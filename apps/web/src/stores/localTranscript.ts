import { map } from "nanostores"

// LiveKit text streams never loop back to their sender, so when this client
// transcribes its own mic (useLocalTranscription) the published segments are
// invisible to our own useTranscriptions(). The hook mirrors them here and
// the transcript panel merges them in.
export type LocalSegment = {
  id: string
  identity: string
  text: string
  final: boolean
  at: number
}

export const $localSegments = map<Record<string, LocalSegment>>({})

export function upsertLocalSegment(seg: LocalSegment) {
  $localSegments.setKey(seg.id, seg)
}
