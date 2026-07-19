"use client"

import { useLocalParticipant, useParticipants } from "@livekit/components-react"
import { parseParticipantMeta } from "@meet/shared"
import { useEffect, useRef, useState } from "react"
import { toast } from "react-toastify"

/**
 * Make waiting-room knocks unmissable: a doorbell-ish chime plus a persistent
 * toast with an inline Admit action for every new knocker. The toast stays
 * until the knock resolves (admitted, denied, or gave up), then dismisses.
 */
export function useKnockAlerts(slug: string) {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const known = useRef<Set<string>>(new Set())
  const ctxRef = useRef<AudioContext | null>(null)

  const waiting = participants.filter(
    (p) => parseParticipantMeta(p.metadata)?.kind === "waiting",
  )

  useEffect(() => {
    const current = new Set(waiting.map((p) => p.identity))

    for (const p of waiting) {
      if (known.current.has(p.identity)) continue
      known.current.add(p.identity)
      knockChime(ctxRef)
      toast.info(
        <KnockToast
          slug={slug}
          identity={p.identity}
          name={p.name || p.identity}
          requesterIdentity={localParticipant.identity}
        />,
        {
          toastId: `knock-${p.identity}`,
          autoClose: false,
          closeOnClick: false,
        },
      )
    }

    for (const identity of [...known.current]) {
      if (!current.has(identity)) {
        known.current.delete(identity)
        toast.dismiss(`knock-${identity}`)
      }
    }
  }, [waiting, slug, localParticipant])

  useEffect(
    () => () => {
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    },
    [],
  )
}

function KnockToast({
  slug,
  identity,
  name,
  requesterIdentity,
}: {
  slug: string
  identity: string
  name: string
  requesterIdentity: string
}) {
  const [busy, setBusy] = useState(false)

  const decide = async (action: "admit" | "deny") => {
    setBusy(true)
    try {
      await fetch(`/api/rooms/${slug}/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity, action, requesterIdentity }),
      })
    } finally {
      toast.dismiss(`knock-${identity}`)
    }
  }

  return (
    <div className="flex w-full items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{name}</span> is asking to join
      </span>
      <button
        type="button"
        className="btn btn-success btn-xs"
        disabled={busy}
        onClick={() => decide("admit")}
      >
        Admit
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        disabled={busy}
        onClick={() => decide("deny")}
      >
        Deny
      </button>
    </div>
  )
}

/** Two quick knocks — clearly distinct from the join/leave chimes. */
function knockChime(ctxRef: React.RefObject<AudioContext | null>) {
  try {
    ctxRef.current ??= new AudioContext()
    const ctx = ctxRef.current
    if (ctx.state === "suspended") void ctx.resume()
    for (const [i, freq] of [392, 392].entries()) {
      const start = ctx.currentTime + i * 0.18
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "triangle"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.1, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.2)
    }
  } catch {
    // no audio available — the toast still shows
  }
}
