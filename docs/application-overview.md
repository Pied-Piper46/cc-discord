# cc-discord アプリケーション概要

## 目次
- [概要](#概要)
- [主要機能](#主要機能)
- [システム構成](#システム構成)
- [技術スタック](#技術スタック)
- [使用方法](#使用方法)
- [アーキテクチャ概観](#アーキテクチャ概観)

## 概要

**cc-discord** は、Discord上でClaude CodeのAI機能を利用できるボットアプリケーションです。Discordのスレッド機能を活用して、Claude Codeとリアルタイムで対話し、コード生成、ファイル操作、システム管理などを Discord UI から実行できます。

### 何ができるのか？

- **Discord上でのAI対話**: Claude Codeの全機能をDiscordチャットで利用
- **リアルタイム応答**: ストリーミング形式でAI応答を段階的に受信
- **ファイル操作**: プロジェクトファイルの読み書き、編集、検索
- **コード生成・解析**: プログラムの作成、リファクタリング、デバッグ支援
- **セッション管理**: 会話の継続、履歴の保存・復元
- **セキュリティ**: 指定ユーザーのみアクセス可能

## 主要機能

### 1. Discord統合
- **自動スレッド作成**: 起動時に専用スレッドを自動生成
- **WebSocketリアルタイム通信**: Discord.jsによる即座なメッセージ処理
- **権限管理**: 特定ユーザーのみアクセス許可
- **コマンド機能**: `!reset`, `!stop`, `!exit`, `!<shell-command>` 対応

### 2. AI統合
- **Claude Code SDK**: プログラマブルなClaude Code統合
- **Gemini CLI**: 代替AIエンジン（オプション）
- **ストリーミング応答**: リアルタイムでの応答表示
- **ツール実行表示**: ファイル操作等の詳細表示

### 3. セッション管理
- **会話継続**: セッションIDによる状態保持
- **履歴復元**: 過去の会話から継続可能
- **監査ログ**: 全操作の記録（オプション）

## システム構成

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Discord User  │◄──►│   cc-discord     │◄──►│  Claude Code    │
│     (Input)     │    │   Application    │    │     (AI)        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                               │
                               ▼
                       ┌──────────────────┐
                       │  Local Files/    │
                       │  File System     │
                       └──────────────────┘
```

### コンポーネント関係図

```
Discord Thread
       │ WebSocket
       ▼
┌─────────────────────┐
│  DiscordAdapter     │ ◄─┐
└─────────────────────┘   │
       │                  │
       ▼                  │
┌─────────────────────┐   │ MessageBus
│    MessageBus       │ ◄─┤
└─────────────────────┘   │
       │                  │
       ▼                  │
┌─────────────────────┐   │
│ UserActor           │ ◄─┘
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ ClaudeCodeActor     │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ ClaudeCodeAdapter   │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Claude Code SDK     │
└─────────────────────┘
```

## 技術スタック

### ランタイム・言語
- **Deno**: TypeScript実行環境
- **TypeScript**: 型安全なJavaScript

### 主要ライブラリ
- **discord.js**: Discord Bot API クライアント
- **@anthropic-ai/claude-code**: Claude Code SDK
- **discord-cf**: WebSocket対応（実験的）

### アーキテクチャパターン
- **Actorモデル**: 非同期メッセージパッシング
- **Adapterパターン**: 外部サービス抽象化
- **Observer パターン**: イベントドリブン設計

## 使用方法

### 1. セットアップ
```bash
# 環境変数設定
export CC_DISCORD_TOKEN=your-discord-bot-token
export CC_DISCORD_CHANNEL_ID=your-channel-id
export CC_DISCORD_USER_ID=your-user-id

# Claude Code準備
claude --dangerouslySkipPermissions
```

### 2. 起動
```bash
deno task start
```

### 3. 使用
1. 起動すると自動でDiscordスレッドが作成される
2. スレッド内でメッセージを送信
3. Claude Codeが応答を返す
4. ファイル操作、コード生成などが実行される

### 利用可能コマンド
- `!reset` / `!clear`: 会話リセット
- `!stop`: 実行中タスクの停止
- `!exit`: ボット終了
- `!<command>`: シェルコマンド実行
- 通常メッセージ: AI対話

## アーキテクチャ概観

### 設計思想
1. **モジュラー設計**: 各コンポーネントが独立して動作
2. **拡張性**: 新しいAIや通信方式を簡単に追加可能
3. **型安全性**: TypeScriptによる堅牢な型チェック
4. **非同期処理**: 全てのI/O操作が非ブロッキング

### 主要な設計パターン

#### Actorモデル
- 各Actor（User, Claude, Discord等）が独立したメッセージ処理
- MessageBusによる疎結合な通信
- 障害隔離とスケーラビリティ

#### Streaming Architecture
- Claude Codeからのリアルタイム応答
- Discord UI での段階的表示
- ユーザー体験の向上

#### セキュリティ設計
- ユーザーID による認証
- Discord スレッド内での実行制限
- 監査ログによる操作記録

## 次のドキュメント

詳細な技術情報については、以下のドキュメントを参照してください：

- [アーキテクチャ詳細](./architecture-deep-dive.md)
- [Discord統合技術](./discord-integration.md)
- [Claude Code連携](./claude-code-integration.md)
- [メッセージフロー解説](./message-flow-analysis.md)

---

最終更新: 2024年8月