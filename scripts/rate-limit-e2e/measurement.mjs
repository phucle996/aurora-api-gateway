import assert from 'node:assert/strict';

// A rate-limit-specific accumulator: every latency is normalized from the
// generator's nanoseconds to milliseconds here. Histogram quantiles have at
// most 0.1% bucket rounding; min/max/mean and counters are exact for input rows.
export class RateLimitMeasurement {
  constructor() {
    this.count = 0; this.sum = 0; this.sumSquares = 0; this.min = Infinity; this.max = 0;
    this.histogram = new Map(); this.status = {}; this.errors = {}; this.seconds = new Map();
    this.bytesIn = 0; this.bytesOut = 0; this.first = Infinity; this.last = 0; this.worst = [];
  }

  add(event) {
    assert.ok(Number.isFinite(event.latency) && event.latency >= 0, 'Generator latency must be nonnegative nanoseconds');
    assert.ok(Number.isInteger(event.code), 'Generator row must contain an HTTP status code');
    const timestamp = Date.parse(event.timestamp);
    assert.ok(Number.isFinite(timestamp), 'Generator row must contain an ISO timestamp');
    const ms = event.latency / 1e6;
    this.count++; this.sum += ms; this.sumSquares += ms * ms;
    this.min = Math.min(this.min, ms); this.max = Math.max(this.max, ms);
    const bucket = ms === 0 ? -Infinity : Math.ceil(Math.log(ms) / Math.log(1.001));
    this.histogram.set(bucket, (this.histogram.get(bucket) || 0) + 1);
    this.status[event.code] = (this.status[event.code] || 0) + 1;
    if (event.error) this.errors[event.error] = (this.errors[event.error] || 0) + 1;
    this.bytesIn += event.bytes_in || 0; this.bytesOut += event.bytes_out || 0;
    this.first = Math.min(this.first, timestamp); this.last = Math.max(this.last, timestamp + ms);
    const second = Math.floor(timestamp / 1000);
    const point = this.seconds.get(second) || { timestamp: second * 1000, requests: 0, errors: 0, latencySumMs: 0, maxMs: 0, status: {} };
    point.requests++; point.latencySumMs += ms; point.maxMs = Math.max(point.maxMs, ms);
    point.status[event.code] = (point.status[event.code] || 0) + 1;
    if (event.error || event.code === 0) point.errors++;
    this.seconds.set(second, point);
    if (this.worst.length < 20 || ms > this.worst.at(-1).latencyMs) {
      this.worst.push({ timestamp: event.timestamp, latencyMs: ms, status: event.code, error: event.error || null });
      this.worst.sort((a, b) => b.latencyMs - a.latencyMs); this.worst.length = Math.min(20, this.worst.length);
    }
  }

  finish() {
    const histogram = [...this.histogram.entries()].sort((a, b) => a[0] - b[0]);
    const percentiles = {};
    for (const percentile of [50, 75, 90, 95, 99, 99.9]) {
      let count = 0; let result = null;
      for (const [bucket, n] of histogram) {
        count += n;
        if (count >= Math.ceil(this.count * percentile / 100)) { result = Math.min(this.max, bucket === -Infinity ? 0 : 1.001 ** bucket); break; }
      }
      percentiles[`p${percentile}`] = result;
    }
    const elapsedSeconds = this.count ? (this.last - this.first) / 1000 : 0;
    return { requests: this.count, elapsedSeconds, achievedRps: elapsedSeconds > 0 ? this.count / elapsedSeconds : null,
      latencyMs: { min: this.count ? this.min : null, mean: this.count ? this.sum / this.count : null,
        stddev: this.count ? Math.sqrt(Math.max(0, this.sumSquares / this.count - (this.sum / this.count) ** 2)) : null,
        ...percentiles, max: this.count ? this.max : null, quantileRelativeRounding: 0.001 },
      statusCodes: this.status, errors: this.errors, bytesIn: this.bytesIn, bytesOut: this.bytesOut,
      histogram: histogram.map(([bucket, count]) => ({ upperMs: bucket === -Infinity ? 0 : 1.001 ** bucket, count })),
      series: [...this.seconds.values()].map(p => ({ ...p, meanMs: p.latencySumMs / p.requests })), worst: this.worst };
  }
}
