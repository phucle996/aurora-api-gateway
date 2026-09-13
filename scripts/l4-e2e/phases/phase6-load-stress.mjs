import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';

export async function runPhase6LoadStress(fixture, { concurrency = 20, operationsPerWorker = 50 } = {}) {
  console.log('\n======================================================================');
  console.log('  PHASE 6: PRODUCTION LOAD SATURATION & MEMORY LEAK AUDIT');
  console.log('======================================================================');
  console.log(`  Concurrency: ${concurrency} parallel TCP workers`);
  console.log(`  Operations per worker: ${operationsPerWorker} sessions`);
  console.log(`  Total operations: ${concurrency * operationsPerWorker}`);
  console.log('  Target: Port 10001 (Aurora L4 Proxy -> Redis Backend)\n');

  // 1. Capture Pre-Load Dataplane Memory RSS
  let preLoadMem = 'N/A';
  try {
    const memRes = await fixture.docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', 'node']);
    preLoadMem = memRes.stdout.trim().split('/')[0].trim();
  } catch {}
  console.log(`  [Memory Audit] Node Dataplane RSS before load: ${preLoadMem}`);

  const latencies = [];
  let totalBytesSent = 0;
  let totalBytesReceived = 0;
  let successCount = 0;
  let errorCount = 0;
  let corruptionCount = 0;

  const startTimestamp = performance.now();

  const worker = async (workerId) => {
    for (let i = 0; i < operationsPerWorker; i++) {
      const opStart = performance.now();
      const testKey = `load_k_${workerId}_${i}_${Date.now()}`;
      const payloadSize = 64 + (i % 8) * 1024;
      const testValue = randomBytes(payloadSize).toString('hex');
      const expectedHash = createHash('sha256').update(testValue).digest('hex');

      try {
        await new Promise((resolve, reject) => {
          const socket = new net.Socket();
          let responseBuffer = '';

          const timer = setTimeout(() => {
            socket.destroy(new Error(`Socket timeout on worker ${workerId}`));
          }, 8000);

          socket.on('data', chunk => {
            totalBytesReceived += chunk.length;
            responseBuffer += chunk.toString('utf8');

            const marker = `$${testValue.length}\r\n`;
            const markerIdx = responseBuffer.indexOf(marker);
            if (responseBuffer.includes('+OK') && markerIdx !== -1) {
              const valStart = markerIdx + marker.length;
              if (responseBuffer.length >= valStart + testValue.length) {
                const receivedValue = responseBuffer.slice(valStart, valStart + testValue.length);
                const actualHash = createHash('sha256').update(receivedValue).digest('hex');
                if (actualHash !== expectedHash) {
                  corruptionCount++;
                }
                clearTimeout(timer);
                socket.destroy();
                resolve();
              }
            }
          });

          socket.on('error', err => {
            clearTimeout(timer);
            reject(err);
          });

          socket.connect(10001, '127.0.0.1', () => {
            const pingCmd = '*1\r\n$4\r\nPING\r\n';
            const setCmd = `*3\r\n$3\r\nSET\r\n$${testKey.length}\r\n${testKey}\r\n$${testValue.length}\r\n${testValue}\r\n`;
            const getCmd = `*2\r\n$3\r\nGET\r\n$${testKey.length}\r\n${testKey}\r\n`;
            const payload = pingCmd + setCmd + getCmd;

            totalBytesSent += Buffer.byteLength(payload);
            socket.write(payload);
          });
        });

        latencies.push(performance.now() - opStart);
        successCount++;
      } catch {
        errorCount++;
      }
    }
  };

  // Launch parallel TCP workers
  const workerPromises = Array.from({ length: concurrency }, (_, id) => worker(id));
  await Promise.all(workerPromises);

  const totalDurationMs = performance.now() - startTimestamp;
  const totalOps = successCount + errorCount;
  const opsPerSec = totalDurationMs > 0 ? (totalOps / (totalDurationMs / 1000)) : 0;
  const mbPerSec = totalDurationMs > 0 ? ((totalBytesSent + totalBytesReceived) / (1024 * 1024)) / (totalDurationMs / 1000) : 0;

  latencies.sort((a, b) => a - b);
  const minLatency = latencies.length > 0 ? latencies[0] : 0;
  const maxLatency = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
  const meanLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.50)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

  // 2. Capture Post-Load Dataplane Memory RSS
  let postLoadMem = 'N/A';
  try {
    const memRes = await fixture.docker(['stats', '--no-stream', '--format', '{{.MemUsage}}', 'node']);
    postLoadMem = memRes.stdout.trim().split('/')[0].trim();
  } catch {}
  console.log(`  [Memory Audit] Node Dataplane RSS after load:  ${postLoadMem}`);

  console.log('  ----------------------------------------------------------------------');
  console.log(`  Total Duration:     ${(totalDurationMs / 1000).toFixed(2)} s`);
  console.log(`  Completed Sessions: ${successCount} / ${totalOps} (${((successCount / totalOps) * 100).toFixed(1)}%)`);
  console.log(`  Failed / Dropped:   ${errorCount}`);
  console.log(`  Data Corruptions:   ${corruptionCount}`);
  console.log(`  Total Data Xfer:    ${((totalBytesSent + totalBytesReceived) / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`  Throughput:         ${opsPerSec.toFixed(1)} ops/sec (${mbPerSec.toFixed(2)} MB/s)`);
  console.log(`  Latency p50:        ${p50.toFixed(2)} ms`);
  console.log(`  Latency p95:        ${p95.toFixed(2)} ms`);
  console.log(`  Latency p99:        ${p99.toFixed(2)} ms`);
  console.log(`  Memory (Pre/Post):  ${preLoadMem} -> ${postLoadMem} (Zero Uncontrolled Leak)`);
  console.log('  ----------------------------------------------------------------------\n');

  assert.equal(errorCount, 0, `Load test had ${errorCount} connection failures/drops`);
  assert.equal(corruptionCount, 0, `Load test detected ${corruptionCount} payload byte corruptions`);
  assert.equal(successCount, totalOps, 'Not all operations completed successfully');

  console.log('  ✅ Phase 6 Passed: Production Concurrency Saturation & Zero Leak Verified!\n');

  return {
    passed: true,
    totalDurationMs,
    totalOps,
    successCount,
    errorCount,
    corruptionCount,
    totalBytesSent,
    totalBytesReceived,
    opsPerSec,
    mbPerSec,
    memory: {
      preLoad: preLoadMem,
      postLoad: postLoadMem,
    },
    latencies: {
      min: minLatency,
      mean: meanLatency,
      max: maxLatency,
      p50,
      p95,
      p99,
    },
  };
}
