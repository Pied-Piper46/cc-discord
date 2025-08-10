import type { Actor, ActorMessage, ActorResponse, MessageBus } from "../types.ts";
import { GeminiCliAdapter } from "../adapter/gemini-cli-adapter.ts";
import type { Config } from "../config.ts";

// Actor that communicates with Gemini CLI
export class GeminiCliActor implements Actor {
  name: string;
  private adapter: GeminiCliAdapter;
  private bus?: MessageBus;

  constructor(config: Config, name = "gemini-cli") {
    this.name = name;
    this.adapter = new GeminiCliAdapter(config);
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
    originalMessageId?: string,
  ): ActorResponse {
    return {
      id: originalMessageId ? `${originalMessageId}-response` : crypto.randomUUID(),
      from: this.name,
      to,
      type,
      payload,
      timestamp: new Date(),
    };
  }

  async handleMessage(message: ActorMessage): Promise<ActorResponse | null> {
    // Gemini CLIに対するクエリを処理
    if (message.type === "query" && typeof message.payload === "object") {
      const payload = message.payload as { content?: string };

      if (!payload.content) {
        return this.createResponse(
          message.from,
          "error",
          { error: "No content provided for query" },
          message.id,
        );
      }

      try {
        // ストリーミングサポートの確認
        if (message.type === "query" && this.bus) {
          // ストリーミング開始を通知
          await this.bus.send({
            id: `${message.id}-stream-start`,
            from: this.name,
            to: message.from,
            type: "stream_start",
            payload: { originalMessageId: message.id },
            timestamp: new Date(),
          });

          // Gemini CLIでストリーミング実行
          const asyncIterator = this.adapter.queryStream(payload.content);

          for await (const chunk of asyncIterator) {
            // チャンクをバスに送信
            await this.bus.send({
              id: `${message.id}-chunk-${Date.now()}`,
              from: this.name,
              to: message.from,
              type: "stream_chunk",
              payload: {
                originalMessageId: message.id,
                chunk: chunk.content,
                isToolUse: chunk.isToolUse,
              },
              timestamp: new Date(),
            });
          }

          // 最終結果を取得
          const result = await this.adapter.getLastResult();

          // ストリーミング終了を通知
          await this.bus.send({
            id: `${message.id}-stream-end`,
            from: this.name,
            to: message.from,
            type: "stream_end",
            payload: {
              originalMessageId: message.id,
              result,
            },
            timestamp: new Date(),
          });

          return this.createResponse(
            message.from,
            "response",
            { content: result },
            message.id,
          );
        } else {
          // 通常のクエリ（非ストリーミング）
          const result = await this.adapter.query(payload.content);
          return this.createResponse(
            message.from,
            "response",
            { content: result },
            message.id,
          );
        }
      } catch (error) {
        console.error(`[${this.name}] Query error:`, error);
        return this.createResponse(
          message.from,
          "error",
          { error: error instanceof Error ? error.message : String(error) },
          message.id,
        );
      }
    }

    // ツール実行リクエスト
    if (message.type === "execute_tool" && typeof message.payload === "object") {
      const payload = message.payload as {
        toolName?: string;
        parameters?: Record<string, unknown>;
      };

      if (!payload.toolName) {
        return this.createResponse(
          message.from,
          "error",
          { error: "No tool name provided" },
          message.id,
        );
      }

      try {
        const result = await this.adapter.executeTool(
          payload.toolName,
          payload.parameters || {},
        );

        return this.createResponse(
          message.from,
          "tool_result",
          { result },
          message.id,
        );
      } catch (error) {
        console.error(`[${this.name}] Tool execution error:`, error);
        return this.createResponse(
          message.from,
          "error",
          { error: error instanceof Error ? error.message : String(error) },
          message.id,
        );
      }
    }

    // その他のメッセージは無視
    return null;
  }
}

