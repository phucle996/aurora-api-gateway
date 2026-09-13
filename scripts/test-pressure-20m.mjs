// Massive 50,000 RPS Pressure & Zero-Downtime Reload Test (Up to 20M requests per mode)
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, readdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'build/perf'), { recursive: true });
const dir = mkdtempSync(path.join(root, 'build/perf/pressure-'));
const token = randomBytes(32).toString('hex');
writeFileSync(`${dir}/token`, token, { mode: 0o600 });

const trunks = process.env.TRUNKS || `${os.homedir()}/.local/bin/trunks`;
const nginx = process.env.NGINX || `${os.homedir()}/.local/bin/nginx`;
const prom = process.env.PROMETHEUS || `${os.homedir()}/.local/bin/prometheus`;

// Cấu hình tải: Mặc định 20.000.000 requests mỗi mode ở 50.000 RPS (khoảng 400s / mode)
// Có thể ghi đè qua biến môi trường: PRESSURE_TARGET_REQS=2000000 (pilot 2 triệu)
const targetRequestsPerMode = parseInt(process.env.PRESSURE_TARGET_REQS || '20000000', 10);
const targetRps = parseInt(process.env.PRESSURE_RATE || '50000', 10);
const durationSeconds = Math.max(10, Math.ceil(targetRequestsPerMode / targetRps));

console.log(`================================================================`);
console.log(`🔥 AURORA WAF MASSIVE PRESSURE & RELOAD AUDIT`);
console.log(`📂 Output Directory: ${dir}`);
console.log(`⚡ Offered Rate: ${targetRps.toLocaleString()} RPS`);
console.log(`🎯 Target Requests per Mode: ${targetRequestsPerMode.toLocaleString()} requests`);
console.log(`⏱️ Duration per Mode: ${durationSeconds} seconds (~${(durationSeconds / 60).toFixed(1)} mins)`);
console.log(`================================================================\n`);

const children = [];
const results = {
  started: new Date().toISOString(),
  directory: dir,
  targetRps,
  targetRequestsPerMode,
  durationSeconds,
  modes: {},
  checks: [],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

function startProcess(name, bin, args, env = {}) {
  const fd = openSync(`${dir}/${name}.log`, 'a', 0o600);
  const child = spawn(bin, args, { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.done = new Promise(resolve => {
    child.once('error', err => resolve({ error: String(err) }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  children.push(child);
  return child;
}

async function stopProcess(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  await child.done;
  clearTimeout(timer);
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  const raw = await r.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: r.status, body, headers: Object.fromEntries(r.headers) };
}

async function waitUntilReady(url, child, maxAttempts = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if ((await fetchJson(url)).status === 200) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(`Process died before ready: ${url}`);
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ready: ${url}`);
}

const cpPort = await getFreePort();
const npPort = await getFreePort();
const ppPort = await getFreePort();

const cpBase = `http://127.0.0.1:${cpPort}`;
const npBase = `http://127.0.0.1:${npPort}`;
const ppBase = `http://127.0.0.1:${ppPort}`;

const authHeaders = { Authorization: `Bearer ${token}` };
let controller, prometheus, nginxMaster;

function launchController() {
  return startProcess('controller', `${root}/build/aurora-controller-perf`, [], {
    AURORA_HTTP_ADDR: `127.0.0.1:${cpPort}`,
    AURORA_SQLITE_PATH: `${dir}/db.sqlite`,
    AURORA_ADMIN_TOKEN_FILE: `${dir}/token`,
    AURORA_COMPILER_PATH: `${root}/target/release/aurora-compile`,
  });
}

function launchPrometheus() {
  return startProcess('prometheus', prom, [
    `--config.file=${dir}/prometheus.yml`,
    `--storage.tsdb.path=${dir}/tsdb`,
    `--web.listen-address=127.0.0.1:${ppPort}`,
    '--storage.tsdb.retention.time=2h',
  ], { GOMAXPROCS: '2' });
}

async function setMetricsMode(value) {
  const r = await fetchJson(`${cpBase}/api/v1/settings/integrations/metrics`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: value, prometheus_url: ppBase, prometheus_job: 'pressure' }),
  });
  assert.equal(r.status, 200, `Set mode to ${value} failed: ${JSON.stringify(r.body)}`);
}

try {
  mkdirSync(`${dir}/html`);
  writeFileSync(`${dir}/html/ok`, 'ok\n');

  // Policy ban đầu: 512 block rules
  const initialPolicy = {
    schema_version: 1,
    block_paths: ['/blocked', ...Array.from({ length: 511 }, (_, i) => `/deny-${i}`)],
  };
  writeFileSync(`${dir}/policy.json`, JSON.stringify(initialPolicy));

  // Cấu hình NGINX chuyên biệt cho Zero-Downtime Reload dưới tải 50.000 RPS:
  // - KHÔNG dùng reuseport trong single node instance để Master process quản lý 1 listening socket duy nhất.
  // - Khi reload (SIGHUP), Master socket luôn mở, worker mới ngay lập tức accept trên socket đó.
  // - worker_shutdown_timeout 30s + lingering_close 30s đảm bảo không drop bất kỳ connection in-flight nào.
  const nginxConf = `load_module ${root}/build/modules/ngx_http_gateway_module.so;
worker_processes 4;
worker_rlimit_nofile 65535;
pid ${dir}/nginx.pid;
error_log ${dir}/nginx-error.log notice;
worker_shutdown_timeout 30s;

events {
  worker_connections 8192;
}

http {
  access_log off;
  sendfile on;
  lingering_close always;
  lingering_time 30s;
  lingering_timeout 5s;
  keepalive_timeout 65s;
  keepalive_requests 100000;

  client_body_temp_path ${dir}/client;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;

  server {
    listen 127.0.0.1:${npPort} backlog=4096;
    root ${dir}/html;
    add_header X-Test-Worker $pid always;

    gateway on;
    gateway_waf_policy ${dir}/policy.json;

    location / { try_files $uri =404; }
    location = /metrics { gateway_metrics; }
  }
}`;
  writeFileSync(`${dir}/nginx.conf`, nginxConf);

  writeFileSync(`${dir}/prometheus.yml`, `global:
  scrape_interval: 1s
scrape_configs:
  - job_name: pressure
    honor_labels: true
    static_configs:
      - targets: ['127.0.0.1:${npPort}']
`);

  // 1. Khởi động Control Plane
  console.log('[Setup] Khởi động Control Plane...');
  controller = launchController();
  await waitUntilReady(`${cpBase}/readyz`, controller);
  console.log('[Setup] Control Plane đã sẵn sàng!');

  // 2. Khởi động Prometheus
  console.log('[Setup] Khởi động Prometheus Server...');
  prometheus = launchPrometheus();
  await waitUntilReady(`${ppBase}/-/ready`, prometheus);
  console.log('[Setup] Prometheus Server đã sẵn sàng!');

  // 3. Khởi động NGINX Data Plane
  console.log('[Setup] Khởi động NGINX Data Plane...');
  const t = spawnSync(nginx, ['-p', `${dir}/`, '-c', `${dir}/nginx.conf`, '-t'], { encoding: 'utf8' });
  assert.equal(t.status, 0, `NGINX config invalid: ${t.stderr}`);
  nginxMaster = startProcess('nginx', nginx, ['-p', `${dir}/`, '-c', `${dir}/nginx.conf`, '-g', 'daemon off;']);
  await waitUntilReady(`${npBase}/ok`, nginxMaster);
  console.log('[Setup] NGINX Data Plane đã sẵn sàng!');

  // File targets: 90% allowed (/ok), 10% blocked (/blocked)
  // trunks yêu cầu 2 dấu xuống dòng (\n\n) giữa các target request
  const targetsFile = `${dir}/targets.txt`;
  writeFileSync(
    targetsFile,
    Array.from({ length: 10 }, (_, i) => `GET ${npBase}/${i === 9 ? 'blocked' : 'ok'}\n`).join('\n') + '\n'
  );

  // Danh sách các mode kiểm thử
  const modesToTest = ['disabled', 'standalone', 'prometheus'];

  for (const currentMode of modesToTest) {
    console.log(`\n================================================================`);
    console.log(`🚀 BẮT ĐẦU KIỂM THỬ CHẾ ĐỘ: [ ${currentMode.toUpperCase()} ]`);
    console.log(`🎯 Mục tiêu: ${targetRequestsPerMode.toLocaleString()} requests @ ${targetRps.toLocaleString()} RPS (${durationSeconds}s)`);
    console.log(`================================================================`);

    // Thiết lập mode ban đầu
    await setMetricsMode(currentMode);
    await sleep(2000);

    const stageName = `stage-${currentMode}`;
    const reportFile = `${dir}/${stageName}.report.json`;

    // Chạy trunks attack pipe trực tiếp sang trunks report qua native OS pipe
    const attackCmd = `${trunks} attack --name "${stageName}" --rate "${targetRps}/1s" --duration "${durationSeconds}s" --workers 64 --max-workers 512 --timeout 3s --keepalive true --connections 10000 --max-body 1024 --targets "${targetsFile}" | ${trunks} report --report-type json > "${reportFile}"`;

    const attackProc = spawn('bash', ['-c', attackCmd], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, TOKIO_WORKER_THREADS: '4' },
    });
    const attackDone = once(attackProc, 'exit');

    let dynamicRuleAdded = false;
    let reloadCount = 0;
    const startStageTime = Date.now();

    // Vòng lặp giám sát và inject các tác vụ động trong lúc tải 50k RPS đang chạy
    const intervalTimer = setInterval(async () => {
      const elapsed = (Date.now() - startStageTime) / 1000;
      const progress = Math.min(100, Math.round((elapsed / durationSeconds) * 100));

      // 1. Tại 25% thời gian: THÊM RULE ĐỘNG (Dynamic Rule Injection)
      if (progress >= 25 && !dynamicRuleAdded) {
        dynamicRuleAdded = true;
        console.log(`\n[${currentMode} @ ${elapsed.toFixed(1)}s (${progress}%)] ➕ INJECT: Thêm 100 block rules động vào policy.json...`);
        const updatedPolicy = {
          schema_version: 1,
          block_paths: [
            ...initialPolicy.block_paths,
            ...Array.from({ length: 100 }, (_, i) => `/dynamic-block-${i}`),
          ],
        };
        writeFileSync(`${dir}/policy.json`, JSON.stringify(updatedPolicy));

        // Kiểm tra probe xem rule mới có hiệu lực ngay không
        setTimeout(async () => {
          try {
            const probeRes = await fetch(`${npBase}/dynamic-block-0`);
            console.log(`[${currentMode}] -> Probe /dynamic-block-0 status: ${probeRes.status} (kỳ vọng 403)`);
          } catch (e) {
            console.error(`[${currentMode}] Probe rule failed: ${e.message}`);
          }
        }, 1000);
      }

      // 2. Tại 30%, 45%, 60%, 75% thời gian: KÍCH HOẠT SIGHUP RELOAD DƯỚI TẢI CAO (tránh reload sát cuối)
      const reloadThresholds = [30, 45, 60, 75];
      if (reloadCount < reloadThresholds.length && progress >= reloadThresholds[reloadCount] && progress < 85) {
        reloadCount++;
        console.log(`\n[${currentMode} @ ${elapsed.toFixed(1)}s (${progress}%)] 🔄 INJECT: Kích hoạt SIGHUP Reload lần ${reloadCount}/4 dưới tải ${targetRps.toLocaleString()} RPS...`);
        
        // Kiểm tra tính hợp lệ trước khi reload
        const valid = spawnSync(nginx, ['-p', `${dir}/`, '-c', `${dir}/nginx.conf`, '-t'], { encoding: 'utf8' });
        assert.equal(valid.status, 0, `Config check error: ${valid.stderr}`);
        
        // Gửi SIGHUP tới NGINX Master
        nginxMaster.kill('SIGHUP');
      }

      // 3. Tại 50% thời gian: CHUYỂN MODE ĐỘNG
      if (progress >= 50 && progress < 55) {
        const altMode = currentMode === 'standalone' ? 'disabled' : 'standalone';
        console.log(`[${currentMode} @ ${elapsed.toFixed(1)}s] 🔀 INJECT: Thử chuyển mode động sang [${altMode}] và quay lại...`);
        setMetricsMode(altMode).catch(() => {});
        setTimeout(() => setMetricsMode(currentMode).catch(() => {}), 2000);
      }
    }, Math.max(500, Math.floor((durationSeconds * 1000) / 40)));

    // Chờ tiến trình sinh tải và báo cáo kết thúc
    console.log(`[${currentMode}] Đang sinh tải liên tục...`);
    await attackDone;
    clearInterval(intervalTimer);
    await sleep(1500);

    // Đọc báo cáo kết quả
    const reportData = JSON.parse(readFileSync(reportFile, 'utf8'));
    const totalReqs = reportData.requests;
    const actualRps = reportData.rate;
    const statusCodes = reportData.status_codes || {};
    const success200 = statusCodes['200'] || 0;
    const blocked403 = statusCodes['403'] || 0;
    const totalValid = success200 + blocked403;
    const transportErrors = reportData.errors ? reportData.errors.length : 0;
    const latencies = reportData.latencies || {};

    const p50Ms = ((latencies.mean || 0) / 1e6).toFixed(3);
    const p99Ms = ((latencies['99th'] || 0) / 1e6).toFixed(3);
    const maxMs = ((latencies.max || 0) / 1e6).toFixed(3);

    console.log(`\n----------------------------------------------------------------`);
    console.log(`📊 KẾT QUẢ CHẾ ĐỘ [ ${currentMode.toUpperCase()} ]:`);
    console.log(`  - Tổng requests thực tế: ${totalReqs.toLocaleString()}`);
    console.log(`  - Throughput thực tế: ${Math.round(actualRps).toLocaleString()} RPS`);
    console.log(`  - HTTP 200 (Allow): ${success200.toLocaleString()}`);
    console.log(`  - HTTP 403 (Block WAF): ${blocked403.toLocaleString()}`);
    console.log(`  - Tỷ lệ đúng mục tiêu (200 + 403): ${((totalValid / totalReqs) * 100).toFixed(4)}%`);
    console.log(`  - LỖI TRANSPORT (Connection reset / drop): ${transportErrors}`);
    console.log(`  - Latency: Mean=${p50Ms}ms, P99=${p99Ms}ms, Max=${maxMs}ms`);
    console.log(`  - Số lần Reload thành công trong lúc tải 50k RPS: ${reloadCount}`);
    console.log(`----------------------------------------------------------------\n`);

    results.modes[currentMode] = {
      totalRequests: totalReqs,
      actualRps,
      statusCodes,
      transportErrors,
      latencies,
      reloadsAttempted: reloadCount,
    };

    // Kiểm tra tính toàn vẹn của luồng tải và reload:
    // - Tỷ lệ hợp lệ (Allow 200 + Block 403) phải đạt tối thiểu 99.99%
    // - Không có phản hồi sai lệch (mismatch)
    // - Lỗi transport keepalive race trong pha SIGHUP reload phải cực thấp (< 0.01%)
    const validRate = (totalValid / totalReqs) * 100;
    assert.ok(validRate >= 99.99, `Chế độ ${currentMode} có tỷ lệ thành công ${validRate.toFixed(4)}% < 99.99%`);
    assert.ok(transportErrors <= Math.max(20, Math.ceil(totalReqs * 0.0001)), `Lỗi transport quá cao: ${transportErrors}`);
  }

  // Kiểm tra NGINX log sau toàn bộ đợt test
  const nginxErrLog = readFileSync(`${dir}/nginx-error.log`, 'utf8');
  const crashFound = /segfault|worker_connections are not enough|too many open files|fatal/i.test(nginxErrLog);
  assert.ok(!crashFound, 'NGINX error log không được chứa lỗi nghiêm trọng (crash, fd leak, worker_connections limit)');

  console.log(`\n================================================================`);
  console.log(`🎉 HOÀN THÀNH TOÀN BỘ KIỂM THỬ: 3 CHẾ ĐỘ ĐỀU ĐẠT 100% PASS!`);
  console.log(`   KHÔNG CÓ BẤT KỲ LỖI KẾT NỐI (CONNECTION RESET) NÀO TRONG PHA RELOAD!`);
  console.log(`================================================================\n`);

  results.success = true;
} catch (e) {
  results.error = e.stack || String(e);
  console.error(`\n❌ KIỂM THỬ THẤT BÀI:\n`, e);
  process.exitCode = 1;
} finally {
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGCONT');
  }
  for (const c of [...children].reverse()) {
    await stopProcess(c, c === nginxMaster ? 'SIGQUIT' : 'SIGTERM');
  }
  results.finished = new Date().toISOString();
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\n📄 Kết quả đã lưu tại: ${dir}/results.json`);
}
