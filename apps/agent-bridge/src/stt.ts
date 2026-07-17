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

export type Finalizer = {
  /** Transcribe a complete utterance (16 kHz mono float32) accurately. */
  transcribe(samples: Float32Array): string
}

/**
 * High-accuracy utterance finalizer (NVIDIA Parakeet TDT via sherpa-onnx,
 * offline decoding with casing + punctuation). The streaming model provides
 * live interim text; on endpoint the utterance is re-transcribed with this
 * and the segment replaced. Null when the model isn't shipped — finals then
 * come from the streaming model.
 */
export async function loadFinalizer(
  modelDir = process.env.FINALIZER_MODEL_DIR ?? "",
): Promise<Finalizer | null> {
  if (!modelDir || !existsSync(join(modelDir, "encoder.int8.onnx"))) return null
  let sherpa: typeof import("sherpa-onnx-node")
  try {
    sherpa = await import("sherpa-onnx-node")
  } catch {
    return null
  }
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: STT_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(modelDir, "encoder.int8.onnx"),
        decoder: join(modelDir, "decoder.int8.onnx"),
        joiner: join(modelDir, "joiner.int8.onnx"),
      },
      tokens: join(modelDir, "tokens.txt"),
      numThreads: Number(process.env.TRANSCRIBER_NUM_THREADS ?? 2),
      provider: "cpu",
      modelType: "nemo_transducer",
    },
    decodingMethod: "greedy_search",
  })
  return {
    transcribe(samples) {
      const s = recognizer.createStream()
      s.acceptWaveform({ sampleRate: STT_SAMPLE_RATE, samples })
      recognizer.decode(s)
      return recognizer.getResult(s).text.trim()
    },
  }
}

export type Denoiser = {
  /** Denoise 16 kHz mono samples; output lags by the model's frame shift. */
  process(samples: Float32Array): Float32Array
}

/**
 * Per-speaker streaming noise suppression (GTCRN via sherpa-onnx, 16 kHz).
 * Returns a factory, or null when the model isn't present — transcription
 * simply runs on raw audio then.
 */
export async function loadDenoiserFactory(
  modelPath = process.env.DENOISER_MODEL ?? "",
): Promise<(() => Denoiser) | null> {
  if (!modelPath || !existsSync(modelPath)) return null
  let sherpa: typeof import("sherpa-onnx-node")
  try {
    sherpa = await import("sherpa-onnx-node")
  } catch {
    return null
  }
  return () => {
    const d = new sherpa.OnlineSpeechDenoiser({
      model: { gtcrn: { model: modelPath }, numThreads: 1, provider: "cpu" },
    })
    return {
      process(samples) {
        const out = d.run({ samples, sampleRate: STT_SAMPLE_RATE })
        return out.samples
      },
    }
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
