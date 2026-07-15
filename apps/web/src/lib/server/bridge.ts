function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

/** Server-side fetch to the agent-bridge control API (token never reaches the browser). */
export async function bridgeFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(path, required("BRIDGE_URL"))
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${required("BRIDGE_TOKEN")}`,
    },
  })
}
