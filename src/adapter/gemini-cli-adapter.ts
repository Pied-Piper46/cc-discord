import type { Adapter } from "../types.ts";
import type { Config } from "../config.ts";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

export type GeminiStreamChunk = {
  type: "text" | "tool" | "system" | "done";
  content: string;
  isToolUse?: boolean;
  raw?: unknown;
};

// Adapter that manages communication with Gemini CLI
export class GeminiCliAdapter implements Adapter {
  name = "gemini-cli";
  private config: Config;
  private lastResult?: string;
  private abortController?: AbortController;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log(`[${this.name}] Gemini CLI adapter started`);
    console.log(`[${this.name}] Model: ${this.config.geminiModel || "gemini-pro"}`);
  }

  async stop(): Promise<void> {
    console.log(`[${this.name}] Stopping Gemini CLI adapter...`);
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Execute Gemini CLI command and return result
  async query(prompt: string): Promise<string> {
    const model = this.config.geminiModel || "gemini-pro";
    const apiKey = this.config.geminiApiKey;

    if (!apiKey) {
      throw new Error("Gemini API key is not configured");
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env, GEMINI_API_KEY: apiKey };

      // Gemini CLIコマンドを構築
      const args = [
        "chat",
        "--model",
        model,
      ];

      if (this.config.geminiMaxTokens) {
        args.push("--max-tokens", String(this.config.geminiMaxTokens));
      }

      if (this.config.geminiTemperature !== undefined) {
        args.push("--temperature", String(this.config.geminiTemperature));
      }

      const geminiProcess = spawn("gemini", args, { env });

      let output = "";
      let errorOutput = "";

      // プロンプトを標準入力に送信
      geminiProcess.stdin.write(prompt);
      geminiProcess.stdin.end();

      geminiProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      geminiProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      geminiProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Gemini CLI exited with code ${code}: ${errorOutput}`));
        } else {
          this.lastResult = output.trim();
          resolve(output.trim());
        }
      });

      geminiProcess.on("error", (error) => {
        reject(error);
      });

      // Abort処理
      if (this.abortController) {
        this.abortController.signal.addEventListener("abort", () => {
          geminiProcess.kill();
          reject(new Error("Query aborted"));
        });
      }
    });
  }

  // Stream query results using AsyncIterable
  async *queryStream(prompt: string): AsyncIterable<GeminiStreamChunk> {
    const model = this.config.geminiModel || "gemini-pro";
    const apiKey = this.config.geminiApiKey;

    if (!apiKey) {
      throw new Error("Gemini API key is not configured");
    }

    const env = { ...process.env, GEMINI_API_KEY: apiKey };

    // ストリーミング対応のGemini CLIコマンドを構築
    const args = [
      "chat",
      "--model",
      model,
      "--stream", // ストリーミングモードを有効化
    ];

    if (this.config.geminiMaxTokens) {
      args.push("--max-tokens", String(this.config.geminiMaxTokens));
    }

    if (this.config.geminiTemperature !== undefined) {
      args.push("--temperature", String(this.config.geminiTemperature));
    }

    const geminiProcess = spawn("gemini", args, { env });

    // プロンプトを標準入力に送信
    geminiProcess.stdin.write(prompt);
    geminiProcess.stdin.end();

    let buffer = "";
    let fullResponse = "";

    // ストリーム処理
    for await (const chunk of geminiProcess.stdout) {
      const text = chunk.toString();
      buffer += text;
      fullResponse += text;

      // バッファから完全な行を抽出
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          // JSONレスポンスの場合はパース
          if (line.startsWith("{")) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "text") {
                yield {
                  type: "text",
                  content: parsed.content || "",
                  raw: parsed,
                };
              } else if (parsed.type === "tool") {
                yield {
                  type: "tool",
                  content: parsed.content || "",
                  isToolUse: true,
                  raw: parsed,
                };
              }
            } catch {
              // JSONパースエラーの場合は通常のテキストとして扱う
              yield {
                type: "text",
                content: line,
              };
            }
          } else {
            // 通常のテキスト出力
            yield {
              type: "text",
              content: line,
            };
          }
        }
      }
    }

    // 残りのバッファを処理
    if (buffer.trim()) {
      yield {
        type: "text",
        content: buffer,
      };
      fullResponse += buffer;
    }

    // 最終結果を保存
    this.lastResult = fullResponse.trim();

    // 完了シグナル
    yield {
      type: "done",
      content: "",
    };
  }

  // Get the last query result
  getLastResult(): string | undefined {
    return this.lastResult;
  }

  // Execute tool with Gemini CLI
  async executeTool(
    toolName: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    // Gemini CLIのツール実行機能を使用
    // 実装はGemini CLIの仕様に依存
    const apiKey = this.config.geminiApiKey;

    if (!apiKey) {
      throw new Error("Gemini API key is not configured");
    }

    return new Promise((resolve, reject) => {
      const env = { ...process.env, GEMINI_API_KEY: apiKey };

      // ツール実行コマンド
      const args = [
        "tool",
        "--name",
        toolName,
        "--params",
        JSON.stringify(parameters),
      ];

      const geminiProcess = spawn("gemini", args, { env });

      let output = "";
      let errorOutput = "";

      geminiProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      geminiProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      geminiProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Tool execution failed with code ${code}: ${errorOutput}`));
        } else {
          try {
            const result = JSON.parse(output.trim());
            resolve(result);
          } catch {
            // JSONパースエラーの場合は文字列として返す
            resolve(output.trim());
          }
        }
      });

      geminiProcess.on("error", (error) => {
        reject(error);
      });
    });
  }
}

