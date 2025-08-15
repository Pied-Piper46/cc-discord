import { ensureFile } from "https://deno.land/std@0.220.0/fs/ensure_file.ts";

export interface AuditLogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  actor?: string;
  action: string;
  details?: Record<string, unknown>;
  error?: string;
}

export class AuditLogger {
  private logPath?: string;
  private writeStream?: WritableStream<string>;
  private writer?: WritableStreamDefaultWriter<string>;

  constructor(logPath?: string) {
    this.logPath = logPath;
  }

  async init(): Promise<void> {
    if (!this.logPath) return;

    try {
      await ensureFile(this.logPath);
      const file = await Deno.open(this.logPath, {
        write: true,
        append: true,
        create: true,
      });
      
      const encoder = new TextEncoderStream();
      this.writeStream = encoder.writable;
      this.writer = this.writeStream.getWriter();
      
      encoder.readable.pipeTo(file.writable).catch((error) => {
        console.error("Error writing to log file:", error);
      });
    } catch (error) {
      console.error(`Failed to initialize audit logger: ${error}`);
      this.logPath = undefined;
    }
  }

  async log(entry: AuditLogEntry): Promise<void> {
    if (!this.logPath || !this.writer) return;

    const logLine = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    }) + "\n";

    try {
      await this.writer.write(logLine);
    } catch (error) {
      console.error(`Failed to write audit log: ${error}`);
    }
  }

  async logInfo(actor: string, action: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: "INFO",
      actor,
      action,
      details,
    });
  }

  async logWarn(actor: string, action: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: "WARN",
      actor,
      action,
      details,
    });
  }

  async logError(actor: string, action: string, error: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      actor,
      action,
      error,
      details,
    });
  }

  async logDebug(actor: string, action: string, details?: Record<string, unknown>): Promise<void> {
    await this.log({
      timestamp: new Date().toISOString(),
      level: "DEBUG",
      actor,
      action,
      details,
    });
  }

  async close(): Promise<void> {
    if (this.writer) {
      try {
        await this.writer.close();
      } catch (error) {
        console.error(`Failed to close audit logger: ${error}`);
      }
    }
  }
}