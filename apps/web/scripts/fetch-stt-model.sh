#!/usr/bin/env bash
# Fetch the sherpa-onnx WASM ASR bundle (single-threaded SIMD build with the
# streaming zipformer packed into the .data file) into public/stt/ so
# in-browser transcription activates. Without these files the web app probes
# /stt/sherpa-onnx-wasm-main-asr.js, finds nothing, and every participant simply
# uses the server transcriber — shipping the models is optional.
#
# Bundles are published per sherpa-onnx release; see
# https://github.com/k2-fsa/sherpa-onnx/releases (wasm asr artifacts) or the
# prebuilt huggingface space k2-fsa/web-assembly-asr. Set STT_WASM_URL to the
# tar.bz2 you want.
set -euo pipefail

STT_WASM_URL="${STT_WASM_URL:-}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/stt"

if [ -z "$STT_WASM_URL" ]; then
  echo "Set STT_WASM_URL to a sherpa-onnx wasm ASR bundle (tar.bz2)." >&2
  echo "Expected contents: sherpa-onnx-wasm-main-asr.js/.wasm/.data, sherpa-onnx-asr.js" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fL "$STT_WASM_URL" -o "$tmp/bundle.tar.bz2"
tar -xjf "$tmp/bundle.tar.bz2" -C "$tmp"

found=0
for f in sherpa-onnx-wasm-main-asr.js sherpa-onnx-wasm-main-asr.wasm sherpa-onnx-wasm-main-asr.data sherpa-onnx-asr.js; do
  src="$(find "$tmp" -name "$f" | head -1)"
  if [ -n "$src" ]; then
    cp "$src" "$DEST/$f"
    found=$((found + 1))
  fi
done

if [ "$found" -lt 4 ]; then
  echo "warning: bundle was missing expected files ($found/4 copied)" >&2
  exit 1
fi
echo "Installed WASM STT bundle into $DEST"
