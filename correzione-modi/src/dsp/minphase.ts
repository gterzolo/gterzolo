// Spettro a fase minima a partire da un modulo, con il metodo del cepstrum reale.
import { fft, type Spectrum } from './fft';

/** mag: modulo per i bin 0..n/2 (lunghezza n/2+1). Restituisce lo spettro completo (n bin). */
export function minimumPhase(mag: Float64Array): Spectrum {
  const n = (mag.length - 1) * 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) {
    const v = Math.log(Math.max(mag[k], 1e-9));
    re[k] = v;
    if (k > 0 && k < n / 2) re[n - k] = v;
  }
  fft(re, im, true); // cepstrum reale
  for (let i = 1; i < n / 2; i++) { re[i] *= 2; re[n - i] = 0; }
  for (let i = 0; i < n; i++) im[i] = 0;
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const a = Math.exp(re[k]);
    const r = a * Math.cos(im[k]);
    const i = a * Math.sin(im[k]);
    re[k] = r; im[k] = i;
  }
  return { re, im };
}
