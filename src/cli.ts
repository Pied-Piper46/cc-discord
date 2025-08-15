#!/usr/bin/env -S deno run -A --env

import { parseArgs } from "node:util";
import { $ } from "@david/dax";
import { i18n, t, type Locale } from "./i18n.ts";

// CLI option type definitions
export interface CliOptions {
  continue: boolean;
  resume?: string;
  listSessions: boolean;
  select: boolean;
  neverSleep: boolean;
  help: boolean;
  locale?: string;
  permissionMode?: string;
  logs?: string;
}

// Parse CLI options
export function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    args: Deno.args,
    options: {
      continue: {
        type: "boolean",
        short: "c",
        default: false,
      },
      resume: {
        type: "string",
        short: "r",
      },
      "list-sessions": {
        type: "boolean",
        default: false,
      },
      select: {
        type: "boolean",
        short: "s",
        default: false,
      },
      "never-sleep": {
        type: "boolean",
        default: false,
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
      locale: {
        type: "string",
        short: "l",
      },
      "permission-mode": {
        type: "string",
        short: "p",
      },
      logs: {
        type: "string",
      },
    },
  });

  return {
    continue: values.continue as boolean,
    resume: values.resume as string | undefined,
    listSessions: values["list-sessions"] as boolean,
    select: values.select as boolean,
    neverSleep: values["never-sleep"] as boolean,
    help: values.help as boolean,
    locale: values.locale as string | undefined,
    permissionMode: values["permission-mode"] as string | undefined,
    logs: values.logs as string | undefined,
  };
}

// Display help message
export function showHelp(): void {
  console.log(`
${t("cli.help.title")}

${t("cli.help.usage")}

Options:
  -c, --continue        ${t("cli.help.options.continue")}
  -r, --resume <id>     ${t("cli.help.options.resume")}
  --list-sessions       ${t("cli.help.options.listSessions")}
  -s, --select          ${t("cli.help.options.select")}
  --never-sleep         ${t("cli.help.options.neverSleep")}
  -h, --help            ${t("cli.help.options.help")}
  -l, --locale <lang>   ${t("cli.help.options.locale")}
  -p, --permission-mode <mode> Set Claude permission mode (ask/auto/bypassPermissions)
  --logs <path>         Enable audit logging to specified file

${t("cli.help.envVars.title")}
  CC_DISCORD_TOKEN      ${t("cli.help.envVars.token")}
  CC_DISCORD_CHANNEL_ID ${t("cli.help.envVars.channelId")}
  CC_DISCORD_USER_ID    ${t("cli.help.envVars.userId")}

${t("cli.help.examples.title")}
  ${t("cli.help.examples.newSession")}
  deno run -A --env ccdiscord.ts

  ${t("cli.help.examples.continueSession")}
  deno run -A --env ccdiscord.ts -c

  ${t("cli.help.examples.resumeSession")}
  deno run -A --env ccdiscord.ts -r session-id


  ${t("cli.help.examples.neverSleepMode")}
  deno run -A --env ccdiscord.ts --never-sleep
`);
}

// Validate options
export function validateOptions(options: CliOptions): void {
  // Set locale if specified
  if (options.locale) {
    const validLocales: Locale[] = ["ja", "en"];
    if (validLocales.includes(options.locale as Locale)) {
      i18n.setLocale(options.locale as Locale);
    }
  }
  
  // Validate permission mode if specified
  if (options.permissionMode) {
    const validModes = ["ask", "auto", "bypassPermissions"];
    if (!validModes.includes(options.permissionMode)) {
      console.error(`Invalid permission mode: ${options.permissionMode}. Valid modes are: ${validModes.join(", ")}`);
      Deno.exit(1);
    }
    // Convert "auto" to undefined to use Claude Code's default
    if (options.permissionMode === "auto") {
      options.permissionMode = undefined;
    }
  }
  
  // --continue and --resume are mutually exclusive
  if (options.continue && options.resume) {
    console.error(t("cli.errors.continueResumeConflict"));
    Deno.exit(1);
  }

  // --select is mutually exclusive with other session-related options
  if (options.select && (options.continue || options.resume)) {
    console.error(t("cli.errors.selectConflict"));
    Deno.exit(1);
  }
}

// Session selection (interactive)
export async function selectSession(): Promise<string | undefined> {
  // TODO: Port implementation from session management module
  console.log(t("cli.sessionNotImplemented"));
  return undefined;
}

// Display session list
export async function listSessions(): Promise<void> {
  // TODO: Port implementation from session management module
  console.log(t("cli.sessionListNotImplemented"));
}
