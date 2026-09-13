import assert from 'node:assert/strict';

export class RequestSizeJourney {
  constructor(report) {
    this.report = report;
    this.steps = [];
  }

  step(name, details = {}) {
    const entry = {
      name,
      timestamp: new Date().toISOString(),
      ...details,
    };
    this.steps.push(entry);
    if (this.report && this.report.journey) {
      this.report.journey.push(entry);
    }
    console.log(`  [Journey] -> ${name}${details.status ? ` (${details.status})` : ''}`);
  }
}
