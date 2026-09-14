import http from 'node:http';
import assert from 'node:assert/strict';

/**
 * Sends a burst of concurrent requests to evaluate high-throughput lockless SHM recording.
 */
export async function sendBurstTraffic({
  url = 'http://127.0.0.1:8090/ok',
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

  return {
    totalRequests: count,
    successCount,
    failCount,
    statusDistribution,
    durationSeconds: totalDuration,
    rps: count / totalDuration,
    latency: {
      p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p90: latencies[Math.floor(latencies.length * 0.9)] || 0,
      p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
      min: latencies[0] || 0,
      max: latencies[latencies.length - 1] || 0,
    },
  };
}

/**
 * Scrapes and parses Prometheus exporter from OpenTelemetry Collector (port 8889).
 */
export async function queryCollectorMetrics(url = 'http://127.0.0.1:8889/metrics') {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const metrics = {};
        const lines = data.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const spaceIdx = trimmed.indexOf(' ');
          if (spaceIdx === -1) continue;
          const keyPart = trimmed.slice(0, spaceIdx);
          const valPart = trimmed.slice(spaceIdx + 1).trim();
          const val = parseFloat(valPart);

          // key can have labels like otel_http_requests_total{...}
          const braceIdx = keyPart.indexOf('{');
          const metricName = braceIdx === -1 ? keyPart : keyPart.slice(0, braceIdx);
          if (!metrics[metricName]) {
            metrics[metricName] = [];
          }
          metrics[metricName].push({
            fullKey: keyPart,
            value: val,
          });
        }
        resolve({ raw: data, metrics });
      });
    });
    req.on('error', reject);
  });
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
  extensionId = 'opentelemetry-metrics',
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

/**
 * Sends a mutation to the Go Controller API and returns the status and response body.
 */
export async function sendControllerMutation({
  baseUrl = 'http://127.0.0.1:8080',
  token,
  path = '/api/v1/extensions/opentelemetry-metrics/config',
  method = 'PUT',
  body = {},
} = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { status: res.status, data };
}

