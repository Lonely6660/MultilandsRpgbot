client.login(process.env.TOKEN)
  .then(() => {
    console.log('✅ Login successful');
    console.log(`🆔 Bot User ID: ${client.user.id}`);
    console.log(`👥 Guilds: ${client.guilds.cache.size}`);
  })
  .catch(err => {
    console.error('❌ LOGIN FAILED:', err);
    process.exit(1);
  });
require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, WebhookClient } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const app = express();
app.use(express.json());

// Webhook verification endpoint
app.post('/discord-webhook', (req, res) => {
  // Verify the webhook request
  if (req.headers['x-discord-verify'] === 'true') {
    return res.status(200).send('Webhook verified');
  }
  
  // Handle actual webhook events here
  console.log('Webhook received:', req.body);
  res.status(200).end();
});

// Start webhook server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
// Webhook sender function
async function sendToDiscordWebhook(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const webhook = new WebhookClient({ url: webhookUrl });
    await webhook.send({
      content,
      username: 'GitHub Bot',
      avatarURL: 'https://i.imgur.com/AfFp7pu.png'
    });
  } catch (err) {
    console.error('Webhook error:', err);
  }
}

// Example usage when code updates
process.on('exit', () => {
  sendToDiscordWebhook('🔄 Bot is restarting...');
});
// Initialize Discord client with all required intents
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildWebhooks
  ],
  presence: {
    status: 'online',
    activities: [{
      name: 'Multilands RP',
      type: 'PLAYING'
    }]
  }
});

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

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
    diceSize: Number,
    perfectRolls: Number
  }],
  sanity: { type: Number, default: 100 },
  cxp: { type: Number, default: 1 },
  level: { type: Number, default: 1 },
  inventory: [{
    name: String,
    description: String,
    effect: String,
    quantity: Number
  }]
});

const Character = mongoose.model('Character', characterSchema);

// Active profiles tracking
const activeProfiles = new Map();

// ========================
// BOT SETUP AND VISIBILITY
// ========================

client.on('ready', () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
  console.log(`🌐 Serving ${client.guilds.cache.size} servers`);
  
  // Ensure bot is visible
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'Multilands RP',
      type: 'PLAYING'
    }]
  });
});

// ========================
// WEBHOOK PROXY SYSTEM
// ========================

async function sendAsCharacter(message, character) {
  try {
    // Get existing webhooks
    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === character.name);
    
    // Create new webhook if needed
    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: character.name,
        avatar: character.avatarURL,
        reason: 'RP character proxy'
      });
    }
    
    // Delete original message if it's a proxy trigger
    if (message.content.startsWith('"')) {
      await message.delete().catch(console.error);
    }
    
    // Send through webhook
    await webhook.send({
      content: message.content.startsWith('"') 
        ? message.content.slice(1) 
        : message.content,
      username: character.name,
      avatarURL: character.avatarURL
    });
  } catch (error) {
    console.error('Webhook error:', error);
    message.channel.send('⚠️ Failed to send character message').catch(console.error);
  }
}

// ========================
// CORE COMMANDS
// ========================

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Character Creation
  if (message.content.startsWith('!createchar')) {
    const args = message.content.split('|').map(arg => arg.trim());
    if (args.length < 9) {
      return message.reply('❌ Format: `!createchar name|strength1|strength2|strength3|weakness1|weakness2|weakness3|affinity|attack1|attack2|attack3`');
    }

    const [_, name, ...strengths] = args;
    const weaknesses = strengths.splice(3, 3);
    const affinity = strengths.pop();
    const attacks = strengths.splice(3).map(attack => ({
      name: attack,
      type: attack.includes('Slash') ? 'Slash' : 
            attack.includes('Pierce') ? 'Pierce' : 
            attack.includes('Blunt') ? 'Blunt' : 'Magic',
      diceSize: 4,
      perfectRolls: 0
    }));

    const newChar = new Character({
      userId: message.author.id,
      name,
      strengths,
      weaknesses,
      affinity,
      attacks,
      inventory: [{
        name: 'Starter Potion',
        description: 'Basic healing item',
        effect: 'Restores 10 HP',
        quantity: 3
      }]
    });

    await newChar.save();
    return message.reply(`✅ Created character "${name}"! Use \`!profile ${name}\` to speak as them.`);
  }

  // Profile Switching
  if (message.content.startsWith('!profile')) {
    const characterName = message.content.split(' ').slice(1).join(' ');
    const character = await Character.findOne({
      userId: message.author.id,
      name: new RegExp(characterName, 'i')
    });

    if (!character) return message.reply('❌ Character not found');
    
    activeProfiles.set(message.author.id, character._id);
    return message.reply(`🎭 Now speaking as ${character.name}! Type "message" to speak in-character.`);
  }

  // Proxy Messages
  if ((message.content.startsWith('"') || message.content.startsWith('!say')) && activeProfiles.has(message.author.id)) {
    const character = await Character.findById(activeProfiles.get(message.author.id));
    if (!character) return;
    
    await sendAsCharacter(message, character);
  }

  // Help Command
  if (message.content === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('Multilands RP Bot Help')
      .setDescription('Commands for character management and roleplay')
      .addFields(
        { name: 'Character Commands', value: '`!createchar` - Create new character\n`!profile [name]` - Switch character\n`!setavatar [url]` - Set character avatar' },
        { name: 'Roleplay Commands', value: '`"message` - Speak in-character\n`!say message` - Alternative in-character command' },
        { name: 'Utility', value: '`!help` - Show this menu\n`!ping` - Check bot latency' }
      );
    
    return message.channel.send({ embeds: [embed] });
  }

  // Ping Command (visibility test)
  if (message.content === '!ping') {
    const msg = await message.reply('Pinging...');
    const latency = msg.createdTimestamp - message.createdTimestamp;
    return msg.edit(`🏓 Pong! Latency: ${latency}ms`);
  }
});

// ========================
// BOT LOGIN
// ========================

client.login(process.env.TOKEN)
  .then(() => console.log('🔗 Bot is connecting to Discord...'))
  .catch(err => console.error('❌ Login error:', err));
name: Deploy to Discord
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Notify Discord
        uses: Ilshidur/action-discord@master
        with:
          args: '🚀 New update pushed to ${{ github.repository }} by ${{ github.actor }}'
        env:
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
         Name: https:
Value: [discord.com/api/webhooks/1397285884612575332/KTdXs4RDnjq4Raw15SXmJLM-VJ8OYT9ySBhDifAhXUS2QgIS_w6H2_QWwHDSxZkG7qSO]

client.on('ready', () => {
  console.log(`Bot is in ${client.guilds.cache.size} servers:`);
  client.guilds.cache.forEach(guild => {
    console.log(`- ${guild.name} (${guild.id})`);
  });
});
require('dotenv').config();
client.login(process.env.DISCORD_TOKEN);
