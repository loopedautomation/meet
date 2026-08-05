import { $activeChannelSlug } from "@/stores/activeChannel"

export type ChatMessagePosted = {
  channelSlug: string
  channelName: string
  isDm: boolean
  senderId: string
  senderName: string
  messageId: string
  snippet: string
}

declare global {
  interface Window {
    desktopBridge?: {
      notifyMessage: (payload: {
        title: string
        body: string
        channelSlug: string
      }) => void
    }
  }
}

function showBrowserNotification(
  title: string,
  body: string,
  onClick: () => void,
) {
  if (typeof Notification === "undefined") return
  const fire = () => {
    const n = new Notification(title, { body })
    n.onclick = onClick
  }
  if (Notification.permission === "granted") {
    fire()
  } else if (Notification.permission === "default") {
    // Requested lazily, on the first qualifying event, rather than on page
    // load — an unprompted permission popup on every visit gets penalized
    // by browsers and trains users to reflexively dismiss it.
    void Notification.requestPermission().then((perm) => {
      if (perm === "granted") fire()
    })
  }
}

/** Dispatch (or suppress) a notification for a message the SSE stream just
 * forwarded. Skips the sender's own messages and a channel that's both open
 * and focused right now. */
export function handleIncomingMessage(
  msg: ChatMessagePosted,
  currentUserId: string,
  navigateToChannel: (slug: string) => void,
) {
  if (msg.senderId === currentUserId) return
  const viewingThisChannel = $activeChannelSlug.get() === msg.channelSlug
  if (viewingThisChannel && document.hasFocus()) return

  // channelName already carries its "#" (channels are named "#slug" by
  // convention — see POST /api/channels), so it's used as-is here.
  const title = msg.isDm
    ? msg.senderName
    : `${msg.senderName} in ${msg.channelName}`
  const onClick = () => {
    window.focus()
    navigateToChannel(msg.channelSlug)
  }

  if (window.desktopBridge?.notifyMessage) {
    window.desktopBridge.notifyMessage({
      title,
      body: msg.snippet,
      channelSlug: msg.channelSlug,
    })
    return
  }
  showBrowserNotification(title, msg.snippet, onClick)
}
