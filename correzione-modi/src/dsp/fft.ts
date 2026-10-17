// FFT complessa radix-2 iterativa, in place su array separati (parte reale / immaginaria).

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tables(n: number) {
  let t = twiddleCache.get(n);
  if (t) return t;
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`Lunghezza FFT non potenza di 2: ${n}`);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  twiddleCache.set(n, t);
  return t;
}

/** Trasformata in place. Con inverse=true calcola la IFFT già scalata per 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

export interface Spectrum { re: Float64Array; im: Float64Array }

export function nextPow2(x: number): number {
  let n = 1;
  while (n < x) n <<= 1;
  return n;
}

/** Spettro di un segnale reale, con zero padding a n campioni. */
export function realSpectrum(x: ArrayLike<number>, n: number): Spectrum {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const len = Math.min(x.length, n);
  for (let i = 0; i < len; i++) re[i] = x[i];
  fft(re, im);
  return { re, im };
}

/** Forza la simmetria hermitiana a partire dai bin 0..n/2 e restituisce la parte reale della IFFT. */
export function hermitianToReal(s: Spectrum): Float64Array {
  const n = s.re.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) { re[k] = s.re[k]; im[k] = s.im[k]; }
  im[0] = 0;
  im[n / 2] = 0;
  for (let k = 1; k < n / 2; k++) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  fft(re, im, true);
  return re;
}

/** Convoluzione lineare via FFT. */
export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const outLen = a.length + b.length - 1;
  const n = nextPow2(outLen);
  const A = realSpectrum(a, n);
  const B = realSpectrum(b, n);
  for (let k = 0; k < n; k++) {
    const r = A.re[k] * B.re[k] - A.im[k] * B.im[k];
    const i = A.re[k] * B.im[k] + A.im[k] * B.re[k];
    A.re[k] = r; A.im[k] = i;
  }
  fft(A.re, A.im, true);
  return A.re.slice(0, outLen);
}
