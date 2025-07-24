require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();
// --- START DEBUGGING LINES ---
console.log('--- Environment Variables Check ---');
console.log('process.env.MONGODB_URI:', process.env.MONGODB_URI ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.CLIENT_ID:', process.env.CLIENT_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.TEST_GUILD_ID:', process.env.TEST_GUILD_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('---------------------------------');
// --- END DEBUGGING LINES ---
// Initialize Client with updated Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks
  ]
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  retryWrites: true,
  w: 'majority'
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err));

// Character Schema
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
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive'),

  new SlashCommandBuilder()
    .setName('createchar')
    .setDescription('Create a new RPG character')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Character name')
        .setRequired(true))
    .addStringOption(option =>
        option.setName('avatar_url')
          .setDescription('A URL for your character\'s avatar.')
          .setRequired(true))
    .addStringOption(option =>
      option.setName('strengths')
        .setDescription('3 strengths (comma separated)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('weaknesses')
        .setDescription('3 weaknesses (comma separated)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('affinity')
        .setDescription('Character affinity')
        .setRequired(true)
        .addChoices(
          { name: 'Wrath', value: 'Wrath' },
          { name: 'Lust', value: 'Lust' },
          { name: 'Sloth', value: 'Sloth' },
          { name: 'Gluttony', value: 'Gluttony' },
          { name: 'Greed', value: 'Greed' },
          { name: 'Pride', value: 'Pride' },
          { name: 'Envy', value: 'Envy' }
        )),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Set your active character')
    .addStringOption(option =>
      option.setName('character')
        .setDescription('Name of your character')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Speak in-character')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('What your character says')
        .setRequired(true))
].map(command => command.toJSON());

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('⌛ Registering slash commands...');

    // Use guild commands for testing, and global for production
    if (process.env.TEST_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
        { body: commands }
      );
      console.log('⚡ Commands registered in test server');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Successfully registered global commands');
    }

  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// Bot Events
client.on('ready', async () => {
  console.log(`🚀 ${client.user.tag} is online!`);
  await registerCommands();

  // Set presence
  client.user.setPresence({
    activities: [{ name: 'Multilands RP', type: 3 }], // Type 3 is 'WATCHING'
    status: 'online'
  });
});

// Autocomplete Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;

  if (interaction.commandName === 'profile') {
    const focusedValue = interaction.options.getFocused();
    try {
        const userCharacters = await Character.find({
            userId: interaction.user.id,
            name: new RegExp(focusedValue, 'i')
        }).limit(25);

        await interaction.respond(
            userCharacters.map(char => ({
                name: char.name,
                value: char.name
            }))
        );
    } catch (error) {
        console.error('Autocomplete error:', error);
    }
  }
});

// Command Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user, channel } = interaction;

  try {
    // Ping Command
    if (commandName === 'ping') {
      await interaction.reply({ content: '🏓 Pong!', ephemeral: true });
    }

    // Create Character Command
    else if (commandName === 'createchar') {
      await interaction.deferReply({ ephemeral: true });

      const name = options.getString('name');
      const avatarURL = options.getString('avatar_url');
      const strengths = options.getString('strengths').split(',').map(s => s.trim());
      const weaknesses = options.getString('weaknesses').split(',').map(w => w.trim());
      const affinity = options.getString('affinity');

      if (strengths.length !== 3 || weaknesses.length !== 3) {
        return interaction.editReply('❌ Please provide exactly 3 strengths and 3 weaknesses.');
      }

      const newChar = new Character({
        userId: user.id,
        name,
        avatarURL,
        strengths,
        weaknesses,
        affinity,
        attacks: [
          { name: 'Basic Attack', type: 'Slash' }
        ]
      });

      await newChar.save();
      await interaction.editReply(`✅ Created character **${name}**! Use \`/profile\` to set them as your active character.`);
    }

    // Profile Command
    else if (commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });
      const charName = options.getString('character');
      const character = await Character.findOne({
        userId: user.id,
        name: charName
      });

      if (!character) {
        return interaction.editReply('❌ Character not found! Make sure you selected a valid character from the list.');
      }

      activeProfiles.set(user.id, character.id);
      await interaction.editReply(`🎭 Active character set to **${character.name}**.`);
    }

    // Say Command (In-Character Speech)
    else if (commandName === 'say') {
      const activeCharacterId = activeProfiles.get(user.id);
      if (!activeCharacterId) {
        return interaction.reply({
          content: '❌ No active character! Use the `/profile` command first.',
          ephemeral: true
        });
      }

      const character = await Character.findById(activeCharacterId);
        if (!character) {
        // This case handles if a character was deleted but was still set as active.
        activeProfiles.delete(user.id);
        return interaction.reply({
          content: '❌ Your active character could not be found. Please set a new one with `/profile`.',
          ephemeral: true
        });
      }

      const message = options.getString('message');

      // Acknowledge the interaction immediately.
      await interaction.deferReply({ ephemeral: true });

      // Webhook handling
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find(w => w.owner.id === client.user.id && w.name === 'RP Webhook');

      if (!webhook) {
        webhook = await channel.createWebhook({
          name: 'RP Webhook',
          avatar: client.user.displayAvatarURL(),
          reason: 'Webhook for roleplaying messages'
        });
      }

      // Send the message through the webhook, overriding its name and avatar for this one message.
      await webhook.send({
        content: message,
        username: character.name,
        avatarURL: character.avatarURL
      });

      // Confirm to the user that the message was sent.
      await interaction.editReply({ content: 'Your in-character message has been sent!' });
    }

  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ An error occurred while executing this command.', ephemeral: true });
    } else {
        await interaction.reply({ content: '❌ An error occurred while executing this command.', ephemeral: true });
    }
  }
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .catch(err => console.error('❌ Login failed:', err));