// The integration run's profile: each section marks its end with how long it took and the run's total, so a slow
// section shows in the log (#186).

const started = Date.now();
let last = started;

/** Prints `label` with the seconds since the last mark and since the run began. */
export function mark(label: string): void {
  const now = Date.now();
  console.log(`${label} [${((now - last) / 1000).toFixed(1)} s, at ${((now - started) / 1000).toFixed(1)} s]`);
  last = now;
}
