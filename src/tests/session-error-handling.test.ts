#!/usr/bin/env -S deno run -A --env

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  ClaudeCodeAdapter,
  type ClaudeClient,
} from "../adapter/claude-code-adapter.ts";
import type { Config } from "../config.ts";

// テスト用のモック設定を作成
function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    discordToken: "DUMMY",
    channelId: "CHANNEL",
    userId: "USER",
    neverSleep: false,
    sessionId: overrides.sessionId,
    continueSession: overrides.continueSession,
    maxTurns: overrides.maxTurns ?? 3,
    model: overrides.model ?? "test-model",
    claudePermissionMode: overrides.claudePermissionMode ?? "bypassPermissions",
  };
}

// セッションエラーをシミュレートするモッククライアント
class SessionErrorClient implements ClaudeClient {
  private callCount = 0;
  private sessionId?: string;
  
  query({ prompt, options }: { prompt: string; options: any; abortController?: AbortController }) {
    this.callCount++;
    
    // 最初の呼び出しではセッションエラーを発生させる
    if (this.callCount === 1 && (options.resume || options.continue)) {
      throw new Error("No conversation found with session ID: test-session-id");
    }
    
    // 2回目の呼び出しでは正常に動作
    const generator = async function* () {
      // 新しいセッションを開始
      const newSessionId = "new-session-" + crypto.randomUUID();
      yield {
        type: "system",
        subtype: "init",
        session_id: newSessionId,
      };
      
      // レスポンスを返す
      yield {
        type: "assistant",
        message: {
          content: "Hello! This is a new session.",
        },
      };
      
      // 結果
      yield {
        type: "result",
        session_id: newSessionId,
      };
    };
    
    return generator();
  }
  
  getCallCount(): number {
    return this.callCount;
  }
}

Deno.test("ClaudeCodeAdapter: セッションが見つからないエラーで自動リセット（resume）", async () => {
  const config = createTestConfig({ sessionId: "non-existent-session" });
  const mockClient = new SessionErrorClient();
  const adapter = new ClaudeCodeAdapter(config, mockClient);
  
  // 最初のクエリでエラーが発生し、自動的にリトライされる
  const response = await adapter.query("Hello!");
  
  // レスポンスが正常に返されることを確認
  assertEquals(response, "Hello! This is a new session.");
  
  // クライアントが2回呼び出されたことを確認（エラー後にリトライ）
  assertEquals(mockClient.getCallCount(), 2);
  
  // セッションがリセットされ、新しいセッションIDが設定されていることを確認
  const newSessionId = adapter.getCurrentSessionId();
  assertExists(newSessionId);
  assertEquals(newSessionId?.startsWith("new-session-"), true);
});

Deno.test("ClaudeCodeAdapter: セッションが見つからないエラーで自動リセット（continue）", async () => {
  const config = createTestConfig({ continueSession: true });
  const mockClient = new SessionErrorClient();
  const adapter = new ClaudeCodeAdapter(config, mockClient);
  
  // 最初のクエリでエラーが発生し、自動的にリトライされる
  const response = await adapter.query("Hello!");
  
  // レスポンスが正常に返されることを確認
  assertEquals(response, "Hello! This is a new session.");
  
  // クライアントが2回呼び出されたことを確認（エラー後にリトライ）
  assertEquals(mockClient.getCallCount(), 2);
  
  // 新しいセッションが開始されていることを確認
  const newSessionId = adapter.getCurrentSessionId();
  assertExists(newSessionId);
  assertEquals(newSessionId?.startsWith("new-session-"), true);
});

// ストリーミングAPIでのセッションエラーテスト
Deno.test("ClaudeCodeAdapter: ストリーミングでセッションエラー時に自動リセット", async () => {
  const config = createTestConfig({ sessionId: "non-existent-session" });
  const mockClient = new SessionErrorClient();
  const adapter = new ClaudeCodeAdapter(config, mockClient);
  
  // ストリーミングでクエリを実行
  const chunks: string[] = [];
  for await (const chunk of adapter.queryStream("Hello!")) {
    if (chunk.type === "text") {
      chunks.push(chunk.content);
    } else if (chunk.type === "system") {
      // 新しいセッションが開始されたことを確認
      assertExists(chunk.content.includes("session:new-session-"));
    }
  }
  
  // テキストが正しく取得できたことを確認
  assertEquals(chunks.join(""), "Hello! This is a new session.");
  
  // クライアントが2回呼び出されたことを確認
  assertEquals(mockClient.getCallCount(), 2);
});

// 通常のエラー（セッションエラー以外）では再試行しないことを確認
Deno.test("ClaudeCodeAdapter: セッションエラー以外では再試行しない", async () => {
  const config = createTestConfig({ sessionId: "some-session" });
  
  // 別のエラーを投げるモッククライアント
  const errorClient: ClaudeClient = {
    query: () => {
      throw new Error("Network error: Connection refused");
    },
  };
  
  const adapter = new ClaudeCodeAdapter(config, errorClient);
  
  try {
    await adapter.query("Hello!");
    throw new Error("Should have thrown an error");
  } catch (error) {
    // エラーメッセージにセッション関連ではないエラーが含まれることを確認
    assertExists(error instanceof Error);
    if (error instanceof Error) {
      assertExists(error.message.includes("Network error") || error.message.includes("ClaudeCodeAdapter"));
    }
  }
});

// リトライも失敗した場合のテスト
class AlwaysFailingClient implements ClaudeClient {
  query(): AsyncIterable<any> {
    // 常にセッションエラーを投げる
    throw new Error("No conversation found with session ID: any-session");
  }
}

Deno.test("ClaudeCodeAdapter: リトライも失敗した場合はエラーを投げる", async () => {
  const config = createTestConfig({ sessionId: "test-session" });
  const failingClient = new AlwaysFailingClient();
  const adapter = new ClaudeCodeAdapter(config, failingClient);
  
  try {
    await adapter.query("Hello!");
    throw new Error("Should have thrown an error");
  } catch (error) {
    // エラーが正しく投げられることを確認
    assertExists(error instanceof Error);
    if (error instanceof Error) {
      assertExists(error.message.includes("ClaudeCodeAdapter"));
    }
  }
});