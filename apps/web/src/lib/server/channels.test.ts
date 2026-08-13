import { describe, expect, it } from "vitest"
import { dmSlugFor } from "./channels"

describe("dmSlugFor", () => {
  it("is order-independent — the same pair always yields the same slug", () => {
    const a = dmSlugFor([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ])
    const b = dmSlugFor([
      "22222222-2222-2222-2222-222222222222",
      "11111111-1111-1111-1111-111111111111",
    ])
    expect(a).toBe(b)
  })

  it("starts with the dm- prefix used by channel slugs", () => {
    const slug = dmSlugFor([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ])
    expect(slug).toMatch(/^dm-[0-9a-f]{16}$/)
  })

  it("differs for different pairs", () => {
    const a = dmSlugFor([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ])
    const b = dmSlugFor([
      "11111111-1111-1111-1111-111111111111",
      "33333333-3333-3333-3333-333333333333",
    ])
    expect(a).not.toBe(b)
  })
})
