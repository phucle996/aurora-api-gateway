export class RequestTerminationMeasurement {
  constructor() {
    this.count = 0;
    this.sumLatencyMs = 0;
    this.minLatencyMs = Infinity;
    this.maxLatencyMs = 0;
    this.latencies = [];
    this.status = {};
    this.terminationStatuses = {};
    this.upstreams = {};
    this.errors = {};
    this.first = Infinity;
    this.last = 0;
    this.closed = false;
  }

  get totalRequests() {
    return this.count;
  }

  record(statusCode, latencyMs, terminationStatus = null, servedBy = null, error = null) {
    if (this.closed) return;
    const now = Date.now();
    this.count++;
    this.sumLatencyMs += latencyMs;
    this.minLatencyMs = Math.min(this.minLatencyMs, latencyMs);
    this.maxLatencyMs = Math.max(this.maxLatencyMs, latencyMs);
    this.latencies.push(latencyMs);

    this.status[statusCode] = (this.status[statusCode] || 0) + 1;
    if (terminationStatus) {
      this.terminationStatuses[terminationStatus] =
        (this.terminationStatuses[terminationStatus] || 0) + 1;
    }
    if (servedBy) {
      this.upstreams[servedBy] = (this.upstreams[servedBy] || 0) + 1;
    }
    if (error) {
      this.errors[error] = (this.errors[error] || 0) + 1;
    }
    this.first = Math.min(this.first, now - latencyMs);
    this.last = Math.max(this.last, now);
  }

  finish() {
    this.closed = true;
    if (this.count === 0) {
      return {
        requests: 0,
        totalRequests: 0,
        elapsedSeconds: 0,
        achievedRps: 0,
        terminationDistribution: {},
        terminationPercentages: {},
        upstreamDistribution: {},
        latencyMs: { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
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

    const meanLatency = this.sumLatencyMs / this.count;
    const elapsedSeconds = (this.last - this.first) / 1000 || 0.001;

    const terminationPercentages = {};
    for (const [st, cnt] of Object.entries(this.terminationStatuses)) {
      terminationPercentages[st] = parseFloat(((cnt / this.count) * 100).toFixed(2));
    }

    return {
      requests: this.count,
      totalRequests: this.count,
      elapsedSeconds: parseFloat(elapsedSeconds.toFixed(3)),
      achievedRps: parseFloat((this.count / elapsedSeconds).toFixed(1)),
      terminationDistribution: this.terminationStatuses,
      terminationPercentages,
      upstreamDistribution: this.upstreams,
      latencyMs: {
        min: parseFloat(this.minLatencyMs.toFixed(2)),
        mean: parseFloat(meanLatency.toFixed(2)),
        p50: parseFloat(getP(50).toFixed(2)),
        p90: parseFloat(getP(90).toFixed(2)),
        p95: parseFloat(getP(95).toFixed(2)),
        p99: parseFloat(getP(99).toFixed(2)),
        max: parseFloat(this.maxLatencyMs.toFixed(2)),
      },
      statusCodes: this.status,
      errors: this.errors,
    };
  }
}
