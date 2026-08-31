const target = process.argv[2];
if (!target) throw new Error("Usage: npm run load:smoke -- https://host/api/health");

const requests = Number(process.env.LOAD_REQUESTS || 200);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10);
const durations = [];
let succeeded = 0;
let failed = 0;
let cursor = 0;

async function worker() {
  while (cursor < requests) {
    cursor += 1;
    const started = performance.now();
    try {
      const response = await fetch(target, { cache: "no-store" });
      durations.push(performance.now() - started);
      if (response.ok) succeeded += 1;
      else failed += 1;
      await response.arrayBuffer();
    } catch {
      durations.push(performance.now() - started);
      failed += 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
durations.sort((left, right) => left - right);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))];
const report = {
  target,
  requests,
  concurrency,
  succeeded,
  failed,
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  maxMs: Math.round(durations.at(-1) || 0),
};
console.log(JSON.stringify(report, null, 2));
if (failed > 0) process.exitCode = 1;
