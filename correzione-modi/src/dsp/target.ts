// Curva target ("house curve") in dB, relativa al livello di riferimento misurato.

export interface TargetParams {
  /** Esaltazione dei bassi in dB (scaffale centrato su bassCornerHz). */
  bassBoostDb: number;
  bassCornerHz: number;
  /** Pendenza in dB per ottava, con perno a 1 kHz (negativa = più scura sugli acuti). */
  tiltDbPerOct: number;
  /** Passa-alto del target (Butterworth 4° ordine) per non chiedere infrabassi. */
  lowCutHz: number;
}

export const defaultTarget: TargetParams = {
  bassBoostDb: 4,
  bassCornerHz: 120,
  tiltDbPerOct: -0.5,
  lowCutHz: 18,
};

export function targetDb(f: number, t: TargetParams): number {
  const ff = Math.max(f, 1);
  const shelf = t.bassBoostDb * 0.5 * (1 - Math.tanh(1.5 * Math.log2(ff / t.bassCornerHz)));
  const tilt = t.tiltDbPerOct * Math.log2(ff / 1000);
  const hp = 10 * Math.log10(1 / (1 + Math.pow(t.lowCutHz / ff, 8)));
  return shelf + tilt + hp;
}
