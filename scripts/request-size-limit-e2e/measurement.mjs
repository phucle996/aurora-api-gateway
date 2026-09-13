import assert from 'node:assert/strict';

export class RequestSizeMeasurement {
  constructor() {
    this.count = 0;
    this.sum = 0;
    this.sumSquares = 0;
    this.min = Infinity;
    this.max = 0;
    this.latencies = [];
    this.status = {};
    this.errors = {};
    this.first = Infinity;
    this.last = 0;
  }

  record(statusCode, latencyMs, error = null) {
    const now = Date.now();
    this.count++;
    this.sum += latencyMs;
    this.sumSquares += latencyMs * latencyMs;
    this.min = Math.min(this.min, latencyMs);
    this.max = Math.max(this.max, latencyMs);
    this.latencies.push(latencyMs);
    this.status[statusCode] = (this.status[statusCode] || 0) + 1;
    if (error) {
      this.errors[error] = (this.errors[error] || 0) + 1;
    }
    this.first = Math.min(this.first, now - latencyMs);
    this.last = Math.max(this.last, now);
  }

  finish() {
    if (this.count === 0) {
      return {
        requests: 0,
        elapsedSeconds: 0,
        achievedRps: 0,
        latencyMs: { min: 0, mean: 0, stddev: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
        statusCodes: {},
        errors: {},
      };
    }

    this.latencies.sort((a, b) => a - b);
    const getP = (p) => {
      const idx = Math.min(
        this.latencies.length - 1,
        Math.max(0, Math.floor((this.latencies.length * p) / 100))
      );
      return this.latencies[idx];
    };

    const mean = this.sum / this.count;
    const variance = Math.max(0, this.sumSquares / this.count - mean * mean);
    const stddev = Math.sqrt(variance);
    const elapsedSeconds = (this.last - this.first) / 1000 || 0.001;

    return {
      requests: this.count,
      elapsedSeconds: parseFloat(elapsedSeconds.toFixed(3)),
      achievedRps: parseFloat((this.count / elapsedSeconds).toFixed(1)),
      latencyMs: {
        min: parseFloat(this.min.toFixed(2)),
        mean: parseFloat(mean.toFixed(2)),
        stddev: parseFloat(stddev.toFixed(2)),
        p50: parseFloat(getP(50).toFixed(2)),
        p90: parseFloat(getP(90).toFixed(2)),
        p95: parseFloat(getP(95).toFixed(2)),
        p99: parseFloat(getP(99).toFixed(2)),
        max: parseFloat(this.max.toFixed(2)),
      },
      statusCodes: this.status,
      errors: this.errors,
    };
  }
}
