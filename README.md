# Packet Logger

A comprehensive network packet logger for Tera Toolbox that captures ALL network packets sent to and from the server.

## Features

- Captures all client->server and server->client packets
- Logs raw packet data in hexadecimal format
- **Translates numeric opcodes to human-readable names** (e.g., `61655` → `C_PLAYER_LOCATION`)
- **Blacklist system to ignore high-frequency, low-value packets**
- **Custom packet parsing and readable field descriptions**
- Includes timestamps, packet direction, opcode, and size
- Saves logs to timestamped files
- Provides packet counters and statistics
- Easy to use in-game commands
- Opcode lookup functionality

## Usage

### Commands

- `/packetlogger start` - Start logging all packets
- `/packetlogger stop` - Stop logging and close log file
- `/packetlogger status` - Show current status and statistics
- `/packetlogger clear` - Clear packet counters
- `/packetlogger lookup <opcode>` - Look up opcode by number or name
- `/packetlogger blacklist list` - Show all blacklisted packets
- `/packetlogger blacklist add <packet>` - Add packet to blacklist
- `/packetlogger blacklist remove <packet>` - Remove packet from blacklist
- `/packetlogger blacklist toggle` - Enable/disable blacklist
- `/packetlogger descriptions list` - Show configured packet descriptions
- `/packetlogger descriptions toggle` - Enable/disable packet descriptions

### Log Format

Each log entry follows this format:
```
[Timestamp] [Direction] [Opcode Name (Number)] [Size] [Hex Data] | [Parsed Info]
```

Example with opcode translation and parsing:
```
[2024-01-15T10:30:45.123Z] [RECEIVED] [S_SPAWN_NPC (12345)] [25 bytes] [190000001234567890abcdef1234567890abcdef1234567890abcdef1234567890] | NPC 12345678 at (123.45, 67.89, 12.34) (aggressive: true)
```

### Packet Descriptions System

The packet descriptions system allows you to define custom parsing and formatting for specific packet types. This makes logs much more readable by extracting and displaying relevant information.

**Configuration File:** `packet-descriptions.json`

**Example Configuration:**
```json
{
  "S_SPAWN_NPC": {
    "description": "NPC spawned",
    "fields": ["gameId", "loc", "aggressive"],
    "format": "NPC {gameId} at {loc} (aggressive: {aggressive})"
  },
  "S_CHAT": {
    "description": "Chat message",
    "fields": ["name", "message", "channel"],
    "format": "[{channel}] {name}: {message}"
  }
}
```

**Available Fields:**
- `gameId` - Entity game ID
- `loc` - Location coordinates (x, y, z)
- `name` - Player/NPC name
- `message` - Chat message content
- `channel` - Chat channel
- `level` - Player level
- `aggressive` - NPC aggression status
- `target` - Target entity
- `id` - Effect/skill ID
- `duration` - Effect duration
- `skill` - Skill name
- `stage` - Action stage
- `zone` - Zone ID
- `type` - Movement type

### Blacklist System

The blacklist automatically filters out high-frequency packets that typically aren't useful for analysis:

**Default Blacklisted Packets:**
- `S_RESPONSE_GAMESTAT_PONG` - Ping responses (very frequent)
- `S_SOCIAL` - Social interactions (very frequent)
- `C_PLAYER_LOCATION` - Player movement (very frequent)
- `S_NPC_LOCATION` - NPC movement (very frequent)
- `S_USER_LOCATION` - Other player movement (very frequent)
- `S_CREATURE_ROTATE` - Creature rotation (very frequent)
- `C_REQUEST_GAMESTAT_PING` - Ping requests (very frequent)
- `S_ABNORMALITY_BEGIN/REFRESH/END` - Buff/debuff updates (very frequent)
- `S_ACTION_STAGE/END` - Combat actions (very frequent)
- `S_SPAWN/DESPAWN_NPC/USER` - Entity spawning (very frequent)

**Blacklist Commands:**
- `/packetlogger blacklist list` - View all blacklisted packets
- `/packetlogger blacklist add S_CHAT` - Add chat packets to blacklist
- `/packetlogger blacklist remove C_PLAYER_LOCATION` - Remove movement packets from blacklist
- `/packetlogger blacklist toggle` - Enable/disable blacklist entirely

### Opcode Translation

The module automatically loads opcode mappings from the protocol files and translates numeric opcodes to their human-readable names:

- `61655` → `C_PLAYER_LOCATION`
- `59350` → `S_CHAT`
- `57309` → `C_LOGIN_ARBITER`

### Opcode Lookup

Use the lookup command to find opcodes:

- `/packetlogger lookup 61655` - Find name for opcode number
- `/packetlogger lookup C_PLAYER_LOCATION` - Find number for opcode name
- `/packetlogger lookup CHAT` - Search for opcodes containing "CHAT"

### Configuration

You can control various settings in the config:

- `showOpcodeNames: true` - Show both name and number (default)
- `showOpcodeNames: false` - Show only numbers
- `useBlacklist: true` - Enable blacklist filtering (default)
- `useBlacklist: false` - Disable blacklist filtering
- `usePacketDescriptions: true` - Enable packet parsing (default)
- `usePacketDescriptions: false` - Disable packet parsing

### Log Files

Log files are saved in the `mods/packet-logger/logs/` directory with timestamps:
- `packet-log-2024-01-15T10-30-45-123Z.log`

## Performance Note

This module captures ALL packets, which can generate large log files quickly. The blacklist system helps reduce log size by filtering out high-frequency packets. Use with caution in busy areas or during extended gameplay sessions.

## Installation

1. Place this module in your `mods/` directory
2. Restart Starscape Toolbox
3. Use `/packetlogger start` to begin logging

## Troubleshooting

- If logs aren't being created, check that the `logs/` directory exists
- Large log files may impact performance - stop logging when not needed
- Log files can be opened with any text editor or hex viewer
- If opcode names aren't showing, check that the protocol map file exists for your game version
- If you're missing important packets, check the blacklist and remove unwanted filters
- If packet parsing isn't working, check the packet-descriptions.json file format

## Tested Versions

- Currently all testing has been performed on Starscape, Tera V100.
