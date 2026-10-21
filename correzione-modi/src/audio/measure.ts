// Misura delle risposte all'impulso dal browser: sweep su un'uscita alla volta, microfono USB in ingresso.
import { convolve } from '../dsp/fft';
import { deconvolve, expSweep } from '../dsp/sweep';

export interface MeasureOptions {
  /** Numero di canali dell'interfaccia audio (uscite fisiche). */
  channels: number;
  sweepSec: number;
  amplitude: number;
  f1: number;
  f2: number;
  irSec: number;
}

export class Measurer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private recorder: AudioWorkletNode | null = null;
  private chunks: { frame: number; data: Float32Array }[] = [];

  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  get maxChannels(): number { return this.ctx?.destination.maxChannelCount ?? 0; }

  async open(channels: number, micDeviceId?: string): Promise<void> {
    await this.close();
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    if (ctx.destination.maxChannelCount < channels) {
      const max = ctx.destination.maxChannelCount;
      await ctx.close();
      throw new Error(`L'uscita audio offre ${max} canali, ne servono ${channels}. Seleziona come uscita di sistema un'interfaccia multicanale.`);
    }
    ctx.destination.channelCount = channels;
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: micDeviceId ? { exact: micDeviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
      },
    });
    await ctx.audioWorklet.addModule(new URL('recorder-worklet.js', document.baseURI).href);
    const src = ctx.createMediaStreamSource(this.stream);
    this.recorder = new AudioWorkletNode(ctx, 'recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.recorder.port.onmessage = (e) => this.chunks.push(e.data);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.recorder).connect(mute).connect(ctx.destination);
    this.ctx = ctx;
  }

  async close(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx) await this.ctx.close();
    this.ctx = null; this.stream = null; this.recorder = null;
  }

  /** Riproduce signals[k] sull'uscita k (tutte insieme) e restituisce la registrazione allineata. */
  async playAndRecord(signals: (Float32Array | null)[], tailSec: number): Promise<Float32Array> {
    const ctx = this.ctx, rec = this.recorder;
    if (!ctx || !rec) throw new Error('Audio non inizializzato');
    if (ctx.state === 'suspended') await ctx.resume();
    const ch = ctx.destination.channelCount;
    const len = Math.max(...signals.map((s) => s?.length ?? 0));
    const buf = ctx.createBuffer(ch, len, ctx.sampleRate);
    signals.forEach((s, k) => { if (s && k < ch) buf.getChannelData(k).set(s); });
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.channelCount = ch;
    node.channelCountMode = 'explicit';
    node.channelInterpretation = 'discrete';
    node.connect(ctx.destination);
    this.chunks = [];
    rec.port.postMessage('start');
    const t0 = ctx.currentTime + 0.3;
    const startFrame = Math.round(t0 * ctx.sampleRate);
    node.start(t0);
    const total = len + Math.round(tailSec * ctx.sampleRate);
    await new Promise<void>((resolve) => {
      const check = () => {
        const last = this.chunks[this.chunks.length - 1];
        if (last && last.frame + last.data.length >= startFrame + total) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    rec.port.postMessage('stop');
    const out = new Float32Array(total);
    for (const c of this.chunks) {
      for (let i = 0; i < c.data.length; i++) {
        const j = c.frame + i - startFrame;
        if (j >= 0 && j < total) out[j] = c.data[i];
      }
    }
    return out;
  }

  /** Sweep sulla sola uscita `output`, poi deconvoluzione. */
  async measure(output: number, o: MeasureOptions): Promise<{ ir: Float32Array; peakDb: number }> {
    const sr = this.sampleRate;
    const sweep = expSweep({ f1: o.f1, f2: o.f2, durationSec: o.sweepSec, sampleRate: sr, amplitude: o.amplitude });
    const signals = Array.from({ length: o.channels }, (_, k) => (k === output ? sweep : null));
    const rec = await this.playAndRecord(signals, o.irSec + 0.3);
    return { ir: deconvolve(rec, sweep, sr, o.f1, o.f2, Math.round(o.irSec * sr)), peakDb: peakDb(rec) };
  }

  /** Verifica: lo sweep passa per i filtri del canale d'ingresso e suona su tutte le uscite insieme. */
  async measureCorrected(filters: Float32Array[], o: MeasureOptions): Promise<Float32Array> {
    const sr = this.sampleRate;
    const sweep = expSweep({ f1: o.f1, f2: o.f2, durationSec: o.sweepSec, sampleRate: sr, amplitude: o.amplitude });
    const signals = Array.from({ length: o.channels }, (_, k) => (filters[k] ? Float32Array.from(convolve(sweep, filters[k])) : null));
    const rec = await this.playAndRecord(signals, o.irSec + 0.3);
    return deconvolve(rec, sweep, sr, o.f1, o.f2, Math.round(o.irSec * sr) + filters[0].length);
  }
}

export function peakDb(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return 20 * Math.log10(Math.max(p, 1e-9));
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === 'audioinput');
}
