// Classic (non-module) worker hosting the sherpa-onnx WASM streaming
// recognizer. Runs single-threaded — no SharedArrayBuffer, no COOP/COEP —
// for maximum browser compatibility (Safari/iOS included).
//
// Protocol (all messages are {type, ...}):
//   in:  init             — load wasm + model (served from /stt/)
//        frames {samples} — Float32Array, 16 kHz mono
//   out: ready {loadMs}   — engine loaded and recognizer constructed
//        alive            — heartbeat, posted after every processed batch
//        segment {text, final} — interim (final=false) or endpoint final
//        error {message}  — fatal; the page falls back to server STT

/* global createOnlineRecognizer */

let recognizer = null
let stream = null

function fail(message) {
  self.postMessage({ type: "error", message: String(message) })
}

self.onmessage = (e) => {
  const msg = e.data
  if (msg.type === "init") {
    const start = Date.now()
    try {
      // Module must exist before the emscripten glue runs. The .data file
      // packs the streaming zipformer model into the wasm FS.
      self.Module = {
        locateFile: (f) => `/stt/${f}`,
        onRuntimeInitialized: () => {
          try {
            recognizer = createOnlineRecognizer(self.Module)
            stream = recognizer.createStream()
            self.postMessage({ type: "ready", loadMs: Date.now() - start })
          } catch (err) {
            fail(`recognizer init: ${err}`)
          }
        },
        onAbort: (what) => fail(`wasm aborted: ${what}`),
      }
      // API glue first (defines createOnlineRecognizer), then the
      // emscripten runtime. Both ship with the sherpa-onnx wasm ASR bundle.
      importScripts("/stt/sherpa-onnx-asr.js", "/stt/sherpa-onnx-wasm-main-asr.js")
    } catch (err) {
      fail(`wasm load: ${err}`)
    }
    return
  }

  if (msg.type === "frames") {
    if (!recognizer || !stream) return
    try {
      stream.acceptWaveform(16000, msg.samples)
      while (recognizer.isReady(stream)) recognizer.decode(stream)
      const text = (recognizer.getResult(stream).text || "").trim()
      if (recognizer.isEndpoint(stream)) {
        if (text) self.postMessage({ type: "segment", text, final: true })
        recognizer.reset(stream)
      } else if (text) {
        self.postMessage({ type: "segment", text, final: false })
      }
      self.postMessage({ type: "alive" })
    } catch (err) {
      fail(`decode: ${err}`)
    }
  }
}
