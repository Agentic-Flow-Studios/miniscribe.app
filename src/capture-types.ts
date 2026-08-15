// Shared between the renderer (producer) and main (consumer). Kept in its own
// file so the main process can depend on the chunk shape without pulling in any
// Web Audio types.

export type TrackKind = 'me' | 'them';

export interface AudioChunk {
  kind: TrackKind;
  samples: Float32Array;
  /**
   * Frame index of the first sample, counted from the start of RECORDING (not
   * from AudioContext creation). Both tracks hang off a single AudioContext, so
   * this is one shared timeline — `frame` is directly comparable across kinds.
   *
   * This is the field that makes the capture layer replaceable. Sample counts
   * alone assume no buffer was ever dropped and that mic and loopback run off
   * the same hardware clock; neither is true. An explicit frame index lets the
   * consumer see a hole instead of silently absorbing it into every later
   * timestamp.
   */
  frame: number;
  /** Peak absolute amplitude in this chunk, for level metering. */
  peak: number;
}
