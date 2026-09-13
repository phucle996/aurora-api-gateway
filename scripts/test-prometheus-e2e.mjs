// End-to-End Prometheus Verification:
// Systemd Prometheus Server <-> NGINX Data Plane Native Exporter <-> Aurora Control Plane
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'aurora-prometheus-e2e-'));
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
const prometheusURL = 'http://127.0.0.1:9090';

console.log(`[E2E Prometheus] Thư mục kiểm thử: ${dir}`);
console.log(`[E2E Prometheus] Controller: ${controllerBase}, NGINX: http://127.0.0.1:${nginxPort}, Prometheus: ${prometheusURL}`);

let controller, nginxProcess;
let controllerStderr = '', nginxStderr = '';
const promConfigPath = path.join(os.homedir(), '.config/prometheus/prometheus.yml');
let originalPromConfig = null;

try {
  // 1. Kiểm tra Prometheus Systemd service có đang sẵn sàng không
  console.log('[E2E Prometheus] 1. Kiểm tra trạng thái Prometheus Server...');
  const promReadyRes = await fetch(`${prometheusURL}/-/ready`);
  assert.equal(promReadyRes.status, 200, 'Prometheus Server trên systemd phải trả về ready (HTTP 200)');
  console.log('[E2E Prometheus] -> Prometheus Server is Ready!');

  // Lưu lại cấu hình Prometheus gốc để khôi phục sau test
  try {
    originalPromConfig = readFileSync(promConfigPath, 'utf8');
  } catch {}

  // 2. Khởi động Aurora Control Plane
  console.log('[E2E Prometheus] 2. Khởi động Control Plane...');
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
  console.log('[E2E Prometheus] -> Control Plane đã sẵn sàng!');

  // 3. Test kết nối Prometheus thông qua Control Plane API
  console.log('[E2E Prometheus] 3. Kiểm tra khả năng kết nối Prometheus qua API Control Plane...');
  const testConnRes = await fetch(`${controllerBase}/api/v1/settings/integrations/metrics/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url: prometheusURL }),
  });
  assert.equal(testConnRes.status, 200);
  const testResult = await testConnRes.json();
  assert.equal(testResult.success, true, 'Test kết nối tới Prometheus phải thành công');
  console.log(`[E2E Prometheus] -> Test kết nối thành công: ${testResult.message} (${testResult.latency_ms}ms)`);

  // 4. Cấu hình Control Plane chuyển sang mode 'prometheus'
  console.log('[E2E Prometheus] 4. Kích hoạt chế độ PROMETHEUS trên Control Plane...');
  const setPromRes = await fetch(`${controllerBase}/api/v1/settings/integrations/metrics`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: 'prometheus',
      prometheus_url: prometheusURL,
      prometheus_job: 'aurora-waf-nodes',
    }),
  });
  assert.equal(setPromRes.status, 200);
  console.log('[E2E Prometheus] -> Đã lưu cấu hình chế độ Prometheus thành công!');

  // 5. Cập nhật cấu hình Prometheus cào NGINX node và nạp lại qua /-/reload
  console.log(`[E2E Prometheus] 5. Cấu hình Prometheus cào NGINX tại 127.0.0.1:${nginxPort}...`);
  const testPromConfig = `global:
  scrape_interval: 1s
  evaluation_interval: 1s

scrape_configs:
  - job_name: 'aurora-waf-nodes'
    honor_labels: true
    metrics_path: '/metrics'
    static_configs:
      - targets: ['127.0.0.1:${nginxPort}']
`;
  writeFileSync(promConfigPath, testPromConfig);
  const reloadRes = await fetch(`${prometheusURL}/-/reload`, { method: 'POST' });
  assert.equal(reloadRes.status, 200, 'Prometheus config reload phải trả về 200');
  console.log('[E2E Prometheus] -> Đã reload cấu hình Prometheus thành công!');

  // 6. Khởi tạo cấu hình và chạy NGINX Data Plane
  console.log('[E2E Prometheus] 6. Khởi động NGINX Data Plane...');
  mkdirSync(`${dir}/html`);
  writeFileSync(`${dir}/html/ok`, 'ok\n');
  writeFileSync(`${dir}/policy.json`, JSON.stringify({ schema_version: 1, block_paths: ['/blocked'] }));

  const nginxConf = `load_module ${root}/build/modules/ngx_http_gateway_module.so;
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
    gateway on;
    gateway_waf_policy ${dir}/policy.json;

    location / { try_files $uri =404; }
    location = /metrics { gateway_metrics; }
  }
}`;
  writeFileSync(`${dir}/nginx.conf`, nginxConf);

  const nginxArgs = ['-e', 'stderr', '-p', `${dir}/`, '-c', `${dir}/nginx.conf`];
  assert.equal(spawnSync('nginx', [...nginxArgs, '-t'], { encoding: 'utf8' }).status, 0);

  nginxProcess = spawn('nginx', [...nginxArgs, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  nginxProcess.stderr.on('data', chunk => { nginxStderr += chunk; });

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
  console.log('[E2E Prometheus] -> NGINX Data Plane đã sẵn sàng!');

  // Sinh traffic
  for (let i = 0; i < 15; i++) {
    await fetch(`http://127.0.0.1:${nginxPort}/ok`);
  }
  await fetch(`http://127.0.0.1:${nginxPort}/blocked`);

  // 7. Xác nhận nhịp tim vẫn cập nhật Node status = Ready trong mode Prometheus
  console.log('[E2E Prometheus] 7. Kiểm tra nhịp tim liveness trên Control Plane...');
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
  assert.ok(nodeDetail, 'Node phải nhận được nhịp tim và ở trạng thái Ready');
  console.log(`[E2E Prometheus] -> Nhịp tim liveness hoạt động chuẩn: status=${nodeDetail.status}, CPU=${nodeDetail.cpuUsage.toFixed(1)}%`);

  // 8. Đợi Prometheus scrape NGINX exporter (chờ 3-4 giây cho 2-3 chu kỳ scrape)
  console.log('[E2E Prometheus] 8. Đợi Prometheus cào dữ liệu từ NGINX /metrics...');
  let scraped = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 1000));
    const queryRes = await fetch(`${prometheusURL}/api/v1/query?query=aurora_node_cpu_percent{node_id="node-local-01"}`);
    if (queryRes.ok) {
      const qData = await queryRes.json();
      if (qData.data && qData.data.result && qData.data.result.length > 0) {
        scraped = true;
        console.log(`[E2E Prometheus] -> Prometheus đã cào thành công metric: ${JSON.stringify(qData.data.result[0].value)}`);
        break;
      }
    }
  }
  assert.ok(scraped, 'Prometheus phải cào được metric từ NGINX exporter');

  // Chờ 2 giây để Prometheus scrape thêm mẫu và thời gian trôi qua mốc giây evaluate tiếp theo của query_range
  console.log('[E2E Prometheus] Đợi 2 giây để TSDB ghi nhận chu kỳ tiếp theo...');
  await new Promise(r => setTimeout(r, 2000));

  // 9. Kiểm tra endpoint Timeline Metrics của Control Plane (/api/v1/nodes/node-local-01/metrics)
  console.log('[E2E Prometheus] 9. Kiểm tra Control Plane chuyển tiếp dữ liệu Timeline từ Prometheus...');
  const clientMetricsRes = await fetch(`${controllerBase}/api/v1/nodes/node-local-01/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`[E2E Prometheus] -> Control Plane metrics status: ${clientMetricsRes.status}`);
  const points = await clientMetricsRes.json();
  console.log(`[E2E Prometheus] -> Control Plane metrics body:`, JSON.stringify(points));
  assert.equal(clientMetricsRes.status, 200, 'Control Plane phải trả về HTTP 200');
  assert.ok(Array.isArray(points), 'Metrics phải là một mảng');
  assert.ok(points.length > 0, 'Phải có ít nhất 1 điểm đo trả về từ Prometheus');
  console.log(`[E2E Prometheus] -> Nhận được ${points.length} điểm đo từ Prometheus qua Control Plane! Mẫu:`, points[points.length - 1]);

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ CÁC BƯỚC KIỂM THỬ VỚI PROMETHEUS ĐỀU PASS 100%!');
  console.log('======================================================\n');
} finally {
  // Khôi phục cấu hình Prometheus
  if (originalPromConfig) {
    try {
      writeFileSync(promConfigPath, originalPromConfig);
      await fetch(`${prometheusURL}/-/reload`, { method: 'POST' });
    } catch {}
  }
  if (nginxProcess) {
    nginxProcess.kill('SIGKILL');
  }
  if (controller) {
    controller.kill('SIGKILL');
  }
}
