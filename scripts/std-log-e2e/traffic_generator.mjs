import http from 'node:http';

export function makeHttpRequest({
  host = '127.0.0.1',
  port = 80,
  path = '/ok',
  method = 'GET',
  headers = {},
  body = null,
  timeout = 5000,
}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path,
        method,
        headers,
        timeout,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: rawData,
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeout}ms`));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Fires a burst of concurrent requests to evaluate throughput and resilience.
 */
export async function sendBurstTraffic({
  total = 100,
  concurrency = 10,
  path = '/ok',
  port = 80,
  headers = {},
} = {}) {
  const start = performance.now();
  const latencies = [];
  let completed = 0;
  let successCount = 0;
  let failCount = 0;

  async function worker() {
    while (true) {
      const idx = completed++;
      if (idx >= total) break;

      const t0 = performance.now();
      try {
        const res = await makeHttpRequest({
          host: '127.0.0.1',
          port,
          path,
          method: 'GET',
          headers,
          timeout: 4000,
        });
        latencies.push(performance.now() - t0);
        if (res.statusCode >= 200 && res.statusCode < 500) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (_err) {
        latencies.push(performance.now() - t0);
        failCount++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - start;
  latencies.sort((a, b) => a - b);

  return {
    total,
    durationMs,
    rps: Number(((total / durationMs) * 1000).toFixed(1)),
    successCount,
    failCount,
    p50: Number((latencies[Math.floor(latencies.length * 0.5)] || 0).toFixed(2)),
    p90: Number((latencies[Math.floor(latencies.length * 0.9)] || 0).toFixed(2)),
    p99: Number((latencies[Math.floor(latencies.length * 0.99)] || 0).toFixed(2)),
  };
}

/**
 * Mutates extension config or status via Control Plane REST API.
 */
export async function sendControllerMutation({
  extensionId = 'std-log',
  token,
  action = 'config', // 'config' or 'status'
  body = {},
  baseUrl = 'http://127.0.0.1:8080',
}) {
  const url = new URL(`${baseUrl}/api/v1/extensions/${extensionId}/${action}`);
  const payload = JSON.stringify(body);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
    },
    body: payload,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_e) {
    // not JSON
  }

  return {
    status: res.status,
    ok: res.ok,
    body: json || text,
  };
}

/**
 * Sends a burst of concurrent requests to the Controller API to verify race conditions.
 */
export async function sendControllerBurstTraffic({
  token,
  total = 200,
  concurrency = 20,
  extensionId = 'std-log',
} = {}) {
  const start = performance.now();
  const latencies = [];
  let completed = 0;
  let successCount = 0;
  let failCount = 0;

  async function worker() {
    while (true) {
      const idx = completed++;
      if (idx >= total) break;

      const t0 = performance.now();
      try {
        const res = await sendControllerMutation({
          extensionId,
          token,
          action: 'status',
          body: { enabled: true },
        });
        latencies.push(performance.now() - t0);
        if (res.status === 200) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (_e) {
        latencies.push(performance.now() - t0);
        failCount++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - start;
  latencies.sort((a, b) => a - b);

  return {
    total,
    durationMs,
    rps: Number(((total / durationMs) * 1000).toFixed(1)),
    successCount,
    failCount,
    p50: Number((latencies[Math.floor(latencies.length * 0.5)] || 0).toFixed(2)),
    p90: Number((latencies[Math.floor(latencies.length * 0.9)] || 0).toFixed(2)),
    p99: Number((latencies[Math.floor(latencies.length * 0.99)] || 0).toFixed(2)),
  };
}
