import {
  MIN_CLIENT_PROTOCOL,
  PROTOCOL_VERSION,
  SERVICE_ID,
} from "@meet/shared/protocol"
import { NextResponse } from "next/server"

/**
 * Liveness probe *and* the desktop client's compatibility handshake — the
 * shell already calls this before saving a server, so folding the handshake
 * in keeps connecting to one round trip.
 *
 * `ok` stays first and unchanged: the compose healthcheck and the desktop's
 * reachability test only look at the status code and this field.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: SERVICE_ID,
    protocol: PROTOCOL_VERSION,
    minClientProtocol: MIN_CLIENT_PROTOCOL,
    version: process.env.npm_package_version ?? "0.1.0",
  })
}
