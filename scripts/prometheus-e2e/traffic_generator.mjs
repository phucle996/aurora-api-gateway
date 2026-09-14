import http from 'node:http';
import assert from 'node:assert/strict';

/**
 * Sends a burst of concurrent requests to evaluate high-throughput lockless SHM recording.
 */
export async function sendBurstTraffic({
  url = 'http://127.0.0.1:80/ok',
  count = 500,
  concurrency = 32,
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
    method: 'GET',
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

        req.on('error', (err) => {
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

  return {
    totalSent: count,
    completed,
    successCount,
    failCount,
    durationSec: totalDuration,
    actualRps: (completed / Math.max(0.001, totalDuration)).toFixed(1),
    p50: (latencies[Math.floor(latencies.length * 0.50)] || 0).toFixed(2),
    p95: (latencies[Math.floor(latencies.length * 0.95)] || 0).toFixed(2),
    p99: (latencies[Math.floor(latencies.length * 0.99)] || 0).toFixed(2),
    statusDistribution,
  };
}

/**
 * Queries Prometheus Instant Query API.
 */
export async function promQuery(promUrl = 'http://127.0.0.1:9090', query = '') {
  const url = `${promUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(res.status, 200, `PromQL query '${query}' failed with HTTP ${res.status}`);
  const json = await res.json();
  assert.equal(json.status, 'success', `PromQL query returned non-success: ${JSON.stringify(json)}`);
  return json.data.result;
}

/**
 * Extracts a numeric scalar from Prometheus query results.
 */
export async function promScalar(promUrl = 'http://127.0.0.1:9090', query = '') {
  const result = await promQuery(promUrl, query);
  if (!result || result.length === 0) return 0;
  if (result[0].value) return Number(result[0].value[1]);
  return 0;
}

/**
 * Sends a burst of API calls directly to the Go Control Plane to measure Go runtime and SQLite throughput.
 */
export async function sendControllerBurstTraffic({
  baseUrl = 'http://127.0.0.1:8080',
  token,
  count = 200,
  concurrency = 16,
} = {}) {
  const url = `${baseUrl}/api/v1/extensions`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  return sendBurstTraffic({
    url,
    count,
    concurrency,
    headers,
    timeoutMs: 5000,
  });
}

/**
 * Sends concurrent conflicting mutations to test Go Controller SQLite transaction handling and idempotency.
 */
export async function sendConcurrentControllerMutations({
  baseUrl = 'http://127.0.0.1:8080',
  token,
  extensionId = 'prometheus',
  mutationA = { enabled: true },
  mutationB = { enabled: true },
} = {}) {
  const url = `${baseUrl}/api/v1/extensions/${extensionId}/status`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const reqA = fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(mutationA),
  });
  const reqB = fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(mutationB),
  });

  const [resA, resB] = await Promise.all([reqA, reqB]);
  return {
    statusA: resA.status,
    statusB: resB.status,
    bodyA: await resA.text().catch(() => ''),
    bodyB: await resB.text().catch(() => ''),
  };
}
