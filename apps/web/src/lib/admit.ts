import { roomAuthHeaders } from "@/lib/roomAuth"

/**
 * Admit or deny a knocking participant. Both entry points (the Participants
 * panel and the knock toast) go through this so a failure reads the same
 * either way — and reads as something the person clicking can act on, not
 * one generic message for every status (which is what made #259
 * undiagnosable from its bug report).
 */
export async function decideAdmission(
  slug: string,
  identity: string,
  action: "admit" | "deny",
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/rooms/${slug}/admit`, {
      method: "POST",
      // The server derives who's admitting from the verified token in the
      // Authorization header — a claimed identity would be spoofable.
      headers: {
        "content-type": "application/json",
        ...roomAuthHeaders(slug),
      },
      body: JSON.stringify({ identity, action }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, message: await admitErrorMessage(res, action) }
  } catch {
    return {
      ok: false,
      message: `Could not ${action} — network problem. Try again.`,
    }
  }
}

async function admitErrorMessage(
  res: Response,
  action: "admit" | "deny",
): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return `Could not ${action} — your session has gone stale. Reload the page and try again.`
  }
  if (res.status === 404) {
    return `Could not ${action} — they are no longer waiting.`
  }
  if (res.status === 502) {
    return `Could not ${action} — the meeting server refused. Try again.`
  }
  // Anything unexpected still names the status, so a bug report carries it.
  const detail = await res
    .json()
    .then((b: { error?: string }) => b?.error)
    .catch(() => undefined)
  return `Could not ${action} (${res.status}${detail ? `: ${detail}` : ""}).`
}
