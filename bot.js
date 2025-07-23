require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildWebhooks
  ]
});

// Debugging
let isCommandsRegistered = false;

// Command Definitions
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),
  new SlashCommandBuilder()
    .setName('createchar')
    .setDescription('Create a new character')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Character name')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('strengths')
        .setDescription('Comma-separated strengths (e.g., Strong,Fast,Smart)')
        .setRequired(true))
].map(command => command.toJSON());

// Command Registration
async function registerCommands() {
  try {
    console.log('⌛ Registering commands...');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    
    console.log('✅ Commands registered globally');
    isCommandsRegistered = true;
  } catch (error) {
    console.error('❌ Command registration failed:', error);
  }
}

// Bot Events
client.on('ready', async () => {
  console.log(`✅ ${client.user.tag} online`);
  await registerCommands();
  
  // Debug: Check command visibility
  client.guilds.cache.forEach(guild => {
    guild.commands.fetch()
      .then(cmds => console.log(`📜 ${guild.name} has ${cmds.size} commands`))
      .catch(console.error);
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  console.log(`🛠️ Command received: ${interaction.commandName}`); // Debug log

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply('🏓 Pong!');
    }
    
    if (interaction.commandName === 'createchar') {
      await interaction.reply('✅ Character creation started...');
      // Add your logic here
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.reply({
      content: '❌ Command failed',
      ephemeral: true
    });
  }
});

// Start Bot
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('🔗 Logging in...'))
  .catch(console.error);
