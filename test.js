require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, WebhookClient } = require('discord.js');
const mongoose = require('mongoose');

// Initialize Discord client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers,
  ]
});

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Character Schema
const characterSchema = new mongoose.Schema({
  userId: String,
  name: String,
  avatarURL: String,
  strengths: [String],
  weaknesses: [String],
  affinity: String,
  attacks: [String],
  sanity: { type: Number, default: 100 },
  cxp: { type: Number, default: 1 },
  level: { type: Number, default: 1 },
  inventory: [String],
  perfectRolls: { type: Map, of: Number }
});
const Character = mongoose.model('Character', characterSchema);

// Battle Schema
const battleSchema = new mongoose.Schema({
  participants: [String],
  currentTurn: String,
  turnCount: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  winner: String,
  battleLog: [Object]
});
const Battle = mongoose.model('Battle', battleSchema);

// Active profiles tracking
const activeProfiles = new Map();

// Ready event
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Character Creation
client.on('messageCreate', async message => {
  if (message.content.startsWith('!createchar')) {
    const args = message.content.split('|').map(arg => arg.trim());
    if (args.length < 9) {
      return message.reply('Format: !createchar [name]|3 strengths|3 weaknesses|affinity|attack1|attack2|attack3');
    }

    const [_, name, ...strengths] = args;
    const weaknesses = strengths.splice(3, 3);
    const affinity = strengths.pop();
    const attacks = strengths.splice(3);

    const newChar = new Character({
      userId: message.author.id,
      name,
      strengths,
      weaknesses,
      affinity,
      attacks,
      inventory: []
    });

    await newChar.save();
    await message.reply(`Character ${name} created! Use !profile ${name} to speak as them.`);
  }
});

// Profile Management
client.on('messageCreate', async message => {
  // Set active profile
  if (message.content.startsWith('!profile')) {
    const characterName = message.content.split(' ').slice(1).join(' ');
    const character = await Character.findOne({ 
      userId: message.author.id,
      name: new RegExp(characterName, 'i')
    });
    
    if (!character) return message.reply(`Character "${characterName}" not found`);
    
    activeProfiles.set(message.author.id, character._id);
    await message.reply(`Now speaking as ${character.name}! Type "message" to speak in-character.`);
  }

  // Clear active profile
  if (message.content === '!noprofile') {
    activeProfiles.delete(message.author.id);
    await message.reply('Returned to normal identity.');
  }

  // Set character avatar
  if (message.content.startsWith('!setavatar')) {
    const args = message.content.split(' ');
    const characterName = args[1];
    const avatarURL = message.attachments.first()?.url || args[2];
    
    if (!avatarURL) return message.reply('Attach an image or provide URL');
    
    const character = await Character.findOneAndUpdate(
      { userId: message.author.id, name: new RegExp(characterName, 'i') },
      { avatarURL },
      { new: true }
    );
    
    if (!character) return message.reply(`Character "${characterName}" not found`);
    await message.reply(`Updated avatar for ${character.name}!`);
  }
});

// Proxy Messaging
client.on('messageCreate', async message => {
  if (message.author.bot || !activeProfiles.has(message.author.id)) return;
  
  // Handle in-character messages (start with ")
  if (message.content.startsWith('"')) {
    const character = await Character.findById(activeProfiles.get(message.author.id));
    if (!character) return;
    
    // Find or create webhook
    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === character.name);
    
    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: character.name,
        avatar: character.avatarURL || null
      });
    }
    
    // Delete original and send proxy
    await message.delete().catch(console.error);
    await webhook.send({
      content: message.content.slice(1),
      username: character.name,
      avatarURL: character.avatarURL || undefined
    });
  }
});

// Combat System (simplified example)
client.on('messageCreate', async message => {
  if (message.content.startsWith('!attack')) {
    const character = await Character.findById(activeProfiles.get(message.author.id));
    if (!character) return message.reply('Set a profile first with !profile');
    
    const [_, type, affinity] = message.content.split(' ');
    const diceSize = 4 + Math.floor(character.level / 2);
    const roll = Math.floor(Math.random() * diceSize) + 1;
    const sanityMod = character.sanity >= 50 ? 1.25 : 0.5;
    const damage = Math.floor(roll * sanityMod);
    
    const embed = new EmbedBuilder()
      .setTitle(`${character.name}'s ${type} Attack`)
      .setDescription(`Used ${affinity} affinity`)
      .addFields(
        { name: 'Roll', value: `1d${diceSize}: ${roll}` },
        { name: 'Sanity Modifier', value: `${sanityMod}x` },
        { name: 'Damage', value: damage.toString() }
      );
    
    await message.channel.send({ embeds: [embed] });
  }
});

// Login
client.login(process.env.TOKEN);