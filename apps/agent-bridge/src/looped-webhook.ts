import type { TtyServerFrame } from "./looped-tty.js"

export type Brain = {
  runTurn: (input: string) => AsyncGenerator<TtyServerFrame>
  close: () => void
}

/**
 * Webhook brain: request/reply against a looped-af webhook trigger.
 * No streaming and no tool-activity feed — the whole reply arrives at once.
 */
export class LoopedWebhookClient implements Brain {
  #url: string
  #token: string
  #conversationId: string

  constructor(opts: { url: string; token: string; conversationId: string }) {
    this.#url = opts.url
    this.#token = opts.token
    this.#conversationId = opts.conversationId
  }

  async *runTurn(input: string): AsyncGenerator<TtyServerFrame> {
    const res = await fetch(this.#url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#token}`,
      },
      body: JSON.stringify({
        input,
        conversation_id: this.#conversationId,
      }),
    })
    if (!res.ok) {
      yield { type: "error", error: `webhook responded ${res.status}` }
      return
    }
    const body = (await res.json()) as { reply?: string; status?: string }
    const reply = body.reply ?? ""
    if (reply) yield { type: "assistant", content: reply }
    yield {
      type: "result",
      status: body.status ?? "ok",
      reply,
      steps: 1,
    }
  }

  close() {}
}
