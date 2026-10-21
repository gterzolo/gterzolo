// Il calcolo dei filtri gira in un Web Worker per non bloccare l'interfaccia.
import { computeArt, type ArtParams, type MeasurementSet } from './dsp/art';
import { parseMicCal } from './io/micCal';

export interface WorkerRequest { m: MeasurementSet; params: Omit<ArtParams, 'micCalDb'>; micCal?: string }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    const { m, params, micCal } = e.data;
    const res = computeArt(m, { ...params, micCalDb: micCal ? parseMicCal(micCal) : undefined });
    (self as unknown as Worker).postMessage({ ok: true, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error).message ?? err) });
  }
};
