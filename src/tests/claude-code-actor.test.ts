import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ClaudeCodeActor } from "../actors/claude-code-actor.ts";
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
    maxTurns: 3,
    model: "test-model",
    claudePermissionMode: overrides.claudePermissionMode,
  };
}

Deno.test("ClaudeCodeActor", async (t) => {
  await t.step(
    "case1: Adapter が例外 → handleMessage が error レスポンスを返す",
    async () => {
      const config = createConfig();
      const actor = new ClaudeCodeActor(config, "claude-actor-test");

      // Fake adapter that throws
      const fakeAdapter = {
        query: async () => {
          throw new Error("simulated adapter failure");
        },
        getCurrentSessionId: () => undefined,
        // unused in this test but keep shape compatible
        start: async () => {},
        stop: async () => {},
        resetSession: () => {},
      };

      // Inject fake adapter (bypass private with 'any' cast)
      (actor as any).adapter = fakeAdapter;

      const message = {
        id: "msg-1",
        from: "tester",
        to: "claude-actor-test",
        type: "chat",
        payload: { text: "hello" },
        timestamp: new Date(),
      };

      const res = await actor.handleMessage(message);
      assertExists(res);
      assertEquals(res.type, "error");
      const payload = res.payload as { error: string };
      assertEquals(payload.error, "simulated adapter failure");
    }
  );

  await t.step("case2: 正常レスポンス → claude-response を返す", async () => {
    const config = createConfig();
    const actor = new ClaudeCodeActor(config, "claude-actor-test-2");

    const fakeAdapter = {
      query: async (text: string) => {
        return `echo: ${text}`;
      },
      getCurrentSessionId: () => "session-xyz",
      start: async () => {},
      stop: async () => {},
      resetSession: () => {},
    };

    (actor as any).adapter = fakeAdapter;

    const message = {
      id: "msg-2",
      from: "tester",
      to: "claude-actor-test-2",
      type: "chat",
      payload: { text: "hello ai" },
      timestamp: new Date(),
    };

    const res = await actor.handleMessage(message);
    assertExists(res);
    assertEquals(res.type, "claude-response");
    const payload = res.payload as { text: string; sessionId?: string };
    assertEquals(payload.text, "echo: hello ai");
    assertEquals(payload.sessionId, "session-xyz");
  });

  await t.step(
    "case3: config.claudePermissionMode='ask' が Adapter→client.query へ伝播する",
    async () => {
      const config: Config = createConfig({ claudePermissionMode: "ask" });
      const actor = new ClaudeCodeActor(config, "claude-actor-test-3");

      // ClaudeCodeAdapter に注入する fake client を用意して options を捕捉
      let capturedPermissionMode: unknown = undefined;
      const fakeClient = {
        query: ({ options }: any) => {
          capturedPermissionMode = options?.permissionMode;
          // 空の非同期イテレータ
          return (async function* () {})();
        },
      };

      // 実 adapter に fake client を注入して、Actor 経由で query を実行
      const realAdapter = new (
        await import("../adapter/claude-code-adapter.ts")
      ).ClaudeCodeAdapter(config, fakeClient as any);
      (actor as any).adapter = realAdapter;

      const message = {
        id: "msg-3",
        from: "tester",
        to: "claude-actor-test-3",
        type: "chat",
        payload: { text: "permission test" },
        timestamp: new Date(),
      };

      const res = await actor.handleMessage(message);
      assertExists(res); // 応答自体は返る（空応答でもよい）
      assertEquals(capturedPermissionMode, "ask"); // permissionMode が正しく伝播
    }
  );
});
