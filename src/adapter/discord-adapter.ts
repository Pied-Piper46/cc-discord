import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import type { Adapter, MessageBus, ActorMessage } from "../types.ts";
import type { Config } from "../config.ts";
import { t } from "../i18n.ts";
import { AuditLogger } from "../utils/audit-logger.ts";
import { sessionHistory } from "../utils/session-history.ts";

// Adapter that manages Discord connection
export class DiscordAdapter implements Adapter {
  name = "discord";
  private client: Client;
  private config: Config;
  private messageBus: MessageBus;
  private currentThread: ThreadChannel | null = null;
  private isRunning = false;
  private auditLogger: AuditLogger;
  // Streaming state: originalMessageId -> buffers and timer
  private streamStates: Map<
    string,
    {
      buffer: string;
      toolBuffer: string;
      timer?: number;
      thinkingMessage?: Message;
      mode: "edit" | "append";
      channelId?: string;
    }
  > = new Map();
  private completedStreamIds: Set<string> = new Set();
  private busListener: ((message: ActorMessage) => void) | null = null;

  constructor(config: Config, messageBus: MessageBus) {
    this.config = config;
    this.messageBus = messageBus;
    this.auditLogger = new AuditLogger();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupEventHandlers();

    // Subscribe to stream events
    this.busListener = (msg: ActorMessage) => this.handleStreamEvent(msg);
    this.messageBus.addListener(this.busListener);
  }

  async start(): Promise<void> {
    console.log(`[${this.name}] ${t("discord.starting")}`);

    try {
      await this.auditLogger.init();
      await this.client.login(this.config.discordToken);
      this.isRunning = true;
      await this.auditLogger.logSessionStart(this.config.sessionId || "default", Deno.cwd());
    } catch (error) {
      console.error(`[${this.name}] ${t("discord.failedLogin")}`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log(`[${this.name}] ${t("discord.stopping")}`);

    if (this.currentThread && this.currentThread.sendable) {
      try {
        await this.currentThread.send(t("discord.goodbye"));
      } catch (error) {
        console.error(`[${this.name}] ${t("discord.failedGoodbye")}`, error);
      }
    }

    await this.auditLogger.logSessionEnd(this.config.sessionId || "default");

    // Unsubscribe listener and clear timers
    if (this.busListener) {
      this.messageBus.removeListener(this.busListener);
      this.busListener = null;
    }
    for (const st of this.streamStates.values()) {
      if (st.timer) clearTimeout(st.timer);
    }
    this.streamStates.clear();

    this.client.destroy();
    this.isRunning = false;
  }

  private isUserAllowed(userId: string): boolean {
    // If allowedUsers is defined, check against the list
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      return this.config.allowedUsers.includes(userId);
    }
    // Otherwise, fall back to checking against the single userId
    return userId === this.config.userId;
  }

  private setupEventHandlers(): void {
    this.client.once("ready", () => this.handleReady());
    this.client.on("messageCreate", (message) => this.handleMessage(message));
    this.client.on("error", (error) => this.handleError(error));
  }

  private async handleReady(): Promise<void> {
    console.log(
      `[${this.name}] ${t("discord.ready")} ${this.client.user?.tag}`
    );

    try {
      const channel = await this.client.channels.fetch(this.config.channelId);
      if (channel && channel.isTextBased() && !channel.isThread()) {
        await this.createThread(channel as TextChannel);
      }
    } catch (error) {
      console.error(`[${this.name}] ${t("discord.failedSetup")}`, error);
    }
  }

  private async createThread(channel: TextChannel): Promise<void> {
    const threadName = `Claude Session - ${new Date().toLocaleString("ja-JP")}`;

    try {
      this.currentThread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440, // 24 hours
        reason: "Claude session thread",
      });

      // Send initial message
      const initialMessage = await this.createInitialMessage();
      await this.currentThread.send(initialMessage);

      console.log(`[${this.name}] ${t("discord.threadCreated")} ${threadName}`);
    } catch (error) {
      console.error(`[${this.name}] ${t("discord.failedCreateThread")}`, error);
    }
  }

  private async createInitialMessage(): Promise<string> {
    // 会話履歴を取得（--continueまたは--resumeオプション時）
    let conversationHistory = "";
    if (this.config.continueSession || this.config.sessionId) {
      try {
        let targetSessionId = this.config.sessionId;
        
        // --continueオプションの場合は最新セッションを取得
        if (this.config.continueSession && !targetSessionId) {
          const latestId = await sessionHistory.getLatestSessionId();
          if (latestId) {
            targetSessionId = latestId;
          }
        }
        
        if (targetSessionId) {
          const messages = await sessionHistory.getConversationHistory(targetSessionId, 5);
          if (messages.length > 0) {
            conversationHistory = sessionHistory.formatConversationHistoryForDiscord(messages);
          }
        }
      } catch (error) {
        console.error(`[${this.name}] Failed to load conversation history:`, error);
      }
    }
    
    const sessionInfo = `## ${t("discord.sessionInfo.title")}

**${t("discord.sessionInfo.startTime")}**: ${new Date().toISOString()}
**${t("discord.sessionInfo.workDir")}**: \`${Deno.cwd()}\`
**${t("discord.sessionInfo.mode")}**: ${
      this.config.debugMode ? "Debug" : "Production"
    }
${
  this.config.neverSleep
    ? `**${t("discord.sessionInfo.neverSleepEnabled")}**`
    : ""
}
${
  this.config.continueSession
    ? `**${t("discord.sessionInfo.continueMode")}**: Enabled`
    : ""
}
${
  this.config.sessionId
    ? `**${t("discord.sessionInfo.resumeSession")}**: ${this.config.sessionId}`
    : ""
}`;

    const instructions = `${t("discord.instructions.header")}
- \`!reset\` or \`!clear\`: ${t("discord.instructions.reset")}
- \`!stop\`: ${t("discord.instructions.stop")}
- \`!exit\`: ${t("discord.instructions.exit")}
- \`!<command>\`: ${t("discord.instructions.shellCommand")}
- ${t("discord.instructions.normalMessage")}`;
    
    // 会話履歴がある場合は先頭に追加
    if (conversationHistory) {
      return `${conversationHistory}${sessionInfo}\n\n---\n\n${instructions}`;
    } else {
      return `${sessionInfo}\n\n---\n\n${instructions}`;
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore own messages and messages from other bots
    if (message.author.bot) return;

    // Ignore messages outside current thread
    if (!this.currentThread || message.channel.id !== this.currentThread.id)
      return;

    // Check if user is allowed
    if (!this.isUserAllowed(message.author.id)) {
      // Log auth failure
      await this.auditLogger.logAuthFailure(message.author.id, message.channel.id);
      // Send warning message if user is not allowed
      await message.reply(t("discord.userNotAllowed") || "You are not authorized to use this bot.");
      return;
    }

    const content = message.content.trim();
    if (!content) return;

    console.log(
      `[${this.name}] ${t("discord.receivedMessage")} ${
        message.author.username
      }: ${content}`
    );

    // Log user message
    await this.auditLogger.logUserMessage(
      message.author.id,
      message.author.username,
      message.channel.id,
      content
    );

    // Convert Discord message to ActorMessage
    const actorMessage: ActorMessage = {
      id: message.id,
      from: "discord",
      to: "user",
      type: "discord-message",
      payload: {
        text: content,
        authorId: message.author.id,
        channelId: message.channel.id,
      },
      timestamp: new Date(),
    };

    // Send message to UserActor
    const response = await this.messageBus.send(actorMessage);

    if (response) {
      // Process response
      await this.handleActorResponse(message, response);
    }
  }

  private async handleActorResponse(
    originalMessage: Message,
    response: ActorMessage
  ): Promise<void> {
    // Handle system commands
    if (response.to === "system") {
      await this.handleSystemCommand(originalMessage, response);
      return;
    }

    // Forward regular messages to assistant
    if (response.to === "assistant" || response.to === "auto-responder") {
      const assistantResponse = await this.messageBus.send(response);

      if (assistantResponse) {
        const text = (assistantResponse.payload as { text?: string })?.text;
        if (text) {
          // Avoid duplicate final send if streaming path already handled completion
          const streamingEnabled = this.config.streamingEnabled ?? true;
          if (
            streamingEnabled &&
            (this.streamStates.has(originalMessage.id) ||
              this.completedStreamIds.has(originalMessage.id))
          ) {
            return;
          }
          await this.sendLongMessage(originalMessage, text);
        }
      }
    }
  }

  private async handleSystemCommand(
    message: Message,
    response: ActorMessage
  ): Promise<void> {
    const channel = message.channel as TextChannel | ThreadChannel;

    await this.auditLogger.logBotResponse(channel.id, response.type);

    switch (response.type) {
      case "reset-session":
        await channel.send(t("discord.commands.resetComplete"));
        break;

      case "stop-tasks":
        await channel.send(t("discord.commands.stopComplete"));
        break;

      case "shutdown":
        await channel.send(t("discord.commands.exitMessage"));
        await this.stop();
        Deno.exit(0);

      case "execute-command":
        // SECURITY WARNING: Shell command execution is disabled for security reasons.
        // If you need this functionality, implement it with extreme caution:
        // - Use a whitelist of allowed commands
        // - Validate and sanitize all inputs
        // - Run commands in a sandboxed environment
        // - Log all command executions for audit purposes
        await channel.send(
          "⚠️ Shell command execution is disabled for security reasons."
        );
        break;
    }
  }

  private async sendLongMessage(
    message: Message,
    content: string
  ): Promise<void> {
    const channel = message.channel as TextChannel | ThreadChannel;
    const messages: string[] = [];
    let currentMessage = "";

    const lines = content.split("\n");
    for (const line of lines) {
      if (currentMessage.length + line.length + 1 > 1900) {
        messages.push(currentMessage);
        currentMessage = line;
      } else {
        currentMessage += (currentMessage ? "\n" : "") + line;
      }
    }
    if (currentMessage) {
      messages.push(currentMessage);
    }

    for (const msg of messages) {
      try {
        await channel.send(msg);
        // Wait a bit to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `[${this.name}] ${t("discord.failedSendMessage")}`,
          error
        );
      }
    }
  }

  private handleError(error: Error): void {
    console.error(`[${this.name}] ${t("discord.clientError")}`, error);
  }

  // Streaming helpers
  private getStreamingConfig() {
    return {
      enabled: this.config.streamingEnabled ?? true,
      mode: (this.config.streamingUpdateMode ?? "append") as "edit" | "append",
      interval: this.config.streamingIntervalMs ?? 1000,
      showThinking: this.config.streamingShowThinking ?? true,
      showDone: this.config.streamingShowDone ?? true,
      showAbort: this.config.streamingShowAbort ?? true,
    };
  }

  private capContent(s: string, max = 1900): string {
    return s.length > max ? s.slice(0, max - 3) + "..." : s;
  }

  private handleStreamEvent(message: ActorMessage): void {
    if (message.to !== "discord") return;

    const type = message.type;
    if (
      type !== "stream-started" &&
      type !== "stream-partial" &&
      type !== "stream-completed" &&
      type !== "stream-error"
    )
      return;

    const cfg = this.getStreamingConfig();
    if (!cfg.enabled) return;

    const payload = message.payload as any;
    const channelId: string | undefined = payload?.channelId;
    const id: string | undefined = payload?.originalMessageId;

    // Only handle for current thread
    if (
      !this.currentThread ||
      (channelId && this.currentThread.id !== channelId)
    )
      return;
    if (!id) return;

    switch (type) {
      case "stream-started":
        void this.onStreamStarted(id, channelId, payload?.meta);
        break;
      case "stream-partial":
        void this.onStreamPartial(id, channelId, payload);
        break;
      case "stream-completed":
        void this.onStreamCompleted(id, channelId, payload?.fullText ?? "");
        break;
      case "stream-error":
        void this.onStreamError(
          id,
          channelId,
          payload?.message ?? "Unknown error"
        );
        break;
    }
  }

  private async onStreamStarted(
    id: string,
    channelId?: string,
    _meta?: any
  ): Promise<void> {
    const cfg = this.getStreamingConfig();
    const state = {
      buffer: "",
      toolBuffer: "",
      timer: undefined as number | undefined,
      thinkingMessage: undefined as Message | undefined,
      mode: cfg.mode,
      channelId,
    };
    // appendモードでは「考え中...」メッセージを編集しないので、editモードの時のみ表示
    if (cfg.showThinking && cfg.mode === "edit" && this.currentThread?.sendable) {
      try {
        const msg = await this.currentThread.send("🤔 考え中...");
        state.thinkingMessage = msg;
      } catch (e) {
        console.error(`[${this.name}] failed to post thinking message`, e);
      }
    }
    this.streamStates.set(id, state);
  }

  private scheduleFlush(id: string): void {
    const st = this.streamStates.get(id);
    if (!st) return;
    const cfg = this.getStreamingConfig();
    if (st.timer) return;
    st.timer = setTimeout(async () => {
      st.timer = undefined;
      await this.flushNow(id);
    }, cfg.interval) as unknown as number;
  }

  private async flushNow(id: string): Promise<void> {
    const st = this.streamStates.get(id);
    if (!st || !this.currentThread) return;
    const out = `${st.toolBuffer}${st.toolBuffer && st.buffer ? "\n" : ""}${
      st.buffer
    }`.trim();
    if (!out) return;

    try {
      if (st.mode === "edit" && st.thinkingMessage) {
        await st.thinkingMessage.edit(this.capContent(out));
      } else {
        // append mode or no thinking message available
        await this.currentThread.send(this.capContent(out));
      }
    } catch (e) {
      console.error(`[${this.name}] stream flush error`, e);
    } finally {
      st.buffer = "";
      st.toolBuffer = "";
    }
  }

  private async onStreamPartial(
    id: string,
    _channelId: string | undefined,
    payload: any
  ): Promise<void> {
    const st = this.streamStates.get(id);
    if (!st) {
      // Initialize implicit state when partial comes before started
      this.onStreamStarted(id, _channelId);
    }
    const s = this.streamStates.get(id);
    if (!s) return;

    const textDelta = payload?.textDelta as string | undefined;
    const toolChunk = payload?.toolChunk as string | undefined;
    if (toolChunk) {
      s.toolBuffer += (s.toolBuffer ? "\n" : "") + toolChunk;
    }
    if (textDelta) {
      s.buffer += textDelta;
    }

    this.scheduleFlush(id);
  }

  private async sendLongToCurrentThread(content: string): Promise<void> {
    if (!this.currentThread) return;
    const messages: string[] = [];
    let currentMessage = "";

    const lines = content.split("\n");
    for (const line of lines) {
      if (currentMessage.length + line.length + 1 > 1900) {
        messages.push(currentMessage);
        currentMessage = line;
      } else {
        currentMessage += (currentMessage ? "\n" : "") + line;
      }
    }
    if (currentMessage) {
      messages.push(currentMessage);
    }

    for (const msg of messages) {
      try {
        await this.currentThread.send(msg);
        // Wait to avoid rate limiting (keep parity with sendLongMessage)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `[${this.name}] ${t("discord.failedSendMessage")}`,
          error
        );
      }
    }
  }

  private async onStreamCompleted(
    id: string,
    _channelId: string | undefined,
    fullText: string
  ): Promise<void> {
    const st = this.streamStates.get(id);
    if (st?.timer) {
      clearTimeout(st.timer);
      st.timer = undefined;
    }
    // Final flush pending buffers before sending final
    await this.flushNow(id);

    // Remove thinking message (editモードのみ)
    const cfg = this.getStreamingConfig();
    if (cfg.mode === "edit" && cfg.showThinking && st?.thinkingMessage) {
      try {
        await st.thinkingMessage.delete();
      } catch {
        // ignore
      }
    }

    // Final output using long message split
    try {
      // appendモードの場合は最終出力を送信しない（すでにストリーミングで送信済み）
      if (cfg.mode === "edit") {
        if (st?.thinkingMessage) {
          await this.sendLongMessage(st.thinkingMessage, fullText);
        } else {
          await this.sendLongToCurrentThread(fullText);
        }
      }
      if (cfg.showDone && this.currentThread) {
        await this.currentThread.send("✅ done");
      }
    } catch (e) {
      console.error(`[${this.name}] failed to send final output`, e);
    } finally {
      this.streamStates.delete(id);
      this.completedStreamIds.add(id);
      // Cleanup completion mark later to avoid memory growth
      setTimeout(() => this.completedStreamIds.delete(id), 60_000);
    }
  }

  private async onStreamError(
    id: string,
    _channelId: string | undefined,
    message: string
  ): Promise<void> {
    const st = this.streamStates.get(id);
    if (st?.timer) {
      clearTimeout(st.timer);
      st.timer = undefined;
    }
    // Remove thinking message (editモードのみ)
    const cfg = this.getStreamingConfig();
    if (cfg.mode === "edit" && st?.thinkingMessage) {
      try {
        await st.thinkingMessage.delete();
      } catch {
        // ignore
      }
    }
    if (cfg.showAbort && this.currentThread) {
      try {
        await this.currentThread.send(`⚠️ ストリーミング中断: ${message}`);
      } catch {
        // ignore
      }
    }
    this.streamStates.delete(id);
    this.completedStreamIds.add(id);
    setTimeout(() => this.completedStreamIds.delete(id), 60_000);
  }

  // Utility methods
  getCurrentThread(): ThreadChannel | null {
    return this.currentThread;
  }

  isConnected(): boolean {
    return this.isRunning && this.client.ws.status === 0;
  }
}
