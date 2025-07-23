require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');

// Initialize Client
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
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    console.log('⌛ Registering slash commands...');
    
    // Global registration
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    // Optional: Test server registration for faster updates
    if (process.env.TEST_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
        { body: commands }
      );
      console.log('⚡ Commands updated in test server');
    }

    console.log(`✅ Successfully registered ${commands.length} commands`);
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
    activities: [{ name: 'Multilands RP', type: 'PLAYING' }],
    status: 'online'
  });
});

// Autocomplete Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;

  if (interaction.commandName === 'profile') {
    const focusedValue = interaction.options.getFocused();
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
  }
});

// Command Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user } = interaction;

  try {
    // Ping Command
    if (commandName === 'ping') {
      await interaction.reply('🏓 Pong!');
    }

    // Create Character Command
    if (commandName === 'createchar') {
      await interaction.deferReply();
      
      const name = options.getString('name');
      const strengths = options.getString('strengths').split(',').map(s => s.trim());
      const weaknesses = options.getString('weaknesses').split(',').map(w => w.trim());
      const affinity = options.getString('affinity');

      if (strengths.length !== 3 || weaknesses.length !== 3) {
        return interaction.editReply('❌ Please provide exactly 3 strengths and 3 weaknesses');
      }

      const newChar = new Character({
        userId: user.id,
        name,
        strengths,
        weaknesses,
        affinity,
        attacks: [
          { name: 'Basic Attack', type: 'Slash' }
        ]
      });

      await newChar.save();
      await interaction.editReply(`✅ Created character **${name}**! Use \`/profile ${name}\` to activate.`);
    }

    // Profile Command
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

    // Say Command (In-Character Speech)
    if (commandName === 'say') {
      const character = await Character.findById(activeProfiles.get(user.id));
      if (!character) {
        return interaction.reply({ 
          content: '❌ No active character! Use `/profile` first.', 
          ephemeral: true 
        });
      }

      const message = options.getString('message');
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      // Webhook handling
      const webhooks = await interaction.channel.fetchWebhooks();
      let webhook = webhooks.find(w => w.name === character.name);
      
      if (!webhook) {
        webhook = await interaction.channel.createWebhook({
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
    console.error(`Error executing ${commandName}:`, error);
    await interaction.reply({ 
      content: '❌ An error occurred while executing this command.', 
      ephemeral: true 
    });
  }
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .catch(err => console.error('❌ Login failed:', err));
