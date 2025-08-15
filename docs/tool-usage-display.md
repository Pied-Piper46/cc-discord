# ツール使用時の表示フォーマット

ccdiscord では、Claude Code がツールを使用する際に、その詳細を Discord に表示します。

## 表示される情報

### 1. ツール使用開始時

```
🔧 **ツール使用**: `Read`
📋 **パラメータ**: 
```json
{
  "file_path": "/home/user/project/src/main.ts",
  "limit": 50
}
```
```

### 2. ツール実行結果（成功時）

```
✅ **ツール実行結果** (ID: tool_abc123):
```
File contents here...
```
```

### 3. ツール実行結果（エラー時）

```
❌ **ツールエラー** (ID: tool_abc123):
```
Error: File not found
```
```

## 表示フロー例

実際の使用時は以下のような流れで表示されます：

```
User: main.ts ファイルを読んで
[accepted]
ファイルを読み取ります。

🔧 **ツール使用**: `Read`
📋 **パラメータ**: 
```json
{
  "file_path": "/home/user/project/src/main.ts"
}
```

✅ **ツール実行結果** (ID: tool_abc123):
```typescript
import express from 'express';

const app = express();
...
```

main.ts ファイルの内容を確認しました。Express を使用したサーバーアプリケーションのようですね。
[done]
```

## 利点

1. **透明性**: どのツールが使用されているか明確に分かる
2. **デバッグ**: パラメータが表示されるため、問題の特定が容易
3. **エラー追跡**: ツール ID によりエラーの原因を特定しやすい
4. **実行順序**: ツールの使用順序が時系列で確認できる

## 設定

この機能は `streamingEnabled` が `true` の場合に自動的に有効になります（デフォルトで有効）。