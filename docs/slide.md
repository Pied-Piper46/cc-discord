# ccdiscord を紹介したい

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

## 内部実装: 起動時の処理

- discord.js でスレッドを作成
- スレッドの書き込みを監視を開始

---

## 内部実装: ユーザー入力 discord -> claude-code -> discord

- `MessageBus` という入力バスを設計
- discord のユーザー入力をキューイング
- claude-code は MessageBus からコンシューム
  - 出力結果を MessageBus に書き込む
- discord が CC の結果をスレッドに書き込み

claude-code は claude-code を MCP として使っている

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
