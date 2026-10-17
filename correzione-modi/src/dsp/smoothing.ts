// Smoothing a frazione d'ottava della potenza su griglia lineare di bin.

/** Frazione d'ottava variabile: 1/12 sotto 100 Hz, fino a 1/3 sopra 4 kHz. */
export function psychoFraction(f: number): number {
  if (f <= 100) return 12;
  if (f >= 4000) return 3;
  const t = Math.log2(f / 100) / Math.log2(4000 / 100);
  return 12 * Math.pow(3 / 12, t);
}

/**
 * power: potenza per i bin 0..n/2 (lunghezza n/2+1); binHz: risoluzione in Hz.
 * fraction(f) restituisce N per uno smoothing a 1/N d'ottava.
 */
export function smoothPower(
  power: Float64Array,
  binHz: number,
  fraction: (f: number) => number,
): Float64Array {
  const m = power.length;
  const prefix = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) prefix[i + 1] = prefix[i] + power[i];
  const out = new Float64Array(m);
  out[0] = power[0];
  for (let k = 1; k < m; k++) {
    const f = k * binHz;
    const half = Math.pow(2, 1 / (2 * fraction(f)));
    const lo = Math.max(1, Math.floor(k / half));
    const hi = Math.min(m - 1, Math.ceil(k * half));
    out[k] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

export function toDb(x: number, floor = 1e-12): number {
  return 10 * Math.log10(Math.max(x, floor));
}
