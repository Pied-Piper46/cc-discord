// i18n module for multi-language support

export type Locale = "ja" | "en";

interface LocaleMessages {
  // Setup messages
  setup: {
    title: string;
    missingEnv: string;
    discordSetup: string;
    createPrivateServer: string;
    createBot: string;
    portal: string;
    getToken: string;
    getClientId: string;
    inviteBot: string;
    permissions: string;
    envFile: string;
    envContent: string;
    optionalConfig: string;
    sessionConfig: string;
    sessionExample: string;
    debugConfig: string;
    debugExample: string;
    neverSleepConfig: string;
    neverSleepExample: string;
    runCommand: string;
    runExample: string;
    moreInfo: string;
  };
  validation: {
    discordTokenMissing: string;
    discordClientIdMissing: string;
    discordChannelIdMissing: string;
  };
  config: {
    warnings: {
      apiKeyNotNeeded: string;
      apiKeyBillingRisk: string;
      apiKeyIgnored: string;
    };
  };

  // CLI messages
  cli: {
    help: {
      title: string;
      usage: string;
      options: {
        continue: string;
        resume: string;
        listSessions: string;
        select: string;
        neverSleep: string;
        debug: string;
        help: string;
        locale: string;
      };
      envVars: {
        title: string;
        token: string;
        channelId: string;
        userId: string;
      };
      examples: {
        title: string;
        newSession: string;
        continueSession: string;
        resumeSession: string;
        debugMode: string;
        neverSleepMode: string;
      };
    };
    errors: {
      continueResumeConflict: string;
      selectConflict: string;
      sessionNotSelected: string;
      configLoadFailed: string;
    };
    sessionNotImplemented: string;
    sessionListNotImplemented: string;
  };

  // Main messages
  main: {
    startup: {
      title: string;
      mode: string;
      neverSleep: string;
      resumeSession: string;
      newSession: string;
    };
    debug: {
      running: string;
      userResponse: string;
      assistantResponse: string;
      neverSleepDemo: string;
      autoResponderResponse: string;
    };
    discord: {
      connected: string;
      shutdown: string;
      connectionError: string;
    };
    fatalError: string;
  };

  // Discord adapter messages
  discord: {
    starting: string;
    stopping: string;
    goodbye: string;
    ready: string;
    threadCreated: string;
    failedLogin: string;
    failedGoodbye: string;
    failedSetup: string;
    failedCreateThread: string;
    failedSendMessage: string;
    userNotAllowed: string;
    clientError: string;
    sessionInfo: {
      title: string;
      startTime: string;
      workDir: string;
      mode: string;
      neverSleepEnabled: string;
    };
    instructions: {
      header: string;
      reset: string;
      stop: string;
      exit: string;
      shellCommand: string;
      normalMessage: string;
    };
    receivedMessage: string;
    commands: {
      resetComplete: string;
      stopComplete: string;
      exitMessage: string;
      executing: string;
    };
  };

  // Actor messages
  actors: {
    starting: string;
    stopping: string;
    messageReceived: string;
    processing: string;
    error: string;
  };
}

const messages: Record<Locale, LocaleMessages> = {
  ja: {
    setup: {
      title: "🚀 セットアップガイド",
      missingEnv: "必要な環境変数が設定されていません",
      discordSetup: "Discord Bot のセットアップ",
      createPrivateServer: "0. まず、あなた専用のプライベートDiscordサーバーを作成してください",
      createBot: "1. Discord Developer Portal でボットを作成:",
      portal: "   https://discord.com/developers/applications",
      getToken: "2. Bot タブから TOKEN を取得",
      getClientId: "3. OAuth2 タブから CLIENT ID を取得", 
      inviteBot: "4. OAuth2 URL Generator で bot スコープと以下の権限を選択:",
      permissions: "   - Send Messages\n   - Create Public Threads\n   - Send Messages in Threads\n   - Read Message History",
      envFile: "5. .env ファイルを作成:",
      envContent: `   DISCORD_BOT_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here  
   DISCORD_CHANNEL_ID=your_channel_id_here  # プライベートサーバーのチャンネルID`,
      optionalConfig: "オプション設定",
      sessionConfig: "セッション管理:",
      sessionExample: "   SESSION_ID=unique_session_id  # 会話の継続用",
      debugConfig: "デバッグモード:",
      debugExample: "   DEBUG_MODE=true  # Claude APIを使用しないデバッグモード",
      neverSleepConfig: "Never Sleep モード:",
      neverSleepExample: "   NEVER_SLEEP=true  # 自動タスク実行モード",
      runCommand: "実行方法",
      runExample: "deno run -A --env src/main.ts",
      moreInfo: "詳細は README.md を参照してください",
    },
    validation: {
      discordTokenMissing: "DISCORD_BOT_TOKEN が設定されていません",
      discordClientIdMissing: "DISCORD_CLIENT_ID が設定されていません", 
      discordChannelIdMissing: "DISCORD_CHANNEL_ID が設定されていません",
    },
    config: {
      warnings: {
        apiKeyNotNeeded: "警告: ANTHROPIC_API_KEY が設定されていますが、Claude Code は内部認証を使用するため不要です。",
        apiKeyBillingRisk: "この API キーを設定すると予期しない課金が発生する可能性があります。",
        apiKeyIgnored: "設定された API キーは無視されます。環境変数から削除することを推奨します。",
      },
    },
    cli: {
      help: {
        title: "CC Discord Bot - Claude Code Discord 統合",
        usage: "使用方法: deno run -A --env ccdiscord.ts [オプション]",
        options: {
          continue: "最後のセッションから続行",
          resume: "特定のセッションをIDで再開",
          listSessions: "再開可能なセッション一覧を表示",
          select: "セッションを対話的に選択",
          neverSleep: "Never Sleepモードを有効化（タスク自動実行）",
          debug:
            "デバッグモードを有効化（ClaudeCodeの代わりにDebugActorを使用）",
          help: "このヘルプメッセージを表示",
          locale: "言語を設定 (ja/en)",
        },
        envVars: {
          title: "環境変数:",
          token: "Discord ボットトークン（必須）",
          channelId: "Discord チャンネルID（必須）",
          userId: "Discord ユーザーID（必須）",
        },
        examples: {
          title: "例:",
          newSession: "# 新しいセッションを開始",
          continueSession: "# 最後のセッションから続行",
          resumeSession: "# 特定のセッションを再開",
          debugMode: "# デバッグモード（Claude APIを呼び出さない）",
          neverSleepMode: "# Never Sleepモード",
        },
      },
      errors: {
        continueResumeConflict:
          "エラー: --continue と --resume は同時に使用できません",
        selectConflict:
          "エラー: --select は --continue や --resume と同時に使用できません",
        sessionNotSelected: "セッションが選択されませんでした",
        configLoadFailed: "設定の読み込みに失敗しました",
      },
      sessionNotImplemented: "セッション選択機能は後で実装します",
      sessionListNotImplemented: "セッション一覧機能は後で実装します",
    },
    main: {
      startup: {
        title: "CC Discord Bot 起動完了",
        mode: "モード",
        neverSleep: "Never Sleep",
        resumeSession: "セッション再開",
        newSession: "新規セッション",
      },
      debug: {
        running: "デバッグモード: デモ会話を実行中...",
        userResponse: "UserActor レスポンス:",
        assistantResponse: "アシスタント レスポンス:",
        neverSleepDemo: "Never Sleepモード デモ...",
        autoResponderResponse: "AutoResponder レスポンス:",
      },
      discord: {
        connected: "Discordに接続しました。",
        shutdown: "終了処理を開始します...",
        connectionError: "Discord接続エラー:",
      },
      fatalError: "致命的なエラー:",
    },
    discord: {
      starting: "Discord アダプターを起動中...",
      stopping: "Discord アダプターを停止中...",
      goodbye: "👋 ボットを終了します",
      ready: "Discord ボット準備完了:",
      threadCreated: "スレッド作成完了:",
      failedLogin: "ログインに失敗しました:",
      failedGoodbye: "終了メッセージの送信に失敗しました:",
      failedSetup: "チャンネルのセットアップに失敗しました:",
      failedCreateThread: "スレッドの作成に失敗しました:",
      failedSendMessage: "メッセージの送信に失敗しました:",
      userNotAllowed: "このボットを使用する権限がありません。",
      clientError: "Discord クライアントエラー:",
      sessionInfo: {
        title: "セッション情報",
        startTime: "開始時刻",
        workDir: "作業ディレクトリ",
        mode: "モード",
        neverSleepEnabled: "Never Sleep モード: 有効",
      },
      instructions: {
        header:
          "このスレッドでメッセージを送信すると、Claude Code が応答します。",
        reset: "会話をリセット",
        stop: "実行中のタスクを中断",
        exit: "ボットを終了",
        shellCommand: "シェルコマンドを実行",
        normalMessage: "通常のメッセージ: Claude に問い合わせ",
      },
      receivedMessage: "メッセージ受信:",
      commands: {
        resetComplete: "💫 会話をリセットしました。新しい会話を始めましょう！",
        stopComplete: "⛔ 実行中のタスクを停止しました。",
        exitMessage: "👋 ボットを終了します。",
        executing: "実行中:",
      },
    },
    actors: {
      starting: "起動中",
      stopping: "停止中",
      messageReceived: "メッセージ受信",
      processing: "処理中",
      error: "エラー",
    },
  },
  en: {
    setup: {
      title: "🚀 Setup Guide",
      missingEnv: "Required environment variables are not set",
      discordSetup: "Discord Bot Setup",
      createPrivateServer: "0. First, create your own private Discord server",
      createBot: "1. Create a bot on Discord Developer Portal:",
      portal: "   https://discord.com/developers/applications",
      getToken: "2. Get TOKEN from Bot tab",
      getClientId: "3. Get CLIENT ID from OAuth2 tab",
      inviteBot: "4. Select bot scope and following permissions in OAuth2 URL Generator:",
      permissions: "   - Send Messages\n   - Create Public Threads\n   - Send Messages in Threads\n   - Read Message History",
      envFile: "5. Create .env file:",
      envContent: `   DISCORD_BOT_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   DISCORD_CHANNEL_ID=your_channel_id_here  # Your private server's channel ID`,
      optionalConfig: "Optional Configuration",
      sessionConfig: "Session Management:",
      sessionExample: "   SESSION_ID=unique_session_id  # For conversation continuity",
      debugConfig: "Debug Mode:",
      debugExample: "   DEBUG_MODE=true  # Debug mode without Claude API",
      neverSleepConfig: "Never Sleep Mode:",
      neverSleepExample: "   NEVER_SLEEP=true  # Automatic task execution mode",
      runCommand: "How to Run",
      runExample: "deno run -A --env src/main.ts",
      moreInfo: "See README.md for more details",
    },
    validation: {
      discordTokenMissing: "DISCORD_BOT_TOKEN is not set",
      discordClientIdMissing: "DISCORD_CLIENT_ID is not set",
      discordChannelIdMissing: "DISCORD_CHANNEL_ID is not set",
    },
    config: {
      warnings: {
        apiKeyNotNeeded: "Warning: ANTHROPIC_API_KEY is set but not needed. Claude Code uses internal authentication.",
        apiKeyBillingRisk: "Setting this API key may cause unexpected billing charges.",
        apiKeyIgnored: "The API key will be ignored. We recommend removing it from environment variables.",
      },
    },
    cli: {
      help: {
        title: "CC Discord Bot - Claude Code Discord Integration",
        usage: "Usage: deno run -A --env ccdiscord.ts [options]",
        options: {
          continue: "Continue from the last session",
          resume: "Resume a specific session by ID",
          listSessions: "List all resumable sessions",
          select: "Select a session interactively",
          neverSleep: "Enable Never Sleep mode (auto-execute tasks)",
          debug: "Enable debug mode (use DebugActor instead of ClaudeCode)",
          help: "Show this help message",
          locale: "Set language (ja/en)",
        },
        envVars: {
          title: "Environment Variables:",
          token: "Discord bot token (required)",
          channelId: "Discord channel ID (required)",
          userId: "Discord user ID (required)",
        },
        examples: {
          title: "Examples:",
          newSession: "# Start a new session",
          continueSession: "# Continue from the last session",
          resumeSession: "# Resume a specific session",
          debugMode: "# Debug mode (no Claude API calls)",
          neverSleepMode: "# Never Sleep mode",
        },
      },
      errors: {
        continueResumeConflict:
          "Error: --continue and --resume cannot be used together",
        selectConflict:
          "Error: --select cannot be used with --continue or --resume",
        sessionNotSelected: "No session was selected",
        configLoadFailed: "Failed to load configuration",
      },
      sessionNotImplemented:
        "Session selection feature will be implemented later",
      sessionListNotImplemented:
        "Session list feature will be implemented later",
    },
    main: {
      startup: {
        title: "CC Discord Bot Started",
        mode: "Mode",
        neverSleep: "Never Sleep",
        resumeSession: "Resume Session",
        newSession: "New Session",
      },
      debug: {
        running: "Debug mode: Running demo conversation...",
        userResponse: "UserActor response:",
        assistantResponse: "Assistant response:",
        neverSleepDemo: "Never Sleep mode demo...",
        autoResponderResponse: "AutoResponder response:",
      },
      discord: {
        connected: "Connected to Discord.",
        shutdown: "Starting shutdown process...",
        connectionError: "Discord connection error:",
      },
      fatalError: "Fatal error:",
    },
    discord: {
      starting: "Starting Discord adapter...",
      stopping: "Stopping Discord adapter...",
      goodbye: "👋 Shutting down bot",
      ready: "Discord bot ready:",
      threadCreated: "Thread created:",
      failedLogin: "Failed to login:",
      failedGoodbye: "Failed to send goodbye message:",
      failedSetup: "Failed to setup channel:",
      failedCreateThread: "Failed to create thread:",
      failedSendMessage: "Failed to send message:",
      userNotAllowed: "You are not authorized to use this bot.",
      clientError: "Discord client error:",
      sessionInfo: {
        title: "Session Information",
        startTime: "Start Time",
        workDir: "Working Directory",
        mode: "Mode",
        neverSleepEnabled: "Never Sleep Mode: Enabled",
      },
      instructions: {
        header: "Send a message in this thread and Claude Code will respond.",
        reset: "Reset conversation",
        stop: "Stop running tasks",
        exit: "Exit bot",
        shellCommand: "Execute shell command",
        normalMessage: "Regular message: Ask Claude",
      },
      receivedMessage: "Received message from",
      commands: {
        resetComplete: "💫 Conversation reset. Let's start a new conversation!",
        stopComplete: "⛔ Stopped running tasks.",
        exitMessage: "👋 Shutting down bot.",
        executing: "Executing:",
      },
    },
    actors: {
      starting: "Starting",
      stopping: "Stopping",
      messageReceived: "Message received",
      processing: "Processing",
      error: "Error",
    },
  },
};

class I18n {
  private locale: Locale;

  constructor(locale?: Locale) {
    this.locale = locale || this.detectSystemLocale();
  }

  private detectSystemLocale(): Locale {
    // Try to detect from environment variables
    const lang = Deno.env.get("LANG") || Deno.env.get("LANGUAGE") || "";
    if (lang.startsWith("ja")) return "ja";

    // Default to English
    return "en";
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  getLocale(): Locale {
    return this.locale;
  }

  t(key: string): string {
    const keys = key.split(".");
    let value: any = messages[this.locale];

    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) {
        // Fallback to English if key not found
        value = messages.en;
        for (const k2 of keys) {
          value = value?.[k2];
          if (value === undefined) break;
        }
        break;
      }
    }

    return typeof value === "string" ? value : key;
  }
}

// Global i18n instance
export const i18n = new I18n();

// Helper function for template literals
export function t(key: string): string {
  return i18n.t(key);
}

// Show setup instructions
export function showSetupInstructions(missingVars: string[]) {
  console.log(`\n${t("setup.title")}\n`);
  console.log(`${t("setup.missingEnv")}:\n`);
  
  missingVars.forEach(varName => {
    console.log(`  ❌ ${varName}`);
  });
  
  console.log("\n" + "=".repeat(50) + "\n");
  
  // Discord setup if needed
  if (missingVars.some(v => v.startsWith("DISCORD_"))) {
    console.log(`${t("setup.discordSetup")}\n`);
    console.log(`⚠️  ${t("setup.createPrivateServer")}\n`);
    console.log(t("setup.createBot"));
    console.log(t("setup.portal"));
    console.log(t("setup.getToken"));
    console.log(t("setup.getClientId"));
    console.log(t("setup.inviteBot"));
    console.log(t("setup.permissions"));
    console.log(t("setup.envFile"));
    console.log(t("setup.envContent"));
    console.log();
  }
  
  // Optional configuration
  console.log(`${t("setup.optionalConfig")}\n`);
  console.log(t("setup.sessionConfig"));
  console.log(t("setup.sessionExample"));
  console.log();
  console.log(t("setup.debugConfig"));
  console.log(t("setup.debugExample"));
  console.log();
  console.log(t("setup.neverSleepConfig"));
  console.log(t("setup.neverSleepExample"));
  console.log();
  
  // Run command
  console.log(`${t("setup.runCommand")}\n`);
  console.log(t("setup.runExample"));
  console.log();
  console.log(t("setup.moreInfo"));
  console.log("=".repeat(50) + "\n");
}
