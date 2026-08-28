import fs from 'node:fs';
import { loadSettings, textNormalizerPath } from './model-manager';
import type { TranscriptSegment } from './transcription';

const SYSTEM_PROMPT = 'You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.';
const ASSISTANT_PREFIX = '<|im_start|>assistant\n<think>\n\n</think>\n\n';

let cleanupQueue: Promise<unknown> = Promise.resolve();

function promptFor(transcript: string): string {
  return `<|im_start|>system\n${SYSTEM_PROMPT}<|im_end|>\n<|im_start|>user\n[Styling: semi-formal] [Structure: prose] [Context: general]\n${transcript}<|im_end|>\n${ASSISTANT_PREFIX}`;
}

/**
 * Run S1-mini locally after ASR. Each segment is handled independently so its
 * speaker and timeline stay stable. The original per-word timestamps are not
 * valid after words are removed or rewritten, so cleaned segments omit them.
 */
export async function normalizeTranscript(segments: TranscriptSegment[]): Promise<TranscriptSegment[]> {
  const settings = loadSettings();
  const modelPath = textNormalizerPath();
  if (!settings.textCleanupEnabled || !fs.existsSync(modelPath)) return segments;

  const work = cleanupQueue.then(async () => {
    const { getLlama, LlamaCompletion } = await import('node-llama-cpp');
    // S1-mini is compact enough for a laptop CPU. Shipping one CPU binding
    // keeps the installer small and avoids bundling every optional GPU backend.
    const llama = await getLlama({ gpu: false, build: 'never', maxThreads: 2 });
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 2048, sequences: 1 });
    try {
      const cleaned: TranscriptSegment[] = [];
      for (const segment of segments) {
        const raw = segment.text.trim();
        if (!raw) continue;
        // A fresh sequence prevents one utterance's generated text becoming
        // context for the next one. The model was trained on single transcripts.
        const completion = new LlamaCompletion({
          contextSequence: context.getSequence(),
          autoDisposeSequence: true,
        });
        try {
          const output = (await completion.generateCompletion(promptFor(raw), {
            maxTokens: Math.max(32, Math.ceil(raw.split(/\s+/).length * 1.3) + 32),
            temperature: 0,
            trimWhitespaceSuffix: true,
          })).trim();
          if (output) cleaned.push({ ...segment, text: output, words: [] });
        } finally {
          completion.dispose();
        }
        // A filler-only segment legitimately normalizes to empty text.
      }
      return cleaned;
    } finally {
      context.dispose();
      model.dispose();
      llama.dispose();
    }
  });
  cleanupQueue = work.then(() => undefined, () => undefined);
  return work;
}
