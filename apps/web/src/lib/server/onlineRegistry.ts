// Who has a live presence stream open right now — the cheap "online" signal
// (in-a-call presence comes from room_presence; this is presence-at-the-app).
// In-process state is correct here: the instance is a single web process,
// and a stream dying takes its entry with it.

const connections = new Map<string, number>()

export function onlineConnect(userId: string): void {
  connections.set(userId, (connections.get(userId) ?? 0) + 1)
}

export function onlineDisconnect(userId: string): void {
  const n = (connections.get(userId) ?? 1) - 1
  if (n <= 0) connections.delete(userId)
  else connections.set(userId, n)
}

export function onlineUserIds(): Set<string> {
  return new Set(connections.keys())
}
