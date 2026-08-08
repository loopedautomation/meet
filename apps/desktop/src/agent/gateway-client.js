// Native WebSocket client for the agent gateway (wss://:8093/gateway/agent?ticket=...)

class GatewayClient {
  constructor({ gatewayUrl, ticket, resumeToken, onFrame, onStatus, onOpen }) {
    this.gatewayUrl = gatewayUrl
    this.ticket = ticket
    this.resumeToken = resumeToken
    this.onFrame = onFrame
    this.onStatus = onStatus
    this.onOpen = onOpen
    this.ws = null
    this.closed = false
    this.reconnectDelay = 1000
  }

  connect() {
    if (this.closed) return
    const url = this.ticket
      ? `${this.gatewayUrl}?ticket=${this.ticket}`
      : `${this.gatewayUrl}?resume=${this.resumeToken}`
    this.ws = new WebSocket(url)
    // Use native WebSocket (Electron 38 = Node 22 has global WebSocket)

    this.ws.onopen = () => {
      // The ticket is single-use: after the first successful open, further
      // dials must be resumes.
      this.ticket = null
      this.reconnectDelay = 1000
      this.onStatus?.("online")
      // Fired only once the socket can actually carry frames — hello and
      // anything else sent earlier would be silently dropped by sendFrame.
      this.onOpen?.()
    }
    this.ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data)
        this.onFrame?.(frame)
      } catch {}
    }
    this.ws.onclose = (ev) => {
      if (this.closed) return
      if (ev.code === 4401) {
        this.onStatus?.("error")
        return
      }
      this.onStatus?.("reconnecting")
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000)
    }
    this.ws.onerror = () => {
      // will trigger close
    }
  }

  sendFrame(frame) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
    }
  }

  close() {
    this.closed = true
    try { this.ws?.close() } catch {}
  }
}

module.exports = { GatewayClient }
