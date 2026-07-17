/** Minimal typings for the sherpa-onnx Node addon (no upstream types). */
declare module "sherpa-onnx-node" {
  export type OnlineStream = {
    acceptWaveform(input: {
      sampleRate: number
      samples: Float32Array | number[]
    }): void
    free?(): void
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
