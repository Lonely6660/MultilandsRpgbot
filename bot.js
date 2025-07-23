require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');

// Initialize Discord Client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildWebhooks
  ]
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Character Schema (unchanged from your original)
const characterSchema = new mongoose.Schema({
  userId: String,
  name: String,
  avatarURL: String,
  strengths: [String],
  weaknesses: [String],
  affinity: String,
  attacks: [{
    name: String,
    type: String,
    diceSize: { type: Number, default: 4 },
    perfectRolls: { type: Number, default: 0 }
  }],
  sanity: { type: Number, default: 100 },
  cxp: { type: Number, default: 1 },
  level: { type: Number, default: 1 },
  inventory: [{
    name: String,
    description: String,
    effect: String,
    quantity: { type: Number, default: 1 }
  }]
});
const Character = mongoose.model('Character', characterSchema);
const activeProfiles = new Map();

// Slash Command Definitions
const commands = [
  {
    name: 'ping',
    description: 'Check if bot is alive'
  },
  {
    name: 'createchar',
    description: 'Create a new RPG character',
    options: [
      {
        name: 'name',
        type: 3, // STRING
        description: 'Character name',
        required: true
      },
      {
        name: 'strengths',
        type: 3,
        description: 'Comma-separated strengths (ex: Strong,Fast,Smart)',
        required: true
      },
      {
        name: 'weaknesses',
        type: 3,
        description: 'Comma-separated weaknesses',
        required: true
      },
      {
        name: 'affinity',
        type: 3,
        description: 'Character affinity',
        required: true,
        choices: [
          { name: 'Wrath', value: 'Wrath' },
          { name: 'Lust', value: 'Lust' },
          // Add other affinities...
        ]
      }
    ]
  },
  {
    name: 'profile',
    description: 'Set your active character',
    options: [
      {
        name: 'character',
        type: 3,
        description: 'Character name',
        required: true,
        autocomplete: true // Will implement below
      }
    ]
  },
  {
    name: 'say',
    description: 'Speak in-character',
    options: [
      {
        name: 'message',
        type: 3,
        description: 'What your character says',
        required: true
      }
    ]
  }
];

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('🔧 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// Slash Command Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user } = interaction;

  try {
    // Ping Command
    if (commandName === 'ping') {
      await interaction.reply('🏓 Pong!');
    }

    // Character Creation
    if (commandName === 'createchar') {
      const name = options.getString('name');
      const strengths = options.getString('strengths').split(',');
      const weaknesses = options.getString('weaknesses').split(',');
      const affinity = options.getString('affinity');

      const newChar = new Character({
        userId: user.id,
        name,
        strengths,
        weaknesses,
        affinity,
        attacks: [] // Initialize empty attacks
      });

      await newChar.save();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Character Created!')
            .setDescription(`**${name}** is ready for adventure!`)
            .addFields(
              { name: 'Affinity', value: affinity, inline: true },
              { name: 'Strengths', value: strengths.join(', '), inline: true }
            )
            .setColor('#00ff00')
        ]
      });
    }

    // Profile Selection
    if (commandName === 'profile') {
      const charName = options.getString('character');
      const character = await Character.findOne({
        userId: user.id,
        name: new RegExp(charName, 'i')
      });

      if (!character) {
        return interaction.reply({ content: '❌ Character not found!', ephemeral: true });
      }

      activeProfiles.set(user.id, character._id);
      await interaction.reply(`🎭 Active character set to **${character.name}**`);
    }

    // In-Character Speech
    if (commandName === 'say') {
      const character = await Character.findById(activeProfiles.get(user.id));
      if (!character) {
        return interaction.reply({ 
          content: '❌ No active character! Use `/profile` first.', 
          ephemeral: true 
        });
      }

      const message = options.getString('message');
      const channel = interaction.channel;

      // Delete the original slash command
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      // Send as webhook
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find(w => w.name === character.name);
      
      if (!webhook) {
        webhook = await channel.createWebhook({
          name: character.name,
          avatar: character.avatarURL
        });
      }

      await webhook.send({
        content: message,
        username: character.name,
        avatarURL: character.avatarURL
      });
    }

  } catch (error) {
    console.error('Command Error:', error);
    await interaction.reply({
      content: '❌ An error occurred while processing this command.',
      ephemeral: true
    });
  }
});

// Autocomplete for Profile Command
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;

  if (interaction.commandName === 'profile') {
    const focusedValue = interaction.options.getFocused();
    const characters = await Character.find({
      userId: interaction.user.id,
      name: new RegExp(focusedValue, 'i')
    }).limit(25);

    await interaction.respond(
      characters.map(char => ({
        name: char.name,
        value: char.name
      }))
    );
  }
});

// Bot Startup
client.on('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  await registerCommands();
});

client.login(process.env.DISCORD_TOKEN)
  .catch(err => console.error('❌ Login failed:', err));
