import { existsSync } from "node:fs"
import { join } from "node:path"

// Local streaming speech-to-text via sherpa-onnx (CPU, no cloud calls). The
// module is loaded lazily so deployments without the model (or the native
// addon) can still run the bridge with transcription disabled.

export const STT_SAMPLE_RATE = 16_000

export type SttStream = {
  /** Feed 16 kHz mono float32 samples ([-1, 1]). */
  accept(samples: Float32Array): void
  /** Current utterance text (interim — grows as the speaker talks). */
  text(): string
  /** True when the endpoint rules decided the utterance is finished. */
  endpoint(): boolean
  /** Reset for the next utterance (after handling an endpoint). */
  reset(): void
  free(): void
}

export type SttEngine = {
  createStream(): SttStream
}

/** Model files expected under TRANSCRIBER_MODEL_DIR (streaming zipformer). */
const files = (dir: string) => {
  const pick = (...candidates: string[]) =>
    candidates.find((f) => existsSync(join(dir, f)))
  return {
    encoder: pick(
      "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
      "encoder-epoch-99-avg-1.int8.onnx",
      "encoder.int8.onnx",
    ),
    decoder: pick(
      "decoder-epoch-99-avg-1-chunk-16-left-128.onnx",
      "decoder-epoch-99-avg-1.onnx",
      "decoder.onnx",
    ),
    joiner: pick(
      "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
      "joiner-epoch-99-avg-1.int8.onnx",
      "joiner.int8.onnx",
    ),
    tokens: pick("tokens.txt"),
  }
}

/**
 * Load the local STT engine, or explain why it can't be loaded. Call once per
 * process; streams share the model weights.
 */
export async function loadSttEngine(
  modelDir = process.env.TRANSCRIBER_MODEL_DIR ?? "",
): Promise<SttEngine | { error: string }> {
  if (!modelDir) return { error: "TRANSCRIBER_MODEL_DIR is not set" }
  const f = files(modelDir)
  if (!f.encoder || !f.decoder || !f.joiner || !f.tokens) {
    return { error: `streaming zipformer model files not found in ${modelDir}` }
  }
  let sherpa: typeof import("sherpa-onnx-node")
  try {
    sherpa = await import("sherpa-onnx-node")
  } catch (err) {
    return {
      error: `sherpa-onnx-node failed to load: ${(err as Error).message}`,
    }
  }
  const recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: STT_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, f.encoder),
        decoder: join(modelDir, f.decoder),
        joiner: join(modelDir, f.joiner),
      },
      tokens: join(modelDir, f.tokens),
      numThreads: Number(process.env.TRANSCRIBER_NUM_THREADS ?? 2),
      provider: "cpu",
    },
    decodingMethod: "greedy_search",
    enableEndpoint: true,
    // Endpoint when: long silence with no speech / short silence after
    // speech / a very long utterance.
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 0.8,
    rule3MinUtteranceLength: 20,
  })
  return {
    createStream(): SttStream {
      const s = recognizer.createStream()
      return {
        accept(samples) {
          s.acceptWaveform({ sampleRate: STT_SAMPLE_RATE, samples })
          while (recognizer.isReady(s)) recognizer.decode(s)
        },
        text: () => recognizer.getResult(s).text.trim(),
        endpoint: () => recognizer.isEndpoint(s),
        reset: () => recognizer.reset(s),
        free: () => s.free?.(),
      }
    },
  }
}
