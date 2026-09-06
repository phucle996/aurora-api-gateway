// Script kiểm thử traffic thực tế qua Cụm NGINX Edge Node & Kiểm tra đồng bộ Access Activity
import { execSync } from 'node:child_process';

const LB_URL = 'http://node-01/';
const blockedIPs = ['203.0.113.88', '198.51.100.1', '203.0.113.5'];
const allowedIPs = ['1.2.3.4', '118.69.1.2', '14.160.10.5'];

console.log('=== 1. GỬI TRAFFIC CHẶN (EXPECT 403 FORBIDDEN) ===');
for (const ip of blockedIPs) {
  try {
    const cmd = `docker compose exec lb curl -s -o /dev/null -w "%{http_code}" -H "X-Real-IP: ${ip}" http://node-01/`;
    const code = execSync(cmd).toString().trim();
    console.log(`IP: ${ip.padEnd(16)} -> HTTP ${code} ${code === '403' ? '✅ (BLOCKED BY WAF)' : '❌ (UNEXPECTED)'}`);
  } catch (err) {
    console.error(`Lỗi gửi traffic cho ${ip}:`, err.message);
  }
}

console.log('\n=== 2. GỬI TRAFFIC HỢP LỆ (EXPECT 404/200 NON-BLOCKED) ===');
for (const ip of allowedIPs) {
  try {
    const cmd = `docker compose exec lb curl -s -o /dev/null -w "%{http_code}" -H "X-Real-IP: ${ip}" http://node-01/`;
    const code = execSync(cmd).toString().trim();
    console.log(`IP: ${ip.padEnd(16)} -> HTTP ${code} ${code !== '403' ? '✅ (ALLOWED PAST WAF)' : '❌ (BLOCKED)'}`);
  } catch (err) {
    console.error(`Lỗi gửi traffic cho ${ip}:`, err.message);
  }
}

console.log('\n=== 3. CHỜ ĐỒNG BỘ LOG (5 GIÂY) ===');
execSync('sleep 5');

console.log('\n=== 4. TRUY VẤN ACCESS ACTIVITY TỪ CONTROLLER ===');
const token = '71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994';
const res = execSync(`docker compose exec controller curl -s -H "Authorization: Bearer ${token}" http://localhost:8080/api/v1/access/activity`).toString();
const events = JSON.parse(res);
console.log(`Tổng số sự kiện Access Activity ghi nhận: ${events.length}`);
for (const e of events.slice(0, 5)) {
  console.log(`- [${e.created_at}] Node: ${e.node_id} | Rule #${e.rule_id} | IP: ${e.ip} | Action: ${e.action.toUpperCase()}`);
}
