import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const SHM_MAGIC = 0x4155524F; // "AURO"
export const SHM_VERSION = 1;

/**
 * Reads memory cgroup statistics and system meminfo from inside a container.
 * @param {string} containerName
 */
export function readCgroupMemory(containerName = 'aurora-node') {
  try {
    const raw = execFileSync(
      'docker',
      ['exec', containerName, 'sh', '-c', 'cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes; cat /proc/meminfo'],
      { encoding: 'utf8', timeout: 5000 }
    );

    const lines = raw.trim().split('\n');
    const currentBytes = Number(lines[0]) || 0;
    const memTotalMatch = raw.match(/^MemTotal:\s+(\d+)/m);
    const memFreeMatch = raw.match(/^MemFree:\s+(\d+)/m);
    const memAvailableMatch = raw.match(/^MemAvailable:\s+(\d+)/m);

    const totalBytes = memTotalMatch ? Number(memTotalMatch[1]) * 1024 : 0;
    const availableBytes = memAvailableMatch ? Number(memAvailableMatch[1]) * 1024 : (memFreeMatch ? Number(memFreeMatch[1]) * 1024 : 0);

    return {
      currentBytes,
      currentMB: (currentBytes / (1024 * 1024)).toFixed(2),
      totalBytes,
      availableBytes,
    };
  } catch (err) {
    return {
      currentBytes: 0,
      currentMB: '0.00',
      totalBytes: 0,
      availableBytes: 0,
      error: err.message,
    };
  }
}

/**
 * Directly samples and parses the 4096-byte Shared Memory struct from /dev/shm.
 * @param {string} containerName
 */
export function sampleShmDirect(containerName = 'aurora-node') {
  const b64 = execFileSync(
    'docker',
    ['exec', containerName, 'base64', '/dev/shm/aurora_gateway_telemetry.bin'],
    { encoding: 'utf8', timeout: 5000 }
  );
  const buf = Buffer.from(b64, 'base64');
  assert.ok(buf.length >= 360, `SHM buffer size ${buf.length} is less than minimum struct size 360`);

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const r64 = (offset) => Number(buf.readBigUInt64LE(offset));

  return {
    magic,
    version,
    generation: r64(8),
    http_requests_total: r64(16),
    http_status_2xx: r64(24),
    http_status_3xx: r64(32),
    http_status_4xx: r64(40),
    http_status_5xx: r64(48),
    http_status_other: r64(56),
    buckets: {
      '1ms': r64(64),
      '5ms': r64(72),
      '10ms': r64(80),
      '50ms': r64(88),
      '100ms': r64(96),
      '500ms': r64(104),
      '1000ms': r64(112),
      inf: r64(120),
    },
    http_duration_sum_ms: r64(128),
    waf: {
      allowed: r64(136),
      blocked: r64(144),
      audit: r64(152),
    },
    access: {
      allowed: r64(160),
      blocked: r64(168),
      evaluations: r64(160) + r64(168),
    },
    ratelimit: {
      allowed: r64(176),
      throttled: r64(184),
      rejected: r64(192),
      requests: r64(176) + r64(184) + r64(192),
    },
    jwt: {
      valid: r64(200),
      invalid: r64(208),
      expired: r64(216),
      missing: r64(224),
      validations: r64(200) + r64(208) + r64(216) + r64(224),
    },
    active_log_consumers: r64(352),
  };
}

/**
 * Asserts that cgroup memory does not grow unbounded across lifecycle transitions.
 */
export function assertMemoryBounded(before, after, maxGrowthMB = 25) {
  const delta = Number(after.currentMB) - Number(before.currentMB);
  assert.ok(
    delta <= maxGrowthMB,
    `Memory leak detected! Cgroup memory increased by ${delta.toFixed(2)} MB (Limit: ${maxGrowthMB} MB)`
  );
}
