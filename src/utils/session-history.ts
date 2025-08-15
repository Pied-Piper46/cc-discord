#!/usr/bin/env -S deno run -A --env

import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// 会話メッセージの型定義
export interface ConversationMessage {
  type: "user" | "assistant";
  content: string;
  timestamp?: string;
}

// セッション情報の型定義
export interface SessionInfo {
  sessionId: string;
  timestamp: string;
  lastQuery?: string;
  title?: string;
}

// セッション履歴管理クラス
export class SessionHistoryManager {
  private projectPath: string;

  constructor() {
    // Claude のプロジェクトディレクトリを構築
    const homeDir = Deno.env.get("HOME") || "";
    const currentDir = Deno.cwd().replace(/^\//, "").replace(/\//g, "-");
    this.projectPath = join(homeDir, ".claude", "projects", `-${currentDir}`);
  }

  // セッション一覧を取得
  async getSessionList(): Promise<SessionInfo[]> {
    const entries: SessionInfo[] = [];

    try {
      for await (const dirEntry of Deno.readDir(this.projectPath)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".jsonl")) {
          const filePath = join(this.projectPath, dirEntry.name);
          const sessionInfo = await this.parseSessionFile(filePath);
          if (sessionInfo) {
            entries.push(sessionInfo);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.error("[SessionHistory] Error reading sessions:", error);
      }
    }

    // タイムスタンプでソート（新しい順）
    entries.sort((a, b) => {
      if (a.timestamp === "N/A") return 1;
      if (b.timestamp === "N/A") return -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return entries;
  }

  // セッションファイルをパース
  private async parseSessionFile(filePath: string): Promise<SessionInfo | null> {
    try {
      const content = await Deno.readTextFile(filePath);
      const lines = content.trim().split("\n");
      
      if (lines.length === 0) return null;

      // 最初の行からセッション情報を取得
      const firstLine = JSON.parse(lines[0]);
      if (!firstLine.sessionId) return null;

      const sessionInfo: SessionInfo = {
        sessionId: firstLine.sessionId,
        timestamp: firstLine.timestamp || "N/A",
      };

      // タイトルを探す
      if (firstLine.title) {
        sessionInfo.title = firstLine.title;
      }

      // 最後のユーザークエリを探す（逆順で検索）
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const lineData = JSON.parse(lines[i]);
          if (lineData.type === "user" && lineData.message?.content) {
            const content = this.extractTextContent(lineData.message.content);
            if (content) {
              sessionInfo.lastQuery = content.slice(0, 50) + 
                (content.length > 50 ? "..." : "");
              break;
            }
          }
        } catch {
          // JSONパースエラーは無視
        }
      }

      return sessionInfo;
    } catch (error) {
      console.error(`[SessionHistory] Error parsing session file ${filePath}:`, error);
      return null;
    }
  }

  // 会話履歴を取得
  async getConversationHistory(
    sessionId: string,
    limit = 10
  ): Promise<ConversationMessage[]> {
    try {
      // セッションIDを含むファイルを探す
      let targetFile: string | undefined;
      
      for await (const dirEntry of Deno.readDir(this.projectPath)) {
        if (dirEntry.isFile && dirEntry.name.includes(sessionId)) {
          targetFile = join(this.projectPath, dirEntry.name);
          break;
        }
      }

      if (!targetFile) {
        console.log("[SessionHistory] Session history not found for:", sessionId);
        return [];
      }

      const content = await Deno.readTextFile(targetFile);
      const lines = content.trim().split("\n");
      const messages: ConversationMessage[] = [];

      // メッセージをパース
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          
          if (data.type === "user" && data.message?.content) {
            const content = this.extractTextContent(data.message.content);
            if (content) {
              messages.push({
                type: "user",
                content: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
                timestamp: data.timestamp,
              });
            }
          } else if (data.type === "assistant" && data.message?.content) {
            const content = this.extractAssistantContent(data.message.content);
            if (content) {
              messages.push({
                type: "assistant",
                content: content.slice(0, 100) + (content.length > 100 ? "..." : ""),
                timestamp: data.timestamp,
              });
            }
          }
        } catch {
          // JSONパースエラーは無視
        }
      }

      // 最新のメッセージを返す
      return messages.slice(-limit);
    } catch (error) {
      console.error("[SessionHistory] Error reading conversation history:", error);
      return [];
    }
  }

  // テキストコンテンツを抽出
  private extractTextContent(content: any): string {
    if (typeof content === "string") {
      return content;
    }
    
    if (Array.isArray(content)) {
      const textBlock = content.find((c: any) => c.type === "text");
      return textBlock?.text || "";
    }
    
    return "";
  }

  // アシスタントのコンテンツを抽出
  private extractAssistantContent(content: any): string {
    if (typeof content === "string") {
      return content;
    }
    
    if (Array.isArray(content)) {
      return content
        .map((c: any) => c.type === "text" ? c.text : "[ツール使用]")
        .join(" ");
    }
    
    return "";
  }

  // 会話履歴をDiscord形式にフォーマット
  formatConversationHistoryForDiscord(messages: ConversationMessage[]): string {
    if (messages.length === 0) {
      return "";
    }

    let content = "## 📋 直近の会話履歴\n\n";

    for (const msg of messages) {
      const role = msg.type === "user" ? "👤 **User**" : "🤖 **Claude**";
      const time = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString("ja-JP")
        : "";

      content += `${role} \`${time}\`\n`;
      content += `> ${msg.content.replace(/\n/g, "\n> ")}\n\n`;
    }

    content += "---\n\n";

    return content;
  }

  // 会話履歴をコンソールに表示
  showConversationHistory(messages: ConversationMessage[]): void {
    if (messages.length === 0) {
      console.log("会話履歴がありません");
      return;
    }

    console.log("\n直近の会話履歴:");
    console.log("==========================================");

    for (const msg of messages) {
      const role = msg.type === "user" ? "👤 User" : "🤖 Claude";
      const time = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString("ja-JP")
        : "";
      console.log(`\n[${time}] ${role}:`);
      console.log(msg.content);
    }

    console.log("\n==========================================");
    console.log("会話を継続します...\n");
  }

  // 最新のセッションIDを取得
  async getLatestSessionId(): Promise<string | null> {
    const sessions = await this.getSessionList();
    return sessions.length > 0 ? sessions[0].sessionId : null;
  }
}

// シングルトンインスタンスを遅延初期化
let _sessionHistory: SessionHistoryManager | null = null;

export function getSessionHistory(): SessionHistoryManager {
  if (!_sessionHistory) {
    _sessionHistory = new SessionHistoryManager();
  }
  return _sessionHistory;
}

// 後方互換性のため、プロパティとしてもエクスポート
export const sessionHistory = {
  getSessionList: () => getSessionHistory().getSessionList(),
  getConversationHistory: (sessionId: string, limit?: number) => 
    getSessionHistory().getConversationHistory(sessionId, limit),
  formatConversationHistoryForDiscord: (messages: ConversationMessage[]) =>
    getSessionHistory().formatConversationHistoryForDiscord(messages),
  showConversationHistory: (messages: ConversationMessage[]) =>
    getSessionHistory().showConversationHistory(messages),
  getLatestSessionId: () => getSessionHistory().getLatestSessionId(),
};