// Configurazione CamillaDSP (v3): ingressi → matrice di convoluzioni → somma sulle uscite.
//
//   ingresso c ──► canale interno c·K+k ──[FIR c→k]──► somma su c ──► uscita k

export interface CamillaOptions {
  sampleRate: number;
  inputs: string[];
  outputs: string[];
  captureDevice: string;
  playbackDevice: string;
  chunkSize: number;
}

export const filterFileName = (input: string, output: string) => `filters/art_${input}_to_${output}.wav`;
const filterName = (input: string, output: string) => `art_${input}_${output}`;

export function camillaConfig(o: CamillaOptions): string {
  const C = o.inputs.length, K = o.outputs.length;
  const L: string[] = [];
  L.push('---');
  L.push('title: "Correzione stanza ART (correzione-modi)"');
  L.push(`description: "Ingressi: ${o.inputs.join(', ')} - Uscite: ${o.outputs.join(', ')}"`);
  L.push('devices:');
  L.push(`  samplerate: ${o.sampleRate}`);
  L.push(`  chunksize: ${o.chunkSize}`);
  L.push('  capture:');
  L.push('    type: Alsa');
  L.push(`    channels: ${C}`);
  L.push(`    device: "${o.captureDevice}"`);
  L.push('    format: S32LE');
  L.push('  playback:');
  L.push('    type: Alsa');
  L.push(`    channels: ${K}`);
  L.push(`    device: "${o.playbackDevice}"`);
  L.push('    format: S32LE');
  L.push('filters:');
  for (const i of o.inputs) for (const out of o.outputs) {
    L.push(`  ${filterName(i, out)}:`);
    L.push('    type: Conv');
    L.push('    parameters:');
    L.push('      type: Wav');
    L.push(`      filename: ${filterFileName(i, out)}`);
  }
  L.push('mixers:');
  L.push('  split:');
  L.push(`    channels: {in: ${C}, out: ${C * K}}`);
  L.push('    mapping:');
  for (let c = 0; c < C; c++) for (let k = 0; k < K; k++) {
    L.push(`      - dest: ${c * K + k}`);
    L.push('        sources:');
    L.push(`          - {channel: ${c}, gain: 0, inverted: false}`);
  }
  L.push('  sum:');
  L.push(`    channels: {in: ${C * K}, out: ${K}}`);
  L.push('    mapping:');
  for (let k = 0; k < K; k++) {
    L.push(`      - dest: ${k}`);
    L.push('        sources:');
    for (let c = 0; c < C; c++) L.push(`          - {channel: ${c * K + k}, gain: 0, inverted: false}`);
  }
  L.push('pipeline:');
  L.push('  - type: Mixer');
  L.push('    name: split');
  for (let c = 0; c < C; c++) for (let k = 0; k < K; k++) {
    L.push('  - type: Filter');
    L.push(`    channels: [${c * K + k}]`);
    L.push(`    names: [${filterName(o.inputs[c], o.outputs[k])}]`);
  }
  L.push('  - type: Mixer');
  L.push('    name: sum');
  return L.join('\n') + '\n';
}
