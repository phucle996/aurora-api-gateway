import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { RateLimitMeasurement } from './measurement.mjs';

export async function runRateLimitLoad(lab, scenario, during) {
  const id = `load-${String(lab.report.loads.length + 1).padStart(3, '0')}-${scenario.name}`;
  const targetFile = path.join(lab.dir, `${id}.targets`);
  const rawFile = path.join(lab.dir, `${id}.jsonl`);
  const targets = [];
  for (let i = 0; i < (scenario.keys || 1); i++) {
    const node = lab.nodes[i % lab.nodes.length];
    targets.push(`GET ${scenario.direct ? lab.origin : node.url}${scenario.path || '/bench/item'}\nHost: rate-limit.test\nX-Api-Key: bench-${i}\n\n`);
  }
  writeFileSync(targetFile, targets.join(''));
  const args = ['attack', '--name', id, '--targets', targetFile, '--output', rawFile,
    '--encode', 'json', '--duration', `${scenario.seconds}s`, '--rate', `${scenario.rps}/1s`,
    '--workers', '16', '--max-workers', String(lab.options.maxLoadWorkers), '--timeout', `${lab.options.timeoutMs}ms`,
    '--keepalive', String(scenario.keepalive !== false), '--http2', 'false', '--max-body', '0'];
  if (scenario.pace === 'linear') args.push('--pace', 'linear', '--slope', String(scenario.slope));
  const measurement = new RateLimitMeasurement();
  const start = Date.now();
  const cpuBefore = process.cpuUsage();
  const resourcesBefore = {};
  for (const node of lab.nodes) {
    const out = await lab.docker(['exec', '-T', node.id, 'cat', '/sys/fs/cgroup/cpu.stat'], { allowFailure: true });
    resourcesBefore[node.id] = out.code === 0 ? out.stdout : null;
  }
  const child = spawn(process.env.TRUNKS || 'trunks', args, { env: { ...process.env, TOKIO_WORKER_THREADS: '4' }, stdio: ['ignore', 'ignore', 'pipe'] });
  lab.children.add(child);
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const stats = spawn('docker', ['stats', '--format', '{{json .}}', '--no-trunc',
    ...lab.nodes.map(n => `${lab.project}-${n.id}-1`), `${lab.project}-redis-1`, `${lab.project}-origin-1`, `${lab.project}-controller-1`], { stdio: ['ignore', 'pipe', 'pipe'] });
  lab.children.add(stats);
  let statsBuffer = ''; let statsError = '';
  const samples = [];
  stats.stderr.on('data', b => { statsError += b; });
  stats.on('error', e => { statsError += e.message; });
  stats.stdout.on('data', data => {
    statsBuffer += data;
    const lines = statsBuffer.split('\n'); statsBuffer = lines.pop();
    for (const line of lines) {
      try { const sample = { at: Date.now(), ...JSON.parse(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')) };
        samples.push(sample); appendFileSync(path.join(lab.dir, 'resources.jsonl'), JSON.stringify({ load: id, ...sample }) + '\n');
      } catch { /* Retain raw diagnostic if Docker emits a non-JSON line. */ statsError += line; }
    }
  });
  const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
  const deadline = setTimeout(() => child.kill('SIGTERM'), (scenario.seconds * 1000) + lab.options.timeoutMs + 15000);
  let mutationError; const mutation = during ? during().catch(error => { mutationError = error; }) : Promise.resolve();
  let status;
  try { status = await completed; await mutation; }
  finally { clearTimeout(deadline); stats.kill('SIGTERM'); lab.children.delete(stats); lab.children.delete(child); }
  writeFileSync(path.join(lab.dir, `${id}.stderr.log`), stderr);
  const resourcesAfter = {};
  for (const node of lab.nodes) {
    const out = await lab.docker(['exec', '-T', node.id, 'cat', '/sys/fs/cgroup/cpu.stat'], { allowFailure: true });
    resourcesAfter[node.id] = out.code === 0 ? out.stdout : null;
  }
  for await (const line of createInterface({ input: createReadStream(rawFile), crlfDelay: Infinity })) {
    if (line.trim()) measurement.add(JSON.parse(line));
  }
  const summary = measurement.finish();
  const offered = scenario.pace === 'linear'
    ? scenario.rps * scenario.seconds + 0.5 * scenario.slope * scenario.seconds ** 2
    : scenario.rps * scenario.seconds;
  const unexpected = Object.entries(summary.statusCodes).filter(([code]) => !scenario.expectedStatuses.includes(Number(code)));
  const result = { id, scenario, ...summary, started: new Date(start).toISOString(), wallMs: Date.now() - start,
    offeredRequests: offered, emissionRatio: summary.requests / offered, offeredRps: scenario.rps,
    validLoad: status.code === 0 && summary.requests >= offered * 0.95, unexpectedStatuses: Object.fromEntries(unexpected),
    resources: { samples, before: resourcesBefore, after: resourcesAfter, sampling: 'Docker stats approximately 1 second; node cpu.stat around load', error: statsError || null },
    generator: { command: args, orchestratorCpuMicros: process.cpuUsage(cpuBefore), maxWorkers: lab.options.maxLoadWorkers,
      schedulerLag: null, coordinatedOmissionCorrection: null, note: 'Raw generator request latency; fixed offered rate. Emission deficit invalidates the load; scheduler lag is not exposed by trunks.' },
    rawArtifact: path.basename(rawFile), pass: status.code === 0 && unexpected.length === 0 && Object.keys(summary.errors).length === 0 && !mutationError };
  lab.report.loads.push(result);
  console.log(`LOAD ${id}: ${summary.requests} req; ${summary.achievedRps?.toFixed(1)} RPS; p99 ${summary.latencyMs.p99?.toFixed(3)} ms; status ${JSON.stringify(summary.statusCodes)}; valid=${result.validLoad}`);
  assert.equal(status.code, 0, stderr);
  assert.ok(result.validLoad, 'Generator failed to emit at least 95% of requested load');
  assert.equal(unexpected.length, 0, `Unexpected HTTP statuses: ${JSON.stringify(unexpected)}`);
  assert.equal(Object.keys(summary.errors).length, 0, JSON.stringify(summary.errors));
  if (mutationError) throw mutationError;
  return result;
}
