#!/usr/bin/env node
// Enforce that CLIENT_PROTOCOL / MIN_SERVER_PROTOCOL / SERVICE_ID in apps/desktop/src/main.js
// match packages/shared/src/protocol.ts exports. Additive capabilities do NOT need a bump.
import { readFileSync } from "node:fs"

const protoPath = "packages/shared/src/protocol.ts"
const mainPath = "apps/desktop/src/main.js"

const proto = readFileSync(protoPath, "utf8")
const main = readFileSync(mainPath, "utf8")

function extract(re, src, label) {
  const m = src.match(re)
  if (!m) {
    console.error(`Could not find ${label}`)
    process.exit(1)
  }
  return m[1]
}

const protoVersion = extract(/export const PROTOCOL_VERSION\s*=\s*(\d+)/, proto, "PROTOCOL_VERSION")
const protoMin = extract(/export const MIN_CLIENT_PROTOCOL\s*=\s*(\d+)/, proto, "MIN_CLIENT_PROTOCOL")
const protoService = extract(/export const SERVICE_ID\s*=\s*"([^"]+)"/, proto, "SERVICE_ID")

const mainVersion = extract(/const CLIENT_PROTOCOL\s*=\s*(\d+)/, main, "CLIENT_PROTOCOL")
const mainMin = extract(/const MIN_SERVER_PROTOCOL\s*=\s*(\d+)/, main, "MIN_SERVER_PROTOCOL")
const mainService = extract(/const SERVICE_ID\s*=\s*"([^"]+)"/, main, "SERVICE_ID")

let ok = true
if (protoVersion !== mainVersion) {
  console.error(`PROTOCOL_VERSION ${protoVersion} != CLIENT_PROTOCOL ${mainVersion}`)
  ok = false
}
if (protoMin !== mainMin) {
  console.error(`MIN_CLIENT_PROTOCOL ${protoMin} != MIN_SERVER_PROTOCOL ${mainMin}`)
  ok = false
}
if (protoService !== mainService) {
  console.error(`SERVICE_ID "${protoService}" != "${mainService}"`)
  ok = false
}
if (!ok) process.exit(1)
console.log(`protocol sync ok: PROTOCOL_VERSION=${protoVersion} SERVICE_ID=${protoService}`)
