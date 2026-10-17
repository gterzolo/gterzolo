// Correzione attiva della stanza (approccio di tipo "Active Room Treatment").
//
// Per ogni canale d'ingresso c (es. L, R) si cercano i filtri W_ck verso TUTTE le uscite k
// (L, R, SW1, SW2...) che minimizzano, in ogni bin di frequenza e sommando su tutte le posizioni
// di misura p, l'errore |Σ_k H_pk W_ck − D_pc|². D_pc è la risposta desiderata: il target alla
// posizione p con l'arrivo del suono diretto del diffusore c più un ritardo di modellazione.
// Così, nella gamma dei bassi, gli altri diffusori e i sub emettono segnali che annullano le onde
// stazionarie e accorciano il decadimento dei modi. Sopra la banda ART resta una correzione a fase
// minima sul solo diffusore c, ottenuta dalla media spaziale con smoothing psicoacustico.
import { fft, hermitianToReal, nextPow2, realSpectrum, type Spectrum } from './fft';
import { minimumPhase } from './minphase';
import { psychoFraction, smoothPower, toDb } from './smoothing';
import { solveComplex } from './complexSolve';
import { targetDb, type TargetParams } from './target';

export interface MeasurementSet {
  sampleRate: number;
  /** Nomi delle uscite fisiche, nell'ordine dei canali del DSP. */
  outputs: string[];
  /** ir[posizione][uscita]. La prima posizione è quella d'ascolto principale. */
  ir: Float32Array[][];
}

export interface ArtParams {
  /** Indici delle uscite che sono anche canali d'ingresso del sistema (es. [0, 1] per L e R). */
  inputs: number[];
  firLength: number;
  irWindowMs: number;
  /** Limite superiore della correzione multi-diffusore. */
  artMaxHz: number;
  /** Larghezza (ottave) della transizione sopra artMaxHz. */
  artTransitionOct: number;
  /** Limite superiore della correzione a fase minima del singolo diffusore. */
  correctionMaxHz: number;
  maxBoostDb: number;
  /** Sotto questa frequenza i diffusori principali non vengono esaltati (lavorano i sub). */
  mainLowHz: number;
  modelingDelayMs: number;
  /** Regolarizzazione di Tikhonov, relativa all'energia delle misure in ogni bin. */
  regularization: number;
  positionWeights: number[];
  target: TargetParams;
  /** Correzione del microfono in dB (risposta del mic, che verrà sottratta). */
  micCalDb?: (f: number) => number;
}

export const defaultArtParams = (inputs: number[], positions: number): Omit<ArtParams, 'target'> => ({
  inputs,
  firLength: 65536,
  irWindowMs: 500,
  artMaxHz: 150,
  artTransitionOct: 0.5,
  correctionMaxHz: 500,
  maxBoostDb: 6,
  mainLowHz: 45,
  modelingDelayMs: 25,
  regularization: 0.02,
  positionWeights: Array.from({ length: positions }, (_, i) => (i === 0 ? 1.5 : 1)),
});

export interface ChannelPlot {
  input: string;
  /** Livello di riferimento (500–2000 Hz) a cui corrisponde lo 0 dB dei grafici. */
  refLevel: number;
  /** Per posizione: risposta prima/dopo in dB (1/24 d'ottava) sui punti di freqAxis. */
  beforeDb: Float32Array[];
  afterDb: Float32Array[];
  targetDb: Float32Array;
  /** Per posizione: curva energia-tempo dei bassi (dB), un punto per ms, da −20 ms. */
  etcBefore: Float32Array[];
  etcAfter: Float32Array[];
  /** Deviazione dal target (dB RMS) nella banda ART, prima e dopo. */
  rmsBefore: number;
  rmsAfter: number;
}

export interface ArtResult {
  sampleRate: number;
  inputs: string[];
  outputs: string[];
  /** filters[c][k]: FIR dal canale d'ingresso c all'uscita k, già normalizzati. */
  filters: Float32Array[][];
  /** Attenuazione applicata per evitare il clipping (dB, ≤ 0). */
  headroomDb: number;
  freqAxis: Float32Array;
  channels: ChannelPlot[];
  etcStartMs: number;
}

const PLOT_POINTS = 480;
const ETC_PRE_MS = 20;
const ETC_LEN_MS = 600;

export function computeArt(m: MeasurementSet, params: ArtParams): ArtResult {
  const sr = m.sampleRate;
  const N = params.firLength;
  const half = N / 2;
  const binHz = sr / N;
  const P = m.ir.length;
  const K = m.outputs.length;
  if (P === 0) throw new Error('Nessuna misura');
  for (const row of m.ir) if (row.length !== K) throw new Error('Misure incomplete: servono tutte le uscite per ogni posizione');
  const weights = Array.from({ length: P }, (_, p) => params.positionWeights[p] ?? 1);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const delta = (params.modelingDelayMs / 1000) * sr;

  // 1) Finestra comune sulle risposte e passaggio in frequenza.
  let onset = Infinity;
  for (const row of m.ir) for (const x of row) onset = Math.min(onset, firstAbove(x, 0.1));
  const winEnd = Math.min(N, Math.round(Math.max(0, onset - 0.002 * sr) + (params.irWindowMs / 1000) * sr));
  const H: Spectrum[][] = m.ir.map((row) => row.map((x) => realSpectrum(windowIr(x, winEnd), N)));
  if (params.micCalDb) {
    const cal = params.micCalDb;
    for (const row of H) for (const s of row) {
      for (let k = 0; k <= half; k++) {
        const g = Math.pow(10, -cal(k * binHz) / 20);
        s.re[k] *= g; s.im[k] *= g;
      }
    }
  }

  const tDb = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) tDb[k] = targetDb(k * binHz, params.target);

  const filters: Float32Array[][] = [];
  const refLevels: number[] = [];
  const arrivals: number[][] = [];

  for (const c of params.inputs) {
    // Arrivo del suono diretto del diffusore c in ogni posizione (campioni, latenza inclusa).
    const tau = m.ir.map((row) => peakIndex(row[c]));
    arrivals.push(tau);

    // Livello di riferimento: potenza media 500–2000 Hz.
    const avgPow = new Float64Array(half + 1);
    for (let p = 0; p < P; p++) {
      const s = H[p][c];
      for (let k = 0; k <= half; k++) avgPow[k] += (weights[p] * (s.re[k] ** 2 + s.im[k] ** 2)) / wSum;
    }
    let ref = 0, cnt = 0;
    for (let k = Math.ceil(500 / binHz); k <= Math.floor(2000 / binHz); k++) { ref += avgPow[k]; cnt++; }
    const refPow = ref / cnt;
    refLevels.push(Math.sqrt(refPow));

    // 2) Correzione a fase minima del solo diffusore c (media spaziale, smoothing psicoacustico).
    const sm = smoothPower(avgPow, binHz, psychoFraction);
    const gMag = new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
      const f = k * binHz;
      let g = tDb[k] + toDb(refPow) - toDb(sm[k]);
      g = Math.min(Math.max(g, -24), f < params.mainLowHz ? 0 : params.maxBoostDb);
      let w = f > params.correctionMaxHz ? Math.max(0, 1 - Math.log2(f / params.correctionMaxHz)) : 1;
      if (f < 15) w *= Math.max(0, (f - 10) / 5);
      gMag[k] = Math.pow(10, (g * w) / 20);
    }
    const G = minimumPhase(gMag);

    // 3) Ottimizzazione multi-diffusore bin per bin.
    const W: Spectrum[] = Array.from({ length: K }, () => ({ re: new Float64Array(N), im: new Float64Array(N) }));
    const aRe = new Float64Array(K * K), aIm = new Float64Array(K * K);
    const bRe = new Float64Array(K), bIm = new Float64Array(K);
    const sRe = new Float64Array(K * K), sIm = new Float64Array(K * K);
    const xRe = new Float64Array(K), xIm = new Float64Array(K);
    const dRe = new Float64Array(P), dIm = new Float64Array(P);
    const T = Math.sqrt(refPow);
    for (let k = 0; k <= half; k++) {
      const f = k * binHz;
      const om = (2 * Math.PI * k) / N;
      const w0r = G.re[k] * Math.cos(om * delta) + G.im[k] * Math.sin(om * delta);
      const w0i = G.im[k] * Math.cos(om * delta) - G.re[k] * Math.sin(om * delta);
      const alpha = artWeight(f, params.artMaxHz, params.artTransitionOct);
      if (alpha <= 0 || k === 0 || k === half) {
        W[c].re[k] = w0r; W[c].im[k] = k === 0 || k === half ? 0 : w0i;
        continue;
      }
      const tAmp = T * Math.pow(10, tDb[k] / 20);
      for (let p = 0; p < P; p++) {
        const ph = -om * (tau[p] + delta);
        const hr = H[p][c].re[k], hi = H[p][c].im[k];
        dRe[p] = alpha * tAmp * Math.cos(ph) + (1 - alpha) * (hr * w0r - hi * w0i);
        dIm[p] = alpha * tAmp * Math.sin(ph) + (1 - alpha) * (hr * w0i + hi * w0r);
      }
      aRe.fill(0); aIm.fill(0); bRe.fill(0); bIm.fill(0);
      for (let p = 0; p < P; p++) {
        const wp = weights[p];
        for (let i = 0; i < K; i++) {
          const ir = H[p][i].re[k], ii = -H[p][i].im[k]; // conj(H_pi)
          for (let j = 0; j < K; j++) {
            const jr = H[p][j].re[k], ji = H[p][j].im[k];
            aRe[i * K + j] += wp * (ir * jr - ii * ji);
            aIm[i * K + j] += wp * (ir * ji + ii * jr);
          }
          bRe[i] += wp * (ir * dRe[p] - ii * dIm[p]);
          bIm[i] += wp * (ir * dIm[p] + ii * dRe[p]);
        }
      }
      let trace = 0;
      for (let i = 0; i < K; i++) trace += aRe[i * K + i];
      // Limite di guadagno: niente "riempimento" delle antirisonanze a forza di boost.
      const cap = Math.pow(10, (params.maxBoostDb + Math.max(0, tDb[k])) / 20);
      let lamScale = 1;
      for (let iter = 0; iter < 16; iter++) {
        sRe.set(aRe); sIm.set(aIm); xRe.set(bRe); xIm.set(bIm);
        const lamBase = (lamScale * params.regularization * trace) / K + 1e-30;
        for (let i = 0; i < K; i++) {
          let lam = lamBase;
          if (i !== c) lam *= 1 + 1e4 * (1 - alpha);
          if (params.inputs.includes(i) && f < params.mainLowHz * 2) lam *= 1 + 100 * Math.pow(params.mainLowHz / f, 4);
          sRe[i * K + i] += lam;
          // Regolarizza verso la soluzione "solo diffusore c" invece che verso zero.
          if (i === c) { xRe[i] += lam * w0r; xIm[i] += lam * w0i; }
        }
        solveComplex(sRe, sIm, xRe, xIm, K);
        let gain = 0;
        for (let i = 0; i < K; i++) gain += Math.hypot(xRe[i], xIm[i]);
        if (gain <= cap) break;
        lamScale *= 3;
      }
      for (let i = 0; i < K; i++) { W[i].re[k] = xRe[i]; W[i].im[k] = xIm[i]; }
    }

    filters.push(W.map((s) => windowFilter(hermitianToReal(s), sr)));
  }

  // 4) Normalizzazione: il caso peggiore su ogni uscita è la somma dei moduli dei filtri che la alimentano.
  const F: Spectrum[][] = filters.map((row) => row.map((x) => realSpectrum(x, N)));
  let maxGain = 0;
  for (let k = 0; k < K; k++) {
    for (let b = Math.ceil(10 / binHz); b <= Math.min(half, Math.floor(20000 / binHz)); b++) {
      let g = 0;
      for (let c = 0; c < F.length; c++) g += Math.hypot(F[c][k].re[b], F[c][k].im[b]);
      maxGain = Math.max(maxGain, g);
    }
  }
  const limit = Math.pow(10, -0.5 / 20);
  const scale = maxGain > limit ? limit / maxGain : 1;
  const scaled = filters.map((row) => row.map((x) => Float32Array.from(x, (v) => v * scale)));

  // 5) Previsione del risultato in ogni posizione, per i grafici.
  const freqAxis = new Float32Array(PLOT_POINTS);
  for (let i = 0; i < PLOT_POINTS; i++) freqAxis[i] = 10 * Math.pow(2000, i / (PLOT_POINTS - 1));
  const channels: ChannelPlot[] = params.inputs.map((c, ci) => {
    const ref = refLevels[ci];
    const beforeDb: Float32Array[] = [], afterDb: Float32Array[] = [];
    const etcBefore: Float32Array[] = [], etcAfter: Float32Array[] = [];
    let errB = 0, errA = 0, n = 0;
    const devB: number[] = [], devA: number[] = [];
    for (let p = 0; p < P; p++) {
      const before: Spectrum = { re: new Float64Array(N), im: new Float64Array(N) };
      const after: Spectrum = { re: new Float64Array(N), im: new Float64Array(N) };
      for (let b = 0; b <= half; b++) {
        before.re[b] = H[p][c].re[b] / ref; before.im[b] = H[p][c].im[b] / ref;
        let yr = 0, yi = 0;
        for (let k = 0; k < K; k++) {
          const hr = H[p][k].re[b], hi = H[p][k].im[b];
          const fr = F[ci][k].re[b], fi = F[ci][k].im[b];
          yr += hr * fr - hi * fi; yi += hr * fi + hi * fr;
        }
        after.re[b] = yr / ref; after.im[b] = yi / ref;
      }
      const sb = smoothedDb(before, binHz), sa = smoothedDb(after, binHz);
      beforeDb.push(sampleLog(sb, binHz, freqAxis));
      afterDb.push(sampleLog(sa, binHz, freqAxis));
      for (let b = Math.ceil(Math.max(20, params.target.lowCutHz * 1.5) / binHz); b <= params.artMaxHz / binHz; b++) {
        devB.push(sb[b] - tDb[b]); devA.push(sa[b] - tDb[b]);
      }
      const lp = params.artMaxHz * 1.5;
      etcBefore.push(etc(before, sr, lp, arrivals[ci][p]));
      etcAfter.push(etc(after, sr, lp, arrivals[ci][p] + delta));
    }
    const mb = mean(devB), ma = mean(devA);
    for (let i = 0; i < devB.length; i++) { errB += (devB[i] - mb) ** 2; errA += (devA[i] - ma) ** 2; n++; }
    return {
      input: m.outputs[c],
      refLevel: ref,
      beforeDb, afterDb,
      targetDb: Float32Array.from(freqAxis, (f) => targetDb(f, params.target)),
      etcBefore, etcAfter,
      rmsBefore: Math.sqrt(errB / Math.max(n, 1)),
      rmsAfter: Math.sqrt(errA / Math.max(n, 1)),
    };
  });

  return {
    sampleRate: sr,
    inputs: params.inputs.map((c) => m.outputs[c]),
    outputs: m.outputs,
    filters: scaled,
    headroomDb: 20 * Math.log10(scale),
    freqAxis,
    channels,
    etcStartMs: -ETC_PRE_MS,
  };
}

/** Risposta misurata (es. verifica con i filtri attivi) sugli stessi assi e riferimenti dei grafici. */
export function measuredDb(
  ir: Float32Array, sr: number, axis: Float32Array, refLevel: number, gainDb: number, micCalDb?: (f: number) => number,
): Float32Array {
  const N = nextPow2(ir.length);
  const s = realSpectrum(ir, N);
  const binHz = sr / N;
  const g = Math.pow(10, -gainDb / 20) / refLevel;
  for (let k = 0; k <= N / 2; k++) {
    const c = micCalDb ? Math.pow(10, -micCalDb(k * binHz) / 20) : 1;
    s.re[k] *= g * c; s.im[k] *= g * c;
  }
  return sampleLog(smoothedDb(s, binHz), binHz, axis);
}

function artWeight(f: number, maxHz: number, oct: number): number {
  if (f <= maxHz) return 1;
  const x = Math.log2(f / maxHz) / oct;
  return x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x);
}

function firstAbove(x: Float32Array, rel: number): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= rel * peak) return i;
  return 0;
}

function peakIndex(x: Float32Array): number {
  let best = 0, idx = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > best) { best = Math.abs(x[i]); idx = i; }
  return idx;
}

function windowIr(x: Float32Array, end: number): Float64Array {
  const len = Math.min(end, x.length);
  const out = new Float64Array(len);
  const fade = Math.floor(len * 0.25);
  for (let i = 0; i < len; i++) {
    let w = 1;
    if (i > len - fade) w = 0.5 + 0.5 * Math.cos((Math.PI * (i - (len - fade))) / fade);
    out[i] = x[i] * w;
  }
  return out;
}

/** Breve fade-in e lunga dissolvenza finale: elimina la parte acausale ripiegata e le code. */
function windowFilter(x: Float64Array, sr: number): Float32Array {
  const n = x.length;
  const fadeIn = Math.round(0.001 * sr);
  const fadeOut = Math.floor(n * 0.25);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let w = 1;
    if (i < fadeIn) w = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
    else if (i > n - fadeOut) w = 0.5 + 0.5 * Math.cos((Math.PI * (i - (n - fadeOut))) / fadeOut);
    out[i] = x[i] * w;
  }
  return out;
}

function smoothedDb(s: Spectrum, binHz: number): Float64Array {
  const half = s.re.length / 2;
  const pow = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) pow[k] = s.re[k] ** 2 + s.im[k] ** 2;
  const sm = smoothPower(pow, binHz, () => 24);
  return sm.map((v) => toDb(v));
}

function sampleLog(db: Float64Array, binHz: number, axis: Float32Array): Float32Array {
  return Float32Array.from(axis, (f) => {
    const x = f / binHz;
    const i = Math.min(Math.floor(x), db.length - 2);
    const t = x - i;
    return db[i] * (1 - t) + db[i + 1] * t;
  });
}

/** Inviluppo (segnale analitico) della risposta filtrata passa-basso, in dB per ms. */
function etc(s: Spectrum, sr: number, lpHz: number, arrival: number): Float32Array {
  const N = s.re.length;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * sr) / N;
    const w = f <= lpHz ? 1 : f >= lpHz * 1.5 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - lpHz)) / (lpHz * 0.5));
    const g = k === 0 || k === N / 2 ? w : 2 * w;
    re[k] = s.re[k] * g; im[k] = s.im[k] * g;
  }
  fft(re, im, true);
  const msLen = sr / 1000;
  const out = new Float32Array(ETC_PRE_MS + ETC_LEN_MS);
  for (let j = 0; j < out.length; j++) {
    let peak = 0;
    const start = Math.round(arrival + (j - ETC_PRE_MS) * msLen);
    for (let i = start; i < start + msLen; i++) {
      const idx = ((i % N) + N) % N;
      peak = Math.max(peak, re[idx] ** 2 + im[idx] ** 2);
    }
    out[j] = toDb(peak);
  }
  return out;
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
}
