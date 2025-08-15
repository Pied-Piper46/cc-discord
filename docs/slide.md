# ccdiscord - discord 経由で AI バイブコーディング

発表資料

## about me

- https://x.com/mizchi
- Node.js/フロントエンドのプログラマ
- discord サーバーはゲーム仲間と 10 年ぐらい
- https://zenn.dev/mizchi/articles/discord-claude-code-interface
- https://github.com/mizchi/discord-claude-bot

## なにこれ

- What's this
  - 起動すると Discord のスレッドを作成し、そこで ClaudeCode を操作できる
  - ローカルマシンの任意ディレクトリを基準に
- Why
  - 今開発でデスクトップ機しかない
  - VPC も試したが、弱いサーバーだと満足できない

---

## 使い方

- `$ deno install -Afg jsr:@mizchi/ccdiscord`

```bash
# Discord設定
CC_DISCORD_TOKEN=your-discord-bot-token
CC_DISCORD_CHANNEL_ID=your-channel-id
CC_DISCORD_USER_ID=your-user-id
```

```bash
$ cd myapp
$ ccdiscord
# 前セッションを引き継ぐ場合
$ ccdiscord -c
```

---

## ccdiscord 仕組み

- ローカルマシンの任意ディレクトリからサーバーを起動 `ccdiscord`
- Discord Bot としてユーザーの書き込み監視して、入力を claude-code へ渡す
- claude-code の出力結果を discord へ出力
- 課金
  - 環境変数に `ANTHROPIC_API_KEY` がある場合は API 課金
  - `ANTHROPIC_API_KEY` がなく claude code (`$ claude`) でログイン済みの場合はそのトークンを使う

---

## 作り方

- https://github.com/KOBA789/human-in-the-loop のコードを読ませる
- rust 実装から discord-js 用に翻訳させる
- 一筆描きのスクリプトで最初のバージョン `_old/ccdiscord.ts` を作成
- ccdicord 自体を使って、バイブコーディング

---

ここでデモする

---

## 内部実装: discord.js

https://discord.js.org/

- 起動時にスレッドを作成
- ユーザーのメッセージを監視

---

## 内部使用: claude-code sdk が便利

node.js / python から claude code を叩ける

```ts
import { query } from "@anthropic-ai/claude-code";

for await (const message of query({
  prompt: "システムパフォーマンスを分析",
  abortController: new AbortController(),
  options: {
    maxTurns: 5,
    systemPrompt: "あなたはパフォーマンスエンジニアです",
    allowedTools: ["Bash", "Read", "WebSearch"],
  },
})) {
  if (message.type === "result") {
    console.log(message.result);
  }
}
```

---

## 内部実装: 起動時の処理フロー

```ts
// main.ts での起動シーケンス
1. Config 読み込み（環境変数 + CLI引数）
2. MessageBus 初期化
3. Actor 生成・登録
   - UserActor
   - ClaudeCodeActor / DebugActor
   - AutoResponderActor（Never Sleep時）
4. DiscordAdapter 起動
   - Bot ログイン
   - チャンネル検証
   - スレッド作成
5. セッション復元（--continue/--resume時）
```

---

## 内部実装: メッセージフロー全体像

```
[Discord]                [MessageBus]              [Actors]
   |                          |                        |
   |--ユーザー入力----------->|                        |
   |                          |--ActorMessage--------->|
   |                          |                        |
   |                          |<--stream-started-------|
   |<--メッセージ作成---------|                        |
   |                          |                        |
   |                          |<--stream-partial-------|
   |<--リアルタイム更新-------|                        |
   |                          |                        |
   |                          |<--stream-completed-----|
   |<--最終結果表示-----------|                        |
```

---

## 内部実装: MessageBus の詳細

```ts
// SimpleMessageBus の主要メソッド
class SimpleMessageBus {
  // アクター登録
  register(actor: Actor): void
  // メッセージ送信（1対1）
  send(message: ActorMessage): Promise<ActorResponse>
  // ブロードキャスト（1対多）
  broadcast(message: ActorMessage): Promise<ActorResponse[]>
  // イベントリスナー（ストリーミング用）
  emit(message: ActorMessage): Promise<void>
}
```

---

## 内部実装: アクターベースアーキテクチャ

```ts
interface Actor {
  name: string;
  handleMessage(message: ActorMessage): Promise<ActorResponse | null>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- **UserActor**: ユーザーコマンドの解析・ルーティング
- **ClaudeCodeActor**: Claude API との通信管理
- **DebugActor**: モック応答（開発・テスト用）
- **AutoResponderActor**: Never Sleep モードの自動タスク

---

## 内部実装: ClaudeCodeAdapter の工夫

```ts
// ストリーミング対応
async *queryStream(prompt: string): AsyncGenerator<ClaudeStreamChunk> {
  // SDK からのレスポンスをストリーミング
  for await (const event of this.client.query({ prompt, options })) {
    yield this.processChunk(event);
  }
}

// セッション管理
if (this.config.continueSession && this.isFirstQuery) {
  // 前回の会話履歴を含めてプロンプトを構築
  actualPrompt = `前回の会話:\n${history}\n\n現在: ${prompt}`;
}
```

---

## 内部実装: セッション履歴管理

```ts
// SessionHistory による会話の永続化
class SessionHistory {
  // 会話をファイルに保存
  async saveMessage(sessionId: string, message: ConversationMessage)
  // 履歴の取得
  async getConversationHistory(sessionId: string, limit?: number)
  // セッション一覧
  async listSessions(): Promise<SessionInfo[]>
}
```

- セッションごとに JSON ファイルで保存
- `./sessions/` ディレクトリに格納
- エラー時の自動リカバリ機能

---

## 内部実装: ストリーミング処理の詳細

```ts
// Discord側でのストリーミング更新処理
class DiscordAdapter {
  private streamingMessages = new Map<string, StreamingState>();
  
  async handleStreamPartial(event: StreamPartialMessage) {
    // 2秒間隔でバッチ更新（API制限対策）
    if (Date.now() - lastUpdate > 2000) {
      await message.edit(accumulatedText);
    }
  }
}
```

- Discordメッセージをリアルタイム更新
- API制限を考慮した更新頻度制御
- ツール出力の整形表示

---

## 内部実装: エラーハンドリング

```ts
// ClaudeCodeActor でのエラー処理
try {
  const result = await this.adapter.query(prompt);
} catch (error) {
  if (error.message.includes("rate limit")) {
    // レート制限エラー
    await this.handleRateLimit(error);
  } else if (error.message.includes("session")) {
    // セッションエラー時は自動リトライ
    return await this.retryWithNewSession(prompt);
  }
}
```

- APIエラーの種類に応じた処理
- 自動リトライ機能
- ユーザーへの適切なフィードバック

---

## 内部実装: セキュリティ機能

```ts
// 認証とアクセス制御
class UserActor {
  async validateUser(userId: string): Promise<boolean> {
    // DISCORD_ALLOWED_USERS 環境変数でホワイトリスト管理
    const allowedUsers = this.config.allowedUsers;
    return allowedUsers.includes(userId);
  }
}

// 監査ログ
class AuditLogger {
  async log(event: AuditEvent) {
    // 全アクションを JSON 形式で記録
    await this.writeLog({
      timestamp: new Date().toISOString(),
      userId: event.userId,
      action: event.action,
      channelId: event.channelId,
      result: event.result
    });
  }
}
```

---

## 今後

- おそらくこの操作自体を MCP にしたほうがいい
  - 一旦停止して、`ccdiscord -c` している
  - 双方向でメッセージを同期したほうがいい
  - (push は discord 側からしかできない...)
- discord-cf
  - 本当は cloudflare bot にしたかった
  - discord.js は cloudflare で動かない (node 互換がたりない)
  - 途中まで作った
- 権限処理
  - ローカル前提
  - 持ってる権限が危険すぎる
