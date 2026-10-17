import { describe, expect, it } from 'vitest';
import { readWav, writeWavFloat32 } from '../src/io/wav';
import { crc32, makeZip } from '../src/io/zip';
import { camillaConfig } from '../src/io/camilla';
import { parseMicCal } from '../src/io/micCal';

describe('io', () => {
  it('WAV float: scrittura e rilettura', () => {
    const x = Float32Array.from([0, 0.5, -0.25, 1e-6]);
    const w = readWav(writeWavFloat32(x, 48000).buffer as ArrayBuffer);
    expect(w.sampleRate).toBe(48000);
    expect(Array.from(w.channels[0])).toEqual(Array.from(x));
  });

  it('CRC32 standard', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('ZIP con firma corretta', () => {
    const z = makeZip([{ name: 'a.txt', data: new TextEncoder().encode('ciao') }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });

  it('configurazione CamillaDSP con tutte le convoluzioni', () => {
    const y = camillaConfig({ sampleRate: 48000, inputs: ['L', 'R'], outputs: ['L', 'R', 'SW1'], captureDevice: 'hw:Loopback,1', playbackDevice: 'hw:0', chunkSize: 2048 });
    expect(y.match(/type: Conv/g)).toHaveLength(6);
    expect(y).toContain('channels: {in: 2, out: 6}');
    expect(y).toContain('channels: {in: 6, out: 3}');
    expect(y).toContain('filename: filters/art_R_to_SW1.wav');
  });

  it('calibrazione microfono con interpolazione logaritmica', () => {
    const cal = parseMicCal('"Sens Factor =-1.2dB"\n10 -3.0 0\n100 0.0 0\n1000 1.0\n');
    expect(cal(5)).toBe(-3);
    expect(cal(100)).toBe(0);
    expect(cal(Math.sqrt(100 * 1000))).toBeCloseTo(0.5, 6);
  });
});
