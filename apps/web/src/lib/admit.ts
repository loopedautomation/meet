/**
 * Turn a failed /admit response into something the person clicking Admit can
 * act on. Both entry points (the Participants panel and the knock toast) share
 * this so a failure reads the same either way.
 */
export async function admitErrorMessage(
  res: Response,
  action: "admit" | "deny",
): Promise<string> {
  const verb = action === "admit" ? "admit" : "deny"
  if (res.status === 401 || res.status === 403) {
    return `Could not ${verb} — your session has gone stale. Reload the page and try again.`
  }
  if (res.status === 404) {
    return `Could not ${verb} — they are no longer waiting.`
  }
  if (res.status === 502) {
    return `Could not ${verb} — the meeting server refused. Try again.`
  }
  // Anything unexpected still names the status, so a bug report carries it.
  const detail = await res
    .json()
    .then((b: { error?: string }) => b?.error)
    .catch(() => undefined)
  return `Could not ${verb} (${res.status}${detail ? `: ${detail}` : ""}).`
}
