#!/usr/bin/env -S deno run -A --env

import {
  parseCliOptions,
  showHelp,
  validateOptions,
  listSessions,
  selectSession,
} from "./cli.ts";
import { loadConfig } from "./config.ts";
import { t } from "./i18n.ts";
import { SimpleMessageBus } from "./message-bus.ts";
import { UserActor } from "./actors/user-actor.ts";
import { ClaudeCodeActor } from "./actors/claude-code-actor.ts";
import { GeminiCliActor } from "./actors/gemini-cli-actor.ts";
import { AutoResponderActor } from "./actors/auto-responder-actor.ts";
import { DiscordAdapter } from "./adapter/discord-adapter.ts";
import { AuditLogger } from "./audit-logger.ts";

async function main() {
  // Parse CLI options
  const options = parseCliOptions();

  // Display help
  if (options.help) {
    showHelp();
    Deno.exit(0);
  }

  // Validate options
  validateOptions(options);

  // Display session list
  if (options.listSessions) {
    await listSessions();
    Deno.exit(0);
  }

  // Select session
  if (options.select) {
    const sessionId = await selectSession();
    if (!sessionId) {
      console.log(t("cli.errors.sessionNotSelected"));
      Deno.exit(0);
    }
    options.resume = sessionId;
  }

  // Load configuration
  const config = loadConfig();
  if (!config) {
    Deno.exit(1);
  }

  // Apply CLI options to configuration
  config.neverSleep = options.neverSleep;
  if (options.resume) {
    config.sessionId = options.resume;
  }
  if (options.continue) {
    config.continueSession = true;
  }
  if (options.permissionMode) {
    config.claudePermissionMode = options.permissionMode as
      | "ask"
      | "bypassPermissions";
  }
  if (options.logs) {
    config.auditLogPath = options.logs;
  }

  // Initialize audit logger if enabled
  const auditLogger = new AuditLogger(config.auditLogPath);
  await auditLogger.init();

  if (config.auditLogPath) {
    await auditLogger.logInfo("system", "startup", {
      neverSleep: config.neverSleep,
      sessionId: config.sessionId,
      continueSession: config.continueSession,
    });
  }

  // Initialize message bus and Actors
  const bus = new SimpleMessageBus();

  // Create each Actor
  const userActor = new UserActor();
  const autoResponderActor = new AutoResponderActor();

  // Select assistant Actor based on configuration
  let assistantActor;
  if (config.useGemini) {
    assistantActor = new GeminiCliActor(config, "assistant");
  } else {
    assistantActor = new ClaudeCodeActor(config, "assistant");
  }

  // Streaming用に MessageBus を注入
  assistantActor.setMessageBus(bus);

  // Register Actors
  bus.register(userActor);
  bus.register(autoResponderActor);
  bus.register(assistantActor);

  // Start all Actors
  await bus.startAll();

  console.log(`
===========================================
${t("main.startup.title")}
${t("main.startup.neverSleep")}: ${config.neverSleep ? "Enabled" : "Disabled"}
${
  config.sessionId
    ? `${t("main.startup.resumeSession")}: ${config.sessionId}`
    : t("main.startup.newSession")
}
===========================================
`);


  // Discord connection
  const discordAdapter = new DiscordAdapter(config, bus);

  try {
    await discordAdapter.start();
    console.log(`\n${t("main.discord.connected")}`);

    // Handle process termination
    Deno.addSignalListener("SIGINT", async () => {
      console.log(`\n${t("main.discord.shutdown")}`);
      await auditLogger.logInfo("system", "shutdown", { reason: "SIGINT" });
      await discordAdapter.stop();
      await bus.stopAll();
      await auditLogger.close();
      Deno.exit(0);
    });

    // Maintain connection
    await new Promise(() => {});
  } catch (error) {
    console.error(`${t("main.discord.connectionError")}`, error);
    await auditLogger.logError(
      "system",
      "discord_connection_failed",
      (error as Error).toString()
    );
    await bus.stopAll();
    await auditLogger.close();
    Deno.exit(1);
  }
}

// Error handling
main().catch(async (error) => {
  console.error(`${t("main.fatalError")}`, error);
  const auditLogger = new AuditLogger();
  await auditLogger.logError("system", "fatal_error", String(error));
  await auditLogger.close();
  Deno.exit(1);
});
