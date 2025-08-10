import { GatewayClient, GatewayIntentBits, REST, API } from "discord-cf";
import type { Adapter, MessageBus, ActorMessage } from "../types.ts";
import type { Config } from "../config.ts";
import { t } from "../i18n.ts";
import { AuditLogger } from "../utils/audit-logger.ts";

// Discord-cf WebSocket adapter (experimental)
// Note: This requires Cloudflare Workers environment with Durable Objects
export class DiscordWebSocketAdapter implements Adapter {
  name = "discord-websocket";
  private gateway: GatewayClient | undefined;
  private rest: REST;
  private api: API;
  private config: Config;
  private messageBus: MessageBus;
  private isRunning = false;
  private auditLogger: AuditLogger;
  private currentThreadId: string | undefined;
  
  // Streaming state management
  private streamStates: Map<
    string,
    {
      buffer: string;
      toolBuffer: string;
      timer?: number;
      thinkingMessageId?: string;
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

    // Initialize REST client for API calls
    this.rest = new REST().setToken(`Bot ${this.config.discordToken}`);
    this.api = new API(this.rest);

    // Subscribe to stream events
    this.busListener = (msg: ActorMessage) => this.handleStreamEvent(msg);
    this.messageBus.addListener(this.busListener);
  }

  async start(): Promise<void> {
    console.log(`[${this.name}] ${t("discord.starting")} (WebSocket mode)`);

    try {
      await this.auditLogger.init();
      
      // Try to initialize WebSocket connection
      // This will only work in Cloudflare Workers environment
      if (typeof globalThis.WEBSOCKET_HANDLER !== 'undefined') {
        this.gateway = new GatewayClient(
          (globalThis as any).WEBSOCKET_HANDLER,
          'bot-instance'
        );

        // Connect to Discord Gateway
        await this.gateway.connect({
          token: this.config.discordToken,
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
          ],
        });

        // Set up event handlers
        this.setupWebSocketHandlers();
        
        console.log(`[${this.name}] WebSocket connected successfully`);
      } else {
        console.warn(`[${this.name}] WebSocket handler not available. This requires Cloudflare Workers environment.`);
        throw new Error("WebSocket not available in current environment");
      }
      
      this.isRunning = true;
      
      // Use the channel as "thread" since discord-cf doesn't support threads
      this.currentThreadId = this.config.channelId;
      
      // Send initial message
      await this.sendInitialMessage();
      
      await this.auditLogger.logSessionStart(this.config.sessionId || "default", Deno.cwd());
    } catch (error) {
      console.error(`[${this.name}] ${t("discord.failedLogin")}`, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log(`[${this.name}] ${t("discord.stopping")}`);

    // Disconnect WebSocket
    if (this.gateway) {
      await this.gateway.disconnect();
    }

    // Send goodbye message
    if (this.currentThreadId) {
      try {
        await this.api.channels.createMessage(this.currentThreadId, {
          content: t("discord.goodbye"),
        });
      } catch (error) {
        console.error(`[${this.name}] ${t("discord.failedGoodbye")}`, error);
      }
    }

    await this.auditLogger.logSessionEnd(this.config.sessionId || "default");

    // Cleanup listeners and timers
    if (this.busListener) {
      this.messageBus.removeListener(this.busListener);
      this.busListener = null;
    }
    for (const st of this.streamStates.values()) {
      if (st.timer) clearTimeout(st.timer);
    }
    this.streamStates.clear();

    this.isRunning = false;
  }

  private setupWebSocketHandlers(): void {
    if (!this.gateway) return;

    // Handle incoming messages through WebSocket
    // Note: The actual event handling would need to be implemented
    // based on discord-cf's WebSocket API documentation
    
    // This is a conceptual implementation as the actual API may differ
    (this.gateway as any).on('MESSAGE_CREATE', async (message: any) => {
      await this.handleMessage(message);
    });

    (this.gateway as any).on('READY', async () => {
      console.log(`[${this.name}] ${t("discord.ready")}`);
    });

    (this.gateway as any).on('ERROR', (error: any) => {
      console.error(`[${this.name}] ${t("discord.clientError")}`, error);
    });
  }

  private async sendInitialMessage(): Promise<void> {
    if (!this.currentThreadId) return;

    const threadName = `Claude Session - ${new Date().toLocaleString("ja-JP")}`;
    const initialMessage = this.createInitialMessage();

    try {
      await this.api.channels.createMessage(this.currentThreadId, {
        content: initialMessage,
      });
      console.log(`[${this.name}] ${t("discord.threadCreated")} ${threadName}`);
    } catch (error) {
      console.error(`[${this.name}] Failed to send initial message:`, error);
    }
  }

  private createInitialMessage(): string {
    return `## ${t("discord.sessionInfo.title")}

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

---

${t("discord.instructions.header")}
- \`!reset\` or \`!clear\`: ${t("discord.instructions.reset")}
- \`!stop\`: ${t("discord.instructions.stop")}
- \`!exit\`: ${t("discord.instructions.exit")}
- \`!<command>\`: ${t("discord.instructions.shellCommand")}
- ${t("discord.instructions.normalMessage")}`;
  }

  private isUserAllowed(userId: string): boolean {
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      return this.config.allowedUsers.includes(userId);
    }
    return userId === this.config.userId;
  }

  private async handleMessage(message: any): Promise<void> {
    // Ignore bot messages
    if (message.author?.bot) return;

    // Ignore messages outside current channel
    if (message.channel_id !== this.currentThreadId) return;

    // Check if user is allowed
    if (!this.isUserAllowed(message.author.id)) {
      await this.auditLogger.logAuthFailure(message.author.id, message.channel_id);
      await this.api.channels.createMessage(message.channel_id, {
        content: t("discord.userNotAllowed") || "You are not authorized to use this bot.",
        message_reference: { message_id: message.id },
      });
      return;
    }

    const content = message.content?.trim();
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
      message.channel_id,
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
        channelId: message.channel_id,
      },
      timestamp: new Date(),
    };

    // Send message to UserActor
    const response = await this.messageBus.send(actorMessage);

    if (response) {
      await this.handleActorResponse(message, response);
    }
  }

  private async handleActorResponse(
    originalMessage: any,
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
          const streamingEnabled = this.config.streamingEnabled ?? true;
          if (
            streamingEnabled &&
            (this.streamStates.has(originalMessage.id) ||
              this.completedStreamIds.has(originalMessage.id))
          ) {
            return;
          }
          await this.sendLongMessage(originalMessage.channel_id, text);
        }
      }
    }
  }

  private async handleSystemCommand(
    message: any,
    response: ActorMessage
  ): Promise<void> {
    const channelId = message.channel_id;

    await this.auditLogger.logBotResponse(channelId, response.type);

    switch (response.type) {
      case "reset-session":
        await this.api.channels.createMessage(channelId, {
          content: t("discord.commands.resetComplete"),
        });
        break;

      case "stop-tasks":
        await this.api.channels.createMessage(channelId, {
          content: t("discord.commands.stopComplete"),
        });
        break;

      case "shutdown":
        await this.api.channels.createMessage(channelId, {
          content: t("discord.commands.exitMessage"),
        });
        await this.stop();
        Deno.exit(0);

      case "execute-command":
        await this.api.channels.createMessage(channelId, {
          content: "⚠️ Shell command execution is disabled for security reasons.",
        });
        break;
    }
  }

  private async sendLongMessage(
    channelId: string,
    content: string
  ): Promise<void> {
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
        await this.api.channels.createMessage(channelId, {
          content: msg,
        });
        // Wait to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `[${this.name}] ${t("discord.failedSendMessage")}`,
          error
        );
      }
    }
  }

  // Streaming helpers
  private getStreamingConfig() {
    return {
      enabled: this.config.streamingEnabled ?? true,
      mode: (this.config.streamingUpdateMode ?? "edit") as "edit" | "append",
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

    if (!this.currentThreadId || (channelId && this.currentThreadId !== channelId))
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
      thinkingMessageId: undefined as string | undefined,
      mode: cfg.mode,
      channelId: channelId || this.currentThreadId,
    };
    
    if (cfg.showThinking && state.channelId) {
      try {
        const msg = await this.api.channels.createMessage(state.channelId, {
          content: "🤔 考え中...",
        });
        state.thinkingMessageId = msg.id;
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
    if (!st || !st.channelId) return;
    const out = `${st.toolBuffer}${st.toolBuffer && st.buffer ? "\n" : ""}${
      st.buffer
    }`.trim();
    if (!out) return;

    try {
      if (st.mode === "edit" && st.thinkingMessageId) {
        await this.api.channels.editMessage(st.channelId, st.thinkingMessageId, {
          content: this.capContent(out),
        });
      } else {
        await this.api.channels.createMessage(st.channelId, {
          content: this.capContent(out),
        });
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
    await this.flushNow(id);

    const cfg = this.getStreamingConfig();
    const channelId = st?.channelId || _channelId || this.currentThreadId;
    
    if (cfg.showThinking && st?.thinkingMessageId && channelId) {
      try {
        await this.api.channels.deleteMessage(channelId, st.thinkingMessageId);
      } catch {
        // ignore
      }
    }

    if (channelId) {
      try {
        await this.sendLongMessage(channelId, fullText);
        if (cfg.showDone) {
          await this.api.channels.createMessage(channelId, {
            content: "✅ done",
          });
        }
      } catch (e) {
        console.error(`[${this.name}] failed to send final output`, e);
      }
    }
    
    this.streamStates.delete(id);
    this.completedStreamIds.add(id);
    setTimeout(() => this.completedStreamIds.delete(id), 60_000);
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
    
    const channelId = st?.channelId || _channelId || this.currentThreadId;
    
    if (st?.thinkingMessageId && channelId) {
      try {
        await this.api.channels.deleteMessage(channelId, st.thinkingMessageId);
      } catch {
        // ignore
      }
    }
    
    const cfg = this.getStreamingConfig();
    if (cfg.showAbort && channelId) {
      try {
        await this.api.channels.createMessage(channelId, {
          content: `⚠️ ストリーミング中断: ${message}`,
        });
      } catch {
        // ignore
      }
    }
    
    this.streamStates.delete(id);
    this.completedStreamIds.add(id);
    setTimeout(() => this.completedStreamIds.delete(id), 60_000);
  }

  // Utility methods
  getCurrentThread(): string | null {
    return this.currentThreadId || null;
  }

  isConnected(): boolean {
    return this.isRunning && !!this.gateway;
  }

  async getGatewayStatus(): Promise<any> {
    if (!this.gateway) {
      return { connected: false, error: "Gateway not initialized" };
    }
    try {
      return await this.gateway.getStatus();
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }
}