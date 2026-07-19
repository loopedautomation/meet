// AudioWorkletProcessor that taps the local mic, downmixes to mono,
// resamples to 16 kHz (linear interpolation — the context may run at any
// hardware rate), and posts ~100 ms Float32 chunks to the STT worker.
const TARGET_RATE = 16000
const CHUNK_SAMPLES = 1600 // 100 ms at 16 kHz

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_RATE
    this.pos = 0
    this.tail = new Float32Array(0)
    this.out = new Float32Array(CHUNK_SAMPLES)
    this.outLen = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    const mono = channels[0]
    // Join the carried-over tail with this block so interpolation can read
    // across the block boundary.
    const input = new Float32Array(this.tail.length + mono.length)
    input.set(this.tail)
    input.set(mono, this.tail.length)

    let pos = this.pos
    while (pos + 1 < input.length) {
      const i = Math.floor(pos)
      const frac = pos - i
      this.out[this.outLen++] = input[i] * (1 - frac) + input[i + 1] * frac
      pos += this.ratio
      if (this.outLen === CHUNK_SAMPLES) {
        const chunk = this.out.slice()
        this.port.postMessage({ type: "frames", samples: chunk }, [
          chunk.buffer,
        ])
        this.outLen = 0
      }
    }
    const consumed = Math.floor(pos)
    this.tail = input.slice(consumed)
    this.pos = pos - consumed
    return true
  }
}

registerProcessor("pcm-worklet", PcmWorklet)
