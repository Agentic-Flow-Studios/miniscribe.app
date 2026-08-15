import fs from 'node:fs';

// Incremental WAV writer for the main process.
//
// The renderer used to hold the whole recording as an array of Float32Arrays —
// roughly 230MB of JS heap for 30 minutes across two tracks, all of it lost on a
// crash, and the GC pressure from it was itself a cause of dropped buffers.
// Audio now goes straight to disk as it arrives and never accumulates anywhere.

export const SAMPLE_RATE = 16000;
const HEADER_BYTES = 44;

// 16-bit PCM rather than 32-bit float: universally playable, readable by
// sherpa's readWave, half the size, and the precision loss is irrelevant to ASR.
// Exported because clip playback re-heads a byte range of one of these files.
export function wavHeader(sampleRate: number, dataBytes: number): Buffer {
  const b = Buffer.alloc(HEADER_BYTES);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // 1 = PCM integer
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28); // byte rate
  b.writeUInt16LE(2, 32); // block align
  b.writeUInt16LE(16, 34); // bits per sample
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

export class WavWriter {
  private fd: number;
  private dataBytes = 0;

  constructor(
    readonly filePath: string,
    private readonly sampleRate: number = SAMPLE_RATE,
  ) {
    this.fd = fs.openSync(filePath, 'w');
    fs.writeSync(this.fd, wavHeader(sampleRate, 0), 0, HEADER_BYTES, 0);
  }

  append(samples: Float32Array): void {
    const buf = Buffer.allocUnsafe(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      // Clamp before scaling. A sample outside [-1,1] wraps at int16 and turns a
      // loud peak into a burst of noise rather than clipping cleanly.
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(Math.round(s * 32767), i * 2);
    }
    // Synchronous, but these are ~4KB writes arriving 8x/sec per track — well
    // under anything the main process would notice.
    fs.writeSync(this.fd, buf, 0, buf.length, HEADER_BYTES + this.dataBytes);
    this.dataBytes += buf.length;
    this.patch();
  }

  // Re-stamp the two length fields after every chunk. A crash then leaves a WAV
  // that plays correctly up to the last 128ms, instead of one carrying a zero
  // length header that no player will open.
  private patch(): void {
    const n = Buffer.alloc(4);
    n.writeUInt32LE(36 + this.dataBytes, 0);
    fs.writeSync(this.fd, n, 0, 4, 4);
    n.writeUInt32LE(this.dataBytes, 0);
    fs.writeSync(this.fd, n, 0, 4, 40);
  }

  get frames(): number {
    return this.dataBytes / 2;
  }

  get seconds(): number {
    return this.frames / this.sampleRate;
  }

  close(): void {
    this.patch();
    fs.closeSync(this.fd);
  }
}
