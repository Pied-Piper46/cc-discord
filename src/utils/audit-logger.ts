// Audit logger for security events
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

export interface AuditEvent {
  timestamp: Date;
  eventType:
    | "AUTH_FAILED"
    | "COMMAND_BLOCKED"
    | "USER_MESSAGE"
    | "BOT_RESPONSE"
    | "SESSION_START"
    | "SESSION_END";
  userId?: string;
  username?: string;
  channelId?: string;
  details: Record<string, unknown>;
}

export class AuditLogger {
  private logDir: string;
  private currentLogFile: string;

  constructor(logDir = "./logs/audit") {
    this.logDir = logDir;
    const dateStr = new Date().toISOString().split("T")[0];
    this.currentLogFile = join(logDir, `audit-${dateStr}.log`);
  }

  async init(): Promise<void> {
    await ensureDir(this.logDir);
  }

  async log(event: AuditEvent): Promise<void> {
    const logEntry = {
      ...event,
      timestamp: event.timestamp.toISOString(),
    };

    const logLine = JSON.stringify(logEntry) + "\n";

    try {
      await Deno.writeTextFile(this.currentLogFile, logLine, { append: true });
    } catch (error) {
      console.error("[AuditLogger] Failed to write log:", error);
    }
  }

  async logAuthFailure(userId: string, channelId: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      eventType: "AUTH_FAILED",
      userId,
      channelId,
      details: {
        reason: "User not in allowed list",
      },
    });
  }

  async logUserMessage(
    userId: string,
    username: string,
    channelId: string,
    message: string
  ): Promise<void> {
    await this.log({
      timestamp: new Date(),
      eventType: "USER_MESSAGE",
      userId,
      username,
      channelId,
      details: {
        message: message.substring(0, 200), // Truncate for privacy
        messageLength: message.length,
      },
    });
  }

  async logBotResponse(channelId: string, responseType: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      eventType: "BOT_RESPONSE",
      channelId,
      details: {
        responseType,
      },
    });
  }

  async logSessionStart(sessionId: string, workDir: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      eventType: "SESSION_START",
      details: {
        sessionId,
        workDir,
      },
    });
  }

  async logSessionEnd(sessionId: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      eventType: "SESSION_END",
      details: {
        sessionId,
      },
    });
  }
}
