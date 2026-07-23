import type { DocPresence } from "@meet/shared"
import { atom } from "nanostores"

/**
 * Live cursors in the shared document, keyed by participant identity.
 *
 * `seenAt` is stamped locally on receipt — remote clocks can't be trusted
 * for staleness, and a skewed `at` would insta-prune a healthy cursor.
 */
export type SeenDocPresence = DocPresence & { seenAt: number }

export const $docPresence = atom<Record<string, SeenDocPresence>>({})

export function upsertDocPresence(presence: DocPresence) {
  $docPresence.set({
    ...$docPresence.get(),
    [presence.by]: { ...presence, seenAt: Date.now() },
  })
}

export function removeDocPresence(identity: string) {
  const current = $docPresence.get()
  if (!(identity in current)) return
  const { [identity]: _removed, ...rest } = current
  $docPresence.set(rest)
}

/** Drops cursors that have gone quiet longer than `maxAgeMs`. */
export function pruneDocPresence(maxAgeMs: number) {
  const current = $docPresence.get()
  const now = Date.now()
  const fresh = Object.entries(current).filter(
    ([, p]) => now - p.seenAt <= maxAgeMs,
  )
  if (fresh.length !== Object.keys(current).length) {
    $docPresence.set(Object.fromEntries(fresh))
  }
}

export function resetDocPresence() {
  $docPresence.set({})
}
