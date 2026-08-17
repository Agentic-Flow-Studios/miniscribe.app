// Runs on the realtime audio rendering thread, NOT the renderer's main JS
// thread. That is the entire reason this file exists.
//
// Receives native audio (e.g. 48kHz / 44.1kHz from hardware mic or WASAPI loopback)
// and accurately resamples to target 16kHz using an anti-aliasing filter and
// fractional interpolation before posting 2048-sample (128ms) chunks.

const TARGET_SAMPLE_RATE = 16000;
const CHUNK = 2048; // 2048 samples @ 16kHz = 128ms
const SILENT_BLOCK = new Float32Array(128);

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
    this.peak = 0;
    this.deliveredFrames = 0;

    // Resampling configuration
    // `sampleRate` is a global in AudioWorkletGlobalScope reflecting the context sample rate
    const nativeRate = typeof sampleRate !== 'undefined' ? sampleRate : TARGET_SAMPLE_RATE;
    this.ratio = nativeRate / TARGET_SAMPLE_RATE;
    this.sourcePos = 0;
    this.prevSample = 0;

    // 2nd-order Butterworth low-pass anti-aliasing filter if downsampling is required (nativeRate > 16kHz)
    if (this.ratio > 1.0) {
      const fc = 7200; // 7.2kHz cutoff (< 8kHz Nyquist of 16kHz output)
      const w0 = (2 * Math.PI * fc) / nativeRate;
      const alpha = Math.sin(w0) / (2 * 0.70710678);
      const cosw = Math.cos(w0);
      const b0 = (1 - cosw) / 2;
      const b1 = 1 - cosw;
      const b2 = (1 - cosw) / 2;
      const a0 = 1 + alpha;
      const a1 = -2 * cosw;
      const a2 = 1 - alpha;

      this.b0 = b0 / a0;
      this.b1 = b1 / a0;
      this.b2 = b2 / a0;
      this.a1 = a1 / a0;
      this.a2 = a2 / a0;

      this.x1 = 0;
      this.x2 = 0;
      this.y1 = 0;
      this.y2 = 0;
      this.filteredBuf = new Float32Array(128);
    }

    this.port.onmessage = (e) => {
      if (e.data === 'flush') this.flush();
    };
  }

  process(inputs) {
    const input = inputs[0];
    const ch =
      input && input.length > 0 && input[0] && input[0].length > 0
        ? input[0]
        : SILENT_BLOCK;

    const len = ch.length;

    if (this.ratio <= 1.0) {
      // Direct pass-through when running at 16kHz
      for (let i = 0; i < len; i++) {
        const s = ch[i];
        this.buf[this.n++] = s;
        const a = s < 0 ? -s : s;
        if (a > this.peak) this.peak = a;
        if (this.n === CHUNK) this.flush();
      }
      return true;
    }

    // 1. Low-pass anti-aliasing filter
    if (!this.filteredBuf || this.filteredBuf.length < len) {
      this.filteredBuf = new Float32Array(len);
    }
    const filtered = this.filteredBuf;
    for (let i = 0; i < len; i++) {
      const x = ch[i];
      const y =
        this.b0 * x +
        this.b1 * this.x1 +
        this.b2 * this.x2 -
        this.a1 * this.y1 -
        this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;
      filtered[i] = y;
    }

    // 2. Fractional linear interpolation downsampling
    let pos = this.sourcePos;
    while (pos < len - 1) {
      let s;
      if (pos < 0) {
        const frac = pos + 1;
        s = this.prevSample + frac * (filtered[0] - this.prevSample);
      } else {
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const s0 = filtered[idx];
        const s1 = filtered[idx + 1];
        s = s0 + frac * (s1 - s0);
      }

      this.buf[this.n++] = s;
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      if (this.n === CHUNK) this.flush();

      pos += this.ratio;
    }

    this.sourcePos = pos - len;
    this.prevSample = filtered[len - 1];

    return true;
  }

  flush() {
    if (this.n === 0) return;
    const samples = this.buf.slice(0, this.n);
    const startFrame = this.deliveredFrames;
    this.deliveredFrames += samples.length;
    this.port.postMessage(
      { frame: startFrame, samples, peak: this.peak },
      [samples.buffer],
    );
    this.n = 0;
    this.peak = 0;
  }
}

registerProcessor('capture', CaptureProcessor);
