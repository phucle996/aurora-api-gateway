// End-to-End standalone verification: Control Plane + NGINX Data Plane + Native Telemetry Heartbeat
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-standalone-e2e-'));
const token = randomBytes(32).toString('hex');
writeFileSync(path.join(dir, 'token'), token, { mode: 0o600 });

// Lấy 2 cổng ngẫu nhiên khả dụng: 1 cho Controller, 1 cho NGINX
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

console.log(`[E2E Standalone] Thư mục kiểm thử: ${dir}`);
console.log(`[E2E Standalone] Controller port: ${controllerPort}, NGINX port: ${nginxPort}`);

let controller, nginxProcess;
let controllerStderr = '', nginxStderr = '';

try {
  // 1. Khởi động Control Plane Controller
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
    process.stderr.write(`[Controller Log] ${chunk}`);
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
  console.log('[E2E Standalone] 1. Control Plane đã sẵn sàng!');

  // 2. Kiểm tra cấu hình ban đầu: Mặc định là 'disabled'
  const initConfigRes = await fetch(`${controllerBase}/api/v1/settings/integrations/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(initConfigRes.status, 200);
  const initConfig = await initConfigRes.json();
  assert.equal(initConfig.mode, 'disabled', 'Mặc định cấu hình DB ban đầu phải là disabled');
  console.log('[E2E Standalone] 2. Trạng thái ban đầu của Metrics Service: disabled');

  // 3. Khởi tạo cấu hình và chạy NGINX với native telemetry trỏ về Control Plane
  mkdirSync(`${dir}/html`);
  writeFileSync(`${dir}/html/ok`, 'ok\n');
  writeFileSync(`${dir}/policy.json`, JSON.stringify({ schema_version: 1, block_paths: ['/blocked'] }));

  const nginxConf = `load_module ${root}/build/modules/ngx_http_aurora_waf_module.so;
worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log notice;
events { worker_connections 1024; }
http {
  access_log off;
  client_body_temp_path ${dir}/client;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
  server {
    listen 127.0.0.1:${nginxPort};
    root ${dir}/html;
    aurora_waf on;
    aurora_waf_policy ${dir}/policy.json;
    aurora_waf_controller ${controllerBase};
    aurora_waf_node_id node-local-01;
    aurora_waf_token ${token};
    aurora_waf_heartbeat_interval 1;

    location / { try_files $uri =404; }
    location = /metrics { aurora_waf_metrics; }
  }
}`;
  writeFileSync(`${dir}/nginx.conf`, nginxConf);

  const nginxArgs = ['-e', 'stderr', '-p', `${dir}/`, '-c', `${dir}/nginx.conf`];
  assert.equal(spawnSync('nginx', [...nginxArgs, '-t'], { encoding: 'utf8' }).status, 0, 'Cấu hình NGINX phải hợp lệ');

  nginxProcess = spawn('nginx', [...nginxArgs, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  nginxProcess.stderr.on('data', chunk => { nginxStderr += chunk; });

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
  console.log('[E2E Standalone] 3. NGINX Data Plane đã khởi động thành công!');

  // Gửi traffic
  for (let i = 0; i < 10; i++) {
    await fetch(`http://127.0.0.1:${nginxPort}/ok`);
  }
  await fetch(`http://127.0.0.1:${nginxPort}/blocked`);

  // 4. Kiểm tra LUỒNG DISABLED:
  // - Heartbeat vẫn phải được gửi và ghi nhận: Node status = Ready, CPU/RAM tức thời vẫn hiển thị
  // - Timeline metrics endpoint phải trả về HTTP 503 với lỗi METRICS_DISABLED
  console.log('[E2E Standalone] 4. Kiểm thử luồng DISABLED: Đợi nhịp tim của NGINX đến Control Plane...');
  let nodeDetail;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 200));
    const res = await fetch(`${controllerBase}/api/v1/nodes/node-local-01`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'Ready') {
        nodeDetail = data;
        break;
      }
    }
  }

  assert.ok(nodeDetail, 'Phải nhận được thông tin heartbeat của node-local-01 ngay cả khi Metrics bị disabled');
  assert.equal(nodeDetail.status, 'Ready', 'Trạng thái node vẫn phải là Ready khi disabled metrics');
  assert.ok(nodeDetail.cpuUsage >= 0, 'cpuUsage liveness vẫn phải hiển thị');
  assert.ok(nodeDetail.memoryUsage >= 0, 'memoryUsage liveness vẫn phải hiển thị');
  console.log(`[E2E Standalone] -> Nhịp tim liveness sống tốt trong mode DISABLED! status=${nodeDetail.status}, CPU=${nodeDetail.cpuUsage.toFixed(1)}%, RAM=${nodeDetail.memoryUsage.toFixed(1)}%`);

  // Kiểm tra timeline metrics bị disable
  const disabledMetricsRes = await fetch(`${controllerBase}/api/v1/nodes/node-local-01/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(disabledMetricsRes.status, 503, 'Khi disabled, API timeline metrics phải trả về HTTP 503');
  const disabledBody = await disabledMetricsRes.json();
  assert.equal(disabledBody.error, 'METRICS_DISABLED', 'Mã lỗi phải là METRICS_DISABLED');
  console.log(`[E2E Standalone] -> Timeline metrics trả về đúng 503 METRICS_DISABLED: "${disabledBody.message}"`);

  // 5. CHUYỂN SANG CHẾ ĐỘ 'standalone'
  console.log('[E2E Standalone] 5. Chuyển cấu hình sang chế độ STANDALONE qua API...');
  const setStandaloneRes = await fetch(`${controllerBase}/api/v1/settings/integrations/metrics`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: 'standalone' }),
  });
  assert.equal(setStandaloneRes.status, 200, 'Kích hoạt standalone phải trả về 200 OK');

  // Chờ 1.5 giây để NGINX gửi thêm heartbeat vào in-memory ring buffer
  await new Promise(r => setTimeout(r, 1500));

  // Kiểm tra Timeline Metrics trong In-Memory Ring Buffer
  const metricsRes = await fetch(`${controllerBase}/api/v1/nodes/node-local-01/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(metricsRes.status, 200, 'Lấy timeline metrics trong mode standalone phải trả về 200');
  const points = await metricsRes.json();
  assert.ok(Array.isArray(points), 'Metrics phải là một mảng');
  assert.ok(points.length > 0, 'Phải có ít nhất 1 điểm đo timeline trong Ring Buffer');
  console.log(`[E2E Standalone] -> Timeline Ring Buffer: Đã nhận được ${points.length} điểm đo thời gian thực!`);

  // 6. CHUYỂN NGƯỢC LẠI 'disabled' ĐỂ KIỂM TRA HOT-SWAP
  console.log('[E2E Standalone] 6. Chuyển cấu hình ngược lại DISABLED để kiểm tra Hot-Swap...');
  const setDisabledRes = await fetch(`${controllerBase}/api/v1/settings/integrations/metrics`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: 'disabled' }),
  });
  assert.equal(setDisabledRes.status, 200);

  const disabledAgainRes = await fetch(`${controllerBase}/api/v1/nodes/node-local-01/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(disabledAgainRes.status, 503, 'Sau khi hot-swap về disabled, endpoint timeline phải trả về 503 ngay lập tức');
  console.log('[E2E Standalone] -> Hot-swap về DISABLED tức thì thành công (503 METRICS_DISABLED)!');

  // 7. Kiểm tra OpenMetrics endpoint /metrics của NGINX
  const nginxMetrics = await fetch(`http://127.0.0.1:${nginxPort}/metrics`);
  assert.equal(nginxMetrics.status, 200);
  const metricsText = await nginxMetrics.text();
  assert.ok(metricsText.includes('aurora_waf_evaluations_total'));
  assert.ok(metricsText.includes('aurora_node_cpu_percent'));
  console.log('[E2E Standalone] 7. Native Prometheus Exporter của NGINX vẫn độc lập và hoạt động hoàn hảo!');

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ CÁC BƯỚC KIỂM THỬ (DISABLED & STANDALONE) ĐỀU PASS 100%!');
  console.log('======================================================\n');
} finally {
  if (nginxProcess) {
    nginxProcess.kill('SIGKILL');
  }
  if (controller) {
    controller.kill('SIGKILL');
  }
}
