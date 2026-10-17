// Sweep sinusoidale esponenziale (metodo di Farina) e deconvoluzione in risposta all'impulso.
import { fft, nextPow2, realSpectrum } from './fft';

export interface SweepParams {
  f1: number;
  f2: number;
  durationSec: number;
  sampleRate: number;
  amplitude: number;
}

export function expSweep(p: SweepParams): Float32Array {
  const n = Math.round(p.durationSec * p.sampleRate);
  const out = new Float32Array(n);
  const L = p.durationSec / Math.log(p.f2 / p.f1);
  const fadeIn = Math.round(0.05 * p.sampleRate);
  const fadeOut = Math.round(0.005 * p.sampleRate);
  for (let i = 0; i < n; i++) {
    const t = i / p.sampleRate;
    let w = 1;
    if (i < fadeIn) w = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    else if (i > n - fadeOut) w = 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fadeOut);
    out[i] = p.amplitude * w * Math.sin(2 * Math.PI * p.f1 * L * (Math.exp(t / L) - 1));
  }
  return out;
}

/**
 * Ricava la risposta all'impulso dividendo lo spettro della registrazione per quello dello sweep,
 * con regolarizzazione fuori dalla banda dello sweep. La registrazione deve iniziare nello stesso
 * istante in cui parte lo sweep: la latenza dell'interfaccia resta come ritardo comune a tutte le misure.
 */
export function deconvolve(
  recording: ArrayLike<number>,
  sweep: ArrayLike<number>,
  sampleRate: number,
  f1: number,
  f2: number,
  irLength: number,
): Float32Array {
  const n = nextPow2(recording.length + sweep.length);
  const Y = realSpectrum(recording, n);
  const X = realSpectrum(sweep, n);
  let maxPow = 0;
  for (let k = 0; k <= n / 2; k++) maxPow = Math.max(maxPow, X.re[k] ** 2 + X.im[k] ** 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * sampleRate) / n;
    // Taglio morbido fuori banda: mezzo ottava sotto f1 e sopra f2.
    let band = 1;
    if (f < f1) band = Math.max(0, 1 - Math.log2(f1 / Math.max(f, 1e-3)) * 2);
    else if (f > f2) band = Math.max(0, 1 - Math.log2(f / f2) * 2);
    const xr = X.re[k], xi = X.im[k];
    const pow = xr * xr + xi * xi;
    const eps = maxPow * 1e-6 + (1 - band) * maxPow;
    const hr = (Y.re[k] * xr + Y.im[k] * xi) / (pow + eps);
    const hi = (Y.im[k] * xr - Y.re[k] * xi) / (pow + eps);
    re[k] = hr * band; im[k] = hi * band;
    if (k > 0 && k < n / 2) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  }
  im[0] = 0; im[n / 2] = 0;
  fft(re, im, true);
  const out = new Float32Array(irLength);
  for (let i = 0; i < Math.min(irLength, n); i++) out[i] = re[i];
  return out;
}
