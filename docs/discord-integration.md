# Discord統合技術詳細

## 目次
- [Discord統合概要](#discord統合概要)
- [Discord.jsライブラリ](#discordjsライブラリ)
- [WebSocket通信の仕組み](#websocket通信の仕組み)
- [スレッド管理](#スレッド管理)
- [メッセージ処理フロー](#メッセージ処理フロー)
- [権限・セキュリティ](#権限セキュリティ)
- [ストリーミング応答](#ストリーミング応答)
- [エラーハンドリング](#エラーハンドリング)

## Discord統合概要

cc-discordは **Discord.js** ライブラリを使用してDiscord APIと統合し、WebSocketベースのリアルタイム通信でユーザーとAIの対話を実現しています。

### 統合アーキテクチャ

```
┌─────────────────┐  WebSocket   ┌──────────────────┐  ActorMessage  ┌─────────────────┐
│   Discord UI    │ ◄─────────► │  DiscordAdapter  │ ◄────────────► │   MessageBus    │
│   (User Input)  │              │   (discord.js)   │                │  (Core System)  │
└─────────────────┘              └──────────────────┘                └─────────────────┘
```

### 主要機能
- **リアルタイムメッセージ処理**: WebSocketによる即座の反応
- **自動スレッド管理**: セッション毎の専用スレッド作成
- **ストリーミング応答**: AI応答の段階的表示
- **権限管理**: 特定ユーザーのみアクセス許可

## Discord.jsライブラリ

### 基本セットアップ

```typescript
// src/adapter/discord-adapter.ts
import { Client, GatewayIntentBits, Message, TextChannel, ThreadChannel } from "discord.js";

export class DiscordAdapter implements Adapter {
  private client: Client;

  constructor(config: Config, messageBus: MessageBus) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,           // サーバー情報
        GatewayIntentBits.GuildMessages,    // メッセージ読み取り  
        GatewayIntentBits.MessageContent,   // メッセージ内容アクセス (特権)
      ],
    });
    
    this.setupEventHandlers();
  }
}
```

### 必要な権限設定

#### GatewayIntentBits の意味
```typescript
GatewayIntentBits.Guilds          // サーバー作成・削除、チャンネル変更等
GatewayIntentBits.GuildMessages   // メッセージ作成・削除イベント
GatewayIntentBits.MessageContent  // メッセージ内容へのアクセス (要特権設定)
```

#### Discord Developer Portal での設定
1. **Message Content Intent**: 有効化必須（特権Intent）
2. **Bot Permissions**: 
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads  
   - Read Message History

## WebSocket通信の仕組み

### HTTP vs WebSocket の比較

```
【HTTPの場合 (非効率)】
Client: "新しいメッセージある？" → Server: "ないよ"
Client: "新しいメッセージある？" → Server: "ないよ"  
Client: "新しいメッセージある？" → Server: "あるよ！"
↑ 1秒間隔のポーリング、無駄な通信大量発生

【WebSocketの場合 (効率的)】  
Client ⟷ Server (常時接続維持)
Server: "新しいメッセージだよ！" → Client (即座にプッシュ)
```

### Discord.js でのWebSocket活用

```typescript
private setupEventHandlers(): void {
  // Discord Gateway (WebSocket) からのイベント受信
  this.client.once("ready", () => this.handleReady());           // 接続完了
  this.client.on("messageCreate", (msg) => this.handleMessage(msg));   // 新規メッセージ
  this.client.on("messageUpdate", (old, new) => this.handleEdit(old, new)); // 編集
  this.client.on("error", (error) => this.handleError(error));         // エラー
}
```

### WebSocketの利点
1. **レスポンス性**: ユーザー投稿と同時にBot反応開始
2. **効率性**: ポーリング不要、CPU・帯域節約
3. **リアルタイム性**: タイピング状況、リアクション等も即座に取得

## スレッド管理

### 自動スレッド作成

```typescript
// src/adapter/discord-adapter.ts:140-158
private async createThread(channel: TextChannel): Promise<void> {
  const threadName = `Claude Session - ${new Date().toLocaleString("ja-JP")}`;

  try {
    this.currentThread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: 1440, // 24時間で自動アーカイブ  
      reason: "Claude session thread",
    });

    // 初期メッセージ投稿 (使い方説明)
    const initialMessage = await this.createInitialMessage();
    await this.currentThread.send(initialMessage);

    console.log(`[${this.name}] Thread created: ${threadName}`);
  } catch (error) {
    console.error(`[${this.name}] Failed to create thread:`, error);
  }
}
```

### スレッドのメリット

#### 1. 会話の分離
```
#general チャンネル
├─ Thread: "Claude Session - 2024/08/27 10:30:00" 
│  ├─ User: "ファイルを作成して"
│  ├─ Bot: "どのようなファイルを..."  
│  └─ User: "README.mdを作成して"
│
└─ Thread: "Claude Session - 2024/08/27 14:20:00"
   ├─ User: "エラーを修正して"
   └─ Bot: "エラー内容を確認します..."
```

#### 2. プライバシー保護
- メインチャンネルに影響を与えない
- 他ユーザーからの干渉を防ぐ
- セッション毎の独立した環境

#### 3. 自動管理
```typescript
autoArchiveDuration: 1440  // 24時間後に自動アーカイブ
                          // → Discord UI では折りたたまれる
                          // → サーバー負荷軽減
```

## メッセージ処理フロー

### メッセージ受信から処理まで

```typescript
// 1. Discord WebSocket イベント受信
this.client.on("messageCreate", (message) => this.handleMessage(message));

// 2. フィルタリング処理  
private async handleMessage(message: Message): Promise<void> {
  // Bot メッセージを無視
  if (message.author.bot) return;

  // 現在のスレッド以外を無視
  if (!this.currentThread || message.channel.id !== this.currentThread.id) return;

  // ユーザー認証チェック
  if (!this.isUserAllowed(message.author.id)) {
    await message.reply("あなたは許可されていません。");
    return;
  }

  // 空メッセージを無視
  const content = message.content.trim();
  if (!content) return;

  // 3. ActorMessage に変換
  const actorMessage: ActorMessage = {
    id: message.id,
    from: "discord",           // DiscordAdapter が送信者
    to: "user",               // UserActor が宛先  
    type: "discord-message",
    payload: {
      text: content,
      authorId: message.author.id,
      channelId: message.channel.id,
    },
    timestamp: new Date(),
  };

  // 4. MessageBus に送信 → UserActor が処理
  const response = await this.messageBus.send(actorMessage);
  
  // 5. 応答処理 (必要に応じてDiscordに返信)
  if (response) {
    await this.handleActorResponse(message, response);
  }
}
```

### ユーザー認証

```typescript
private isUserAllowed(userId: string): boolean {
  // 複数ユーザー許可の場合
  if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
    return this.config.allowedUsers.includes(userId);
  }
  // 単一ユーザー許可の場合 (後方互換)
  return userId === this.config.userId;
}
```

## 権限・セキュリティ

### Discord Bot権限

#### 最小権限の原則
```typescript
// 必要最小限の権限のみ要求
bot_permissions: [
  "SEND_MESSAGES",           // メッセージ送信
  "CREATE_PUBLIC_THREADS",   // パブリックスレッド作成
  "SEND_MESSAGES_IN_THREADS", // スレッド内メッセージ送信
  "READ_MESSAGE_HISTORY"     // メッセージ履歴読み取り
]

// 不要な危険な権限は除外
// ❌ ADMINISTRATOR (管理者権限)
// ❌ MANAGE_CHANNELS (チャンネル管理)  
// ❌ MANAGE_GUILD (サーバー管理)
```

### アクセス制御

#### 環境変数による制御
```bash
# 単一ユーザー制限
CC_DISCORD_USER_ID=123456789012345678

# 複数ユーザー許可  
CC_DISCORD_ALLOWED_USERS=123456789012345678,987654321098765432
```

#### 実行時認証
```typescript
// 各メッセージで認証チェック
if (!this.isUserAllowed(message.author.id)) {
  // 監査ログに記録
  await this.auditLogger.logWarn("discord-adapter", "auth_failed", {
    userId: message.author.id,
    channelId: message.channel.id,
    reason: "User not in allowed list",
  });
  
  // 警告メッセージ送信
  await message.reply("認証に失敗しました。管理者に問い合わせてください。");
  return;
}
```

### プライベートサーバー推奨

#### セキュリティ上の理由
1. **アクセス制御**: サーバー管理者が参加者を完全制御
2. **データ保護**: 機密情報がパブリックサーバーに流出しない
3. **性能向上**: 他のボットや大量ユーザーの干渉なし
4. **カスタマイズ**: 自由なチャンネル・権限設定

## ストリーミング応答

### リアルタイム応答の仕組み

```typescript
// ClaudeCodeActor からのストリーミング配信
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

// DiscordAdapter でのストリーミング受信
private busListener = (msg: ActorMessage) => {
  if (msg.type === "stream-chunk") {
    this.handleStreamEvent(msg);
  }
};
```

### バッファリング戦略

```typescript
// 高頻度更新の制御 (Discord API レート制限対策)
private streamStates: Map<string, {
  buffer: string;
  toolBuffer: string;  
  timer?: number;
  thinkingMessage?: Message;
  mode: "edit" | "append";
  channelId?: string;
}> = new Map();

private handleStreamEvent(message: ActorMessage): void {
  const payload = message.payload as StreamChunkPayload;
  const messageId = payload.originalMessageId;
  
  // 既存状態を取得または初期化
  let state = this.streamStates.get(messageId);
  if (!state) {
    state = { 
      buffer: "", 
      toolBuffer: "",
      mode: "append",  // デフォルトはappendモード
      channelId: payload.channelId 
    };
    this.streamStates.set(messageId, state);
  }

  // バッファに追加
  state.buffer += payload.text;

  // 既存タイマーをクリア
  if (state.timer) {
    clearTimeout(state.timer);
  }

  // 1秒後にDiscord投稿 (レート制限対策)
  state.timer = setTimeout(async () => {
    await this.sendBufferedContent(messageId, state);
  }, 1000);
}
```

### 応答モード

#### Append Mode (デフォルト)
```
Message 1: "こんにちは。今日は..."
Message 2: "こんにちは。今日はファイルの作成について..."
Message 3: "こんにちは。今日はファイルの作成について説明します。まず..."
```

#### Edit Mode  
```
Message 1: "こんにちは。今日は..."
↓ (同じメッセージを編集)
Message 1: "こんにちは。今日はファイルの作成について..."  
↓ (さらに編集)
Message 1: "こんにちは。今日はファイルの作成について説明します。まず..."
```

## エラーハンドリング

### Discord API エラー

```typescript
try {
  await this.currentThread.send(content);
} catch (error) {
  // Discord API 固有エラーの処理
  if (error.code === 50013) { // Missing Permissions
    console.error("Bot has insufficient permissions");
  } else if (error.code === 50035) { // Invalid Form Body
    console.error("Message content is invalid");
  } else if (error.code === 429) { // Rate Limited
    console.error("Rate limited, retrying...");
    // リトライロジック
  }
  
  // 監査ログに記録
  await this.auditLogger.logError("discord-adapter", "send_failed", error.message);
}
```

### 接続エラーの回復

```typescript
// 接続断時の自動再接続
this.client.on("disconnect", () => {
  console.log("Discord connection lost, attempting to reconnect...");
});

this.client.on("reconnecting", () => {
  console.log("Reconnecting to Discord...");
});

// プロセス終了時のクリーンシャットダウン
Deno.addSignalListener("SIGINT", async () => {
  console.log("Shutting down Discord adapter...");
  
  // 現在のスレッドにお別れメッセージ
  if (this.currentThread && this.currentThread.sendable) {
    await this.currentThread.send("Botを終了します。またお会いしましょう！");
  }
  
  // ストリーミング状態のクリーンアップ  
  for (const state of this.streamStates.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  
  // Discord接続を正常終了
  this.client.destroy();
  Deno.exit(0);
});
```

### メッセージ配信失敗

```typescript
private async handleActorResponse(originalMessage: Message, response: ActorMessage): Promise<void> {
  try {
    if (response.type === "claude-response") {
      const payload = response.payload as ClaudeResponsePayload;
      await this.currentThread!.send(payload.text);
    }
  } catch (error) {
    // Discord送信失敗時の代替手段
    console.error("Failed to send response to Discord:", error);
    
    try {
      // 元メッセージにリアクションで失敗を通知
      await originalMessage.react("❌");
    } catch (reactionError) {
      console.error("Failed to add error reaction:", reactionError);
    }
  }
}
```

この包括的なDiscord統合により、cc-discordは安定したリアルタイム通信でユーザーとAIの自然な対話を実現しています。

---

最終更新: 2024年8月