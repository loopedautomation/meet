import { iconForAttachment } from "@/lib/fileIcon"

type Attachment = { key: string; name: string; type: string; size: number }

/** Card treatment for a non-image attachment (docs, audio, video, anything
 * else) — the image branch already renders inline with a lightbox; this is
 * everything that doesn't. */
export function AttachmentCard({
  attachment,
  href,
}: {
  attachment: Attachment
  href: string
}) {
  const Icon = iconForAttachment(attachment.type)
  return (
    <a
      href={href}
      download={attachment.name}
      className="mt-1 flex max-w-xs items-center gap-2 rounded-box border border-base-300 bg-base-100 p-2.5 hover:bg-base-200/60"
    >
      <Icon className="size-6 shrink-0 text-base-content/60" />
      <span className="min-w-0">
        <span className="block truncate text-sm">{attachment.name}</span>
        <span className="text-base-content/40 text-xs">
          {Math.max(1, Math.round(attachment.size / 1024))} KB
        </span>
      </span>
    </a>
  )
}
