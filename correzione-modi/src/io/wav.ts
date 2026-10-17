// Lettura e scrittura di file WAV (PCM 16/24/32 bit e float 32/64).

export interface WavData { sampleRate: number; channels: Float32Array[] }

export function readWav(buf: ArrayBuffer): WavData {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Non è un file WAV');
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= v.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV senza blocco fmt');
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, v.byteLength - body) / (bytes * fmt.channels));
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          const o = body + (i * fmt.channels + c) * bytes;
          channels[c][i] = readSample(v, o, fmt.format, fmt.bits);
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    off = body + size + (size & 1);
  }
  throw new Error('WAV senza dati');
}

function readSample(v: DataView, o: number, format: number, bits: number): number {
  if (format === 3) return bits === 64 ? v.getFloat64(o, true) : v.getFloat32(o, true);
  if (format !== 1) throw new Error(`Formato WAV non supportato (${format})`);
  switch (bits) {
    case 16: return v.getInt16(o, true) / 32768;
    case 24: { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16); return x / 8388608; }
    case 32: return v.getInt32(o, true) / 2147483648;
    default: throw new Error(`Profondità WAV non supportata (${bits} bit)`);
  }
}

/** WAV mono float a 32 bit, il formato più comodo per i filtri FIR di CamillaDSP. */
export function writeWavFloat32(data: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + data.length * 4);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, data.length * 4, true);
  for (let i = 0; i < data.length; i++) v.setFloat32(44 + i * 4, data[i], true);
  return out;
}
