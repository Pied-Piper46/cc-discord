// Configuration management module
import { showSetupInstructions, t } from "./i18n.ts";

export interface Config {
  discordToken: string;
  channelId: string;
  userId: string;
  allowedUsers?: string[]; // List of allowed user IDs
  neverSleep: boolean;
  sessionId?: string;
  continueSession?: boolean; // Continue existing session
  maxTurns: number;
  model: string;
  claudePermissionMode?: "bypassPermissions" | "ask";
  auditLogPath?: string; // Path to audit log file
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
  // Discord (CC_ prefix only)
  CC_DISCORD_TOKEN?: string;
  CC_DISCORD_CHANNEL_ID?: string;
  CC_DISCORD_USER_ID?: string;
  CC_DISCORD_ALLOWED_USERS?: string; // Comma-separated list of user IDs
  // Anthropic
  CC_ANTHROPIC_API_KEY?: string;
  CC_CLAUDE_API_KEY?: string;
  // Gemini configuration
  CC_GEMINI_API_KEY?: string;
  CC_GEMINI_MODEL?: string;
  CC_GEMINI_MAX_TOKENS?: string;
  CC_GEMINI_TEMPERATURE?: string;
  CC_USE_GEMINI?: string;
}

// Load configuration from environment variables
export function loadConfig(): Config | null {
  const env = Deno.env.toObject() as EnvConfig;

  // Use only CC_ prefixed environment variables
  const discordToken = env.CC_DISCORD_TOKEN;
  const channelId = env.CC_DISCORD_CHANNEL_ID;
  const userId = env.CC_DISCORD_USER_ID;
  const claudeApiKey = env.CC_CLAUDE_API_KEY || env.CC_ANTHROPIC_API_KEY;

  // Check which variables are missing
  const missingVars: string[] = [];

  if (!discordToken) missingVars.push("CC_DISCORD_TOKEN");
  if (!userId) missingVars.push("CC_DISCORD_USER_ID");
  if (!channelId) missingVars.push("CC_DISCORD_CHANNEL_ID");

  // Show setup instructions if any required variables are missing
  if (missingVars.length > 0) {
    showSetupInstructions(missingVars);
    return null;
  }

  // Warn if ANTHROPIC_API_KEY is set (Claude Code uses internal auth)
  if (claudeApiKey) {
    console.log("\n" + "⚠️ ".repeat(25));
    console.log(t("config.warnings.apiKeyNotNeeded"));
    console.log(t("config.warnings.apiKeyBillingRisk"));
    console.log(t("config.warnings.apiKeyIgnored"));
    console.log("⚠️ ".repeat(25) + "\n");
  }

  // Permission mode is now only set via CLI options

  // Parse allowed users from env
  let allowedUsers: string[] | undefined;
  if (env.CC_DISCORD_ALLOWED_USERS) {
    allowedUsers = env.CC_DISCORD_ALLOWED_USERS.split(",").map(id => id.trim()).filter(id => id.length > 0);
    if (allowedUsers.length === 0) {
      allowedUsers = undefined;
    }
  }

  // Parse Gemini configuration
  const useGemini = env.CC_USE_GEMINI === "true" || env.CC_USE_GEMINI === "1";
  const geminiApiKey = env.CC_GEMINI_API_KEY;
  const geminiModel = env.CC_GEMINI_MODEL || "gemini-pro";
  const geminiMaxTokens = env.CC_GEMINI_MAX_TOKENS ? parseInt(env.CC_GEMINI_MAX_TOKENS) : undefined;
  const geminiTemperature = env.CC_GEMINI_TEMPERATURE ? parseFloat(env.CC_GEMINI_TEMPERATURE) : undefined;

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
    neverSleep: false, // Set from CLI options
    maxTurns: 300,
    model: "claude-opus-4-20250514",
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
