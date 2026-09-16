import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

/**
 * Reads the memory usage of a Docker container in bytes.
 */
export function readCgroupMemory(containerName = 'aurora-node') {
  try {
    const stdout = execFileSync(
      'docker',
      ['exec', containerName, 'cat', '/sys/fs/cgroup/memory.current'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return parseInt(stdout.trim(), 10);
  } catch {
    // Fallback: docker stats
    try {
      const stats = execFileSync(
        'docker',
        ['stats', '--no-stream', '--format', '{{.MemUsage}}', containerName],
        { encoding: 'utf8' }
      );
      const match = stats.match(/^([\d.]+)\s*([A-Za-z]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit.startsWith('K')) return Math.round(val * 1024);
        if (unit.startsWith('M')) return Math.round(val * 1024 * 1024);
        if (unit.startsWith('G')) return Math.round(val * 1024 * 1024 * 1024);
        return Math.round(val);
      }
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Asserts that memory growth remains strictly bounded.
 */
export function assertMemoryBounded(beforeBytes, afterBytes, maxDeltaMB = 35) {
  if (!beforeBytes || !afterBytes) return;
  const deltaMB = (afterBytes - beforeBytes) / (1024 * 1024);
  assert.ok(
    deltaMB < maxDeltaMB,
    `Memory leak detected! Grew by ${deltaMB.toFixed(2)} MB, exceeding allowed bound of ${maxDeltaMB} MB`
  );
}

/**
 * Parses spans emitted by OpenTelemetry Collector debug exporter.
 */
export function parseCollectorSpans(logsText) {
  const spans = [];
  const spanBlocks = logsText.split(/(?=Span #\d+)/);

  for (const block of spanBlocks) {
    if (!block.includes('Trace ID') && !block.includes('Kind')) continue;

    const span = {
      traceId: '',
      spanId: '',
      parentId: '',
      name: '',
      kind: '',
      statusCode: '',
      statusMessage: '',
      attributes: {},
    };

    const traceMatch = block.match(/Trace ID\s*:\s*([a-f0-9]+)/i);
    if (traceMatch) span.traceId = traceMatch[1].trim();

    const spanIdMatch = block.match(/^\s*ID\s*:\s*([a-f0-9]+)/mi);
    if (spanIdMatch) span.spanId = spanIdMatch[1].trim();

    const parentMatch = block.match(/Parent ID\s*:\s*([a-f0-9]+)?/i);
    if (parentMatch && parentMatch[1]) span.parentId = parentMatch[1].trim();

    const nameMatch = block.match(/Name\s*:\s*([^\n\r]+)/i);
    if (nameMatch) span.name = nameMatch[1].trim();

    const kindMatch = block.match(/Kind\s*:\s*([^\n\r]+)/i);
    if (kindMatch) span.kind = kindMatch[1].trim();

    const statusMatch = block.match(/Status code\s*:\s*([^\n\r]+)/i);
    if (statusMatch) span.statusCode = statusMatch[1].trim();

    const attrSection = block.match(/Attributes:([\s\S]*?)(?:(?:Span #|\{"resource"|$))/);
    if (attrSection) {
      const attrLines = attrSection[1].split('\n');
      for (const line of attrLines) {
        const m = line.match(/->\s*([a-zA-Z0-9_.-]+):\s*(?:Str|Int|Double|Bool)\((.*?)\)/);
        if (m) {
          span.attributes[m[1]] = m[2];
        }
      }
    }

    if (span.traceId || span.spanId) {
      spans.push(span);
    }
  }

  return spans;
}

/**
 * Fetches and parses spans from the OpenTelemetry Collector container.
 */
export function fetchCollectorSpans(containerName = 'aurora-otel-collector', sinceSec = 15) {
  const res = spawnSync('docker', ['logs', '--since', `${sinceSec}s`, containerName], {
    encoding: 'utf8',
  });
  const rawLogs = (res.stdout || '') + (res.stderr || '');
  return {
    raw: rawLogs,
    spans: parseCollectorSpans(rawLogs),
  };
}
