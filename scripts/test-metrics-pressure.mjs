// Isolated load/recovery audit. Never changes the live controller or Prometheus.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, readdirSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();
mkdirSync(path.join(root, 'build/perf'), { recursive: true });
const dir = mkdtempSync(path.join(root, 'build/perf/metrics-'));
const token = randomBytes(32).toString('hex');
writeFileSync(`${dir}/token`, token, { mode: 0o600 });
const trunks = process.env.TRUNKS || `${os.homedir()}/.local/bin/trunks`;
const nginx = process.env.NGINX || `${os.homedir()}/.local/bin/nginx`;
const prom = process.env.PROMETHEUS || `${os.homedir()}/.local/bin/prometheus`;
const baseline = process.env.AURORA_PRESSURE_PROFILE === 'nginx-baseline';
const children = []; const results = { started: new Date().toISOString(), directory: dir, stages: [], checks: [], samples: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Private harness lifecycle/HTTP functions enforce bounded waits and exact-owned
// process teardown for every stage, including exceptions. No app abstractions.
async function port() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function start(name, bin, args, env = {}) {
    const fd = openSync(`${dir}/${name}.log`, 'a', 0o600);
    const child = spawn(bin, args, { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] }); closeSync(fd);
    child.done = new Promise(resolve => { child.once('error', err => resolve({ error: String(err) })); child.once('exit', (code, signal) => resolve({ code, signal })); });
    children.push(child); return child;
}
async function stop(child, signal = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill(signal); const timer = setTimeout(() => child.kill('SIGKILL'), 8000); await child.done; clearTimeout(timer);
}
async function request(url, options = {}) {
    const r = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) }); const raw = await r.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; }
    return { status: r.status, body, headers: Object.fromEntries(r.headers) };
}
async function ready(url, child) { for (let i = 0; i < 100; i++) { try { if ((await request(url)).status === 200) return; } catch { } if (child.exitCode !== null) throw Error(`startup failed ${url}`); await sleep(100); } throw Error(`not ready ${url}`); }
function check(name, pass, evidence = null) { results.checks.push({ name, pass, evidence }); console.log(`CHECK ${pass ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(evidence).slice(0, 800)}`); }
const cp = await port(), np = await port(), pp = await port();
const cb = `http://127.0.0.1:${cp}`, nb = `http://127.0.0.1:${np}`, pb = `http://127.0.0.1:${pp}`;
const headers = { Authorization: `Bearer ${token}` };
const settings = '/api/v1/settings/integrations/metrics', timeline = '/api/v1/nodes/node-local-01/metrics';
let controller, prometheus, master;
async function mode(value) { const r = await request(cb + settings, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: value, prometheus_url: pb, prometheus_job: 'pressure' }) }); assert.equal(r.status, 200, JSON.stringify(r)); }
function launchController() { return start('controller', `${root}/build/aurora-controller-perf`, [], { AURORA_HTTP_ADDR: `127.0.0.1:${cp}`, AURORA_SQLITE_PATH: `${dir}/db.sqlite`, AURORA_ADMIN_TOKEN_FILE: `${dir}/token`, AURORA_COMPILER_PATH: `${root}/target/release/aurora-compile` }); }
function launchProm() { return start('prometheus', prom, [`--config.file=${dir}/prometheus.yml`, `--storage.tsdb.path=${dir}/tsdb`, `--web.listen-address=127.0.0.1:${pp}`, '--storage.tsdb.retention.time=2h'], { GOMAXPROCS: '2' }); }
function resources() {
    const pids = new Set(children.filter(c => c.exitCode === null && c.signalCode === null).map(c => c.pid));
    try { for (const p of readFileSync(`/proc/${master.pid}/task/${master.pid}/children`, 'utf8').trim().split(/\s+/)) pids.add(Number(p)); } catch { }
    return [...pids].filter(Boolean).flatMap(pid => { try { const status = readFileSync(`/proc/${pid}/status`, 'utf8'); const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return [{ pid, rssKB: Number(status.match(/VmRSS:\s+(\d+)/)?.[1] || 0), threads: Number(status.match(/Threads:\s+(\d+)/)?.[1] || 0), fds: readdirSync(`/proc/${pid}/fd`).length, cpuTicks: Number(stat[11]) + Number(stat[12]) }]; } catch { return []; } });
}
async function attack(name, rate, seconds, { outage = false, reload = false, control = '' } = {}) {
    console.log(`LOAD ${name} rate=${rate}/s duration=${seconds}s`);
    const target = `${dir}/${name}.targets`;
    writeFileSync(target, control ? `GET ${cb}${timeline}\nAuthorization: Bearer ${token}\n` : Array.from({ length: 10 }, (_, i) => `GET ${nb}/${i === 9 ? 'blocked' : 'ok'}\n`).join('\n'), { mode: 0o600 });
    const reportFD = openSync(`${dir}/${name}.report.json`, 'w');
    const reporter = spawn(trunks, ['report', '--report-type', 'json'], { stdio: ['pipe', reportFD, 'pipe'], env: { ...process.env, TOKIO_WORKER_THREADS: '2' } }); closeSync(reportFD);
    const reportDone = once(reporter, 'exit'); let reportError = ''; reporter.stderr.on('data', b => reportError += b);
    const load = spawn(trunks, ['attack', '--name', name, '--rate', `${rate}/1s`, '--duration', `${seconds}s`, '--workers', '64', '--max-workers', '512', '--timeout', '2s', '--max-body', control ? '65536' : '1024', '--targets', target], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TOKIO_WORKER_THREADS: '4' } });
    const loadDone = once(load, 'exit'); let loadError = ''; load.stderr.on('data', b => loadError += b);
    children.push(load, reporter); load.done = loadDone; reporter.done = reportDone;
    const stage = { name, rate, seconds, requests: 0, mismatches: 0, transportErrors: 0, wrongBodies: 0, workerPids: {}, examples: [] };
    let sampling = true; const started = Date.now();
    const sampler = (async () => { while (sampling) { const sample = { stage: name, elapsed: (Date.now() - started) / 1000, resources: resources() }; try { sample.node = await request(cb + '/api/v1/nodes/node-local-01', { headers }); sample.timeline = await request(cb + timeline, { headers }); sample.exporter = await request(nb + '/metrics', { headers: { Connection: 'close' } }); } catch (e) { sample.error = String(e); } results.samples.push(sample); await sleep(2000); } })();
    const disruption = (async () => {
        if (reload) { for (let i = 0; i < 4; i++) { await sleep(seconds * 1000 / 6); const validation = spawnSync(nginx, ['-p', dir + '/', '-c', dir + '/nginx.conf', '-t'], { encoding: 'utf8' }); assert.equal(validation.status, 0, validation.stderr); master.kill('SIGHUP'); } }
        if (outage) { await sleep(3000); controller.kill('SIGSTOP'); if (prometheus) prometheus.kill('SIGSTOP'); await sleep(6000); controller.kill('SIGCONT'); if (prometheus) prometheus.kill('SIGCONT'); }
    })();
    const watchdog = setTimeout(() => load.kill('SIGINT'), (seconds + 15) * 1000);
    try {
        for await (const line of createInterface({ input: load.stdout, crlfDelay: Infinity })) {
            const hit = JSON.parse(line); stage.requests++;
            const expected = control ? (control === 'disabled' ? 503 : 200) : hit.url.endsWith('/blocked') ? 403 : 200;
            if (hit.code !== expected) { stage.mismatches++; if (stage.examples.length < 5) stage.examples.push({ code: hit.code, url: hit.url, error: hit.error }); }
            if (hit.code === 0) stage.transportErrors++;
            if (!control && hit.code === 200 && Buffer.from(hit.body, 'base64').toString() !== 'ok\n') stage.wrongBodies++;
            const pid = hit.headers['x-test-worker']?.[0]; if (pid) stage.workerPids[pid] = (stage.workerPids[pid] || 0) + 1;
            if (!reporter.stdin.write(line + '\n')) await once(reporter.stdin, 'drain');
        }
        stage.loadExit = await loadDone; reporter.stdin.end(); stage.reportExit = await reportDone;
        await disruption; sampling = false; await sampler;
    } finally { clearTimeout(watchdog); sampling = false; controller.kill('SIGCONT'); if (prometheus) prometheus.kill('SIGCONT'); }
    stage.wallSeconds = (Date.now() - started) / 1000; stage.report = JSON.parse(readFileSync(`${dir}/${name}.report.json`, 'utf8')); stage.loadError = loadError; stage.reportError = reportError;
    results.stages.push(stage); writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
    console.log(`RESULT ${name} requests=${stage.requests} mismatch=${stage.mismatches} transport=${stage.transportErrors} latency=${JSON.stringify(stage.report.latencies)}`);
}

try {
    results.host = { cpus: os.cpus().length, cpu: os.cpus()[0].model, memory: os.totalmem(), release: os.release() };
    results.artifacts = Object.fromEntries(['build/aurora-controller-perf', 'build/modules/ngx_http_aurora_waf_module.so'].map(f => [f, createHash('sha256').update(readFileSync(path.join(root, f))).digest('hex')]));
    results.trunks = spawnSync(trunks, ['--version'], { encoding: 'utf8' }).stdout;
    mkdirSync(`${dir}/html`); writeFileSync(`${dir}/html/ok`, 'ok\n');
    writeFileSync(`${dir}/policy.json`, JSON.stringify({ schema_version: 1, block_paths: ['/blocked', ...Array.from({ length: 511 }, (_, i) => `/deny-${i}`)] }));
    writeFileSync(`${dir}/nginx.conf`, `${baseline ? '' : `load_module ${root}/build/modules/ngx_http_aurora_waf_module.so;`}
worker_processes 4; worker_rlimit_nofile 16384; pid ${dir}/nginx.pid; error_log ${dir}/nginx-error.log notice;
worker_shutdown_timeout 30s;
events { worker_connections 4096; }
http { access_log off; sendfile on; client_body_temp_path ${dir}/client; proxy_temp_path ${dir}/proxy; fastcgi_temp_path ${dir}/fastcgi; uwsgi_temp_path ${dir}/uwsgi; scgi_temp_path ${dir}/scgi;
lingering_close on; lingering_time 30s; lingering_timeout 5s;
keepalive_timeout 65s; keepalive_requests 10000;
server { listen 127.0.0.1:${np} reuseport; root ${dir}/html; add_header X-Test-Worker $pid always;
${baseline ? 'location = /blocked { return 403; }' : `aurora_waf on; aurora_waf_policy ${dir}/policy.json; aurora_waf_controller ${cb}; aurora_waf_node_id node-local-01; aurora_waf_token ${token}; aurora_waf_heartbeat_interval 1;`}
location / { try_files $uri =404; } ${baseline ? '' : 'location = /metrics { aurora_waf_metrics; }'}
}}`, { mode: 0o600 });
    writeFileSync(`${dir}/prometheus.yml`, `global:\n  scrape_interval: 1s\nscrape_configs:\n  - job_name: pressure\n    honor_labels: true\n    static_configs:\n      - targets: ['127.0.0.1:${np}']\n`);
    controller = launchController(); await ready(cb + '/readyz', controller);
    const test = spawnSync(nginx, ['-p', dir + '/', '-c', dir + '/nginx.conf', '-t'], { encoding: 'utf8' }); assert.equal(test.status, 0, test.stderr);
    master = start('nginx', nginx, ['-p', dir + '/', '-c', dir + '/nginx.conf', '-g', 'daemon off;']); await ready(nb + '/ok', master);
    for (const current of baseline ? ['disabled'] : ['disabled', 'standalone', 'prometheus']) {
        if (current === 'prometheus') { prometheus = launchProm(); await ready(pb + '/-/ready', prometheus); }
        await mode(current); await sleep(2500);
        check(`${current} timeline contract`, (await request(cb + timeline, { headers })).status === (current === 'disabled' ? 503 : 200));
        if (baseline) {
            await attack('nginx-no-module-100k', 100000, 20);
            await attack('nginx-no-module-200k', 200000, 20);
            await attack('nginx-no-module-soak-reload', 20000, 70, { reload: true }); continue;
        }
        if (process.env.AURORA_PRESSURE_PROFILE === 'read-pressure') {
            await Promise.all([attack(`${current}-timeline-500`, 500, 20, { control: current }), attack(`${current}-with-timeline-readers`, 20000, 20)]);
            continue;
        }
        if (process.env.AURORA_PRESSURE_PROFILE === 'burst') {
            await attack(`${current}-100k`, 100000, 20);
            await attack(`${current}-200k`, 200000, 20);
            continue;
        }
        await attack(`${current}-5k`, 5000, 10);
        await attack(`${current}-20k`, 20000, 20);
        await attack(`${current}-50k`, 50000, 20);
        await attack(`${current}-soak-reload`, 20000, 70, { reload: true });
        const db = new DatabaseSync(`${dir}/db.sqlite`, { readOnly: true }); const history = db.prepare('SELECT count(*) n FROM node_metrics_history').get().n; db.close();
        check(`${current} rollup persisted`, current === 'standalone' ? history > 0 : true, { rows: history });
        await attack(`${current}-dependencies-paused`, 20000, 15, { outage: true });
        check(`${current} controller recovered`, (await request(cb + '/readyz')).status === 200);
    }
    if (!baseline) {
        // Exporter counters with fresh connections are expected to be node-wide and
        // monotonic for the same label set. Group by PID to expose worker isolation.
        const counterSamples = [];
        for (let i = 0; i < 40; i++) { const r = await request(nb + '/metrics', { headers: { Connection: 'close' } }); counterSamples.push({ pid: r.headers['x-test-worker'], total: Number(r.body.match(/action="total"[^\n]*? (\d+)/)?.[1]), cpu: Number(r.body.match(/aurora_node_cpu_percent\{[^\n]*? ([\d.]+)/)?.[1]) }); }
        check('exporter CPU not fixed at fallback 5', counterSamples.some(s => s.cpu !== 5), counterSamples.slice(0, 10));
        const regressions = counterSamples.filter((s, i) => i > 0 && s.total < counterSamples[i - 1].total);
        check('node counter monotonic across workers', regressions.length === 0, { regressions: regressions.length, samples: counterSamples });
        const points = await request(cb + timeline, { headers });
        check('Prometheus memory is populated', Array.isArray(points.body) && points.body.some(p => p.memoryUsage > 0), points.body);
        const wrongJob = await request(cb + settings, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'prometheus', prometheus_url: pb, prometheus_job: 'this-job-does-not-exist' }) });
        assert.equal(wrongJob.status, 200);
        const wrongJobPoints = await request(cb + timeline, { headers });
        check('Prometheus configured job isolates data', Array.isArray(wrongJobPoints.body) && wrongJobPoints.body.length === 0, { points: wrongJobPoints.body.length });
        await mode('prometheus');
        const before = await request(cb + '/api/v1/nodes/node-local-01', { headers });
        await stop(prometheus); const offline = await request(cb + timeline, { headers }); check('Prometheus outage explicit error', offline.status === 503 && offline.body.error === 'PROMETHEUS_UNAVAILABLE', offline);
        check('Prometheus outage leaves enforcement', (await request(nb + '/blocked')).status === 403 && (await request(nb + '/ok')).status === 200, before.body);
        prometheus = launchProm(); await ready(pb + '/-/ready', prometheus); check('Prometheus restart recovery', (await request(cb + timeline, { headers })).status === 200);
        await mode('standalone'); await sleep(2200); await mode('disabled'); await mode('standalone');
        await stop(controller); controller = launchController(); await ready(cb + '/readyz', controller);
        check('mode durable across restart', (await request(cb + settings, { headers })).body.mode === 'standalone');
        check('history recovery after restart', (await request(cb + timeline, { headers })).body.length > 0);
    }
    const log = readFileSync(`${dir}/nginx-error.log`, 'utf8');
    check('no worker crash/connection limit errors', !/exited on signal|segfault|worker_connections are not enough|too many open files/i.test(log), log.match(/.*(?:exited on signal|segfault|worker_connections are not enough|too many open files).*/gi));
} catch (e) { results.fatal = String(e.stack); console.error(e); process.exitCode = 1; }
finally {
    for (const c of children) { if (c.exitCode === null && c.signalCode === null) c.kill('SIGCONT'); }
    for (const c of [...children].reverse()) await stop(c, c === master ? 'SIGQUIT' : 'SIGTERM');
    results.finished = new Date().toISOString(); writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
    console.log(`EVIDENCE ${dir}/results.json`);
    if (results.checks.some(c => !c.pass) || results.stages.some(s => s.mismatches || s.wrongBodies)) process.exitCode = 1;
}
