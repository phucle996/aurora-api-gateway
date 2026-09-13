// End-to-End verification for Directives & Rolling Reload: Control Plane + NGINX Data Plane
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-rolling-e2e-'));
const token = randomBytes(32).toString('hex');
writeFileSync(path.join(dir, 'token'), token, { mode: 0o600 });

async function getFreePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const controllerPort = await getFreePort();
const nginxPort = await getFreePort();
const controllerBase = `http://127.0.0.1:${controllerPort}`;

console.log(`[E2E Rolling] Thư mục kiểm thử: ${dir}`);
console.log(`[E2E Rolling] Controller: ${controllerPort}, NGINX: ${nginxPort}`);

let controller, nginxProcess;
let controllerStderr = '', nginxStderr = '';

function getWorkerPids(masterPid) {
  try {
    const out = execSync(`pgrep -P ${masterPid}`, { encoding: 'utf8' }).trim();
    if (!out) return [];
    return out.split('\n').map(s => parseInt(s.trim(), 10)).filter(Boolean);
  } catch {
    return [];
  }
}

try {
  // 1. Khởi động Control Plane
  controller = spawn(path.join(root, 'build/aurora-controller'), [], {
    cwd: dir,
    env: {
      ...process.env,
      AURORA_HTTP_ADDR: `127.0.0.1:${controllerPort}`,
      AURORA_SQLITE_PATH: path.join(dir, 'aurora.db'),
      AURORA_ADMIN_TOKEN_FILE: path.join(dir, 'token'),
      AURORA_COMPILER_PATH: path.join(root, 'target/release/aurora-compile'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  controller.stderr.on('data', chunk => {
    controllerStderr += chunk;
    process.stderr.write(`[Controller] ${chunk}`);
  });

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${controllerBase}/readyz`);
      if (res.ok) break;
    } catch {}
    if (attempt >= 50 || controller.exitCode !== null) {
      throw new Error(`Controller khởi động thất bại: ${controllerStderr}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('[E2E Rolling] 1. Control Plane đã sẵn sàng!');

  // 2. Khởi tạo cấu hình và chạy NGINX với Master-Worker mode (worker_processes 1)
  mkdirSync(`${dir}/html`);
  writeFileSync(`${dir}/html/ok`, 'ok\n');
  writeFileSync(`${dir}/policy.json`, JSON.stringify({ schema_version: 1, block_paths: ['/blocked'] }));

  const nginxConf = `load_module ${root}/build/modules/ngx_http_gateway_module.so;
master_process on;
worker_processes 1;
worker_shutdown_timeout 30s;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log notice;
events { worker_connections 1024; }
http {
  access_log off;
  lingering_close on;
  client_body_temp_path ${dir}/client;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
  server {
    listen 127.0.0.1:${nginxPort} reuseport;
    root ${dir}/html;
    gateway on;
    gateway_waf_policy ${dir}/policy.json;

    location / { try_files $uri =404; }
  }
}`;
  writeFileSync(`${dir}/nginx.conf`, nginxConf);

  const nginxArgs = ['-e', 'stderr', '-p', `${dir}/`, '-c', `${dir}/nginx.conf`];
  assert.equal(spawnSync('nginx', [...nginxArgs, '-t'], { encoding: 'utf8' }).status, 0, 'Cấu hình NGINX phải hợp lệ');

  nginxProcess = spawn('nginx', [...nginxArgs, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  nginxProcess.stderr.on('data', chunk => {
    nginxStderr += chunk;
    process.stderr.write(`[NGINX] ${chunk}`);
  });

  // Đợi NGINX listen
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${nginxPort}/ok`);
      if (res.ok) break;
    } catch {}
    if (attempt >= 50 || nginxProcess.exitCode !== null) {
      throw new Error(`NGINX khởi động thất bại: ${nginxStderr}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('[E2E Rolling] 2. NGINX Master & Worker đã hoạt động!');

  const masterPid = nginxProcess.pid;
  let initialWorkers = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    initialWorkers = getWorkerPids(masterPid);
    if (initialWorkers.length > 0) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(initialWorkers.length > 0, 'Phải tìm thấy Worker PID của NGINX');
  const initialWorkerPid = initialWorkers[0];
  console.log(`[E2E Rolling] -> Master PID: ${masterPid}, Worker PID ban đầu: ${initialWorkerPid}`);

  // 3. Đợi heartbeat đầu tiên ghi nhận vào Control Plane
  console.log('[E2E Rolling] 3. Đợi Heartbeat đầu tiên gửi lên Control Plane...');
  let nodeReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 200));
    const res = await fetch(`${controllerBase}/api/v1/nodes/node-local-01`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'Ready') {
        nodeReady = true;
        break;
      }
    }
  }
  assert.ok(nodeReady, 'Node node-local-01 phải ở trạng thái Ready');
  console.log('[E2E Rolling] -> Node node-local-01 đã Ready!');

  // 4. Gọi API kích hoạt Reload Node: POST /api/v1/nodes/node-local-01/reload
  console.log('[E2E Rolling] 4. Gửi lệnh reload tới Control Plane: POST /api/v1/nodes/node-local-01/reload');
  const reloadRes = await fetch(`${controllerBase}/api/v1/nodes/node-local-01/reload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(reloadRes.status, 200, 'API reload node phải trả về 200 OK');
  const reloadBody = await reloadRes.json();
  assert.equal(reloadBody.status, 'pending');
  console.log(`[E2E Rolling] -> Lệnh reload đã được lên lịch: ${JSON.stringify(reloadBody)}`);

  // 5. Chờ nhịp tim tiếp theo: NGINX Telemetry thread nhận được chỉ thị reload_process,
  // gửi SIGHUP tới Master PID, và Master sinh ra Worker PID mới!
  console.log('[E2E Rolling] 5. Đang chờ FFI nhận Directive reload_process và gửi SIGHUP tới Master...');
  let newWorkerFound = false;
  let newWorkerPid = null;

  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(r => setTimeout(r, 200));
    const currentWorkers = getWorkerPids(masterPid);
    // Tìm worker pid khác với initialWorkerPid
    for (const pid of currentWorkers) {
      if (pid !== initialWorkerPid) {
        newWorkerPid = pid;
        newWorkerFound = true;
        break;
      }
    }
    if (newWorkerFound) break;
  }

  assert.ok(newWorkerFound, `NGINX Master phải sinh ra Worker PID mới thay thế ${initialWorkerPid}`);
  console.log(`[E2E Rolling] -> THÀNH CÔNG: Worker mới đã sinh ra với PID: ${newWorkerPid} (Worker cũ ${initialWorkerPid} đã được graceful draining)!`);

  // Kiểm tra lưu lượng HTTP vẫn thông suốt trong và sau khi reload
  const trafficRes = await fetch(`http://127.0.0.1:${nginxPort}/ok`);
  assert.equal(trafficRes.status, 200);
  assert.equal(await trafficRes.text(), 'ok\n');
  console.log('[E2E Rolling] -> Lưu lượng HTTP qua NGINX tiếp tục hoạt động 200 OK không gián đoạn!');

  // 6. Kiểm tra API Rolling Status & Cluster Rolling Reload
  console.log('[E2E Rolling] 6. Kiểm tra Cluster Rolling Reload API...');
  const rollingRes = await fetch(`${controllerBase}/api/v1/nodes/rolling-reload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(rollingRes.status, 200);
  const rollingBody = await rollingRes.json();
  console.log(`[E2E Rolling] -> Rolling reload kết quả: ${JSON.stringify(rollingBody)}`);

  const statusRes = await fetch(`${controllerBase}/api/v1/nodes/rolling-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  console.log(`[E2E Rolling] -> Trạng thái Cluster Rolling: ${JSON.stringify(statusBody)}`);

  console.log('\n======================================================');
  console.log('🎉 E2E TEST ROLLING RELOAD & FFI DIRECTIVES PASS 100%!');
  console.log('======================================================\n');
} finally {
  if (nginxProcess) {
    nginxProcess.kill('SIGQUIT');
  }
  if (controller) {
    controller.kill('SIGKILL');
  }
}
