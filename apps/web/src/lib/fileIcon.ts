import {
  File,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react"

const ARCHIVE_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/gzip",
])

const SPREADSHEET_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

/** Attachment content-type isn't restricted to a fixed whitelist server-side
 * (see apps/web/src/app/api/channels/[room]/attachments/route.ts), so this
 * always has a sensible fallback rather than assuming a known set. */
export function iconForAttachment(type: string): LucideIcon {
  if (type.startsWith("audio/")) return FileAudio
  if (type.startsWith("video/")) return FileVideo
  if (ARCHIVE_TYPES.has(type)) return FileArchive
  if (SPREADSHEET_TYPES.has(type)) return FileSpreadsheet
  if (type === "application/pdf" || type.startsWith("text/")) return FileText
  if (type.startsWith("application/")) return FileText
  return File
}
