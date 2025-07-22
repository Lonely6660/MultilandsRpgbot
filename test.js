require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, WebhookClient, Collection } = require('discord.js');
const mongoose = require('mongoose');

// Initialize Discord client with all required intents
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.DirectMessages
  ],
  presence: {
    status: 'online'
  }
});

// Create collections for commands and cooldowns
client.commands = new Collection();
client.cooldowns = new Collection();

// Database connection with error handling
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// ========================
// DATABASE MODELS
// ========================

// Character Schema
const characterSchema = new mongoose.Schema({
  userId: String,
  name: String,
  avatarURL: String,
  strengths: [String],
  weaknesses: [String],
  affinity: { type: String, enum: ['Wrath', 'Lust', 'Sloth', 'Gluttony', 'Greed', 'Pride', 'Envy'] },
  attacks: [{
    name: String,
    type: { type: String, enum: ['Slash', 'Pierce', 'Blunt', 'Magic'] },
    diceSize: { type: Number, default: 4 },
    perfectRolls: { type: Number, default: 0 }
  }],
  sanity: { type: Number, default: 100, min: 0, max: 100 },
  cxp: { type: Number, default: 1 },
  level: { type: Number, default: 1 },
  inventory: [{
    name: String,
    description: String,
    effect: String,
    quantity: { type: Number, default: 1 }
  }],
  traits: [String],
  createdAt: { type: Date, default: Date.now }
});

// Battle Schema
const battleSchema = new mongoose.Schema({
  participants: [{
    userId: String,
    characterId: mongoose.Schema.Types.ObjectId,
    health: { type: Number, default: 100 }
  }],
  currentTurn: Number,
  turnCount: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'completed'], default: 'active' },
  winner: mongoose.Schema.Types.ObjectId,
  battleLog: [{
    action: String,
    userId: String,
    characterId: mongoose.Schema.Types.ObjectId,
    details: Object,
    timestamp: { type: Date, default: Date.now }
  }]
});

const Character = mongoose.model('Character', characterSchema);
const Battle = mongoose.model('Battle', battleSchema);

// ========================
// COMMAND HANDLING
// ========================

const commands = [
  {
    name: 'help',
    description: 'Show all available commands',
    async execute(message) {
      const embed = new EmbedBuilder()
        .setTitle('📜 Multilands RP Bot Commands')
        .setColor('#0099ff')
        .addFields(
          { name: '🛠️ Character Commands', value: 
            '`!createchar` - Create new character\n' +
            '`!profile [name]` - Switch active character\n' +
            '`!noprofile` - Return to normal identity\n' +
            '`!setavatar [name] [image]` - Set character avatar\n' +
            '`!showprofile [name]` - View character sheet'
          },
          { name: '⚔️ Combat Commands', value:
            '`!challenge @user` - Start a battle\n' +
            '`!attack [attack]` - Use an attack\n' +
            '`!defend` - Reduce next damage\n' +
            '`!forfeit` - End current battle'
          },
          { name: '🎒 Inventory Commands', value:
            '`!inventory` - View your items\n' +
            '`!use [item]` - Use an item\n' +
            '`!createitem [name]|[desc]|[effect]` - Make custom item'
          },
          { name: '💡 Other Commands', value:
            '`!roll [dice]` - Roll dice (e.g. 2d6)\n' +
            '`!sanity` - Check your sanity\n' +
            '`!levelup` - Spend CXP to level up'
          }
        );
      
      await message.reply({ embeds: [embed] });
    }
  },
  // Add all other commands here...
];

// Register commands
commands.forEach(cmd => {
  client.commands.set(cmd.name, cmd);
});

// ========================
// BOT EVENT HANDLERS
// ========================

// Ready event
client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('!help for commands', { type: 'PLAYING' });
});

// Message handler with fast response optimization
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // Handle commands
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);

    if (!command) return;

    try {
      // Start typing indicator for faster visual feedback
      await message.channel.sendTyping();
      
      // Execute command with timing
      console.time(`Command ${commandName}`);
      await command.execute(message, args);
      console.timeEnd(`Command ${commandName}`);
    } catch (error) {
      console.error(error);
      await message.reply('❌ Error executing command').catch(console.error);
    }
  }

  // Handle proxy messages (fast path)
  if (message.content.startsWith('"') && activeProfiles.has(message.author.id)) {
    handleProxyMessage(message).catch(console.error);
  }
});

// ========================
// CORE SYSTEMS (OPTIMIZED)
// ========================

// Active profiles and battles tracking
const activeProfiles = new Map();
const activeBattles = new Map();

// Optimized proxy message handler
async function handleProxyMessage(message) {
  const character = await Character.findById(activeProfiles.get(message.author.id)).lean();
  if (!character) return;

  // Find or create webhook (cached)
  const webhooks = await message.channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.name === character.name);
  
  if (!webhook) {
    webhook = await message.channel.createWebhook({
      name: character.name,
      avatar: character.avatarURL,
      reason: `Proxy for ${character.name}`
    });
  }

  // Parallel delete and send
  await Promise.all([
    message.delete().catch(console.error),
    webhook.send({
      content: message.content.slice(1).trim(),
      username: character.name,
      avatarURL: character.avatarURL
    })
  ]);
}

// ========================
// INVENTORY SYSTEM (CUSTOM ITEMS)
// ========================

client.commands.set('createitem', {
  description: 'Create custom item',
  usage: '!createitem [name]|[description]|[effect]',
  async execute(message, args) {
    const input = args.join(' ').split('|').map(s => s.trim());
    if (input.length < 3) {
      return message.reply('❌ Format: `!createitem name|description|effect`');
    }

    const [name, description, effect] = input;
    const character = await Character.findOne({
      userId: message.author.id,
      _id: activeProfiles.get(message.author.id)
    });

    if (!character) {
      return message.reply('❌ Set an active profile first with !profile');
    }

    character.inventory.push({ name, description, effect });
    await character.save();

    await message.reply(`✅ Created "${name}" and added to your inventory!`);
  }
});

client.commands.set('inventory', {
  description: 'View your inventory',
  async execute(message) {
    const character = await Character.findOne({
      userId: message.author.id,
      _id: activeProfiles.get(message.author.id)
    }).lean();

    if (!character) {
      return message.reply('❌ Set an active profile first with !profile');
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎒 ${character.name}'s Inventory`)
      .setColor('#00ff00');

    if (character.inventory.length === 0) {
      embed.setDescription('Your inventory is empty');
    } else {
      character.inventory.forEach(item => {
        embed.addFields({
          name: `${item.name} (x${item.quantity})`,
          value: `${item.description}\n**Effect:** ${item.effect}`,
          inline: true
        });
      });
    }

    await message.reply({ embeds: [embed] });
  }
});

// ========================
// COMBAT SYSTEM (OPTIMIZED)
// ========================

client.commands.set('attack', {
  description: 'Use an attack in battle',
  usage: '!attack [attack name]',
  async execute(message, args) {
    const battleId = activeBattles.get(message.channel.id);
    if (!battleId) return message.reply('❌ No active battle here');

    const battle = await Battle.findById(battleId).lean();
    const currentPlayer = battle.participants[battle.currentTurn];
    if (currentPlayer.userId !== message.author.id) {
      return message.reply('❌ Not your turn!');
    }

    const attackName = args.join(' ');
    const character = await Character.findById(currentPlayer.characterId).lean();
    const attack = character.attacks.find(a => 
      a.name.toLowerCase().includes(attackName.toLowerCase())
    );

    if (!attack) return message.reply('❌ Attack not found');

    // Process attack (optimized)
    const results = processAttack(character, attack);
    const targetIndex = battle.currentTurn === 0 ? 1 : 0;
    const target = battle.participants[targetIndex];

    // Update battle state
    await Battle.updateOne(
      { _id: battleId },
      { 
        $set: { 
          currentTurn: targetIndex,
          [`participants.${targetIndex}.health`]: target.health - results.damage
        },
        $inc: { turnCount: 1 },
        $push: { battleLog: results.logEntry }
      }
    );

    // Send response
    const targetChar = await Character.findById(target.characterId).lean();
    const embed = createAttackEmbed(character, attack, results, targetChar);
    await message.channel.send({ embeds: [embed] });
  }
});

// ========================
// START THE BOT
// ========================

async function startBot() {
  await connectDB();
  await client.login(process.env.TOKEN);
}

startBot().catch(console.error);

// Helper functions would be defined here...
