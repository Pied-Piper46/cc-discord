# Claude Code統合技術詳細

## 目次
- [Claude Code統合概要](#claude-code統合概要)
- [SDK vs CLI の選択理由](#sdk-vs-cliの選択理由)
- [Claude Code SDK](#claude-code-sdk)
- [認証とセッション管理](#認証とセッション管理)
- [ストリーミング処理](#ストリーミング処理)
- [エラーハンドリングと復旧](#エラーハンドリングと復旧)
- [権限管理](#権限管理)
- [パフォーマンス最適化](#パフォーマンス最適化)

## Claude Code統合概要

cc-discordは、**@anthropic-ai/claude-code** SDKを使用してClaude Codeと統合し、Discord UI から直接AI機能を利用可能にします。これにより、ファイル操作、コード生成、システム管理等の強力な機能をチャット形式で実行できます。

### 統合アーキテクチャ

```
┌─────────────────┐   ActorMessage   ┌──────────────────┐   SDK Query   ┌─────────────────┐
│ ClaudeCodeActor │ ◄──────────────► │ClaudeCodeAdapter │ ◄───────────► │ Claude Code SDK │
│ (Business Logic)│                  │ (API Wrapper)    │               │  (AI Engine)    │
└─────────────────┘                  └──────────────────┘               └─────────────────┘
         │                                      │                               │
         │ Stream Events                        │ Progress Callbacks            │ HTTP/Auth  
         ▼                                      ▼                               ▼
┌─────────────────┐                  ┌──────────────────┐               ┌─────────────────┐
│   MessageBus    │                  │ Session History  │               │ Claude Code CLI │
│  (Event Hub)    │                  │  Management      │               │  (Local Auth)   │
└─────────────────┘                  └──────────────────┘               └─────────────────┘
```

## SDK vs CLI の選択理由

### Claude Code CLI (コマンドライン版)
```bash
# 対話的な使用方法
$ claude "ファイルを作成してください"
> [Claude が応答]
> ユーザーが次の質問...
```

**制約**:
- 対話的な使用を前提とした設計
- プログラムからの制御が困難
- ストリーミング応答の取得が複雑
- セッション管理の自動化が困難

### Claude Code SDK (JavaScript/TypeScript版)
```typescript
import { query } from "@anthropic-ai/claude-code";

// プログラマブルな使用
const response = query({
  prompt: "ファイルを作成してください",
  options: { model: "claude-4", maxTurns: 300 }
});

for await (const chunk of response) {
  // リアルタイムストリーミング処理
  console.log(chunk.content);
}
```

**利点**:
- **プログラマブル**: JavaScript/TypeScriptから完全制御
- **ストリーミング対応**: リアルタイム応答取得
- **セッション管理**: 自動的な状態保持・復元
- **エラーハンドリング**: 構造化されたエラー処理
- **型安全**: TypeScript型定義による開発効率向上

## Claude Code SDK

### 基本的な使用方法

```typescript
// src/adapter/claude-code-adapter.ts
import { type Options, query as sdkQuery } from "@anthropic-ai/claude-code";

export class ClaudeCodeAdapter implements Adapter {
  private client: ClaudeClient;
  
  constructor(config: Config) {
    this.client = createClaudeClient();
    // APIキーは不要 - SDK が Claude Code CLI の認証を自動利用
  }

  async query(prompt: string, onProgress?: (chunk) => Promise<void>): Promise<string> {
    const options: Options = {
      maxTurns: this.config.maxTurns,
      model: this.config.model,
      permissionMode: this.config.claudePermissionMode,
      continue: !this.isFirstQuery,  // セッション継続
      resume: this.config.sessionId  // セッション復元
    };

    const response = this.client.query({ prompt, options });
    
    // ストリーミング処理
    for await (const chunk of response) {
      if (onProgress) {
        await onProgress(chunk); // リアルタイムコールバック
      }
      // チャンク処理ロジック
    }
  }
}
```

### DI (Dependency Injection) 設計

```typescript
// テスト可能性のための抽象化
export interface ClaudeClient {
  query(args: {
    prompt: string;
    options: Options;
    abortController?: AbortController;
  }): AsyncIterable<any>;
}

// 本番用実装
export function createClaudeClient(): ClaudeClient {
  return {
    query: ({ prompt, options }) => sdkQuery({ prompt, options })
  };
}

// テスト用モック実装
export function createMockClaudeClient(): ClaudeClient {
  return {
    async* query({ prompt }) {
      yield { type: "assistant", content: `Mock response for: ${prompt}` };
    }
  };
}
```

## 認証とセッション管理

### 認証の仕組み

```typescript
// Claude Code SDK は内部認証を使用
constructor(config: Config, client?: ClaudeClient) {
  this.client = client ?? createClaudeClient();
  // ❌ API キーは不要
  // ✅ Claude Code CLI の認証情報を自動利用
}
```

#### 事前準備が必要な理由
```bash
# ユーザーは事前にこのコマンドを実行する必要がある
claude --dangerouslySkipPermissions
```

**理由**:
- SDKが`bypassPermissions`モードでClaude Code CLIを呼び出し
- 人間の確認を求めることなくファイル操作等を実行
- Discord Bot環境では人間の介入ができないため

### セッション管理

#### セッション開始
```typescript
async query(prompt: string): Promise<string> {
  const options: Options = {
    maxTurns: this.config.maxTurns,
    model: this.config.model,
    permissionMode: this.config.claudePermissionMode,
    
    // 初回クエリかセッション継続かの判定
    ...((this.isFirstQuery && !this.config.continueSession) ? {} : { continue: true }),
    
    // セッション復元の指定
    ...(this.config.sessionId && this.isFirstQuery 
      ? { resume: this.config.sessionId } 
      : {}),
  };
  
  // SDK呼び出し後、セッションIDを保存
  for await (const message of response) {
    if (message.type === "system" && message.subtype === "init") {
      this.currentSessionId = message.session_id;
      console.log(`Session started: ${this.currentSessionId}`);
      this.isFirstQuery = false;
    }
  }
}
```

#### セッション継続戦略

```typescript
// --continue オプション: 最新セッションから自動継続
if (this.config.continueSession && this.isFirstQuery && !this.config.sessionId) {
  const latestSessionId = await sessionHistory.getLatestSessionId();
  if (latestSessionId) {
    // 会話履歴を含めてプロンプト拡張
    const messages = await sessionHistory.getConversationHistory(latestSessionId, 5);
    const historyText = messages.map(msg => 
      `[${msg.type === "user" ? "User" : "Claude"}]: ${msg.content}`
    ).join("\\n");
    
    actualPrompt = `以下は前回の会話の続きです:\\n\\n${historyText}\\n\\n---\\n\\n現在のメッセージ: ${prompt}`;
  }
}
```

## ストリーミング処理

### チャンク種別の処理

```typescript
for await (const message of response) {
  // プログレスコールバックを呼び出し
  if (onProgress) {
    await onProgress(message as ClaudeMessage);
  }

  if (message.type === "assistant") {
    // Claude からの応答テキスト
    const content = message.message.content;
    if (typeof content === "string") {
      fullResponse += content;
    } else if (Array.isArray(content)) {
      // 構造化コンテンツの処理
      for (const block of content) {
        if (block.type === "text") {
          fullResponse += block.text;
        }
      }
    }
  } else if (message.type === "system" && message.subtype === "init") {
    // セッション初期化
    this.currentSessionId = message.session_id;
  } else if (message.type === "user") {
    // ツール実行結果の処理
    const content = message.message.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === "tool_result" && typeof item.content === "string") {
          // 長すぎる結果は切り詰め
          const truncated = item.content.length > 300
            ? item.content.substring(0, 300) + "..."
            : item.content;
          toolResults += `\\n📋 Tool execution result:\\n\\`\\`\\`\\n${truncated}\\n\\`\\`\\`\\n`;
        }
      }
    }
  }
}
```

### リアルタイム配信

```typescript
// ClaudeCodeActor でのストリーミング処理
const response = await this.adapter.query(text, async (chunk) => {
  try {
    if (chunk?.type === "assistant") {
      const content = chunk.message?.content;
      let delta = "";
      
      if (typeof content === "string") {
        delta = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" && typeof block.text === "string") {
            delta += block.text;
          }
        }
      }
      
      // MessageBus 経由でリアルタイム配信
      if (delta) {
        await this.bus!.emit({
          id: crypto.randomUUID(),
          from: this.name,
          to: "discord",
          type: "stream-chunk",
          payload: {
            text: delta,
            originalMessageId,
            channelId
          },
          timestamp: new Date()
        });
      }
    }
  } catch (error) {
    console.error(`Streaming error:`, error);
  }
});
```

## エラーハンドリングと復旧

### セッション期限切れの自動復旧

```typescript
try {
  return await this.client.query({ prompt, options });
} catch (error) {
  // セッション関連エラーの検出
  if (error instanceof Error && !isRetry) {
    const errorMessage = error.message.toLowerCase();
    const isSessionNotFound = 
      errorMessage.includes("no conversation found with session id") ||
      errorMessage.includes("session not found") ||
      errorMessage.includes("invalid session") ||
      errorMessage.includes("session does not exist");
    
    if (isSessionNotFound && (this.config.sessionId || this.config.continueSession)) {
      console.log(`Session not found error detected. Resetting and retrying...`);
      
      // セッション状態をリセット
      this.currentSessionId = undefined;
      this.config.sessionId = undefined;
      this.config.continueSession = false;
      this.isFirstQuery = true;
      
      // 自動リトライ (再帰呼び出し、isRetry=true で無限ループ防止)
      return this.query(originalPrompt, onProgress, true);
    }
  }
  
  throw error; // その他のエラーは再スロー
}
```

### AbortController による中断制御

```typescript
async query(prompt: string, onProgress?: Function): Promise<string> {
  // 中断可能な処理のためのコントローラー
  this.abortController = new AbortController();

  try {
    const response = this.client.query({
      prompt,
      options,
      abortController: this.abortController
    });
    
    // ストリーミング処理...
    
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Query was aborted");
    }
    throw error;
  }
}

async stop(): Promise<void> {
  console.log(`Stopping Claude Code adapter...`);
  if (this.abortController) {
    this.abortController.abort(); // 実行中クエリを中断
  }
}
```

### プリフライトチェック

```typescript
// 初回クエリ時の事前チェック
if (!this.preflightChecked) {
  try {
    // 簡単なテストクエリでClaude Codeの動作確認
    await this.client.query({ 
      prompt: "Hello", 
      options: { maxTurns: 1 } 
    });
    this.preflightChecked = true;
  } catch (error) {
    console.error("Claude Code preflight check failed:", error);
    throw new Error("Claude Code is not accessible. Please run 'claude --dangerouslySkipPermissions' first.");
  }
}
```

## 権限管理

### Permission Mode の制御

```typescript
const options: Options = {
  maxTurns: this.config.maxTurns,
  model: this.config.model,
  permissionMode: this.config.claudePermissionMode as Options["permissionMode"], 
  // "bypassPermissions" | "ask"
};
```

#### bypassPermissions モード
```typescript
permissionMode: "bypassPermissions"
```
- ファイル操作、コマンド実行等を自動承認
- Discord Bot 環境での使用に必須
- 事前に `claude --dangerouslySkipPermissions` の実行が必要

#### ask モード (デフォルト)
```typescript
permissionMode: "ask"
```
- 危険な操作の前に人間の確認を要求
- Discord Bot 環境では使用不可（確認画面が表示できない）

### セキュリティ考慮事項

```typescript
// 環境変数でのAPI キー設定を検出・警告
if (claudeApiKey) {
  console.log("\\n" + "⚠️ ".repeat(25));
  console.log("API キーが設定されていますが、Claude Code SDKでは不要です。");
  console.log("API キーを使用すると課金が発生する可能性があります。");
  console.log("SDK は Claude Code CLI の内部認証を使用します。");
  console.log("⚠️ ".repeat(25) + "\\n");
}
```

## パフォーマンス最適化

### レスポンス文字列の最適化

```typescript
// 長すぎるツール結果の切り詰め
const truncateText = (text: string): string => {
  const lines = text.split('\\n');
  
  if (lines.length <= 35) {
    return text;
  }
  
  const headLines = 25;
  const tailLines = 10;
  const omittedLines = lines.length - headLines - tailLines;
  
  return [
    ...lines.slice(0, headLines),
    `\\n... ${omittedLines} lines omitted ...\\n`,
    ...lines.slice(-tailLines)
  ].join('\\n');
};
```

### ストリーミング効率化

```typescript
// チャンクサイズの制御
if (delta.length > this.config.streamingMaxChunkLength) {
  // 大きすぎるチャンクは分割して送信
  const chunks = delta.match(/.{1,1800}/g) || [];
  for (const chunk of chunks) {
    await this.emitStreamChunk(chunk);
    await new Promise(resolve => setTimeout(resolve, 100)); // レート制限対策
  }
} else {
  await this.emitStreamChunk(delta);
}
```

### メモリ管理

```typescript
// セッション履歴の適切な制限
async getConversationHistory(sessionId: string, limit = 5): Promise<ConversationMessage[]> {
  // 最新の数件のみ取得してメモリ使用量を制限
  return this.history.slice(-limit);
}

// 大きなレスポンスの即座解放
let fullResponse = "";
// ... 処理 ...
const result = fullResponse;
fullResponse = ""; // ガベージコレクション対象にする
return result;
```

この包括的なClaude Code統合により、cc-discordは強力なAI機能をDiscordチャット形式で安定して提供できます。

---

最終更新: 2024年8月