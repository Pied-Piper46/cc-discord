import { type Options, query as sdkQuery } from "@anthropic-ai/claude-code";
import type { Adapter, ClaudeMessage } from "../types.ts";
import type { Config } from "../config.ts";
import { sessionHistory } from "../utils/session-history.ts";

// DI interface to abstract Claude Code client
export interface ClaudeClient {
  query(args: {
    prompt: string;
    options: Options;
    abortController?: AbortController;
  }): AsyncIterable<any>;
}

// Factory to create the real Claude Code client
export function createClaudeClient(): ClaudeClient {
  return {
    query: ({ prompt, options, abortController }) =>
      // SDK 最新版は abortController/signal を受け取らないため未指定で呼び出す
      sdkQuery({ prompt, options }),
  };
}

export type ClaudeStreamChunk = {
  type: "text" | "tool" | "system" | "done";
  content: string;
  raw?: unknown;
};

// Adapter that manages communication with ClaudeCode API
export class ClaudeCodeAdapter implements Adapter {
  name = "claude-code";
  private config: Config;
  private currentSessionId?: string;
  private isFirstQuery = true;
  private abortController?: AbortController;
  private client: ClaudeClient;
  private preflightChecked = false;

  constructor(config: Config, client?: ClaudeClient) {
    this.config = config;
    this.client = client ?? createClaudeClient();

    // Set first query flag to false for resume sessions
    if (config.sessionId) {
      this.isFirstQuery = false;
      this.currentSessionId = config.sessionId;
    }
    
    // Set first query flag to false for continue sessions
    if (config.continueSession) {
      this.isFirstQuery = false;
    }

    // Claude Code uses internal authentication, no API key needed
  }

  async start(): Promise<void> {
    console.log(`[${this.name}] Claude Code adapter started`);
    console.log(`[${this.name}] Model: ${this.config.model}`);
    if (this.currentSessionId) {
      console.log(`[${this.name}] Resuming session: ${this.currentSessionId}`);
    }
    
    // --continue オプション時に会話履歴を表示
    if (this.config.continueSession && !this.config.sessionId) {
      const latestSessionId = await sessionHistory.getLatestSessionId();
      if (latestSessionId) {
        const messages = await sessionHistory.getConversationHistory(latestSessionId, 5);
        sessionHistory.showConversationHistory(messages);
      }
    }
  }

  async stop(): Promise<void> {
    console.log(`[${this.name}] Stopping Claude Code adapter...`);
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  // Send query to Claude API
  async query(
    prompt: string,
    onProgress?: (message: ClaudeMessage) => Promise<void>,
    isRetry = false
  ): Promise<string> {
    // --continue オプション時、最初のクエリに会話履歴を含める
    let actualPrompt = prompt;
    if (this.config.continueSession && this.isFirstQuery && !this.config.sessionId) {
      const latestSessionId = await sessionHistory.getLatestSessionId();
      if (latestSessionId) {
        const messages = await sessionHistory.getConversationHistory(latestSessionId, 5);
        if (messages.length > 0) {
          const historyText = messages.map(msg => 
            `[${msg.type === "user" ? "User" : "Claude"}]: ${msg.content}`
          ).join("\n");
          actualPrompt = `以下は前回の会話の続きです:\n\n${historyText}\n\n---\n\n現在のメッセージ: ${prompt}`;
          console.log(`[${this.name}] Including conversation history in prompt`);
        }
      }
    }

    const options: Options = {
      maxTurns: this.config.maxTurns,
      model: this.config.model,
      permissionMode: this.config.claudePermissionMode as Options["permissionMode"] | undefined,
      ...((this.isFirstQuery && !this.config.continueSession) ? {} : { continue: true }),
      ...(this.config.sessionId && this.isFirstQuery
        ? { resume: this.config.sessionId }
        : {}),
    };

    this.abortController = new AbortController();

    try {
      const response = this.client.query({
        prompt: actualPrompt,
        options,
        abortController: this.abortController,
      });

      let fullResponse = "";
      let toolResults = "";

      for await (const message of response) {
        // Call progress callback if available
        if (onProgress) {
          await onProgress(message as ClaudeMessage);
        }

        if (message.type === "assistant") {
          const content = message.message.content;
          if (typeof content === "string") {
            fullResponse += content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                fullResponse += block.text;
              }
            }
          }
        } else if (message.type === "system" && message.subtype === "init") {
          // Save session ID
          this.currentSessionId = message.session_id;
          console.log(
            `[${this.name}] Session started: ${this.currentSessionId}`
          );

          if (this.isFirstQuery) {
            this.isFirstQuery = false;
          }
        } else if (message.type === "result") {
          // Update session ID from result message
          this.currentSessionId = message.session_id;
        } else if (message.type === "user") {
          // Process tool execution results
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (
                item.type === "tool_result" &&
                typeof item.content === "string"
              ) {
                const truncated =
                  item.content.length > 300
                    ? item.content.substring(0, 300) + "..."
                    : item.content;
                toolResults += `\n📋 Tool execution result:\n\`\`\`\n${truncated}\n\`\`\`\n`;
              }
            }
          }
        }
      }

      // Add toolResults to fullResponse if available
      if (toolResults) {
        fullResponse = toolResults + (fullResponse ? "\n" + fullResponse : "");
      }

      return fullResponse || "No response received.";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Query was aborted");
      }
      
      // セッションが見つからないエラーをチェック
      if (error instanceof Error && !isRetry) {
        const errorMessage = error.message.toLowerCase();
        const isSessionNotFound = 
          errorMessage.includes("no conversation found with session id") ||
          errorMessage.includes("session not found") ||
          errorMessage.includes("invalid session") ||
          errorMessage.includes("session does not exist");
        
        if (isSessionNotFound && (this.config.sessionId || this.config.continueSession)) {
          console.log(`[${this.name}] Session not found error detected. Resetting session and retrying...`);
          
          // セッションをリセット
          this.resetSession();
          
          // セッション関連の設定を一時的に無効化して再試行
          const originalSessionId = this.config.sessionId;
          const originalContinue = this.config.continueSession;
          this.config.sessionId = undefined;
          this.config.continueSession = false;
          
          try {
            // リトライ（isRetry=trueで再帰呼び出しを防ぐ）
            const result = await this.query(prompt, onProgress, true);
            
            // 設定を戻す
            this.config.sessionId = originalSessionId;
            this.config.continueSession = originalContinue;
            
            return result;
          } catch (retryError) {
            // 設定を戻す
            this.config.sessionId = originalSessionId;
            this.config.continueSession = originalContinue;
            
            // リトライも失敗した場合は元のエラー処理を続行
            console.error(`[${this.name}] Retry failed:`, retryError);
            // 元のエラーを投げる
          }
        }
      }

      // Collect diagnostics (non-fatal, best-effort)
      const permissionMode =
        this.config.claudePermissionMode ?? "auto";
      let cwd = "";
      try {
        cwd = Deno.cwd();
      } catch {
        cwd = "unknown";
      }
      let firstPath = "";
      try {
        const p = Deno.env.get("PATH") ?? "";
        firstPath = p.split(":")[0] ?? "";
      } catch {
        firstPath = "unknown";
      }

      const rawMsg = error instanceof Error ? error.message : String(error);
      // Rate limit detection (non-fatal hint only)
      const rateLimited = /429|rate[ -]?limit|too many requests/i.test(rawMsg);
      
      // Process exit code 1 詳細ログ
      if (rawMsg.includes("exited with code")) {
        const exitCodeMatch = rawMsg.match(/exited with code (\d+)/);
        const exitCode = exitCodeMatch ? exitCodeMatch[1] : "unknown";
        console.error(`[${this.name}] Claude Code process exited with code ${exitCode}`);
        console.error(`[${this.name}] Full error: ${rawMsg}`);
        console.error(`[${this.name}] Prompt length: ${actualPrompt.length} characters`);
        console.error(`[${this.name}] Options:`, JSON.stringify(options, null, 2));
        
        // Extract stderr if available
        const stderrMatch = rawMsg.match(/stderr: (.+)/);
        if (stderrMatch) {
          console.error(`[${this.name}] Process stderr: ${stderrMatch[1]}`);
        }
      }
      
      let cliPresence = "unknown";
      if (this.shouldRunPreflight(rawMsg) && !this.preflightChecked) {
        this.preflightChecked = true;
        try {
          cliPresence = await this.checkClaudeCliPresence();
        } catch {
          // swallow any errors and fallback
          cliPresence = "not_found_or_failed";
        }
      }
      const hint = `\nhint: permissionMode=${permissionMode}, cwd=${cwd}, PATH[0]=${firstPath}, cli=${cliPresence}, rate_limited=${rateLimited}`;

      if (error instanceof Error) {
        // Wrap error while preserving original message (e.g. "exited with code" and stderr info)
        throw new Error(`ClaudeCodeAdapter: ${error.message}${hint}`);
      }
      throw new Error(`ClaudeCodeAdapter: Unknown error${hint}`);
    }
  }

  // New: stream chunks API for MCP clients
  async *queryStream(prompt: string, isRetry = false): AsyncIterable<ClaudeStreamChunk> {
    // --continue オプション時、最初のクエリに会話履歴を含める
    let actualPrompt = prompt;
    if (this.config.continueSession && this.isFirstQuery && !this.config.sessionId) {
      const latestSessionId = await sessionHistory.getLatestSessionId();
      if (latestSessionId) {
        const messages = await sessionHistory.getConversationHistory(latestSessionId, 5);
        if (messages.length > 0) {
          const historyText = messages.map(msg => 
            `[${msg.type === "user" ? "User" : "Claude"}]: ${msg.content}`
          ).join("\n");
          actualPrompt = `以下は前回の会話の続きです:\n\n${historyText}\n\n---\n\n現在のメッセージ: ${prompt}`;
          console.log(`[${this.name}] Including conversation history in prompt (stream)`);
        }
      }
    }

    const options: Options = {
      maxTurns: this.config.maxTurns,
      model: this.config.model,
      permissionMode: this.config.claudePermissionMode as Options["permissionMode"] | undefined,
      ...((this.isFirstQuery && !this.config.continueSession) ? {} : { continue: true }),
      ...(this.config.sessionId && this.isFirstQuery
        ? { resume: this.config.sessionId }
        : {}),
    };

    this.abortController = new AbortController();

    try {
      const response = this.client.query({
        prompt: actualPrompt,
        options,
        abortController: this.abortController,
      });

      for await (const message of response) {
        // system init → session id 更新
        if (message.type === "system" && message.subtype === "init") {
          this.currentSessionId = message.session_id;
          if (this.isFirstQuery) this.isFirstQuery = false;
          yield {
            type: "system",
            content: `session:${this.currentSessionId}`,
            raw: message,
          };
          continue;
        }

        // result → 最終 session id 更新（出力はしない）
        if (message.type === "result") {
          this.currentSessionId = message.session_id;
          continue;
        }

        // assistant テキストチャンク
        if (message.type === "assistant") {
          const content = message.message.content;
          if (typeof content === "string") {
            if (content) {
              yield { type: "text", content, raw: message };
            }
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                yield { type: "text", content: block.text, raw: block };
              }
            }
          }
          continue;
        }

        // ツール実行結果（user/tool_result）
        if (message.type === "user") {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (
                item.type === "tool_result" &&
                typeof item.content === "string"
              ) {
                const truncated =
                  item.content.length > 300
                    ? item.content.substring(0, 300) + "..."
                    : item.content;
                const toolText = `📋 Tool execution result:\n\`\`\`\n${truncated}\n\`\`\`\n`;
                yield { type: "tool", content: toolText, raw: item };
              }
            }
          }
          continue;
        }
      }

      // 完了通知
      yield { type: "done", content: "" };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Query was aborted");
      }
      
      // セッションが見つからないエラーをチェック
      if (error instanceof Error && !isRetry) {
        const errorMessage = error.message.toLowerCase();
        const isSessionNotFound = 
          errorMessage.includes("no conversation found with session id") ||
          errorMessage.includes("session not found") ||
          errorMessage.includes("invalid session") ||
          errorMessage.includes("session does not exist");
        
        if (isSessionNotFound && (this.config.sessionId || this.config.continueSession)) {
          console.log(`[${this.name}] Session not found error detected in stream. Resetting and retrying...`);
          
          // セッションをリセット
          this.resetSession();
          
          // セッション関連の設定を一時的に無効化して再試行
          const originalSessionId = this.config.sessionId;
          const originalContinue = this.config.continueSession;
          this.config.sessionId = undefined;
          this.config.continueSession = false;
          
          try {
            // リトライ（isRetry=trueで再帰呼び出しを防ぐ）
            yield* this.queryStream(prompt, true);
            
            // 設定を戻す
            this.config.sessionId = originalSessionId;
            this.config.continueSession = originalContinue;
            
            return; // リトライ成功
          } catch (retryError) {
            // 設定を戻す
            this.config.sessionId = originalSessionId;
            this.config.continueSession = originalContinue;
            
            // リトライも失敗した場合は元のエラー処理を続行
            console.error(`[${this.name}] Stream retry failed:`, retryError);
            // 元のエラーを投げる
          }
        }
      }

      // 既存 query() と同等のヒント付きエラー
      const permissionMode =
        this.config.claudePermissionMode ?? "auto";
      let cwd = "";
      try {
        cwd = Deno.cwd();
      } catch {
        cwd = "unknown";
      }
      let firstPath = "";
      try {
        const p = Deno.env.get("PATH") ?? "";
        firstPath = p.split(":")[0] ?? "";
      } catch {
        firstPath = "unknown";
      }

      const rawMsg = error instanceof Error ? error.message : String(error);
      const rateLimited = /429|rate[ -]?limit|too many requests/i.test(rawMsg);
      
      // Process exit code 詳細ログ (stream)
      if (rawMsg.includes("exited with code")) {
        const exitCodeMatch = rawMsg.match(/exited with code (\d+)/);
        const exitCode = exitCodeMatch ? exitCodeMatch[1] : "unknown";
        console.error(`[${this.name}] Claude Code process exited with code ${exitCode} (stream)`);
        console.error(`[${this.name}] Full error: ${rawMsg}`);
        console.error(`[${this.name}] Prompt length: ${actualPrompt.length} characters`);
        console.error(`[${this.name}] Options:`, JSON.stringify(options, null, 2));
        
        // Extract stderr if available
        const stderrMatch = rawMsg.match(/stderr: (.+)/);
        if (stderrMatch) {
          console.error(`[${this.name}] Process stderr: ${stderrMatch[1]}`);
        }
      }
      
      let cliPresence = "unknown";
      if (this.shouldRunPreflight(rawMsg) && !this.preflightChecked) {
        this.preflightChecked = true;
        try {
          cliPresence = await this.checkClaudeCliPresence();
        } catch {
          cliPresence = "not_found_or_failed";
        }
      }
      const hint = `\nhint: permissionMode=${permissionMode}, cwd=${cwd}, PATH[0]=${firstPath}, cli=${cliPresence}, rate_limited=${rateLimited}`;

      if (error instanceof Error) {
        throw new Error(
          `ClaudeCodeAdapter.queryStream: ${error.message}${hint}`
        );
      }
      throw new Error(`ClaudeCodeAdapter.queryStream: Unknown error${hint}`);
    }
  }

  // Internal utilities
  private shouldRunPreflight(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes("exited with code 1") ||
      m.includes("exited with code") ||
      m.includes("spawn") ||
      m.includes("enoent") ||
      m.includes("not found") ||
      m.includes("eacces")
    );
  }

  private async checkClaudeCliPresence(): Promise<string> {
    try {
      const cmd = new Deno.Command("claude", {
        args: ["--version"],
        stdout: "piped",
        stderr: "piped",
      });
      const { success, stdout } = await cmd.output();
      if (success) {
        const v = new TextDecoder().decode(stdout).trim();
        console.debug(`[${this.name}] claude --version: ${v}`);
        return v || "present";
      }
      return "not_found_or_failed";
    } catch {
      // Permission denied or command not found, etc.
      return "not_found_or_failed";
    }
  }

  // Reset session
  resetSession(): void {
    this.isFirstQuery = true;
    this.currentSessionId = undefined;
    console.log(`[${this.name}] Session reset`);
  }

  // Get current session ID
  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }

  // Abort query
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      console.log(`[${this.name}] Query aborted`);
    }
  }

  // Adapter state
  isReady(): boolean {
    return true; // Claude Code uses internal authentication
  }

  hasActiveSession(): boolean {
    return !!this.currentSessionId;
  }
}
