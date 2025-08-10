import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  ClaudeCodeAdapter,
  type ClaudeClient,
} from "../adapter/claude-code-adapter.ts";
import type { Config } from "../config.ts";

// Helper to create minimal config
function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    discordToken: "DUMMY",
    channelId: "CHANNEL",
    userId: "USER",
    debugMode: true,
    neverSleep: false,
    sessionId: overrides.sessionId,
    maxTurns: overrides.maxTurns ?? 3,
    model: overrides.model ?? "test-model",
    claudePermissionMode: overrides.claudePermissionMode,
  };
}

Deno.test(
  "ClaudeCodeAdapter: permissionMode が client.query(...) へ渡る",
  async () => {
    const config = createConfig({ claudePermissionMode: "ask" });

    let capturedOptions: any = undefined;

    const fakeClient: ClaudeClient = {
      query: ({ options }) => {
        capturedOptions = options;
        // 空の非同期イテレータを返す
        return (async function* () {})();
      },
    };

    const adapter = new ClaudeCodeAdapter(config, fakeClient);
    await adapter.query("hello"); // 実行して options をキャプチャ

    assertEquals(capturedOptions?.permissionMode, "ask");
  }
);

Deno.test(
  "ClaudeCodeAdapter: エラー時に permissionMode/cwd/PATH/cli ヒントが付記される（プリフライトは握り込み）",
  async () => {
    const config = createConfig({ claudePermissionMode: "ask" });

    const erroringClient: ClaudeClient = {
      query: () => {
        // exit code 1 相当の文言を含むエラーでプリフライト発火条件を満たす
        throw new Error("Claude Code process exited with code 1");
      },
    };

    const adapter = new ClaudeCodeAdapter(config, erroringClient);

    try {
      await adapter.query("hello");
      throw new Error("should not reach");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 例外ヘッダと追加ヒントが含まれること
      assertStringIncludes(msg, "ClaudeCodeAdapter:");
      assertStringIncludes(msg, "permissionMode=");
      assertStringIncludes(msg, "cwd=");
      assertStringIncludes(msg, "PATH[0]=");
      assertStringIncludes(msg, "cli=");
      // cli の値は環境に依存するため具体値は検証しない（not_found_or_failed など）
    }
  }
);

Deno.test(
  "ClaudeCodeAdapter: 429 などのエラーで rate_limited=true が付記される",
  async () => {
    const config = createConfig({ claudePermissionMode: "ask" });

    const erroringClient: ClaudeClient = {
      query: () => {
        throw new Error("HTTP 429: rate limit exceeded");
      },
    };

    const adapter = new ClaudeCodeAdapter(config, erroringClient);

    try {
      await adapter.query("hello");
      throw new Error("should not reach");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertStringIncludes(msg, "rate_limited=true");
    }
  }
);
