# cc-discord アーキテクチャ詳細

## 目次
- [アーキテクチャ概要](#アーキテクチャ概要)
- [Actorモデルの実装](#actorモデルの実装)
- [MessageBusシステム](#messagebusシステム)
- [Adapterパターン](#adapterパターン)
- [型システム設計](#型システム設計)
- [非同期処理とストリーミング](#非同期処理とストリーミング)
- [エラーハンドリング戦略](#エラーハンドリング戦略)
- [拡張性の考慮](#拡張性の考慮)

## アーキテクチャ概要

cc-discordは **Actorモデル** を中核とした **イベントドリブンアーキテクチャ** で設計されています。この設計により、高い拡張性、保守性、そして障害耐性を実現しています。

### 全体アーキテクチャ図

```
┌─────────────────────────────────────────────────────────┐
│                   cc-discord Application                │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Discord   │  │    User     │  │   ClaudeCode    │  │
│  │   Adapter   │  │   Actor     │  │     Actor       │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│           │              │                    │         │
│           └──────────────┼────────────────────┘         │
│                          │                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              MessageBus (核となる通信基盤)            │ │
│  └─────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Discord   │  │   Claude    │  │   Gemini CLI    │  │
│  │   Adapter   │  │    Code     │  │    Adapter      │  │
│  │             │  │   Adapter   │  │  (Optional)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│             External Services & APIs                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  Discord    │  │   Claude    │  │   File System   │  │
│  │   API       │  │    Code     │  │   Operations    │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Actorモデルの実装

### Actor基底クラス

```typescript
// src/actors/base.ts
export abstract class BaseActor implements Actor {
  constructor(public name: string) {}
  
  async start(): Promise<void> { /* 初期化処理 */ }
  async stop(): Promise<void> { /* 終了処理 */ }
  
  // 各Actorが実装すべきメッセージ処理
  abstract handleMessage(message: ActorMessage): Promise<ActorResponse | null>;
}
```

### 各Actor の役割

#### 1. UserActor (`src/actors/user-actor.ts`)
**責務**: ユーザー入力の前処理とルーティング判断
```typescript
// 処理フロー:
// 1. Discord からのメッセージを受信
// 2. コマンド判定 (!reset, !stop, shell commands)
// 3. 適切なターゲットActorを決定 (assistant, auto-responder)
// 4. メッセージを転送

private determineTargetActor(text: string): string {
  if (text.toLowerCase().includes("debug")) return "debug";
  if (text.toLowerCase().includes("task")) return "auto-responder";
  return "assistant"; // Claude Code がデフォルト
}
```

#### 2. ClaudeCodeActor (`src/actors/claude-code-actor.ts`)
**責務**: Claude Code APIとの通信・ストリーミング処理
```typescript
// 処理フロー:
// 1. ユーザーメッセージを Claude Code SDK に送信
// 2. ストリーミング応答をリアルタイムで MessageBus に配信
// 3. ツール実行結果の整形・配信
// 4. セッション状態の管理

async handleMessage(message: ActorMessage): Promise<ActorResponse | null> {
  const response = await this.adapter.query(text, async (chunk) => {
    // ストリーミング応答を MessageBus 経由で Discord に配信
    await this.bus!.emit({
      type: "stream-chunk",
      payload: { text: chunk.content, channelId }
    });
  });
}
```

#### 3. AutoResponderActor (`src/actors/auto-responder-actor.ts`)
**責務**: 定型応答・簡易タスク処理
```typescript
// task, todo キーワードを含むメッセージの自動応答
// Claude Code を使わない軽量な応答処理
```

### Actor の生成・登録

```typescript
// src/main.ts での Actor システム初期化
const bus = new SimpleMessageBus();

const userActor = new UserActor();
const autoResponderActor = new AutoResponderActor();
const assistantActor = config.useGemini 
  ? new GeminiCliActor(config, "assistant")
  : new ClaudeCodeActor(config, "assistant");

// MessageBus に登録
bus.register(userActor);
bus.register(autoResponderActor);
bus.register(assistantActor);

await bus.startAll(); // 全Actor の start() を実行
```

## MessageBusシステム

### 設計思想
**MessageBus**は Actor 間の疎結合な通信を実現する中央集権的なメッセージルーター です。

```typescript
// src/message-bus.ts
export class SimpleMessageBus implements MessageBus {
  private actors: Map<string, Actor> = new Map();
  private listeners: Set<(message: ActorMessage) => void> = new Set();

  // Point-to-Point メッセージング
  async send(message: ActorMessage): Promise<ActorResponse | null> {
    const targetActor = this.actors.get(message.to);
    return await targetActor.handleMessage(message);
  }

  // broadcast メッセージング
  async broadcast(message: ActorMessage): Promise<ActorResponse[]> {
    const responses = [];
    for (const [name, actor] of this.actors) {
      if (name !== message.from) { // 送信者以外に配信
        const response = await actor.handleMessage({...message, to: name});
        if (response) responses.push(response);
      }
    }
    return responses;
  }

  // ストリーミング用リスナー (Observable パターン)
  async emit(message: ActorMessage): Promise<void> {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}
```

### メッセージ配信パターン

#### 1. Point-to-Point (send)
```
Discord → User → Claude Code
特定のActorへの直接配信
```

#### 2. Broadcast
```
System → All Actors (例: shutdown signal)
全Actorへの一斉配信
```

#### 3. Pub/Sub (emit/listeners)
```
Claude Code → Stream Events → Discord
リアルタイムストリーミング用
```

## Adapterパターン

### 設計目的
外部サービス（Discord、Claude Code、Gemini）との通信を抽象化し、内部ロジックから分離します。

### Discord Adapter

```typescript
// src/adapter/discord-adapter.ts
export class DiscordAdapter implements Adapter {
  private client: Client; // Discord.js クライアント
  private messageBus: MessageBus;
  private currentThread: ThreadChannel | null;

  // Discord イベントを ActorMessage に変換
  private async handleMessage(message: Message): Promise<void> {
    // フィルタリング (bot除外、スレッド限定、ユーザー認証)
    if (message.author.bot) return;
    if (!this.isUserAllowed(message.author.id)) return;

    // Discord Message → ActorMessage 変換
    const actorMessage: ActorMessage = {
      id: message.id,
      from: "discord",
      to: "user",
      type: "discord-message",
      payload: { text: message.content, authorId: message.author.id },
      timestamp: new Date()
    };

    // MessageBus に送信
    await this.messageBus.send(actorMessage);
  }
}
```

### Claude Code Adapter

```typescript
// src/adapter/claude-code-adapter.ts  
export class ClaudeCodeAdapter implements Adapter {
  private client: ClaudeClient;
  
  async query(prompt: string, onProgress?: (chunk) => Promise<void>): Promise<string> {
    const response = this.client.query({ prompt, options });
    
    // ストリーミング処理
    for await (const chunk of response) {
      if (onProgress && chunk.type === "assistant") {
        await onProgress(chunk); // リアルタイム配信
      }
      // セッション管理、エラーハンドリング等
    }
  }
}
```

## 型システム設計

### 中核となるメッセージ型

```typescript
// src/types.ts
export interface ActorMessage {
  id: string;
  from: string;        // 送信者Actor名
  to: string;          // 宛先Actor名  
  type: string;        // メッセージタイプ
  payload: unknown;    // ペイロード (型安全性は実行時に検証)
  timestamp: Date;
}

export interface ActorResponse extends ActorMessage {
  // Response は Message を継承 (一貫した型システム)
}
```

### 型安全なペイロード設計

```typescript
// Discord メッセージの型定義
interface DiscordMessagePayload {
  text: string;
  authorId: string;
  channelId: string;
}

// Claude 応答の型定義
interface ClaudeResponsePayload {
  text: string;
  sessionId?: string;
  toolResults?: ToolResult[];
}

// ストリーミングチャンクの型定義
interface StreamChunkPayload {
  text: string;
  type: "assistant" | "tool" | "system";
  originalMessageId: string;
  channelId: string;
}
```

## 非同期処理とストリーミング

### ストリーミングアーキテクチャ

```
Claude Code SDK → ClaudeCodeActor → MessageBus → DiscordAdapter → Discord UI
     (chunks)        (emit)          (listeners)    (progressive)   (realtime)
```

### 実装詳細

```typescript
// ClaudeCodeActor でのストリーミング処理
const response = await this.adapter.query(text, async (chunk) => {
  // 各チャンクを即座に配信
  await this.bus!.emit({
    id: crypto.randomUUID(),
    from: this.name,
    to: "discord",
    type: "stream-chunk",
    payload: {
      text: chunk.content,
      originalMessageId,
      channelId
    },
    timestamp: new Date()
  });
});

// DiscordAdapter でのストリーミング受信
private busListener = (msg: ActorMessage) => {
  if (msg.type === "stream-chunk") {
    this.handleStreamEvent(msg); // Discord への段階的投稿
  }
};
```

### バッファリング戦略

```typescript
// 高頻度更新を制御するためのバッファリング
private streamStates: Map<string, {
  buffer: string;
  timer?: number;
  mode: "edit" | "append";
}> = new Map();

private handleStreamEvent(message: ActorMessage): void {
  const state = this.streamStates.get(messageId) || { buffer: "", mode: "append" };
  state.buffer += chunk.text;

  // 1秒間隔での更新制御
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    this.sendToDiscord(state.buffer); // 実際のDiscord投稿
  }, 1000);
}
```

## エラーハンドリング戦略

### 階層的エラー処理

```typescript
try {
  const response = await this.adapter.query(text);
  return this.createResponse(/* success */);
} catch (error) {
  // セッション期限切れの自動リカバリ
  if (error.message.includes("session not found")) {
    console.log("Session expired, resetting and retrying...");
    this.resetSession();
    return this.query(text, onProgress, true); // リトライ
  }
  
  // その他のエラー
  console.error(`Claude Code error:`, error);
  return this.createResponse("error", { error: error.message });
}
```

### 障害隔離

```typescript
// Actor レベルでの障害隔離
async handleMessage(message: ActorMessage): Promise<ActorResponse | null> {
  try {
    return await this.processMessage(message);
  } catch (error) {
    // このActor の障害が他に波及しないように隔離
    console.error(`[${this.name}] Error:`, error);
    return this.createErrorResponse(error);
  }
}
```

## 拡張性の考慮

### 新しいActor の追加
```typescript
// 新しいActor (例: SlackAdapter) を追加
export class SlackActor implements Actor {
  name = "slack";
  
  async handleMessage(message: ActorMessage): Promise<ActorResponse | null> {
    // Slack 固有の処理
    return this.createResponse(/*...*/);
  }
}

// main.ts での登録
bus.register(new SlackActor());
```

### 新しいAI統合
```typescript  
// 新しいAIアダプター (例: OpenAI) を追加
export class OpenAIAdapter implements Adapter {
  async query(prompt: string): Promise<string> {
    // OpenAI API 呼び出し
  }
}

export class OpenAIActor extends BaseActor {
  constructor(private adapter: OpenAIAdapter) {
    super("openai");
  }
  // handleMessage 実装
}
```

### 設定による動的切り替え
```typescript
// config.ts での AI 選択
let assistantActor: Actor;
if (config.useOpenAI) {
  assistantActor = new OpenAIActor(new OpenAIAdapter(config));
} else if (config.useGemini) {
  assistantActor = new GeminiCliActor(config);  
} else {
  assistantActor = new ClaudeCodeActor(config); // デフォルト
}
```

## パフォーマンス考慮

### メモリ管理
- ストリーミング用バッファの適切なクリーンアップ
- 完了したセッション状態の削除
- 大きなファイル操作時のチャンク処理

### 並行性
- 全ての I/O 操作は非同期
- Actor 間のメッセージ処理は並列実行可能  
- Discord API のレート制限考慮

この設計により、cc-discord は高い拡張性と保守性を持ちながら、リアルタイムな AI 対話体験を提供しています。

---

最終更新: 2024年8月