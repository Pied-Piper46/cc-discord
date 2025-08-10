import type {
  Actor,
  ActorMessage,
  ActorResponse,
  MessageBus,
} from "../types.ts";
import { ClaudeCodeAdapter } from "../adapter/claude-code-adapter.ts";
import type { Config } from "../config.ts";

// Actor that communicates with ClaudeCode API
export class ClaudeCodeActor implements Actor {
  name: string;
  private adapter: ClaudeCodeAdapter;
  private bus?: MessageBus;

  constructor(config: Config, name = "claude-code") {
    this.name = name;
    this.adapter = new ClaudeCodeAdapter(config);
  }

  // MessageBus を後付け注入（後方互換維持のため）
  setMessageBus(bus: MessageBus): void {
    this.bus = bus;
  }

  async start(): Promise<void> {
    console.log(`[${this.name}] Actor started`);
    await this.adapter.start();
  }

  async stop(): Promise<void> {
    await this.adapter.stop();
    console.log(`[${this.name}] Actor stopped`);
  }

  protected createResponse(
    to: string,
    type: string,
    payload: unknown,
    originalMessageId?: string
  ): ActorResponse {
    return {
      id: originalMessageId
        ? `${originalMessageId}-response`
        : crypto.randomUUID(),
      from: this.name,
      to,
      type,
      payload,
      timestamp: new Date(),
    };
  }

  async handleMessage(message: ActorMessage): Promise<ActorResponse | null> {
    console.log(`[${this.name}] Processing message with Claude Code`);

    const content = message.payload as {
      text?: string;
      originalMessageId?: string;
      channelId?: string;
    };
    const text = content.text;
    const originalMessageId = content.originalMessageId ?? message.id;
    const channelId = content.channelId;

    if (!text) {
      return this.createResponse(
        message.from,
        "error",
        { error: "No text provided for Claude" },
        message.id
      );
    }

    // ストリーミング有効判定（bus 未注入や無効時は従来どおり最終のみ）
    const streamingEnabled =
      (this as any).adapter &&
      ((this as any).adapter["config"]?.streamingEnabled ?? true);
    const canStream = streamingEnabled && !!this.bus;

    if (!canStream) {
      try {
        const response = await this.adapter.query(text);
        return this.createResponse(
          message.from,
          "claude-response",
          { text: response, sessionId: this.adapter.getCurrentSessionId() },
          message.id
        );
      } catch (error) {
        console.error(`[${this.name}] Error querying Claude:`, error);
        return this.createResponse(
          message.from,
          "error",
          { error: error instanceof Error ? error.message : "Unknown error" },
          message.id
        );
      }
    }

    // ストリーミング経路
    try {
      // stream-started
      await this.bus!.emit({
        id: crypto.randomUUID(),
        from: this.name,
        to: "discord",
        type: "stream-started",
        payload: {
          originalMessageId,
          channelId: channelId ?? "",
          meta: { sessionId: this.adapter.getCurrentSessionId() },
        },
        timestamp: new Date(),
      });

      const cfg: any = (this as any).adapter["config"] ?? {};
      const toolPrefix: string =
        cfg.streamingToolChunkPrefix ?? "📋 ツール実行結果:";
      const maxChunk: number = cfg.streamingMaxChunkLength ?? 1800;

      const truncate = (s: string, n: number) =>
        s.length > n ? s.slice(0, n) + "..." : s;

      const response = await this.adapter.query(text, async (cm) => {
        try {
          // assistant のテキストチャンク
          if (cm?.type === "assistant") {
            const content = (cm as any).message?.content;
            let delta = "";
            if (typeof content === "string") {
              delta = content;
            } else if (Array.isArray(content)) {
              for (const b of content) {
                if (b?.type === "text" && typeof b.text === "string")
                  delta += b.text;
              }
            }
            if (delta) {
              await this.bus!.emit({
                id: crypto.randomUUID(),
                from: this.name,
                to: "discord",
                type: "stream-partial",
                payload: {
                  originalMessageId,
                  channelId: channelId ?? "",
                  textDelta: delta,
                  raw: cm,
                },
                timestamp: new Date(),
              });
            }
          }

          // ツール結果チャンク（Claude 側は user/tool_result 経由）
          if (cm?.type === "user") {
            const content = (cm as any).message?.content;
            if (Array.isArray(content)) {
              for (const item of content) {
                if (item?.type === "tool_result") {
                  const raw =
                    typeof item.content === "string"
                      ? item.content
                      : JSON.stringify(item.content);
                  const chunk = `${toolPrefix}\n\`\`\`\n${truncate(
                    raw ?? "",
                    maxChunk
                  )}\n\`\`\`\n`;
                  await this.bus!.emit({
                    id: crypto.randomUUID(),
                    from: this.name,
                    to: "discord",
                    type: "stream-partial",
                    payload: {
                      originalMessageId,
                      channelId: channelId ?? "",
                      toolChunk: chunk,
                      raw: cm,
                    },
                    timestamp: new Date(),
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error(`[${this.name}] onProgress emit error`, e);
        }
      });

      // 完了
      await this.bus!.emit({
        id: crypto.randomUUID(),
        from: this.name,
        to: "discord",
        type: "stream-completed",
        payload: {
          originalMessageId,
          channelId: channelId ?? "",
          fullText: response,
          sessionId: this.adapter.getCurrentSessionId(),
        },
        timestamp: new Date(),
      });

      // 既存の最終応答も維持
      return this.createResponse(
        message.from,
        "claude-response",
        { text: response, sessionId: this.adapter.getCurrentSessionId() },
        message.id
      );
    } catch (error) {
      console.error(`[${this.name}] Error querying Claude:`, error);
      // エラーも通知
      try {
        await this.bus!.emit({
          id: crypto.randomUUID(),
          from: this.name,
          to: "discord",
          type: "stream-error",
          payload: {
            originalMessageId,
            channelId: channelId ?? "",
            message: error instanceof Error ? error.message : "Unknown error",
            fatal: true,
          },
          timestamp: new Date(),
        });
      } catch {
        // ignore
      }

      return this.createResponse(
        message.from,
        "error",
        { error: error instanceof Error ? error.message : "Unknown error" },
        message.id
      );
    }
  }

  // Reset session
  resetSession(): void {
    this.adapter.resetSession();
  }

  getCurrentSessionId(): string | undefined {
    return this.adapter.getCurrentSessionId();
  }
}
