// Configuration management module
import { showSetupInstructions, t } from "./i18n.ts";

export interface Config {
  discordToken: string;
  channelId: string;
  userId: string;
  allowedUsers?: string[]; // List of allowed user IDs
  debugMode: boolean;
  neverSleep: boolean;
  sessionId?: string;
  continueSession?: boolean; // Continue existing session
  maxTurns: number;
  model: string;
  claudePermissionMode?: "bypassPermissions" | "ask";
  // Streaming options (defaults applied in loadConfig)
  streamingEnabled?: boolean;
  streamingUpdateMode?: "edit" | "append";
  streamingIntervalMs?: number;
  streamingToolChunkPrefix?: string;
  streamingMaxChunkLength?: number;
  streamingShowThinking?: boolean;
  streamingShowDone?: boolean;
  streamingShowAbort?: boolean;
  // Gemini configuration
  useGemini?: boolean;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiMaxTokens?: number;
  geminiTemperature?: number;
}

export interface EnvConfig {
  // Discord
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CHANNEL_ID?: string;
  DISCORD_ALLOWED_USERS?: string; // Comma-separated list of user IDs
  // Anthropic
  ANTHROPIC_API_KEY?: string;
  // Claude Code permission mode
  CLAUDE_PERMISSION_MODE?: string;
  // Gemini configuration
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_MAX_TOKENS?: string;
  GEMINI_TEMPERATURE?: string;
  USE_GEMINI?: string;
  // Legacy support
  CC_DISCORD_TOKEN?: string;
  CC_DISCORD_CHANNEL_ID?: string;
  CC_DISCORD_USER_ID?: string;
  CC_CLAUDE_API_KEY?: string;
  CC_ANTHROPIC_API_KEY?: string;
}

// Load configuration from environment variables
export function loadConfig(debugMode = false): Config | null {
  const env = Deno.env.toObject() as EnvConfig;

  // Support both new and legacy environment variable names
  const discordToken = env.DISCORD_BOT_TOKEN || env.CC_DISCORD_TOKEN;
  const channelId = env.DISCORD_CHANNEL_ID || env.CC_DISCORD_CHANNEL_ID;
  const clientId = env.DISCORD_CLIENT_ID;
  const userId = env.CC_DISCORD_USER_ID || clientId;
  const claudeApiKey =
    env.ANTHROPIC_API_KEY || env.CC_CLAUDE_API_KEY || env.CC_ANTHROPIC_API_KEY;

  // Check which variables are missing
  const missingVars: string[] = [];

  if (!discordToken) missingVars.push("DISCORD_BOT_TOKEN");
  if (!clientId && !env.CC_DISCORD_USER_ID)
    missingVars.push("DISCORD_CLIENT_ID");
  if (!channelId) missingVars.push("DISCORD_CHANNEL_ID");

  // Show setup instructions if any required variables are missing
  if (missingVars.length > 0) {
    showSetupInstructions(missingVars);
    return null;
  }

  // Warn if ANTHROPIC_API_KEY is set (Claude Code uses internal auth)
  if (claudeApiKey && !debugMode) {
    console.log("\n" + "⚠️ ".repeat(25));
    console.log(t("config.warnings.apiKeyNotNeeded"));
    console.log(t("config.warnings.apiKeyBillingRisk"));
    console.log(t("config.warnings.apiKeyIgnored"));
    console.log("⚠️ ".repeat(25) + "\n");
  }

  // Parse permission mode from env
  let claudePermissionMode: "bypassPermissions" | "ask" | undefined;
  const rawMode = env.CLAUDE_PERMISSION_MODE?.trim();
  if (rawMode) {
    if (rawMode === "default") {
      // keep undefined to use existing default behavior (backward compatible)
    } else if (rawMode === "ask" || rawMode === "bypassPermissions") {
      claudePermissionMode = rawMode;
    } else {
      console.warn(
        `[config] Invalid CLAUDE_PERMISSION_MODE="${rawMode}" - falling back to default`
      );
    }
  }

  // Parse allowed users from env
  let allowedUsers: string[] | undefined;
  if (env.DISCORD_ALLOWED_USERS) {
    allowedUsers = env.DISCORD_ALLOWED_USERS.split(",").map(id => id.trim()).filter(id => id.length > 0);
    if (allowedUsers.length === 0) {
      allowedUsers = undefined;
    }
  }

  // Parse Gemini configuration
  const useGemini = env.USE_GEMINI === "true" || env.USE_GEMINI === "1";
  const geminiApiKey = env.GEMINI_API_KEY;
  const geminiModel = env.GEMINI_MODEL || "gemini-pro";
  const geminiMaxTokens = env.GEMINI_MAX_TOKENS ? parseInt(env.GEMINI_MAX_TOKENS) : undefined;
  const geminiTemperature = env.GEMINI_TEMPERATURE ? parseFloat(env.GEMINI_TEMPERATURE) : undefined;

  // Warn if Gemini is enabled but API key is missing
  if (useGemini && !geminiApiKey) {
    console.error(t("config.errors.geminiApiKeyMissing"));
    return null;
  }

  return {
    discordToken: discordToken!,
    channelId: channelId!,
    userId: userId!,
    allowedUsers,
    debugMode,
    neverSleep: false, // Set from CLI options
    maxTurns: 300,
    model: "claude-opus-4-20250514",
    claudePermissionMode,
    // Streaming defaults
    streamingEnabled: true,
    streamingUpdateMode: "append",  // Changed from "edit" to "append" - each update creates a new message
    streamingIntervalMs: 1000,
    streamingToolChunkPrefix: "📋 ツール実行結果:",
    streamingMaxChunkLength: 1800,
    streamingShowThinking: true,
    streamingShowDone: true,
    streamingShowAbort: true,
    // Gemini configuration
    useGemini,
    geminiApiKey,
    geminiModel,
    geminiMaxTokens,
    geminiTemperature,
  };
}

// Validate configuration
export function validateConfig(config: Config): boolean {
  if (!config.discordToken || !config.channelId || !config.userId) {
    return false;
  }

  return true;
}

// Default configuration
export const DEFAULT_CONFIG = {
  maxTurns: 300,
  model: "claude-opus-4-20250514",
  permissionMode: "ask",
} as const;
