import { defaultArtParams, measuredDb, type ArtParams, type ArtResult, type MeasurementSet } from './dsp/art';
import { demoConfig, simulateRoom } from './dsp/simulate';
import { camillaConfig, filterFileName } from './io/camilla';
import { parseMicCal } from './io/micCal';
import { readWav, writeWavFloat32 } from './io/wav';
import { makeZip } from './io/zip';
import { listMics, Measurer, type MeasureOptions } from './audio/measure';
import { drawPlot, freqLabel, freqTicks, type Series } from './ui/plot';
import type { WorkerRequest } from './worker';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);
const SR = 48000;
const INPUTS = [0, 1];

const state = {
  outputs: [] as string[],
  ir: [] as (Float32Array | null)[][],
  peaks: [] as (number | null)[][],
  micCal: undefined as string | undefined,
  result: null as ArtResult | null,
  verified: new Map<string, Float32Array>(),
  live: false,
  busy: false,
};
const measurer = new Measurer();

function setStatus(id: string, text: string, kind: '' | 'ok' | 'warn' | 'err' = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

function outputsFor(subs: number): string[] {
  return ['L', 'R', ...Array.from({ length: subs }, (_, i) => `SW${i + 1}`)];
}

function resetGrid() {
  const outputs = outputsFor(num('cfg-subs'));
  const P = Math.min(9, Math.max(1, Math.round(num('cfg-pos')) || 1));
  const old = { outputs: state.outputs, ir: state.ir, peaks: state.peaks };
  state.ir = Array.from({ length: P }, (_, p) => outputs.map((name) => {
    const k = old.outputs.indexOf(name);
    return k >= 0 ? old.ir[p]?.[k] ?? null : null;
  }));
  state.peaks = Array.from({ length: P }, (_, p) => outputs.map((name) => {
    const k = old.outputs.indexOf(name);
    return k >= 0 ? old.peaks[p]?.[k] ?? null : null;
  }));
  state.outputs = outputs;
  invalidate();
  $('cfg-outputs').textContent = outputs.map((o, i) => `${i + 1} = ${o}`).join(', ');
  renderTable();
}

function invalidate() {
  state.result = null;
  state.verified.clear();
  $('sec-results').hidden = true;
  $('sec-export').hidden = true;
}

function renderTable() {
  const t = $('meas-table');
  const head = `<tr><th>Posizione</th>${state.outputs.map((o) => `<th>${o}</th>`).join('')}<th></th></tr>`;
  const rows = state.ir.map((row, p) => {
    const cells = row.map((ir, k) => {
      const peak = state.peaks[p][k];
      let label = '<span class="cell-none">—</span>';
      if (ir) {
        const warn = peak !== null && (peak > -1 || peak < -45);
        label = `<span class="${warn ? 'cell-warn' : 'cell-ok'}">✓${peak !== null ? ` ${peak.toFixed(0)} dB` : ''}</span>`;
      }
      const btn = state.live ? ` <button class="secondary" data-p="${p}" data-k="${k}">Misura</button>` : '';
      return `<td>${label}${btn}</td>`;
    }).join('');
    const rowBtn = state.live ? `<button data-row="${p}">Misura tutto</button>` : '';
    return `<tr><td>${p + 1}${p === 0 ? ' (principale)' : ''}</td>${cells}<td>${rowBtn}</td></tr>`;
  }).join('');
  t.innerHTML = head + rows;
  const complete = state.ir.every((row) => row.every(Boolean));
  $<HTMLButtonElement>('btn-compute').disabled = !complete || state.busy;
}

function measureOptions(): MeasureOptions {
  return {
    channels: state.outputs.length,
    sweepSec: num('cfg-sweep'),
    amplitude: Math.pow(10, num('cfg-level') / 20),
    f1: 10,
    f2: 22000,
    irSec: 1,
  };
}

async function measureCell(p: number, k: number) {
  setStatus('audio-status', `Misura: posizione ${p + 1}, uscita ${state.outputs[k]}…`);
  const { ir, peakDb } = await measurer.measure(k, measureOptions());
  state.ir[p][k] = ir;
  state.peaks[p][k] = peakDb;
  invalidate();
  renderTable();
  if (peakDb > -1) setStatus('audio-status', `Clipping del microfono (${peakDb.toFixed(1)} dBFS): abbassa il livello e ripeti.`, 'err');
  else if (peakDb < -45) setStatus('audio-status', `Segnale debole (${peakDb.toFixed(1)} dBFS): alza il volume.`, 'warn');
  else setStatus('audio-status', `Picco ${peakDb.toFixed(1)} dBFS`, 'ok');
}

async function runExclusive(fn: () => Promise<void>, statusId: string) {
  if (state.busy) return;
  state.busy = true;
  renderTable();
  try { await fn(); }
  catch (e) { setStatus(statusId, (e as Error).message, 'err'); }
  finally { state.busy = false; renderTable(); }
}

$('meas-table').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.row !== undefined) {
    const p = Number(b.dataset.row);
    runExclusive(async () => {
      for (let k = 0; k < state.outputs.length; k++) {
        await measureCell(p, k);
        await new Promise((r) => setTimeout(r, 800));
      }
    }, 'audio-status');
  } else {
    runExclusive(() => measureCell(Number(b.dataset.p), Number(b.dataset.k)), 'audio-status');
  }
});

$('btn-audio').addEventListener('click', () => runExclusive(async () => {
  try {
    await measurer.open(state.outputs.length, $<HTMLSelectElement>('cfg-mic').value || undefined);
  } catch (err) {
    const msg = (err as Error).message;
    throw new Error(/permission|denied|not allowed|NotAllowed/i.test(msg) || (err as Error).name === 'NotAllowedError'
      ? 'Il microfono non è accessibile da questa pagina. Per misurare apri l\'app sul computer (npm run dev); qui puoi usare la stanza demo o importare WAV.'
      : msg);
  }
  state.live = true;
  const mics = await listMics();
  const sel = $<HTMLSelectElement>('cfg-mic');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Predefinito di sistema</option>' +
    mics.map((d) => `<option value="${d.deviceId}">${d.label || d.deviceId}</option>`).join('');
  sel.value = cur;
  setStatus('audio-status', `Audio attivo: ${measurer.sampleRate} Hz, ${state.outputs.length} uscite.`, 'ok');
}, 'audio-status'));

$('btn-demo').addEventListener('click', () => {
  const subs = num('cfg-subs') as 1 | 2;
  const m = simulateRoom(demoConfig(subs));
  $<HTMLInputElement>('cfg-pos').value = String(m.ir.length);
  state.outputs = m.outputs;
  state.ir = m.ir;
  state.peaks = m.ir.map((row) => row.map(() => null));
  resetGrid();
  setStatus('audio-status', `Stanza simulata 5,2 × 4,3 × 2,7 m con ${subs} sub e ${m.ir.length} posizioni.`, 'ok');
});

$<HTMLInputElement>('imp-wav').addEventListener('change', async (e) => {
  const files = Array.from((e.target as HTMLInputElement).files ?? []);
  const errors: string[] = [];
  let ok = 0;
  for (const f of files) {
    const m = /^p(\d+)[_-]([A-Za-z0-9]+)\.wav$/i.exec(f.name);
    const k = m ? state.outputs.findIndex((o) => o.toLowerCase() === m[2].toLowerCase()) : -1;
    const p = m ? Number(m[1]) - 1 : -1;
    if (!m || k < 0 || p < 0 || p >= state.ir.length) { errors.push(`${f.name}: nome non riconosciuto`); continue; }
    try {
      const w = readWav(await f.arrayBuffer());
      if (w.sampleRate !== SR) throw new Error(`frequenza ${w.sampleRate} Hz, serve ${SR}`);
      state.ir[p][k] = w.channels[0];
      state.peaks[p][k] = null;
      ok++;
    } catch (err) { errors.push(`${f.name}: ${(err as Error).message}`); }
  }
  (e.target as HTMLInputElement).value = '';
  invalidate();
  renderTable();
  setStatus('audio-status', `Importati ${ok} file.${errors.length ? ' ' + errors.join('; ') : ''}`, errors.length ? 'warn' : 'ok');
});

$<HTMLInputElement>('cfg-cal').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) { state.micCal = undefined; return; }
  try {
    const text = await f.text();
    parseMicCal(text);
    state.micCal = text;
    invalidate();
  } catch (err) {
    state.micCal = undefined;
    setStatus('audio-status', `Calibrazione: ${(err as Error).message}`, 'err');
  }
});

for (const id of ['cfg-subs', 'cfg-pos']) $(id).addEventListener('change', () => {
  if (state.live) measurer.close().then(() => { state.live = false; renderTable(); setStatus('audio-status', 'Configurazione cambiata: riattiva l\'audio.'); });
  resetGrid();
});

function artParams(): Omit<ArtParams, 'micCalDb'> {
  return {
    ...defaultArtParams(INPUTS, state.ir.length),
    firLength: num('p-fir'),
    artMaxHz: num('p-art'),
    correctionMaxHz: num('p-corr'),
    maxBoostDb: num('p-maxboost'),
    mainLowHz: num('p-mainlow'),
    modelingDelayMs: num('p-delay'),
    regularization: num('p-reg'),
    target: { bassBoostDb: num('p-boost'), bassCornerHz: num('p-corner'), tiltDbPerOct: num('p-tilt'), lowCutHz: num('p-lowcut') },
  };
}

$('btn-compute').addEventListener('click', () => runExclusive(async () => {
  setStatus('compute-status', 'Calcolo in corso…');
  const t0 = performance.now();
  const m: MeasurementSet = { sampleRate: SR, outputs: state.outputs, ir: state.ir as Float32Array[][] };
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const req: WorkerRequest = { m, params: artParams(), micCal: state.micCal };
  const res = await new Promise<ArtResult>((resolve, reject) => {
    worker.onmessage = (e) => (e.data.ok ? resolve(e.data.res) : reject(new Error(e.data.error)));
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(req);
  }).finally(() => worker.terminate());
  state.result = res;
  state.verified.clear();
  setStatus('compute-status', `Fatto in ${((performance.now() - t0) / 1000).toFixed(1)} s. Guadagno complessivo ${res.headroomDb.toFixed(1)} dB per evitare il clipping.`, 'ok');
  showResults();
}, 'compute-status'));

function showResults() {
  const r = state.result;
  if (!r) return;
  $('sec-results').hidden = false;
  $('sec-export').hidden = false;
  const ch = $<HTMLSelectElement>('r-ch');
  ch.innerHTML = r.inputs.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  const pos = $<HTMLSelectElement>('r-pos');
  pos.innerHTML = '<option value="-1">Tutte</option>' + r.channels[0].beforeDb.map((_, p) => `<option value="${p}">${p + 1}</option>`).join('');
  pos.value = '0';
  $<HTMLButtonElement>('btn-verify').disabled = !state.live;
  drawResults();
}

function drawResults() {
  const r = state.result;
  if (!r) return;
  const ci = Number($<HTMLSelectElement>('r-ch').value);
  const sel = Number($<HTMLSelectElement>('r-pos').value);
  const c = r.channels[ci];
  const positions = sel < 0 ? c.beforeDb.map((_, p) => p) : [sel];
  const thin = positions.length > 1;
  const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const series: Series[] = [];
  for (const p of positions) series.push({ x: r.freqAxis, y: c.beforeDb[p], color: cssVar('--before'), width: thin ? 1 : 1.5, alpha: thin ? 0.6 : 1 });
  for (const p of positions) series.push({ x: r.freqAxis, y: c.afterDb[p], color: cssVar('--after'), width: thin ? 1 : 2, alpha: thin ? 0.7 : 1 });
  for (const p of positions) {
    const v = state.verified.get(`${ci}-${p}`);
    if (v) series.push({ x: r.freqAxis, y: v, color: cssVar('--verify'), width: 1.5 });
  }
  series.push({ x: r.freqAxis, y: c.targetDb, color: cssVar('--target'), width: 1.5, dash: [5, 4] });
  drawPlot($<HTMLCanvasElement>('plot-freq'), {
    xLog: true, xRange: [15, 20000], yRange: [-30, 15], xTicks: freqTicks, yStep: 5,
    xLabel: freqLabel, yUnit: '', series,
  });

  const t = Float32Array.from(c.etcBefore[0], (_, i) => i + r.etcStartMs);
  const etc: Series[] = [];
  for (const p of positions) {
    // Ogni curva è riferita al proprio picco: conta la velocità di decadimento, non il livello.
    const norm = (a: Float32Array) => { const peak = Math.max(...a); return Float32Array.from(a, (v) => v - peak); };
    etc.push({ x: t, y: norm(c.etcBefore[p]), color: cssVar('--before'), width: 1, alpha: thin ? 0.6 : 1 });
    etc.push({ x: t, y: norm(c.etcAfter[p]), color: cssVar('--after'), width: thin ? 1 : 1.5, alpha: thin ? 0.7 : 1 });
  }
  drawPlot($<HTMLCanvasElement>('plot-etc'), {
    xLog: false, xRange: [r.etcStartMs, 600], yRange: [-60, 3], xTicks: [0, 100, 200, 300, 400, 500, 600], yStep: 10,
    xLabel: (v) => `${v} ms`, yUnit: '', series: etc,
  });

  $('r-metrics').innerHTML = `Deviazione dal target sotto ${num('p-art')} Hz, su tutte le posizioni: <b>${c.rmsBefore.toFixed(1)} dB</b> → <b>${c.rmsAfter.toFixed(1)} dB</b>`;
}

$('r-ch').addEventListener('change', drawResults);
$('r-pos').addEventListener('change', drawResults);
window.addEventListener('resize', drawResults);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawResults);

$('btn-verify').addEventListener('click', () => runExclusive(async () => {
  const r = state.result!;
  const ci = Number($<HTMLSelectElement>('r-ch').value);
  const p = Math.max(0, Number($<HTMLSelectElement>('r-pos').value));
  setStatus('verify-status', `Microfono in posizione ${p + 1}: riproduzione di ${r.inputs[ci]} con i filtri…`);
  const ir = await measurer.measureCorrected(r.filters[ci], measureOptions());
  const cal = state.micCal ? parseMicCal(state.micCal) : undefined;
  state.verified.set(`${ci}-${p}`, measuredDb(ir, r.sampleRate, r.freqAxis, r.channels[ci].refLevel, r.headroomDb, cal));
  $<HTMLSelectElement>('r-pos').value = String(p);
  drawResults();
  setStatus('verify-status', 'Misura di verifica sovrapposta in arancione.', 'ok');
}, 'verify-status'));

$('btn-export').addEventListener('click', async () => {
  const r = state.result;
  if (!r) return;
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  r.filters.forEach((row, c) => row.forEach((f, k) => {
    files.push({ name: filterFileName(r.inputs[c], r.outputs[k]), data: writeWavFloat32(f, r.sampleRate) });
  }));
  files.push({
    name: 'camilladsp.yml',
    data: enc.encode(camillaConfig({
      sampleRate: r.sampleRate, inputs: r.inputs, outputs: r.outputs,
      captureDevice: $<HTMLInputElement>('x-cap').value, playbackDevice: $<HTMLInputElement>('x-play').value,
      chunkSize: num('x-chunk'),
    })),
  });
  files.push({ name: 'LEGGIMI.txt', data: enc.encode(readme(r)) });
  const zip = makeZip(files);
  const name = 'correzione-art-camilladsp.zip';
  // Dentro claude.ai i download passano dal capability "downloads"; altrove si usa un link normale.
  const claude = (window as unknown as { claude?: { use(n: string): Promise<SaveApi | null> } }).claude;
  const downloads = claude ? await claude.use('downloads') : null;
  if (downloads) {
    try {
      await downloads.save({ filename: name, data: new Blob([zip]) });
      setStatus('export-status', `${files.length} file esportati.`, 'ok');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setStatus('export-status', code === 'declined' ? 'Salvataggio annullato.' : 'Il salvataggio non è disponibile qui.', code === 'declined' ? '' : 'err');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus('export-status', `${files.length} file esportati.`, 'ok');
});

interface SaveApi { save(r: { filename: string; data: Blob }): Promise<unknown> }

function readme(r: ArtResult): string {
  return [
    'Correzione stanza ART per CamillaDSP',
    '',
    `Frequenza di campionamento: ${r.sampleRate} Hz`,
    `Ingressi: ${r.inputs.join(', ')}`,
    `Uscite (ordine dei canali di riproduzione): ${r.outputs.map((o, i) => `${i} = ${o}`).join(', ')}`,
    `Guadagno già incluso nei filtri: ${r.headroomDb.toFixed(1)} dB`,
    `Ritardo introdotto: ${num('p-delay')} ms + latenza di CamillaDSP`,
    '',
    'Installazione:',
    '1. Copia camilladsp.yml e la cartella filters/ nella stessa directory.',
    '2. Controlla i dispositivi di cattura e riproduzione in devices:.',
    '3. Avvia: camilladsp camilladsp.yml',
    '',
    'Ogni ingresso alimenta tutte le uscite: nei bassi tutti i diffusori e i sub lavorano',
    'insieme per smorzare i modi della stanza. Non spostare diffusori, sub o punto d\'ascolto',
    'dopo la misura, altrimenti la correzione va rifatta.',
    '',
  ].join('\n');
}

resetGrid();
