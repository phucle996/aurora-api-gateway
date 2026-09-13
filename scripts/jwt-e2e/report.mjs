import { writeFileSync } from 'node:fs';
import path from 'node:path';

export function renderConsoleReport(report) {
  console.log('\n' + '='.repeat(80));
  console.log('              AURORA JWT EXTENSION: E2E TEST & BENCHMARK REPORT');
  console.log('='.repeat(80));
  console.log(`Profile:     ${report.profile.toUpperCase()}`);
  console.log(`Started:     ${report.startedAt}`);
  console.log(`Finished:    ${report.finishedAt}`);
  console.log('-'.repeat(80));

  // Cases summary
  const passedCases = report.cases.filter(c => c.status === 'passed').length;
  const failedCases = report.cases.filter(c => c.status === 'failed').length;
  console.log(`Correctness Cases: ${passedCases} passed, ${failedCases} failed (Total: ${report.cases.length})`);

  if (failedCases > 0) {
    console.log('\n❌ FAILED CASES:');
    for (const c of report.cases.filter(c => c.status === 'failed')) {
      console.log(`  - ${c.name}: ${c.error}`);
    }
  }

  // Nanosecond Micro-Benchmarks
  if (report.benchmarks && report.benchmarks.length > 0) {
    console.log('\n⏱️  Nanosecond Engine Microbenchmarks:');
    console.table(report.benchmarks.map(b => ({
      Algorithm: b.algorithm,
      Scenario: b.scenario,
      Rules: b.rules,
      'Median (ns)': b.median_ns,
      'Allocations/eval': b.allocations,
    })));
  }

  // UI Journey
  if (report.ui.length > 0) {
    console.log('\n🖥️  UI Journey Steps:');
    for (const u of report.ui) {
      console.log(`  - ${u.action}: ${u.durationMs.toFixed(1)} ms`);
    }
  }

  // Load Benchmarks
  if (report.loads.length > 0) {
    console.log('\n⚡ Load Benchmarks:');
    console.table(report.loads.map(l => ({
      Scenario: l.scenario.name,
      OfferedRps: l.offeredRps,
      AchievedRps: l.achievedRps ? l.achievedRps.toFixed(1) : 'N/A',
      'p50 (ms)': l.latencyMs.p50 ? l.latencyMs.p50.toFixed(3) : 'N/A',
      'p95 (ms)': l.latencyMs.p95 ? l.latencyMs.p95.toFixed(3) : 'N/A',
      'p99 (ms)': l.latencyMs.p99 ? l.latencyMs.p99.toFixed(3) : 'N/A',
      Status: JSON.stringify(l.statusCodes),
      Pass: l.pass ? 'PASS' : 'FAIL'
    })));
  }

  console.log('='.repeat(80) + '\n');
}

export function exportJsonReport(report, outDir) {
  const jsonFile = path.join(outDir, 'report.json');
  writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  console.log(`Report JSON written to: ${jsonFile}`);
}

export function exportCsvReport(report, outDir) {
  // 1. Cases CSV
  const casesHeader = 'name,status,durationMs,assertionsCount,started\n';
  const casesRows = report.cases.map(c =>
    `"${c.name}","${c.status}",${c.durationMs.toFixed(2)},${c.assertions?.length || 0},"${c.started}"`
  ).join('\n');
  writeFileSync(path.join(outDir, 'cases.csv'), casesHeader + casesRows);

  // 2. Loads CSV
  if (report.loads.length > 0) {
    const loadsHeader = 'id,scenario,offeredRps,achievedRps,p50Ms,p95Ms,p99Ms,requests,pass\n';
    const loadsRows = report.loads.map(l =>
      `"${l.id}","${l.scenario.name}",${l.offeredRps},${l.achievedRps?.toFixed(2) || 0},${l.latencyMs.p50?.toFixed(3) || 0},${l.latencyMs.p95?.toFixed(3) || 0},${l.latencyMs.p99?.toFixed(3) || 0},${l.requests},${l.pass}`
    ).join('\n');
    writeFileSync(path.join(outDir, 'loads.csv'), loadsHeader + loadsRows);
  }

  // 3. Benchmarks CSV
  if (report.benchmarks && report.benchmarks.length > 0) {
    const benchHeader = 'algorithm,scenario,rules,median_ns,allocations\n';
    const benchRows = report.benchmarks.map(b =>
      `"${b.algorithm}","${b.scenario}",${b.rules},${b.median_ns},"${b.allocations}"`
    ).join('\n');
    writeFileSync(path.join(outDir, 'benchmarks.csv'), benchHeader + benchRows);
  }
}

export function exportHtmlReport(report, outDir) {
  const passedCases = report.cases.filter(c => c.status === 'passed').length;
  const failedCases = report.cases.filter(c => c.status === 'failed').length;
  const totalCases = report.cases.length;
  const passRate = totalCases > 0 ? ((passedCases / totalCases) * 100).toFixed(1) : '100.0';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Aurora WAF — JWT Authentication E2E Lab Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --accent: #58a6ff;
      --accent-green: #238636;
      --accent-red: #da3633;
      --accent-purple: #8957e5;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 32px 48px;
    }
    h1, h2, h3 { color: var(--text-bright); }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .metric-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }
    .metric-title { font-size: 13px; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
    .metric-value { font-size: 28px; font-weight: bold; color: var(--text-bright); }
    .metric-value.pass { color: #3fb950; }
    .metric-value.fail { color: #f85149; }
    table {
      width: 100%;
      border-collapse: collapse;
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    th { background-color: #21262d; color: var(--text-bright); font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge.passed { background-color: rgba(46, 160, 67, 0.2); color: #3fb950; border: 1px solid #238636; }
    .badge.failed { background-color: rgba(248, 81, 73, 0.2); color: #f85149; border: 1px solid #da3633; }
    pre {
      background: #090d13;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Aurora API Gateway — JWT Authentication E2E Suite</h1>
      <p style="color: #8b949e; margin: 4px 0 0 0;">Unified Claim Matrix • Relaxed Invariants • Algorithm Hot-Swap • Cryptographic Hardening</p>
    </div>
    <div style="text-align: right;">
      <span class="badge ${failedCases === 0 ? 'passed' : 'failed'}" style="font-size: 16px; padding: 8px 16px;">
        ${failedCases === 0 ? 'ALL CHECKS PASSED' : `${failedCases} FAILED`}
      </span>
      <div style="color: #8b949e; font-size: 12px; margin-top: 8px;">Run started: ${report.startedAt}</div>
    </div>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-title">Total Test Cases</div>
      <div class="metric-value">${totalCases}</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Pass Rate</div>
      <div class="metric-value ${failedCases === 0 ? 'pass' : 'fail'}">${passRate}%</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Cryptographic Matrix</div>
      <div class="metric-value" style="color: var(--accent);">RS, HS, ES, EdDSA</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Gateway Nodes</div>
      <div class="metric-value">${report.nodesCount || 2} nodes</div>
    </div>
  </div>

  ${report.benchmarks && report.benchmarks.length > 0 ? `
  <h2>⏱️ Engine Nanosecond Microbenchmarks (Single-Thread Evaluation Speed)</h2>
  <table>
    <thead>
      <tr>
        <th>Algorithm</th>
        <th>Scenario</th>
        <th>Rules Count</th>
        <th>Median Latency</th>
        <th>Allocations / Eval</th>
      </tr>
    </thead>
    <tbody>
      ${report.benchmarks.map(b => `
        <tr>
          <td style="font-weight: 600; color: var(--accent);">${b.algorithm}</td>
          <td><code>${b.scenario}</code></td>
          <td>${b.rules}</td>
          <td><b>${b.median_ns >= 1000 ? (b.median_ns / 1000).toFixed(2) + ' µs' : b.median_ns.toFixed(1) + ' ns'}</b></td>
          <td><span class="badge ${b.allocations === '0.000' ? 'passed' : ''}">${b.allocations}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <h2>🧪 Correctness & Cryptographic Security Cases</h2>
  <table>
    <thead>
      <tr>
        <th>Case Name</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Key Assertions</th>
      </tr>
    </thead>
    <tbody>
      ${report.cases.map(c => `
        <tr>
          <td style="font-weight: 500; color: var(--text-bright);">${c.name}</td>
          <td><span class="badge ${c.status}">${c.status.toUpperCase()}</span></td>
          <td>${c.durationMs.toFixed(1)} ms</td>
          <td>${(c.assertions || []).join(', ') || 'N/A'}${c.error ? `<br><pre>${c.error}</pre>` : ''}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${report.loads.length > 0 ? `
  <h2>⚡ Load & High-Concurrency Benchmarks</h2>
  <table>
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Offered RPS</th>
        <th>Achieved RPS</th>
        <th>p50 Latency</th>
        <th>p95 Latency</th>
        <th>p99 Latency</th>
        <th>Status Codes</th>
        <th>Verdict</th>
      </tr>
    </thead>
    <tbody>
      ${report.loads.map(l => `
        <tr>
          <td style="font-weight: 500; color: var(--text-bright);">${l.scenario.name}</td>
          <td>${l.offeredRps}</td>
          <td>${l.achievedRps ? l.achievedRps.toFixed(1) : 'N/A'}</td>
          <td>${l.latencyMs.p50 ? l.latencyMs.p50.toFixed(3) + ' ms' : 'N/A'}</td>
          <td>${l.latencyMs.p95 ? l.latencyMs.p95.toFixed(3) + ' ms' : 'N/A'}</td>
          <td>${l.latencyMs.p99 ? l.latencyMs.p99.toFixed(3) + ' ms' : 'N/A'}</td>
          <td><code>${JSON.stringify(l.statusCodes)}</code></td>
          <td><span class="badge ${l.pass ? 'passed' : 'failed'}">${l.pass ? 'PASS' : 'FAIL'}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <h2>🖥️ Real Playwright UI Journey</h2>
  <table>
    <thead>
      <tr>
        <th>Action</th>
        <th>Duration</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${report.ui.map(u => `
        <tr>
          <td style="font-weight: 500; color: var(--text-bright);">${u.action}</td>
          <td>${u.durationMs.toFixed(1)} ms</td>
          <td>${u.authentication || u.host || ''}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

</body>
</html>`;

  writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`Interactive HTML Dashboard written to: ${path.join(outDir, 'index.html')}`);
}
