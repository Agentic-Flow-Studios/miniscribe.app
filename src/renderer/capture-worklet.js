// Runs on the realtime audio rendering thread, NOT the renderer's main JS
// thread. That is the entire reason this file exists.
//
// The previous implementation used ScriptProcessorNode, whose onaudioprocess
// callback runs on the main thread alongside the DOM, the meter loop and GC.
// Miss the deadline and the buffer is dropped: no exception, no log, and — worse
// — no hole in the sample count to prove it ever happened. Every timestamp after
// the drop just quietly shifts earlier. An AudioWorklet cannot be starved by UI
// work, and posts an explicit frame index so a drop is visible if it ever does
// happen.

// Frames per message. 2048 @ 16kHz = 128ms — small enough that the two tracks
// stay tightly interleaved, large enough to keep postMessage traffic sane.
const CHUNK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
    this.peak = 0;
    this.startFrame = 0;
    // Stop sends 'flush' so the final partial chunk isn't discarded — without
    // it every track loses up to 128ms off the end.
    this.port.onmessage = (e) => {
      if (e.data === 'flush') this.flush();
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    // Absent between the node being connected and the track producing audio.
    // Return true to stay alive rather than letting the node be torn down.
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      // `currentFrame` is the frame index at the start of this 128-frame
      // quantum, counted from AudioContext creation and shared by every worklet
      // on that context. Both tracks live on one context, so Me and Them land on
      // a single timeline with no cross-track drift to reconcile later.
      if (this.n === 0) this.startFrame = currentFrame + i;

      const s = ch[i];
      this.buf[this.n++] = s;
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;

      if (this.n === CHUNK) this.flush();
    }
    return true;
  }

  flush() {
    if (this.n === 0) return;
    // slice() copies out of the reused scratch buffer, so transferring the
    // result is safe and saves a second copy across the thread boundary.
    const samples = this.buf.slice(0, this.n);
    this.port.postMessage(
      { frame: this.startFrame, samples, peak: this.peak },
      [samples.buffer],
    );
    this.n = 0;
    this.peak = 0;
  }
}

registerProcessor('capture', CaptureProcessor);
