import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  mode: "auth0" as "auth0" | "none",
  revokeDesktopSession: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "meet_desktop_session" && state.cookieValue
        ? { name, value: state.cookieValue }
        : undefined,
  }),
}))

vi.mock("@/lib/server/authMode", () => ({
  authMode: () => state.mode,
}))

vi.mock("@/lib/server/desktopSession", () => ({
  DESKTOP_SESSION_COOKIE: "meet_desktop_session",
  revokeDesktopSession: state.revokeDesktopSession,
}))

const { DELETE, POST } = await import("./route")

function request(url = "https://meet.test/api/desktop/logout") {
  return new Request(url)
}

beforeEach(() => {
  state.cookieValue = "desktop-token"
  state.mode = "auth0"
  state.revokeDesktopSession.mockClear()
  delete process.env.APP_BASE_URL
})

describe("desktop logout route", () => {
  it("revokes the desktop session and expires the cookie", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(state.revokeDesktopSession).toHaveBeenCalledWith("desktop-token")

    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("meet_desktop_session=")
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=lax")
    expect(setCookie).toContain("Secure")
  })

  it("clears the cookie even when there is no session token", async () => {
    state.cookieValue = undefined

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(state.revokeDesktopSession).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("supports DELETE as an alias for POST", async () => {
    const response = await DELETE(
      request("http://meet.test/api/desktop/logout"),
    )

    expect(response.status).toBe(200)
    expect(state.revokeDesktopSession).toHaveBeenCalledWith("desktop-token")
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("Max-Age=0")
    expect(setCookie).not.toContain("Secure")
  })

  it("404s when Auth0 mode is disabled", async () => {
    state.mode = "none"

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(state.revokeDesktopSession).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
