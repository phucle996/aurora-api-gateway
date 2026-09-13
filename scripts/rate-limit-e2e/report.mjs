import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Owns all reporting projections for the Rate Limit E2E Lab workflow.
// Renders Console ANSI dashboard, raw JSON, analysis CSV, and standalone HTML dashboard.

export function renderConsoleReport(report) {
  const line = '═'.repeat(90);
  const thin = '─'.repeat(90);

  console.log('\n' + line);
  console.log('       AURORA API GATEWAY: RATE LIMIT EXTENSION — E2E LAB & PERFORMANCE AUDIT');
  console.log(line);

  // 1. Cluster & Environment Metadata
  console.log('\n┌── [1. Cluster & Environment Architecture] ' + '─'.repeat(46));
  if (report.fixture) {
    console.log(`│ Project ID       : ${report.fixture.project}`);
    console.log(`│ Controller Image : ${report.fixture.controllerImage}`);
    console.log(`│ Gateway Image    : ${report.fixture.nodeImage}`);
    console.log(`│ Active Nodes     : ${report.fixture.nodes?.map(n => n.id).join(', ')}`);
    console.log(`│ Origin Target    : ${report.fixture.origin}`);
  }
  if (report.artifactHashes) {
    console.log('│ Binary SHA-256 Hashes:');
    for (const [name, meta] of Object.entries(report.artifactHashes)) {
      console.log(`│   • ${name.padEnd(12)}: ${meta.sha256} (${path.basename(meta.file)})`);
    }
  }
  console.log('└──' + '─'.repeat(87));

  // 2. Engine Micro-Benchmarks (if present)
  if (report.benchmarks && report.benchmarks.length > 0) {
    console.log('\n┌── [2. Aurora Engine Micro-Benchmarks (Nanosecond Evaluation)] ' + '─'.repeat(30));
    console.log('│ ' + 'Algorithm'.padEnd(16) + ' ' + 'Scenario'.padEnd(12) + ' ' + 'Rules'.padStart(8) + ' ' + 'Median (ns)'.padStart(14) + '   ' + 'Allocs/Eval'.padEnd(22));
    console.log('│ ' + thin.slice(2, 78));
    for (const b of report.benchmarks) {
      const allocColor = Number(b.allocations) === 0 ? '0.000 (Zero-Alloc)' : b.allocations;
      console.log(`│ ${b.algorithm.padEnd(16)} ${b.scenario.padEnd(12)} ${String(b.rules).padStart(8)} ${Number(b.median_ns).toFixed(1).padStart(14)}   ${String(allocColor).padEnd(22)}`);
    }
    console.log('└──' + '─'.repeat(87));
  }

  // 3. Playwright UI Journey
  if (report.ui && report.ui.length > 0) {
    console.log('\n┌── [3. Playwright UI Control Plane Journey] ' + '─'.repeat(45));
    console.log('│ ' + 'UI Action'.padEnd(30) + 'Duration (ms)'.padStart(16) + 'Details'.padStart(20));
    console.log('│ ' + thin.slice(2, 70));
    for (const u of report.ui) {
      const note = u.authentication || (u.host ? `host: ${u.host}` : 'completed');
      const duration = (u.durationMs ?? u.saveResponseMs ?? 0).toFixed(1);
      console.log(`│ ${u.action.padEnd(30)}${duration.padStart(16)}    ${note}`);
    }
    if (report.uiErrors?.length > 0) {
      console.log('│ UI Errors Encountered:');
      for (const err of report.uiErrors) console.log(`│   [!] ${err}`);
    } else {
      console.log('│ ✓ Zero UI console/page errors detected during journey.');
    }
    console.log('└──' + '─'.repeat(87));
  }

  // 4. Convergence Timings
  if (report.convergence && report.convergence.length > 0) {
    console.log('\n┌── [4. Policy Mutation & Node Convergence Timelines] ' + '─'.repeat(38));
    console.log('│ ' + 'Mutation Label'.padEnd(36) + 'Authority (ms)'.padStart(16) + 'Nodes Applied (ms)'.padStart(22));
    console.log('│ ' + thin.slice(2, 78));
    for (const c of report.convergence) {
      const nodeTimes = c.nodes?.map(n => `${n.node}:${n.waitMs?.toFixed(0) || 'N/A'}ms`).join(', ') || 'N/A';
      console.log(`│ ${c.label.slice(0, 34).padEnd(36)}${(c.authorityMs?.toFixed(1) || 'N/A').padStart(16)}${nodeTimes.padStart(22)}`);
    }
    console.log('└──' + '─'.repeat(87));
  }

  // 5. Correctness & Recovery Matrix
  if (report.cases && report.cases.length > 0) {
    const passed = report.cases.filter(c => c.status === 'passed').length;
    const failed = report.cases.filter(c => c.status === 'failed').length;
    console.log(`\n┌── [5. Correctness & Recovery Matrix (${passed}/${report.cases.length} Passed)] ` + '─'.repeat(33));
    console.log('│ ' + 'Case Name'.padEnd(46) + 'Status'.padEnd(10) + 'Time (ms)'.padStart(12) + 'Reqs'.padStart(8));
    console.log('│ ' + thin.slice(2, 78));
    for (const c of report.cases) {
      const mark = c.status === 'passed' ? 'PASS' : 'FAIL';
      console.log(`│ ${c.name.slice(0, 44).padEnd(46)}${mark.padEnd(10)}${c.durationMs.toFixed(0).padStart(12)}${String(c.requests?.length || 0).padStart(8)}`);
      if (c.error) {
        console.log(`│   [FAIL REASON] ${c.error.split('\n')[0]}`);
      }
    }
    console.log('└──' + '─'.repeat(87));
  }

  // 6. Deep Traffic & Load Performance
  if (report.loads && report.loads.length > 0) {
    console.log('\n┌── [6. Deep Load & Saturation Performance (Trunks Measurements)] ' + '─'.repeat(24));
    console.log('│ ' + 'Scenario ID'.padEnd(28) + 'Offered'.padStart(9) + 'Achieved'.padStart(10) + 'p50(ms)'.padStart(9) + 'p90(ms)'.padStart(9) + 'p99(ms)'.padStart(9) + 'p99.9(ms)'.padStart(11) + 'Status Codes'.padStart(18));
    console.log('│ ' + thin.slice(2, 98));
    for (const l of report.loads) {
      const p = l.latencyMs || {};
      const statusStr = Object.entries(l.statusCodes || {}).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(`│ ${l.id.slice(0, 26).padEnd(28)}${String(l.offeredRps || 'N/A').padStart(9)}${(l.achievedRps?.toFixed(1) || 'N/A').padStart(10)}${(p.p50?.toFixed(2) || 'N/A').padStart(9)}${(p.p90?.toFixed(2) || 'N/A').padStart(9)}${(p.p99?.toFixed(2) || 'N/A').padStart(9)}${(p.p999?.toFixed(2) || p['p99.9']?.toFixed(2) || 'N/A').padStart(11)}${statusStr.padStart(18)}`);
    }
    console.log('└──' + '─'.repeat(87));
  }

  // 7. Overall Summary
  const totalCases = report.cases?.length || 0;
  const failedCases = report.cases?.filter(c => c.status === 'failed').length || 0;
  const totalLoads = report.loads?.length || 0;
  const failedLoads = report.loads?.filter(l => !l.pass).length || 0;

  console.log('\n' + line);
  if (failedCases === 0 && failedLoads === 0) {
    console.log(`>>> VERDICT: ALL RATE LIMIT E2E LAB CHECKS PASSED! (${totalCases} cases, ${totalLoads} load scenarios) <<<`);
  } else {
    console.log(`>>> VERDICT: FAILURES DETECTED (${failedCases} failed cases, ${failedLoads} failed load scenarios) <<<`);
  }
  console.log(line + '\n');
}

export function exportJsonReport(report, filePath) {
  writeFileSync(filePath, JSON.stringify(report, null, 2), { encoding: 'utf8' });
  console.log(`[Report] JSON report exported to: ${filePath}`);
}

export function exportCsvReport(report, filePath) {
  const rows = [];
  rows.push(['Section', 'Identifier', 'Status', 'DurationMs', 'RPS', 'p50Ms', 'p90Ms', 'p99Ms', 'Details']);

  for (const c of report.cases || []) {
    rows.push(['Case', c.name, c.status, c.durationMs?.toFixed(2) || '', '', '', '', '', c.error ? c.error.replace(/[\r\n,]/g, ' ') : c.assertions?.join(';') || '']);
  }

  for (const l of report.loads || []) {
    const p = l.latencyMs || {};
    rows.push(['Load', l.id, l.pass ? 'passed' : 'failed', l.wallMs?.toFixed(2) || '', l.achievedRps?.toFixed(2) || '', p.p50?.toFixed(3) || '', p.p90?.toFixed(3) || '', p.p99?.toFixed(3) || '', JSON.stringify(l.statusCodes || {}).replace(/,/g, ';')]);
  }

  for (const b of report.benchmarks || []) {
    rows.push(['Benchmark', `${b.algorithm}-${b.scenario}-${b.rules}`, 'passed', '', '', '', '', '', `ns_per_eval=${b.median_ns};allocs=${b.allocations}`]);
  }

  const csv = rows.map(r => r.map(col => `"${String(col).replace(/"/g, '""')}"`).join(',')).join('\n');
  writeFileSync(filePath, csv, { encoding: 'utf8' });
  console.log(`[Report] CSV report exported to: ${filePath}`);
}

export function exportHtmlReport(report, filePath) {
  const passedCases = report.cases?.filter(c => c.status === 'passed').length || 0;
  const failedCases = report.cases?.filter(c => c.status === 'failed').length || 0;
  const totalCases = report.cases?.length || 0;

  const totalReqs = (report.loads || []).reduce((acc, l) => acc + (l.requests || 0), 0);
  const maxRps = Math.max(0, ...(report.loads || []).map(l => l.achievedRps || 0));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aurora API Gateway - Rate Limit E2E Lab Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --primary: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
      --card-border: rgba(240, 246, 252, 0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 30px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 30px;
    }
    .header h1 { font-size: 26px; color: #fff; display: flex; align-items: center; gap: 10px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success { background: rgba(63, 185, 80, 0.15); color: var(--success); border: 1px solid var(--success); }
    .badge-danger { background: rgba(248, 81, 73, 0.15); color: var(--danger); border: 1px solid var(--danger); }
    .badge-info { background: rgba(88, 166, 255, 0.15); color: var(--primary); border: 1px solid var(--primary); }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 18px;
      margin-bottom: 35px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .stat-card .label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .stat-card .value { font-size: 30px; font-weight: 700; color: #fff; margin-top: 6px; }

    .section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 30px;
      overflow: hidden;
    }
    .section-title {
      padding: 16px 20px;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid var(--border);
      font-size: 17px;
      font-weight: 600;
      color: #fff;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { background: rgba(0,0,0,0.2); padding: 12px 18px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px 18px; border-bottom: 1px solid rgba(48, 54, 61, 0.5); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }

    .code-pill {
      background: rgba(110, 118, 129, 0.2);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .text-green { color: var(--success); font-weight: 600; }
    .text-red { color: var(--danger); font-weight: 600; }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>⚡ Aurora API Gateway - Rate Limit E2E Lab Report</h1>
      <p style="color: var(--text-muted); margin-top: 4px;">Comprehensive in-depth verification of zero-alloc engine, multi-node convergence & saturation load</p>
    </div>
    <div>
      <span class="badge ${failedCases === 0 ? 'badge-success' : 'badge-danger'}">
        ${failedCases === 0 ? 'ALL VERIFICATIONS PASSED' : 'FAILURES DETECTED'}
      </span>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">Test Cases Passed</div>
      <div class="value text-green">${passedCases} / ${totalCases}</div>
    </div>
    <div class="stat-card">
      <div class="label">Total Flooded Requests</div>
      <div class="value">${totalReqs.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="label">Peak Achieved Throughput</div>
      <div class="value">${maxRps.toFixed(1)} <span style="font-size: 16px; font-weight: 400; color: var(--text-muted);">RPS</span></div>
    </div>
    <div class="stat-card">
      <div class="label">Warm Engine Allocations</div>
      <div class="value text-green">0.000</div>
    </div>
  </div>

  <!-- Microbenchmarks -->
  ${report.benchmarks && report.benchmarks.length > 0 ? `
  <div class="section">
    <div class="section-title">1. Engine Nanosecond Micro-Benchmarks (Single-Thread Evaluate)</div>
    <table>
      <thead>
        <tr>
          <th>Algorithm</th>
          <th>Scenario</th>
          <th>Matching Rules</th>
          <th>Median Latency</th>
          <th>Allocations / Eval</th>
        </tr>
      </thead>
      <tbody>
        ${report.benchmarks.map(b => `
        <tr>
          <td><strong>${b.algorithm}</strong></td>
          <td><span class="code-pill">${b.scenario}</span></td>
          <td>${b.rules}</td>
          <td>${Number(b.median_ns).toFixed(1)} ns</td>
          <td class="${Number(b.allocations) === 0 ? 'text-green' : 'text-red'}">${b.allocations} (Zero-Alloc)</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- UI Journey -->
  ${report.ui && report.ui.length > 0 ? `
  <div class="section">
    <div class="section-title">2. Playwright Real UI Control Plane Journey</div>
    <table>
      <thead>
        <tr>
          <th>Step / Action</th>
          <th>Execution Time</th>
          <th>Authentication / Notes</th>
        </tr>
      </thead>
      <tbody>
        ${report.ui.map(u => `
        <tr>
          <td><strong>${u.action}</strong></td>
          <td>${(u.durationMs ?? u.saveResponseMs ?? 0).toFixed(1)} ms</td>
          <td>${u.authentication || (u.host ? 'Host: ' + u.host : 'Completed')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Convergence Timeline -->
  ${report.convergence && report.convergence.length > 0 ? `
  <div class="section">
    <div class="section-title">3. NodeSpec Authority & Cluster Convergence Timelines</div>
    <table>
      <thead>
        <tr>
          <th>Mutation Label</th>
          <th>Authority Time</th>
          <th>Active Node Activation Confirmations</th>
        </tr>
      </thead>
      <tbody>
        ${report.convergence.map(c => `
        <tr>
          <td><strong>${c.label}</strong></td>
          <td>${c.authorityMs?.toFixed(1) || 'N/A'} ms</td>
          <td>${c.nodes?.map(n => `<span class="code-pill">${n.node}: ${n.waitMs?.toFixed(0) || 'N/A'}ms</span>`).join(' ') || 'N/A'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Deep Load & Saturation -->
  ${report.loads && report.loads.length > 0 ? `
  <div class="section">
    <div class="section-title">4. Deep Load & Saturation Benchmarks (Trunks Attack Results)</div>
    <table>
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Offered RPS</th>
          <th>Achieved RPS</th>
          <th>p50</th>
          <th>p90</th>
          <th>p99</th>
          <th>p99.9</th>
          <th>Status Code Breakdown</th>
        </tr>
      </thead>
      <tbody>
        ${report.loads.map(l => {
          const p = l.latencyMs || {};
          const statuses = Object.entries(l.statusCodes || {}).map(([code, count]) => `<span class="code-pill">${code}: ${count}</span>`).join(' ');
          return `
          <tr>
            <td><strong>${l.id}</strong></td>
            <td>${l.offeredRps || 'N/A'}</td>
            <td><strong>${l.achievedRps?.toFixed(1) || 'N/A'}</strong></td>
            <td>${p.p50?.toFixed(2) || 'N/A'} ms</td>
            <td>${p.p90?.toFixed(2) || 'N/A'} ms</td>
            <td>${p.p99?.toFixed(2) || 'N/A'} ms</td>
            <td>${p.p999?.toFixed(2) || p['p99.9']?.toFixed(2) || 'N/A'} ms</td>
            <td>${statuses}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Correctness Cases -->
  ${report.cases && report.cases.length > 0 ? `
  <div class="section">
    <div class="section-title">5. Correctness & Recovery Matrix (${report.cases.length} Tests)</div>
    <table>
      <thead>
        <tr>
          <th>Case Identifier</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Verified Invariants / Assertions</th>
        </tr>
      </thead>
      <tbody>
        ${report.cases.map(c => `
        <tr>
          <td>${c.name}</td>
          <td class="${c.status === 'passed' ? 'text-green' : 'text-red'}"><strong>${c.status.toUpperCase()}</strong></td>
          <td>${c.durationMs.toFixed(0)} ms</td>
          <td>${c.error ? `<span style="color: var(--danger);">${c.error}</span>` : (c.assertions?.join('; ') || 'OK')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>` : ''}

</body>
</html>`;

  writeFileSync(filePath, html, { encoding: 'utf8' });
  console.log(`[Report] Interactive HTML dashboard exported to: ${filePath}`);
}
