export class CanaryReleaseJourney {
  constructor(report) {
    this.report = report;
  }

  step(name, data = {}) {
    const record = {
      name,
      timestamp: new Date().toISOString(),
      ...data,
    };
    this.report.journey.push(record);
    const summary = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    console.log(`  [Journey] -> ${name}${summary ? ` (${summary})` : ''}`);
  }
}
