# CC Discord Bot

A Discord bot that integrates Claude Code into Discord channels, enabling AI-powered assistance and automation.

## Features

- **Discord Integration**: Seamlessly connect Claude Code to your Discord server
- **Thread Management**: Automatically creates threads for organized conversations
- **Multi-language Support**: Available in English and Japanese
- **Never Sleep Mode**: Automatically executes tasks when idle
- **Debug Mode**: Test functionality without making API calls
- **Session Management**: Resume previous conversations

## Prerequisites

- [Deno](https://deno.land/) 1.40 or later
- Discord Bot Token
- Claude Code CLI installed and authenticated

## How to use

### Setup

```bash
CC_DISCORD_TOKEN=your-discord-bot-token
CC_DISCORD_CHANNEL_ID=your-channel-id
CC_DISCORD_USER_ID=your-user-id
```

### Run

```bash
deno run -A jsr:@mizchi/ccdiscord
```

### CLI Installation

2. Install globally (optional):

```bash
$ deno install -Afg @mizchi/ccdiscord
```

3. Clone the repository:

```bash
git clone https://github.com/mizchi/ccdiscord.git
cd ccdiscord
```

## Setup

### 0. Create Your Private Discord Server

⚠️ **Important**: First, create your own private Discord server for the bot:

1. Open Discord and click the "+" button in the server list
2. Select "Create My Own" → "For me and my friends"
3. Name your server (e.g., "Claude Code Bot")
4. Right-click on a channel and copy the Channel ID (you'll need this later)

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section in the left sidebar
4. Click "Add Bot"
5. Under "Token", click "Copy" to get your bot token
6. In the "Privileged Gateway Intents" section, enable:
   - Message Content Intent
7. Go to "OAuth2" → "General" in the left sidebar
8. Copy the "CLIENT ID"

### 2. Invite Bot to Your Server

1. Go to "OAuth2" → "URL Generator" in the left sidebar
2. Select the following scopes:
   - `bot`
3. Select the following bot permissions:
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Read Message History
4. Copy the generated URL and open it in your browser
5. Select your private server and click "Authorize"

### 3. Set Environment Variables

Create a `.env` file in the project directory:

```bash
# Discord configuration (Required)
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CHANNEL_ID=your_channel_id_here  # From your private server

# Optional
SESSION_ID=unique_session_id  # For conversation continuity
DEBUG_MODE=false              # Set to true for testing without API calls
NEVER_SLEEP=false            # Set to true for auto-task execution
```

**Note**: The bot also supports legacy environment variable names:

- `CC_DISCORD_TOKEN` → `DISCORD_BOT_TOKEN`
- `CC_DISCORD_USER_ID` → `DISCORD_CLIENT_ID`
- `CC_DISCORD_CHANNEL_ID` → `DISCORD_CHANNEL_ID`

**Important**: Claude Code uses internal authentication. Do NOT set `ANTHROPIC_API_KEY` as it may cause unexpected billing charges.

### Security Settings

1. **Claude Code Permission Mode**:
   ```bash
   CLAUDE_PERMISSION_MODE=ask  # Default: "ask" (recommended)
   ```
   - `ask`: Prompt for user confirmation before executing commands (recommended)
   - `bypassPermissions`: Execute commands without confirmation (dangerous)

2. **Multi-User Access Control**:
   ```bash
   DISCORD_ALLOWED_USERS=user_id1,user_id2,user_id3
   ```
   - Comma-separated list of Discord user IDs allowed to use the bot
   - If not set, only the `DISCORD_CLIENT_ID` user can access

3. **Audit Logging**:
   - All user actions, auth failures, and bot responses are logged to `./logs/audit/`
   - Logs are in JSON format with daily rotation

4. **Shell Command Execution**:
   - Shell command execution (`!command`) is disabled for security reasons
   - If needed, modify the source code to implement with a whitelist approach

## Usage

### Basic Usage

Start the bot:

```bash
deno run -A --env ccdiscord.ts
```

Or if installed globally:

```bash
ccdiscord
```

### Command Line Options

```
Options:
  -c, --continue        Continue from the last session
  -r, --resume <id>     Resume a specific session by ID
  --list-sessions       List all resumable sessions
  -s, --select          Select a session interactively
  --never-sleep         Enable Never Sleep mode (auto-execute tasks)
  -d, --debug           Enable debug mode (use DebugActor instead of ClaudeCode)
  -h, --help            Show help message
  -l, --locale <lang>   Set language (ja/en)
```

### Examples

Start in debug mode (no API calls):

```bash
ccdiscord --debug
```

Continue from last session:

```bash
ccdiscord --continue
```

Start with Japanese language:

```bash
ccdiscord --locale ja
```

Enable Never Sleep mode:

```bash
ccdiscord --never-sleep
```

## Discord Commands

Once the bot is running, you can use these commands in the Discord thread:

- `!reset` or `!clear` - Reset the conversation
- `!stop` - Stop running tasks
- `!exit` - Shut down the bot
- `!<command>` - Execute shell commands
- Regular messages - Ask Claude for assistance

## Architecture

The bot uses an Actor-based architecture:

- **UserActor**: Handles user input and routing
- **ClaudeCodeActor**: Communicates with Claude API
- **DebugActor**: Provides mock responses for testing
- **AutoResponderActor**: Manages Never Sleep mode
- **DiscordAdapter**: Manages Discord connection
- **MessageBus**: Routes messages between actors

## Development

### Running Tests

```bash
deno test --allow-all
```

### Project Structure

```
ccdiscord/
├── src/
│   ├── actors/          # Actor implementations
│   ├── adapter/         # External service adapters
│   ├── tests/           # Test files
│   ├── cli.ts           # CLI option handling
│   ├── config.ts        # Configuration management
│   ├── i18n.ts          # Internationalization
│   ├── main.ts          # Entry point
│   ├── message-bus.ts   # Message routing
│   └── types.ts         # Type definitions
├── ccdiscord.ts         # Main executable
├── README.md            # This file
└── README-ja.md         # Japanese documentation
```

## Configuration

The bot can be configured through environment variables:

- `DISCORD_BOT_TOKEN` or `CC_DISCORD_TOKEN`: Discord bot token (required)
- `DISCORD_CHANNEL_ID` or `CC_DISCORD_CHANNEL_ID`: Discord channel ID (required)
- `DISCORD_CLIENT_ID` or `CC_DISCORD_USER_ID`: Discord client/user ID (required)
- `LANG`: System locale for automatic language detection

**Note**: Claude Code uses internal authentication. Do not set `ANTHROPIC_API_KEY`.

## Security Notice

This bot has strong permissions and executes commands. Use with caution and only in trusted environments.

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
