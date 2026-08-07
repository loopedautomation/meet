export type LinkPreview = {
  url: string
  title?: string
  description?: string
  image?: string
  siteName?: string
}

/** OG-unfurl card for a message's first link, fetched server-side after
 * send (see apps/web/src/lib/server/linkPreview.ts) — nothing to fetch or
 * load here, just rendering whatever the message already carries. Returns
 * null when there's no preview (or nothing worth showing), so callers can
 * render it unconditionally. */
export function LinkPreviewCard({
  preview,
}: {
  preview: LinkPreview | undefined
}) {
  if (!preview?.title) return null
  let hostname = preview.siteName
  if (!hostname) {
    try {
      hostname = new URL(preview.url).hostname
    } catch {
      hostname = undefined
    }
  }
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block max-w-md overflow-hidden rounded-box border border-base-300 bg-base-100 hover:bg-base-200/60"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          className="max-h-52 w-full object-cover"
        />
      )}
      <div className="space-y-0.5 p-3">
        {hostname && (
          <div className="text-base-content/50 text-xs uppercase tracking-wide">
            {hostname}
          </div>
        )}
        <div className="font-medium text-sm">{preview.title}</div>
        {preview.description && (
          <p className="line-clamp-2 text-base-content/70 text-xs">
            {preview.description}
          </p>
        )}
      </div>
    </a>
  )
}
