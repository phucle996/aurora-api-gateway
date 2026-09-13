import assert from 'node:assert/strict';

export class TrafficShaperMeasurement {
  constructor() {
    this.count = 0;
    this.sumDurationMs = 0;
    this.sumBytes = 0;
    this.minDurationMs = Infinity;
    this.maxDurationMs = 0;
    this.durations = [];
    this.throughputs = []; // in KB/s
    this.status = {};
    this.errors = {};
    this.first = Infinity;
    this.last = 0;
  }

  record(statusCode, durationMs, bytesReceived, error = null) {
    const now = Date.now();
    this.count++;
    this.sumDurationMs += durationMs;
    this.sumBytes += bytesReceived;
    this.minDurationMs = Math.min(this.minDurationMs, durationMs);
    this.maxDurationMs = Math.max(this.maxDurationMs, durationMs);
    this.durations.push(durationMs);

    const seconds = durationMs / 1000 || 0.001;
    const throughputKbps = (bytesReceived / 1024) / seconds;
    this.throughputs.push(throughputKbps);

    this.status[statusCode] = (this.status[statusCode] || 0) + 1;
    if (error) {
      this.errors[error] = (this.errors[error] || 0) + 1;
    }
    this.first = Math.min(this.first, now - durationMs);
    this.last = Math.max(this.last, now);
  }

  finish() {
    if (this.count === 0) {
      return {
        requests: 0,
        elapsedSeconds: 0,
        achievedRps: 0,
        totalBytes: 0,
        meanThroughputKbps: 0,
        durationMs: { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
        statusCodes: {},
        errors: {},
      };
    }

    this.durations.sort((a, b) => a - b);
    this.throughputs.sort((a, b) => a - b);

    const getP = (arr, p) => {
      const idx = Math.min(
        arr.length - 1,
        Math.max(0, Math.floor((arr.length * p) / 100))
      );
      return arr[idx];
    };

    const meanDuration = this.sumDurationMs / this.count;
    const elapsedSeconds = (this.last - this.first) / 1000 || 0.001;
    const meanThroughput = (this.sumBytes / 1024) / elapsedSeconds;

    return {
      requests: this.count,
      elapsedSeconds: parseFloat(elapsedSeconds.toFixed(3)),
      achievedRps: parseFloat((this.count / elapsedSeconds).toFixed(1)),
      totalBytes: this.sumBytes,
      meanThroughputKbps: parseFloat(meanThroughput.toFixed(2)),
      durationMs: {
        min: parseFloat(this.minDurationMs.toFixed(2)),
        mean: parseFloat(meanDuration.toFixed(2)),
        p50: parseFloat(getP(this.durations, 50).toFixed(2)),
        p90: parseFloat(getP(this.durations, 90).toFixed(2)),
        p95: parseFloat(getP(this.durations, 95).toFixed(2)),
        p99: parseFloat(getP(this.durations, 99).toFixed(2)),
        max: parseFloat(this.maxDurationMs.toFixed(2)),
      },
      statusCodes: this.status,
      errors: this.errors,
    };
  }
}
