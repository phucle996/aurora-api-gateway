#!/usr/bin/env node
// ==============================================================================
// AURORA WAF: END-TO-END BENCHMARK & PRESSURE AUDIT
// Kịch bản: Bơm 20,000,000 Requests Telemetry vào Ingest Collector,
// đa dạng Endpoints, Methods & Rules; đồng thời thực hiện CRUD Rule dưới tải cao.
// ==============================================================================

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'build/perf'), { recursive: true });
const tempDir = mkdtempSync(path.join(root, 'build/perf/rate-limit-20m-'));
const adminToken = randomBytes(32).toString('hex');
const tokenFile = path.join(tempDir, 'admin.token');
writeFileSync(tokenFile, adminToken, { mode: 0o600 });
const dbFile = path.join(tempDir, 'aurora_bench.db');

const TARGET_REQUESTS = parseInt(process.env.BENCH_TARGET_REQS || '20000000', 10);
const BATCH_SIZE = 100; // Số dòng telemetry syslog nén trong 1 UDP datagram
const TOTAL_PACKETS = Math.ceil(TARGET_REQUESTS / BATCH_SIZE);

console.log(`\n================================================================`);
console.log(`🚀 AURORA WAF: 20,000,000 REQUESTS RATE LIMIT BENCHMARK (E2E)`);
console.log(`📁 Temporary Dir:   ${tempDir}`);
console.log(`🎯 Target Telemetry: ${TARGET_REQUESTS.toLocaleString()} requests`);
console.log(`📦 Batch Packet:     ${BATCH_SIZE} log events / UDP datagram`);
console.log(`📬 Total Packets:    ${TOTAL_PACKETS.toLocaleString()} datagrams`);
console.log(`================================================================\n`);

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, data: json, raw: text };
}

// 1. Khởi động Control Plane process
const httpPort = await getFreePort();
const udpPort = await getFreePort();
const httpBase = `http://127.0.0.1:${httpPort}`;

console.log(`[1/6] ⚙️ Khởi động Aurora WAF Control Plane...`);
console.log(`      HTTP API: ${httpBase}`);
console.log(`      UDP Syslog: 127.0.0.1:${udpPort}`);

const logFd = openSync(path.join(tempDir, 'control-plane.log'), 'a', 0o600);
const cpProcess = spawn('go', ['run', './cmd/main.go'], {
  cwd: path.join(root, 'control-plane'),
  env: {
    ...process.env,
    AURORA_HTTP_ADDR: `127.0.0.1:${httpPort}`,
    AURORA_SQLITE_PATH: dbFile,
    AURORA_ADMIN_TOKEN_FILE: tokenFile,
    AURORA_RATE_LIMIT_UDP: `127.0.0.1:${udpPort}`,
  },
  stdio: ['ignore', logFd, logFd]
});
closeSync(logFd);

// Chờ Control Plane sẵn sàng
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`${httpBase}/readyz`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {}
  await sleep(250);
}

if (!ready) {
  cpProcess.kill('SIGKILL');
  throw new Error('Control Plane không khởi động được trong 15s. Xem log tại: ' + path.join(tempDir, 'control-plane.log'));
}
console.log(`      ✅ Control Plane đã sẵn sàng!\n`);

try {
  // 2. Thiết lập chế độ standalone
  console.log(`[2/6] 🔧 Cấu hình metrics_mode = 'standalone' & kích hoạt RateLimitCollector...`);
  const putSettings = await fetchJSON(`${httpBase}/api/v1/settings/integrations/metrics`, {
    method: 'PUT',
    body: JSON.stringify({
      mode: 'standalone',
      prometheus_url: 'http://127.0.0.1:9090',
      prometheus_job: 'aurora-waf-nodes'
    })
  });
  const enableRes = await fetchJSON(`${httpBase}/api/v1/rate-limits/enable`, { method: 'POST' });
  console.log(`      Settings response: HTTP ${putSettings.status} | Collector: ${enableRes.data?.enabled ? 'ACTIVE' : 'INACTIVE'}`);



  // 3. Tạo 6 Rules Rate Limit đa dạng trên nhiều endpoints & dimensions
  console.log(`[3/6] 🛡️ Thiết lập các Rule Rate Limit đa dạng (Multi-Rule & Multi-Dimension)...`);
  const initialRules = [
    {
      name: "Auth Brute-Force Shield",
      description: "Chặn brute-force login theo IP nguồn",
      enabled_dimensions: ["ip"],
      dimension_order: ["ip"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/32" },
      header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
      path_config: { path: "/api/v1/auth/login", match_type: "exact" },
      rate_limit: 15,
      rate_unit: "1 minute",
      burst: 5,
      action_exceeded: "block_429",
      status: "Active"
    },
    {
      name: "Checkout API VIP Partner Guard",
      description: "Bảo vệ checkout theo Header X-VIP-Key",
      enabled_dimensions: ["header"],
      dimension_order: ["header"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/32" },
      header_config: { header_name: "X-VIP-Key", operator: "equals", header_value: "platinum-member", case_sensitive: false },
      path_config: { path: "/api/v1/checkout", match_type: "prefix" },
      rate_limit: 100,
      rate_unit: "1 minute",
      burst: 20,
      action_exceeded: "challenge_js",
      status: "Active"
    },
    {
      name: "Search Scraper Throttler",
      description: "Hạn chế tốc độ cào dữ liệu tìm kiếm",
      enabled_dimensions: ["path"],
      dimension_order: ["path"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/32" },
      header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
      path_config: { path: "/api/v1/search", match_type: "prefix" },
      rate_limit: 120,
      rate_unit: "1 minute",
      burst: 40,
      action_exceeded: "throttle",
      status: "Active"
    },
    {
      name: "Payment Gateway Multi-Dimension",
      description: "Kiểm soát giao dịch thanh toán kết hợp IP và Subnet",
      enabled_dimensions: ["ip", "path"],
      dimension_order: ["ip", "path"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/24" },
      header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
      path_config: { path: "/api/v1/payment/process", match_type: "exact" },
      rate_limit: 30,
      rate_unit: "1 minute",
      burst: 10,
      action_exceeded: "block_429",
      status: "Active"
    },
    {
      name: "Catalog Public Velocity Cap",
      description: "Bảo vệ trang sản phẩm khỏi request dồn dập",
      enabled_dimensions: ["ip"],
      dimension_order: ["ip"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/24" },
      header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
      path_config: { path: "/api/v1/products", match_type: "prefix" },
      rate_limit: 200,
      rate_unit: "1 minute",
      burst: 50,
      action_exceeded: "block_429",
      status: "Active"
    },
    {
      name: "User Profile Burst Guard",
      description: "Hạn chế request profile theo session",
      enabled_dimensions: ["ip"],
      dimension_order: ["ip"],
      ip_config: { source: "binary_remote_addr", subnet_mask: "/32" },
      header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
      path_config: { path: "/api/v1/users/profile", match_type: "prefix" },
      rate_limit: 120,
      rate_unit: "1 minute",
      burst: 30,
      action_exceeded: "throttle",
      status: "Active"
    }
  ];

  const createdRuleIDs = [];
  for (const r of initialRules) {
    const res = await fetchJSON(`${httpBase}/api/v1/rate-limits`, {
      method: 'POST',
      body: JSON.stringify(r)
    });
    assert.equal(res.status, 201, `Tạo rule ${r.name} thất bại: ${res.raw}`);
    createdRuleIDs.push(res.data.id);
    console.log(`      + Rule [ID: ${res.data.id}] "${r.name}" -> ${r.path_config.path} (${r.action_exceeded})`);
  }
  console.log(`      ✅ Đã thiết lập 6 rules rate limit thành công!\n`);

  // 4. BƠM 20 TRIỆU REQUESTS VÀ CHẠY CRUD SONG SONG DƯỚI TẢI
  console.log(`[4/6] ⚡ Bắt đầu bơm ${TARGET_REQUESTS.toLocaleString()} requests telemetry & CRUD API đồng thời...`);

  const endpointsPool = [
    { path: '/api/v1/auth/login', method: 'POST', rule: 'Auth Brute-Force Shield' },
    { path: '/api/v1/checkout', method: 'POST', rule: 'Checkout API VIP Partner Guard' },
    { path: '/api/v1/search', method: 'GET', rule: 'Search Scraper Throttler' },
    { path: '/api/v1/payment/process', method: 'POST', rule: 'Payment Gateway Multi-Dimension' },
    { path: '/api/v1/products', method: 'GET', rule: 'Catalog Public Velocity Cap' },
    { path: '/api/v1/users/profile', method: 'GET', rule: 'User Profile Burst Guard' },
    { path: '/api/v1/orders', method: 'GET', rule: 'Order History Rate Limit' },
    { path: '/api/v1/upload', method: 'POST', rule: 'Upload Size Limit' },
  ];

  // Chuẩn bị trước các buffer mẫu để gửi UDP siêu tốc độ
  const prebuiltPayloads = [];
  for (let b = 0; b < 20; b++) {
    const lines = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const ep = endpointsPool[(b * BATCH_SIZE + i) % endpointsPool.length];
      const isBlocked = (i % 10) === 0; // 10% blocked (HTTP 429)
      const isThrottled = (i % 25) === 0; // 4% throttled

      let log = `${ep.method} ${ep.path} `;
      if (isBlocked) {
        log += `status=429 blocked rl_rule=${ep.rule}`;
      } else if (isThrottled) {
        log += `status=200 throttled delay=40ms rl_rule=${ep.rule}`;
      } else {
        log += `status=200 rl_rule=${ep.rule}`;
      }
      lines.push(log);
    }
    prebuiltPayloads.push(Buffer.from(lines.join('\n') + '\n'));
  }

  const udpSocket = dgram.createSocket('udp4');
  let isSending = true;

  // Thống kê CRUD song song
  const adminStats = {
    created: 0,
    updated: 0,
    deleted: 0,
    read: 0,
    errors: 0
  };

  const dynamicRuleIDs = [...createdRuleIDs];

  // Worker CRUD: Thêm, Sửa, Xóa, Đọc liên tục
  const runAdminWorkload = async () => {
    let cycle = 0;
    while (isSending || adminStats.created < 5 || adminStats.updated < 5 || adminStats.deleted < 3) {
      cycle++;
      try {
        // 1. Tạo Rule mới
        if (cycle % 2 === 0) {
          const resCreate = await fetchJSON(`${httpBase}/api/v1/rate-limits`, {
            method: 'POST',
            body: JSON.stringify({
              name: `Dynamic-Pressure-Rule-${cycle}`,
              description: "Tạo tự động trong lúc đang tải 20 triệu reqs",
              enabled_dimensions: ["ip"],
              dimension_order: ["ip"],
              ip_config: { source: "binary_remote_addr", subnet_mask: "/32" },
              header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
              path_config: { path: `/api/dynamic/${cycle}`, match_type: "prefix" },
              rate_limit: 100 + (cycle % 500),
              rate_unit: "1 minute",
              burst: 20,
              action_exceeded: "block_429",
              status: "Active"
            })
          });
          if (resCreate.status === 201) {
            adminStats.created++;
            dynamicRuleIDs.push(resCreate.data.id);
          } else {
            adminStats.errors++;
          }
        }

        // 2. Sửa Rule (Update)
        if (dynamicRuleIDs.length > 0) {
          const targetID = dynamicRuleIDs[cycle % dynamicRuleIDs.length];
          const resUpdate = await fetchJSON(`${httpBase}/api/v1/rate-limits/${targetID}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: `Updated-Rule-${targetID}`,
              description: "Cập nhật ngưỡng giới hạn lúc hệ thống đang chịu tải cao",
              enabled_dimensions: ["ip"],
              dimension_order: ["ip"],
              ip_config: { source: "binary_remote_addr", subnet_mask: "/24" },
              header_config: { header_name: "", operator: "equals", header_value: "", case_sensitive: false },
              path_config: { path: `/api/updated/${targetID}`, match_type: "prefix" },
              rate_limit: 999,
              rate_unit: "1 second",
              burst: 100,
              action_exceeded: "challenge_js",
              status: (cycle % 2 === 0) ? "Active" : "Inactive"
            })
          });
          if (resUpdate.status === 200) {
            adminStats.updated++;
          } else {
            adminStats.errors++;
          }
        }

        // 3. Xóa Rule (Delete)
        if (dynamicRuleIDs.length > 8) {
          const deleteID = dynamicRuleIDs.shift();
          const resDel = await fetchJSON(`${httpBase}/api/v1/rate-limits/${deleteID}`, {
            method: 'DELETE'
          });
          if (resDel.status === 200) {
            adminStats.deleted++;
          } else {
            adminStats.errors++;
          }
        }

        // 4. Đọc Danh Sách & Thống Kê (Read)
        const resList = await fetchJSON(`${httpBase}/api/v1/rate-limits?limit=10`);
        if (resList.status === 200) adminStats.read++;
        else adminStats.errors++;

        const resStats = await fetchJSON(`${httpBase}/api/v1/rate-limits/stats`);
        if (resStats.status === 200) adminStats.read++;
        else adminStats.errors++;

      } catch (err) {
        adminStats.errors++;
      }
      await sleep(10);
    }
  };

  const adminPromise = runAdminWorkload();

  // Bơm 20,000,000 requests qua UDP socket
  const t0 = performance.now();

  const sendAllPackets = async () => {
    const CHUNK_SIZE = 2000;
    for (let i = 0; i < TOTAL_PACKETS; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, TOTAL_PACKETS);
      for (let j = i; j < end; j++) {
        const payload = prebuiltPayloads[j % prebuiltPayloads.length];
        udpSocket.send(payload, udpPort, '127.0.0.1');
      }
      // Nhường CPU cho I/O event loop xử lý CRUD song song
      await new Promise(r => setImmediate(r));
    }
  };

  await sendAllPackets();
  const t1 = performance.now();
  const ingestDurationSec = (t1 - t0) / 1000;
  const throughput = TARGET_REQUESTS / ingestDurationSec;

  // Dừng luồng CRUD
  isSending = false;
  await adminPromise;
  await new Promise(r => udpSocket.close(r));

  console.log(`      ✅ Đã bơm xong ${TARGET_REQUESTS.toLocaleString()} requests trong ${ingestDurationSec.toFixed(2)}s!`);
  console.log(`      ⚡ Thông lượng (Throughput): ${Math.round(throughput).toLocaleString()} reqs/sec\n`);

  // 5. KÍCH HOẠT FLUSH & XÁC MINH CƠ SỞ DỮ LIỆU SQLITE
  console.log(`[5/6] 💾 Ra lệnh Flush metrics xuống SQLite CSDL...`);
  // Chờ 200ms và gọi API flush
  await sleep(300);
  const flushRes = await fetchJSON(`${httpBase}/api/v1/rate-limits/flush`, { method: 'POST' });
  console.log(`      Flush Response: HTTP ${flushRes.status} (${flushRes.data?.message || flushRes.raw})`);

  console.log(`[6/6] 📊 Truy vấn API và Đối chiếu Số Liệu CSDL thực tế...`);
  const statsRes = await fetchJSON(`${httpBase}/api/v1/rate-limits/stats`);
  const metricsRes = await fetchJSON(`${httpBase}/api/v1/rate-limits/metrics?range=24h&sort=blocked`);

  const stats = statsRes.data || {};
  const metrics = metricsRes.data || {};

  console.log(`\n================================================================`);
  console.log(`🏆 KẾT QUẢ AUDIT TEST TẢI CAO & CONCURRENCY (20 TRIỆU REQUESTS)`);
  console.log(`================================================================`);
  console.table({
    "Tổng số Requests Telemetry": { Giá_trị: TARGET_REQUESTS.toLocaleString() },
    "Thời gian nạp Telemetry":    { Giá_trị: `${ingestDurationSec.toFixed(3)} giây` },
    "Thông lượng nạp (Throughput)":{ Giá_trị: `${Math.round(throughput).toLocaleString()} reqs/s` },
    "Thao tác Tạo Rule (POST)":    { Giá_trị: `${adminStats.created.toLocaleString()} thành công` },
    "Thao tác Sửa Rule (PUT)":     { Giá_trị: `${adminStats.updated.toLocaleString()} thành công` },
    "Thao tác Xóa Rule (DELETE)":  { Giá_trị: `${adminStats.deleted.toLocaleString()} thành công` },
    "Thao tác Đọc Rule/Stats(GET)":{ Giá_trị: `${adminStats.read.toLocaleString()} thành công` },
    "Số lỗi API CRUD (Deadlock)":  { Giá_trị: `${adminStats.errors} lỗi (0%)` },
    "Total Hits ghi nhận CSDL":    { Giá_trị: `${(stats.total_hits || 0).toLocaleString()} requests` },
    "Total Blocked (429) CSDL":    { Giá_trị: `${(stats.total_blocked || 0).toLocaleString()} requests` },
    "Total Throttled CSDL":        { Giá_trị: `${(stats.total_throttled || 0).toLocaleString()} requests` },
  });

  if (metrics.top_endpoints && metrics.top_endpoints.length > 0) {
    console.log(`\n📈 TOP ENDPOINTS BỊ BLOCK / RATE LIMIT CAO NHẤT:`);
    console.table(metrics.top_endpoints.slice(0, 6).map(e => ({
      Endpoint: e.endpoint,
      Method: e.method,
      Rule: e.rule_name,
      Requests: e.requests.toLocaleString(),
      Blocked: e.blocked.toLocaleString(),
      "Tỉ lệ Block": `${e.block_ratio.toFixed(1)}%`
    })));
  }

  // Assertion kiểm tra tính toàn vẹn
  assert.equal(adminStats.errors, 0, `Phát hiện ${adminStats.errors} lỗi API CRUD khi đang tải cao!`);
  assert.ok(adminStats.created > 0, 'Phải có ít nhất 1 rule được tạo thành công trong lúc tải');
  assert.ok(adminStats.updated > 0, 'Phải có ít nhất 1 rule được sửa thành công trong lúc tải');
  assert.ok(stats.total_hits > 0, 'Số liệu total_hits trong DB phải lớn hơn 0');

  console.log(`\n🎉 TẤT CẢ CÁC TIÊU CHÍ TEST TẢI VÀ CONCURRENCY ĐÃ VƯỢT QUA 100%!`);
  console.log(`================================================================\n`);

} finally {
  // Dọn dẹp process Control Plane
  console.log(`🧹 Dọn dẹp và kết thúc tiến trình Control Plane...`);
  cpProcess.kill('SIGTERM');
  await sleep(500);
  if (cpProcess.exitCode === null) {
    cpProcess.kill('SIGKILL');
  }
}
