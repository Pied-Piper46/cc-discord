#!/usr/bin/env -S deno run -A --env

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import {
  SessionHistoryManager,
  type ConversationMessage,
  type SessionInfo,
} from "../utils/session-history.ts";

// テスト用のモックセッションデータ
const mockSessionData = {
  sessionId: "test-session-123",
  timestamp: "2025-08-15T10:00:00.000Z",
  title: "Test Session",
};

const mockConversationLines = [
  JSON.stringify({
    sessionId: "test-session-123",
    timestamp: "2025-08-15T10:00:00.000Z",
    title: "Test Session",
    type: "system",
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2025-08-15T10:01:00.000Z",
    message: {
      content: "Hello, Claude! Can you help me with TypeScript?",
    },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2025-08-15T10:01:30.000Z",
    message: {
      content: "Of course! I'd be happy to help you with TypeScript.",
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2025-08-15T10:02:00.000Z",
    message: {
      content: [
        { type: "text", text: "How do I define an interface?" },
      ],
    },
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2025-08-15T10:02:30.000Z",
    message: {
      content: [
        { type: "text", text: "You can define an interface using the `interface` keyword." },
        { type: "tool_use", id: "tool1", name: "example" },
      ],
    },
  }),
];

// テスト用の一時ディレクトリとファイルを作成
async function setupTestEnvironment(): Promise<{
  tempDir: string;
  sessionFile: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir();
  const projectDir = join(tempDir, ".claude", "projects", "-test-project");
  await Deno.mkdir(projectDir, { recursive: true });
  
  const sessionFile = join(projectDir, `${mockSessionData.sessionId}.jsonl`);
  await Deno.writeTextFile(sessionFile, mockConversationLines.join("\n"));
  
  // 追加のセッションファイル（古いセッション）
  const olderSessionData = {
    sessionId: "older-session-456",
    timestamp: "2025-08-14T10:00:00.000Z",
  };
  const olderSessionFile = join(projectDir, `${olderSessionData.sessionId}.jsonl`);
  await Deno.writeTextFile(
    olderSessionFile,
    JSON.stringify(olderSessionData) + "\n" +
    JSON.stringify({
      type: "user",
      timestamp: "2025-08-14T10:01:00.000Z",
      message: { content: "This is an older session" },
    })
  );
  
  return {
    tempDir,
    sessionFile,
    cleanup: async () => {
      await Deno.remove(tempDir, { recursive: true });
    },
  };
}

// カスタムSessionHistoryManagerクラス（テスト用）
class TestSessionHistoryManager extends SessionHistoryManager {
  constructor(private testProjectPath: string) {
    super();
    // projectPathをオーバーライド
    (this as any).projectPath = testProjectPath;
  }
}

Deno.test("SessionHistoryManager: セッション一覧を取得できる", async () => {
  const { tempDir, cleanup } = await setupTestEnvironment();
  
  try {
    const projectPath = join(tempDir, ".claude", "projects", "-test-project");
    const manager = new TestSessionHistoryManager(projectPath);
    
    const sessions = await manager.getSessionList();
    
    // セッションが2つ取得できることを確認
    assertEquals(sessions.length, 2);
    
    // 新しいセッションが最初に来ることを確認（タイムスタンプ順）
    assertEquals(sessions[0].sessionId, "test-session-123");
    assertEquals(sessions[0].title, "Test Session");
    assertEquals(sessions[0].timestamp, "2025-08-15T10:00:00.000Z");
    
    // 最後のクエリが含まれることを確認
    assertExists(sessions[0].lastQuery);
    assertEquals(sessions[0].lastQuery, "How do I define an interface?");
    
    // 古いセッションが2番目に来ることを確認
    assertEquals(sessions[1].sessionId, "older-session-456");
    assertEquals(sessions[1].timestamp, "2025-08-14T10:00:00.000Z");
  } finally {
    await cleanup();
  }
});

Deno.test("SessionHistoryManager: 会話履歴を取得できる", async () => {
  const { tempDir, cleanup } = await setupTestEnvironment();
  
  try {
    const projectPath = join(tempDir, ".claude", "projects", "-test-project");
    const manager = new TestSessionHistoryManager(projectPath);
    
    const messages = await manager.getConversationHistory("test-session-123", 5);
    
    // 4つのメッセージが取得できることを確認（system以外）
    assertEquals(messages.length, 4);
    
    // 最初のユーザーメッセージ
    assertEquals(messages[0].type, "user");
    assertEquals(messages[0].content, "Hello, Claude! Can you help me with TypeScript?");
    assertExists(messages[0].timestamp);
    
    // アシスタントの応答
    assertEquals(messages[1].type, "assistant");
    assertEquals(messages[1].content, "Of course! I'd be happy to help you with TypeScript.");
    
    // 2番目のユーザーメッセージ（配列形式）
    assertEquals(messages[2].type, "user");
    assertEquals(messages[2].content, "How do I define an interface?");
    
    // アシスタントの応答（ツール使用を含む）
    assertEquals(messages[3].type, "assistant");
    assertEquals(
      messages[3].content,
      "You can define an interface using the `interface` keyword. [ツール使用]"
    );
  } finally {
    await cleanup();
  }
});

Deno.test("SessionHistoryManager: 存在しないセッションの履歴は空配列を返す", async () => {
  const { tempDir, cleanup } = await setupTestEnvironment();
  
  try {
    const projectPath = join(tempDir, ".claude", "projects", "-test-project");
    const manager = new TestSessionHistoryManager(projectPath);
    
    const messages = await manager.getConversationHistory("non-existent-session", 10);
    
    // 空配列が返ることを確認
    assertEquals(messages.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("SessionHistoryManager: 会話履歴をDiscord形式にフォーマットできる", async () => {
  const messages: ConversationMessage[] = [
    {
      type: "user",
      content: "Hello!",
      timestamp: "2025-08-15T10:00:00.000Z",
    },
    {
      type: "assistant",
      content: "Hi there! How can I help you?",
      timestamp: "2025-08-15T10:00:30.000Z",
    },
  ];
  
  const manager = new TestSessionHistoryManager("/dummy/path");
  const formatted = manager.formatConversationHistoryForDiscord(messages);
  
  // ヘッダーが含まれることを確認
  assertExists(formatted.includes("## 📋 直近の会話履歴"));
  
  // ユーザーメッセージが含まれることを確認
  assertExists(formatted.includes("👤 **User**"));
  assertExists(formatted.includes("> Hello!"));
  
  // アシスタントメッセージが含まれることを確認
  assertExists(formatted.includes("🤖 **Claude**"));
  assertExists(formatted.includes("> Hi there! How can I help you?"));
  
  // 区切り線が含まれることを確認
  assertExists(formatted.includes("---"));
});

Deno.test("SessionHistoryManager: 最新のセッションIDを取得できる", async () => {
  const { tempDir, cleanup } = await setupTestEnvironment();
  
  try {
    const projectPath = join(tempDir, ".claude", "projects", "-test-project");
    const manager = new TestSessionHistoryManager(projectPath);
    
    const latestSessionId = await manager.getLatestSessionId();
    
    // 最新のセッションIDが取得できることを確認
    assertEquals(latestSessionId, "test-session-123");
  } finally {
    await cleanup();
  }
});

Deno.test("SessionHistoryManager: セッションがない場合はnullを返す", async () => {
  const tempDir = await Deno.makeTempDir();
  const emptyProjectPath = join(tempDir, ".claude", "projects", "-empty-project");
  await Deno.mkdir(emptyProjectPath, { recursive: true });
  
  try {
    const manager = new TestSessionHistoryManager(emptyProjectPath);
    
    const sessions = await manager.getSessionList();
    assertEquals(sessions.length, 0);
    
    const latestSessionId = await manager.getLatestSessionId();
    assertEquals(latestSessionId, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionHistoryManager: 制限数より多い履歴がある場合は最新のものだけ取得", async () => {
  const tempDir = await Deno.makeTempDir();
  const projectPath = join(tempDir, ".claude", "projects", "-test-project");
  await Deno.mkdir(projectPath, { recursive: true });
  
  // 多数のメッセージを含むセッションファイルを作成
  const manyMessages: string[] = [
    JSON.stringify({
      sessionId: "many-messages-session",
      timestamp: "2025-08-15T10:00:00.000Z",
      type: "system",
    }),
  ];
  
  for (let i = 0; i < 20; i++) {
    manyMessages.push(
      JSON.stringify({
        type: i % 2 === 0 ? "user" : "assistant",
        timestamp: `2025-08-15T10:${String(i).padStart(2, "0")}:00.000Z`,
        message: {
          content: `Message ${i}`,
        },
      })
    );
  }
  
  const sessionFile = join(projectPath, "many-messages-session.jsonl");
  await Deno.writeTextFile(sessionFile, manyMessages.join("\n"));
  
  try {
    const manager = new TestSessionHistoryManager(projectPath);
    
    // 5件だけ取得
    const messages = await manager.getConversationHistory("many-messages-session", 5);
    
    // 5件取得できることを確認
    assertEquals(messages.length, 5);
    
    // 最新のメッセージが含まれることを確認
    assertEquals(messages[4].content, "Message 19");
    assertEquals(messages[3].content, "Message 18");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionHistoryManager: 不正なJSONがある場合はスキップして処理を続行", async () => {
  const tempDir = await Deno.makeTempDir();
  const projectPath = join(tempDir, ".claude", "projects", "-test-project");
  await Deno.mkdir(projectPath, { recursive: true });
  
  // 不正なJSONを含むセッションファイルを作成
  const mixedContent = [
    JSON.stringify({
      sessionId: "mixed-session",
      timestamp: "2025-08-15T10:00:00.000Z",
      type: "system",
    }),
    "INVALID JSON LINE",
    JSON.stringify({
      type: "user",
      timestamp: "2025-08-15T10:01:00.000Z",
      message: {
        content: "Valid message",
      },
    }),
    "{ broken json",
    JSON.stringify({
      type: "assistant",
      timestamp: "2025-08-15T10:02:00.000Z",
      message: {
        content: "Valid response",
      },
    }),
  ];
  
  const sessionFile = join(projectPath, "mixed-session.jsonl");
  await Deno.writeTextFile(sessionFile, mixedContent.join("\n"));
  
  try {
    const manager = new TestSessionHistoryManager(projectPath);
    
    // セッション一覧を取得（エラーにならないことを確認）
    const sessions = await manager.getSessionList();
    assertEquals(sessions.length, 1);
    assertEquals(sessions[0].sessionId, "mixed-session");
    
    // 会話履歴を取得（有効なメッセージのみ取得されることを確認）
    const messages = await manager.getConversationHistory("mixed-session", 10);
    assertEquals(messages.length, 2);
    assertEquals(messages[0].content, "Valid message");
    assertEquals(messages[1].content, "Valid response");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});