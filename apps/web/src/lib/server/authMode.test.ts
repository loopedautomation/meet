import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { authMode } from "./authMode"

const AUTH_VARS = [
  "MEET_AUTH_MODE",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "DATABASE_URL",
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(AUTH_VARS.map((k) => [k, process.env[k]]))
  for (const k of AUTH_VARS) delete process.env[k]
})

afterEach(() => {
  for (const k of AUTH_VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function configureAuth0() {
  process.env.AUTH0_DOMAIN = "t.auth0.com"
  process.env.AUTH0_CLIENT_ID = "id"
  process.env.AUTH0_CLIENT_SECRET = "secret"
  process.env.AUTH0_SECRET = "s".repeat(64)
  process.env.DATABASE_URL = "postgresql://x"
}

describe("authMode", () => {
  it("defaults to none with nothing configured — the pre-accounts product", () => {
    expect(authMode()).toBe("none")
  })

  it("resolves to auth0 when Auth0 env and a database are present", () => {
    configureAuth0()
    expect(authMode()).toBe("auth0")
  })

  it("stays none without a database even if Auth0 is configured", () => {
    configureAuth0()
    delete process.env.DATABASE_URL
    expect(authMode()).toBe("none")
  })

  it("MEET_AUTH_MODE=none forces the pre-accounts product", () => {
    configureAuth0()
    process.env.MEET_AUTH_MODE = "none"
    expect(authMode()).toBe("none")
  })

  it("MEET_AUTH_MODE=auth0 with missing config fails loudly, not silently open", () => {
    process.env.MEET_AUTH_MODE = "auth0"
    expect(() => authMode()).toThrow()
  })
})
