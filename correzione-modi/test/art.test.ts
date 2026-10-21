import { describe, expect, it } from 'vitest';
import { computeArt, defaultArtParams } from '../src/dsp/art';
import { demoConfig, simulateRoom } from '../src/dsp/simulate';
import { defaultTarget } from '../src/dsp/target';

describe('correzione ART su stanza simulata', () => {
  const m = simulateRoom(demoConfig(2));
  const res = computeArt(m, { ...defaultArtParams([0, 1], m.ir.length), target: defaultTarget });

  it('produce un filtro per ogni coppia ingresso → uscita, senza NaN', () => {
    expect(res.filters).toHaveLength(2);
    for (const row of res.filters) {
      expect(row).toHaveLength(4);
      for (const f of row) expect(f.every(Number.isFinite)).toBe(true);
    }
    expect(res.headroomDb).toBeLessThanOrEqual(0);
  });

  it('riduce la deviazione dal target nei bassi in tutte le posizioni', () => {
    for (const ch of res.channels) {
      console.log(ch.input, 'RMS prima', ch.rmsBefore.toFixed(2), 'dopo', ch.rmsAfter.toFixed(2), 'headroom', res.headroomDb.toFixed(1));
      expect(ch.rmsAfter).toBeLessThan(ch.rmsBefore * 0.6);
    }
  });

  it('accorcia il decadimento dei modi', () => {
    // Energia dei bassi tra 150 e 400 ms dopo l'arrivo, relativa al picco.
    const tail = (e: Float32Array) => {
      const peak = Math.max(...e);
      let s = 0;
      for (let ms = 170; ms < 420; ms++) s += Math.pow(10, (e[ms] - peak) / 10);
      return 10 * Math.log10(s / 250);
    };
    for (const ch of res.channels) {
      for (let p = 0; p < ch.etcBefore.length; p++) {
        const b = tail(ch.etcBefore[p]), a = tail(ch.etcAfter[p]);
        console.log(ch.input, 'pos', p + 1, 'coda prima', b.toFixed(1), 'dopo', a.toFixed(1));
        expect(a).toBeLessThan(b - 3);
      }
    }
  });
});
