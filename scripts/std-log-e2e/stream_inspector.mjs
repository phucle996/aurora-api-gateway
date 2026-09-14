import { execFileSync } from 'node:child_process';

/**
 * Helper to inspect isolated standard streams from Docker container.
 */
export class StreamInspector {
  constructor(container = 'aurora-node') {
    this.container = container;
  }

  /**
   * Fetches only stdout records (redirects stderr to /dev/null).
   */
  getStdout(tail = 100) {
    try {
      const out = execFileSync(
        'sh',
        ['-c', `docker logs --tail ${tail} ${this.container} 2>/dev/null`],
        { encoding: 'utf8', timeout: 5000 }
      );
      return out.trim().split('\n').filter(Boolean);
    } catch (_err) {
      return [];
    }
  }

  /**
   * Fetches only stderr records (redirects stdout to /dev/null).
   */
  getStderr(tail = 100) {
    try {
      const out = execFileSync(
        'sh',
        ['-c', `docker logs --tail ${tail} ${this.container} 2>&1 >/dev/null`],
        { encoding: 'utf8', timeout: 5000 }
      );
      return out.trim().split('\n').filter(Boolean);
    } catch (_err) {
      return [];
    }
  }

  /**
   * Parses JSON log records from an array of log lines.
   */
  parseJsonRecords(lines) {
    const records = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj.level !== undefined && obj.status !== undefined) {
          records.push(obj);
        }
      } catch (_e) {
        // ignore non-JSON
      }
    }
    return records;
  }

  /**
   * Extracts text-format log records matching "[LEVEL] METHOD URI STATUS ...".
   */
  parseTextRecords(lines) {
    const records = [];
    const textRegex = /^\[(INFO|WARN|ERROR)\]\s+([A-Z]+)\s+(\S+)\s+(\d{3})\s+([\d\.]+)ms\s+-\s+(\S+)(.*)$/;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(textRegex);
      if (match) {
        records.push({
          raw: trimmed,
          level: match[1],
          method: match[2],
          uri: match[3],
          status: parseInt(match[4], 10),
          duration_ms: parseFloat(match[5]),
          client_ip: match[6],
          details: match[7].trim(),
        });
      }
    }
    return records;
  }

  /**
   * Extracts NGINX/Apache combined log records.
   */
  parseCombinedRecords(lines) {
    const records = [];
    const combinedRegex = /^(\S+)\s+\S+\s+\S+\s+\[(.*?)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d{3})\s+(\d+)\s+"(.*?)"\s+"(.*?)"$/;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(combinedRegex);
      if (match) {
        records.push({
          raw: trimmed,
          client_ip: match[1],
          timestamp: match[2],
          method: match[3],
          uri: match[4],
          protocol: match[5],
          status: parseInt(match[6], 10),
          bytes_sent: parseInt(match[7], 10),
          referrer: match[8],
          user_agent: match[9],
        });
      }
    }
    return records;
  }
}
