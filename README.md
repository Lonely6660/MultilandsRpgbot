# Multilands RPG Bot

A comprehensive Discord bot for role-playing games with character management, battle systems, and interactive features.

## Features

### 🎭 Character Management
- **Create Characters**: Build detailed characters with custom avatars, stats, and backstories
- **Character Sheets**: View complete character information including health, sanity, level, and experience
- **Edit Characters**: Update character details anytime
- **Multiple Characters**: Manage multiple characters per user
- **Character Selection**: Set default characters for easy access

### ⚔️ Battle System
- **NPC Battles**: Fight against custom NPCs with unique stats and abilities
- **Turn-based Combat**: Strategic battle system with health and sanity mechanics
- **Battle Status**: Real-time battle tracking and status updates
- **Battle End**: Clean battle termination with proper cleanup

### 🗡️ Attack System
- **Create Attacks**: Design custom attacks with dice-based damage
- **Attack Types**: Slash, Pierce, Blunt, and Magic attack categories
- **Affinities**: Seven deadly sins affinities with unique effects:
  - **Wrath**: Extra damage after taking damage
  - **Lust**: Divides opponent's dice by 1.5x
  - **Sloth**: Reduces opponent sanity per damage
  - **Gluttony**: Steals sanity with each attack
  - **Greed**: Gets stronger over time
  - **Pride**: Reflects damage when health is low
  - **Envy**: Can lock enemy attacks
- **Attack Levels**: Level up attacks through usage
- **Perfect Hits**: Track perfect rolls for attack progression

### 🎲 Dice System
- **Custom Dice Notation**: Support for complex dice rolls (e.g., 2d6+3, 1d20-2)
- **Perfect Rolls**: Special recognition for maximum possible rolls
- **Rating System**: Visual feedback with custom GIFs for different roll qualities

### 🤖 Auto RP
- **Webhook Integration**: Automatically send messages as your character
- **Character Avatar**: Uses character avatars for immersive roleplay
- **Message Replacement**: Seamlessly replaces user messages with character messages

### 📊 Progression System
- **Experience Points**: Gain CXP (Character Experience Points) through battles
- **Level System**: Characters level up with increased stats
- **Attack Mastery**: Improve attacks through perfect hits

## Commands

### Character Commands
- `/character create` - Create a new character
- `/character sheet [name]` - View character details
- `/character edit [name]` - Edit character information
- `/character list` - List all your characters
- `/character delete [name]` - Delete a character

### Battle Commands
- `/battle start [opponent]` - Start a battle against an NPC
- `/battle status` - Check current battle status
- `/battle end` - End the current battle (admin only)

### Attack Commands
- `/attack create` - Create a new attack
- `/attack [attack_name]` - Use an attack in battle

### Utility Commands
- `/roll [dice]` - Roll dice (e.g., 1d20, 2d6+3)
- `/set-rating-gifs` - Manage custom rating GIFs

## Setup

### Prerequisites
- Node.js 16.0 or higher
- PostgreSQL database (Neon recommended)
- Discord Bot Token

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with:
   ```
   DISCORD_TOKEN=your_bot_token
   CLIENT_ID=your_client_id
   NEON_POSTGRES_URI=your_database_url
   TEST_GUILD_ID=your_test_server_id (optional)
   ```
4. Run the bot:
   ```bash
   node bot.js
   ```
5:Before dont forget to add a .gitignore file with your sensitive data!
### Database Setup
The bot automatically creates all necessary tables on startup:
- `characters` - Character data
- `attacks` - Attack definitions
- `character_attacks` - Character-attack relationships
- `npcs` - Non-player characters
- `battles` - Active battles
- `battle_participants` - Battle participants
- `affinities` - Attack affinities
- `attack_types` - Attack categories
- `user_rating_gifs` - Custom rating GIFs

## Development

### Project Structure
```
├── src/
│   ├── commands/
│   │   ├── character-updated.js
│   │   ├── battle.js
│   │   ├── attack.js
│   │   └── autorp.js
│   ├── utils/
│   │   ├── dice.js
│   │   └── gifs.js
│   └── database/
│       └── migrations.js
├── assets/
│   └── gifs/
├── bot.js
├── package.json
└── README.md
```

### Adding New Features
1. Create command files in `src/commands/`
2. Add utility functions in `src/utils/`
3. Update database schema in `initializeDatabase()`
4. Register new commands in the commands array

## Contributing
Made by lonely tamashi and the multilands team. Feel free to copy any scripts of this bot.

## License
This project is open source. Feel free to use and modify as needed.
