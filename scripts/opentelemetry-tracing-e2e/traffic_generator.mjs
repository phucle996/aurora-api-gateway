import http from 'node:http';

/**
 * High-concurrency traffic generator calculating latency distribution (p50, p95, p99).
 */
export async function sendBurstTraffic({
  url = 'http://127.0.0.1:8090/ok',
  count = 300,
  concurrency = 32,
  method = 'GET',
  headers = {},
  timeoutMs = 5000,
} = {}) {
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: concurrency,
    keepAliveMsecs: 1000,
  });

  const parsedUrl = new URL(url);
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 80,
    path: parsedUrl.pathname + parsedUrl.search,
    method,
    headers: {
      Host: parsedUrl.hostname,
      ...headers,
    },
    agent,
  };

  const latencies = [];
  let successCount = 0;
  let failCount = 0;
  const statusDistribution = {};

  const startTime = performance.now();
  let completed = 0;
  let inFlight = 0;
  let sent = 0;

  await new Promise((resolve) => {
    function launchNext() {
      while (inFlight < concurrency && sent < count) {
        sent++;
        inFlight++;
        const reqStart = performance.now();

        const req = http.request(options, (res) => {
          res.resume();
          res.on('end', () => {
            const duration = performance.now() - reqStart;
            latencies.push(duration);
            const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
            statusDistribution[statusClass] = (statusDistribution[statusClass] || 0) + 1;
            statusDistribution[res.statusCode] = (statusDistribution[res.statusCode] || 0) + 1;

            if (res.statusCode >= 200 && res.statusCode < 500) {
              successCount++;
            } else {
              failCount++;
            }

            inFlight--;
            completed++;
            if (completed >= count) {
              resolve();
            } else {
              launchNext();
            }
          });
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error('Request timed out'));
        });

        req.on('error', () => {
          inFlight--;
          completed++;
          failCount++;
          statusDistribution.error = (statusDistribution.error || 0) + 1;
          if (completed >= count) {
            resolve();
          } else {
            launchNext();
          }
        });

        req.end();
      }
    }

    launchNext();
  });

  agent.destroy();
  const totalDuration = (performance.now() - startTime) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const rps = totalDuration > 0 ? count / totalDuration : 0;

  return {
    totalRequests: count,
    totalDurationSec: totalDuration,
    rps,
    latencies: {
      min: latencies[0] || 0,
      max: latencies[latencies.length - 1] || 0,
      p50,
      p95,
      p99,
      mean,
    },
    successCount,
    failCount,
    statusDistribution,
  };
}

/**
 * Sends multi-persona production simulated traffic including standard browsing,
 * transactional API calls, and simulated attack vectors.
 */
export async function sendMultiPersonaTraffic({
  baseUrl = 'http://127.0.0.1:8090',
  rounds = 5,
} = {}) {
  const personas = [
    { path: '/ok', method: 'GET', name: 'standard_page_view' },
    { path: '/ok?product=1024', method: 'GET', name: 'catalog_search' },
    { path: '/ok', method: 'POST', name: 'api_mutation', headers: { 'Content-Type': 'application/json' } },
    { path: '/__aurora_blocked', method: 'GET', name: 'security_block' },
    { path: '/ok?q=1%27%20OR%201=1--', method: 'GET', name: 'sqli_attempt' },
    { path: '/ok?file=../../../../etc/passwd', method: 'GET', name: 'traversal_attempt' },
  ];

  const results = [];
  for (let r = 0; r < rounds; r++) {
    for (const p of personas) {
      const url = `${baseUrl}${p.path}`;
      const res = await new Promise((resolve) => {
        const parsed = new URL(url);
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            method: p.method,
            headers: {
              Host: parsed.hostname,
              'User-Agent': 'AuroraE2E-MultiPersona/1.0',
              ...(p.headers || {}),
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => {
              resolve({
                persona: p.name,
                path: p.path,
                method: p.method,
                status: response.statusCode,
              });
            });
          }
        );
        req.on('error', (err) => {
          resolve({ persona: p.name, path: p.path, error: err.message });
        });
        if (p.method === 'POST') {
          req.write(JSON.stringify({ test: 'payload', timestamp: Date.now() }));
        }
        req.end();
      });
      results.push(res);
    }
  }

  return results;
}

/**
 * Sends a fixed count of single sequential requests.
 */
export async function sendFixedRequests(count, url = 'http://127.0.0.1:8090/ok') {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => {
      const parsed = new URL(url);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { Host: parsed.hostname, 'User-Agent': 'AuroraE2E-Fixed/1.0' },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', resolve);
      req.end();
    });
  }
}
