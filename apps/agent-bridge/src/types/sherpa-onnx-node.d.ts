/** Minimal typings for the sherpa-onnx Node addon (no upstream types). */
declare module "sherpa-onnx-node" {
  export type OnlineStream = {
    acceptWaveform(input: {
      sampleRate: number
      samples: Float32Array | number[]
    }): void
    free?(): void
  }

  export class OnlineSpeechDenoiser {
    constructor(config: {
      model: {
        gtcrn: { model: string }
        numThreads?: number
        provider?: string
      }
    })
    sampleRate: number
    frameShiftInSamples: number
    run(input: {
      samples: Float32Array
      sampleRate: number
    }): { samples: Float32Array; sampleRate: number }
    flush(enableExternalBuffer?: boolean): {
      samples: Float32Array
      sampleRate: number
    }
    reset(): void
  }

  export type OfflineStream = {
    acceptWaveform(input: {
      sampleRate: number
      samples: Float32Array | number[]
    }): void
  }

  export class OfflineRecognizer {
    constructor(config: {
      featConfig: { sampleRate: number; featureDim: number }
      modelConfig: {
        transducer: { encoder: string; decoder: string; joiner: string }
        tokens: string
        numThreads?: number
        provider?: string
        modelType?: string
      }
      decodingMethod?: string
    })
    createStream(): OfflineStream
    decode(stream: OfflineStream): void
    getResult(stream: OfflineStream): { text: string }
  }

  export class OnlineRecognizer {
    constructor(config: {
      featConfig: { sampleRate: number; featureDim: number }
      modelConfig: {
        transducer: { encoder: string; decoder: string; joiner: string }
        tokens: string
        numThreads?: number
        provider?: string
        modelType?: string
      }
      decodingMethod?: string
      enableEndpoint?: boolean
      rule1MinTrailingSilence?: number
      rule2MinTrailingSilence?: number
      rule3MinUtteranceLength?: number
    })
    createStream(): OnlineStream
    isReady(stream: OnlineStream): boolean
    decode(stream: OnlineStream): void
    isEndpoint(stream: OnlineStream): boolean
    reset(stream: OnlineStream): void
    getResult(stream: OnlineStream): { text: string }
  }
}
