// Stanza rettangolare simulata con il metodo delle sorgenti immagine (Allen–Berkley).
// Serve per provare l'app senza microfono: i modi della stanza emergono dalle riflessioni.
import { applyBiquad, highpass, lowpass } from './biquad';
import type { MeasurementSet } from './art';

export type Vec3 = [number, number, number];

export interface SimSpeaker { name: string; pos: Vec3; kind: 'main' | 'sub' }

export interface SimConfig {
  room: Vec3;
  /** Coefficiente di riflessione delle pareti (0..1). */
  beta: number;
  speakers: SimSpeaker[];
  mics: Vec3[];
  sampleRate: number;
  maxTimeSec: number;
  latencySec: number;
}

const C = 343;

export function demoConfig(subs: 1 | 2 = 2): SimConfig {
  const speakers: SimSpeaker[] = [
    { name: 'L', pos: [1.3, 0.6, 1.0], kind: 'main' },
    { name: 'R', pos: [3.9, 0.6, 1.0], kind: 'main' },
    { name: 'SW1', pos: [0.4, 0.4, 0.3], kind: 'sub' },
  ];
  if (subs === 2) speakers.push({ name: 'SW2', pos: [4.8, 3.7, 0.3], kind: 'sub' });
  const lp: Vec3 = [2.6, 3.1, 1.1];
  const offs: Vec3[] = [[0, 0, 0], [-0.4, 0, 0], [0.4, 0, 0], [0, 0.35, 0.05], [0, -0.35, -0.05]];
  return {
    room: [5.2, 4.3, 2.7],
    beta: 0.86,
    speakers,
    mics: offs.map((o) => [lp[0] + o[0], lp[1] + o[1], lp[2] + o[2]] as Vec3),
    sampleRate: 48000,
    maxTimeSec: 0.6,
    latencySec: 0.004,
  };
}

export function simulateRoom(cfg: SimConfig): MeasurementSet {
  const sr = cfg.sampleRate;
  const len = Math.round((cfg.maxTimeSec + cfg.latencySec + 0.05) * sr);
  const maxR = C * cfg.maxTimeSec;
  const [Lx, Ly, Lz] = cfg.room;
  const nMax = [Math.ceil(maxR / (2 * Lx)) + 1, Math.ceil(maxR / (2 * Ly)) + 1, Math.ceil(maxR / (2 * Lz)) + 1];
  const betaPow = new Float64Array(4 * Math.max(...nMax) + 4);
  for (let i = 0; i < betaPow.length; i++) betaPow[i] = Math.pow(cfg.beta, i);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;

  const ir: Float32Array[][] = cfg.mics.map(() => []);
  cfg.mics.forEach((m, p) => {
    cfg.speakers.forEach((s) => {
      const out = new Float32Array(len);
      for (let u = 0; u <= 1; u++) for (let nx = -nMax[0]; nx <= nMax[0]; nx++) {
        const dx = 2 * nx * Lx + (u ? -s.pos[0] : s.pos[0]) - m[0];
        if (Math.abs(dx) > maxR) continue;
        const rx = Math.abs(2 * nx - u);
        for (let v = 0; v <= 1; v++) for (let ny = -nMax[1]; ny <= nMax[1]; ny++) {
          const dy = 2 * ny * Ly + (v ? -s.pos[1] : s.pos[1]) - m[1];
          const dxy = dx * dx + dy * dy;
          if (dxy > maxR * maxR) continue;
          const ry = Math.abs(2 * ny - v);
          for (let w = 0; w <= 1; w++) for (let nz = -nMax[2]; nz <= nMax[2]; nz++) {
            const dz = 2 * nz * Lz + (w ? -s.pos[2] : s.pos[2]) - m[2];
            const r2 = dxy + dz * dz;
            if (r2 > maxR * maxR) continue;
            const r = Math.sqrt(r2);
            const t = (r / C + cfg.latencySec) * sr;
            const i0 = Math.floor(t);
            const frac = t - i0;
            const a = betaPow[rx + ry + Math.abs(2 * nz - w)] / Math.max(r, 0.1);
            if (i0 + 1 < len) { out[i0] += a * (1 - frac); out[i0 + 1] += a * frac; }
          }
        }
      }
      if (s.kind === 'main') {
        applyBiquad(out, highpass(55, 0.707, sr));
        applyBiquad(out, highpass(55, 0.707, sr));
        applyBiquad(out, lowpass(18000, 0.707, sr));
      } else {
        applyBiquad(out, highpass(20, 0.707, sr));
        applyBiquad(out, lowpass(140, 0.54, sr));
        applyBiquad(out, lowpass(140, 1.31, sr));
        for (let i = 0; i < len; i++) out[i] *= 2; // i sub sono un po' più "caldi"
      }
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
      for (let i = 0; i < len; i++) out[i] += rand() * peak * 3e-4;
      ir[p].push(out);
    });
  });
  return { sampleRate: sr, outputs: cfg.speakers.map((s) => s.name), ir };
}
