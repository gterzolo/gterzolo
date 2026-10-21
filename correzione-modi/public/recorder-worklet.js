// Registra il microfono marcando ogni blocco con il frame dell'AudioContext,
// così la registrazione si può allineare esattamente all'istante di partenza dello sweep.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.port.onmessage = (e) => { this.active = e.data === 'start'; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (this.active && ch) this.port.postMessage({ frame: currentFrame, data: ch.slice(0) });
    return true;
  }
}
registerProcessor('recorder', RecorderProcessor);
