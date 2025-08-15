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

    // メッセージを受け付けたことを即座にDiscordに通知
    if (this.bus && channelId) {
      try {
        await this.bus.emit({
          id: crypto.randomUUID(),
          from: this.name,
          to: "discord",
          type: "message-accepted",
          payload: {
            originalMessageId,
            channelId,
            text: "[accepted]",
          },
          timestamp: new Date(),
        });
      } catch (e) {
        console.error(`[${this.name}] Failed to send acceptance notification:`, e);
      }
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
      // stream-started (これで「考え中...」が表示されるがeditモードではあまり意味がない)
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

      const truncateLines = (text: string, maxLines: number = 50): string => {
        const lines = text.split('\n');
        if (lines.length <= maxLines) {
          return text;
        }
        
        const headLines = 25;
        const tailLines = 10;
        const omittedLines = lines.length - headLines - tailLines;
        
        return [
          ...lines.slice(0, headLines),
          `\n... ${omittedLines} lines omitted ...\n`,
          ...lines.slice(-tailLines)
        ].join('\n');
      };

      const response = await this.adapter.query(text, async (cm) => {
        try {
          // assistant のテキストチャンクとツール使用
          if (cm?.type === "assistant") {
            const content = (cm as any).message?.content;
            let delta = "";
            let toolUses: any[] = [];
            
            if (typeof content === "string") {
              delta = content;
            } else if (Array.isArray(content)) {
              for (const b of content) {
                if (b?.type === "text" && typeof b.text === "string") {
                  delta += b.text;
                } else if (b?.type === "tool_use") {
                  toolUses.push(b);
                }
              }
            }
            
            // テキストデルタを送信
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
            
            // ツール使用を通知
            for (const toolUse of toolUses) {
              const toolInfo = `🔧 **ツール使用**: \`${toolUse.name || "unknown"}\`\n`;
              let toolParams = "";
              
              if (toolUse.input) {
                const paramsJson = JSON.stringify(toolUse.input, null, 2);
                const truncatedParams = truncateLines(paramsJson, 50);
                toolParams = `📋 **パラメータ**: \n\`\`\`json\n${truncatedParams}\n\`\`\`\n`;
              }
              
              await this.bus!.emit({
                id: crypto.randomUUID(),
                from: this.name,
                to: "discord",
                type: "stream-partial",
                payload: {
                  originalMessageId,
                  channelId: channelId ?? "",
                  toolChunk: toolInfo + toolParams,
                  raw: toolUse,
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
                  const toolId = item.tool_use_id || "unknown";
                  const isError = item.is_error || false;
                  const raw =
                    typeof item.content === "string"
                      ? item.content
                      : JSON.stringify(item.content);
                  
                  const resultHeader = isError ? 
                    `❌ **ツールエラー** (ID: ${toolId}):\n` :
                    `✅ **ツール実行結果** (ID: ${toolId}):\n`;
                  
                  const truncatedResult = truncateLines(raw ?? "", 50);
                  const chunk = `${resultHeader}\`\`\`\n${truncatedResult}\n\`\`\`\n`;
                  
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
      
      // 完了通知を送信
      if (channelId) {
        try {
          await this.bus!.emit({
            id: crypto.randomUUID(),
            from: this.name,
            to: "discord",
            type: "message-completed",
            payload: {
              originalMessageId,
              channelId,
              text: "[done]",
            },
            timestamp: new Date(),
          });
        } catch (e) {
          console.error(`[${this.name}] Failed to send completion notification:`, e);
        }
      }

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
