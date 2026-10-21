import { describe, expect, it } from 'vitest';
import { convolve, fft } from '../src/dsp/fft';
import { deconvolve, expSweep } from '../src/dsp/sweep';
import { minimumPhase } from '../src/dsp/minphase';
import { solveComplex } from '../src/dsp/complexSolve';

describe('fft', () => {
  it('andata e ritorno restituiscono il segnale', () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + (i % 7) * 0.1);
    const orig = re.slice();
    const im = new Float64Array(n);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(orig[i], 9);
  });

  it('una sinusoide finisce nel bin giusto', () => {
    const n = 256;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 10 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    expect(re[10]).toBeCloseTo(n / 2, 6);
    expect(Math.abs(re[11])).toBeLessThan(1e-6);
  });
});

describe('sweep', () => {
  it('la deconvoluzione recupera una risposta all\'impulso nota', () => {
    const sr = 48000;
    const sweep = expSweep({ f1: 10, f2: 22000, durationSec: 2, sampleRate: sr, amplitude: 0.5 });
    const h = new Float64Array(2000);
    h[100] = 1; h[700] = -0.5; h[1500] = 0.25;
    const rec = convolve(sweep, h);
    const ir = deconvolve(rec, sweep, sr, 10, 22000, 4000);
    expect(ir[100]).toBeGreaterThan(0.8);
    expect(ir[700]).toBeLessThan(-0.4);
    expect(ir[1500]).toBeGreaterThan(0.2);
    expect(Math.abs(ir[3000])).toBeLessThan(0.02);
  });
});

describe('fase minima', () => {
  it('conserva il modulo ed è causale', () => {
    const n = 4096;
    const mag = Float64Array.from({ length: n / 2 + 1 }, (_, k) => 1 + 0.8 * Math.exp(-(((k - 100) / 20) ** 2)));
    const s = minimumPhase(mag);
    for (const k of [0, 50, 100, 1000]) expect(Math.hypot(s.re[k], s.im[k])).toBeCloseTo(mag[k], 4);
    const re = s.re.slice(), im = s.im.slice();
    fft(re, im, true);
    let early = 0, late = 0;
    for (let i = 0; i < n; i++) (i < n / 2 ? (early += re[i] ** 2) : (late += re[i] ** 2));
    expect(late / early).toBeLessThan(1e-6);
  });
});

describe('solutore complesso', () => {
  it('risolve un sistema 3×3', () => {
    // A = [[2, i, 0], [-i, 3, 1], [0, 1, 1+i]], x = [1, 1-i, 2i]
    const aRe = Float64Array.from([2, 0, 0, 0, 3, 1, 0, 1, 1]);
    const aIm = Float64Array.from([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    const x = [[1, 0], [1, -1], [0, 2]];
    const bRe = new Float64Array(3), bIm = new Float64Array(3);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      bRe[r] += aRe[r * 3 + c] * x[c][0] - aIm[r * 3 + c] * x[c][1];
      bIm[r] += aRe[r * 3 + c] * x[c][1] + aIm[r * 3 + c] * x[c][0];
    }
    solveComplex(aRe.slice(), aIm.slice(), bRe, bIm, 3);
    for (let i = 0; i < 3; i++) {
      expect(bRe[i]).toBeCloseTo(x[i][0], 9);
      expect(bIm[i]).toBeCloseTo(x[i][1], 9);
    }
  });
});
