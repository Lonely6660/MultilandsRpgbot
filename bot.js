require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, WebhookClient } = require('discord.js');
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

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

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

client.on('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
  client.user.setPresence({
    activities: [{ name: 'Multilands RP', type: 'PLAYING' }],
    status: 'online'
  });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content.startsWith('!createchar')) {
    const args = message.content.split('|').map(arg => arg.trim());
    if (args.length < 9) return message.reply('❌ Format: !createchar name|3 strengths|3 weaknesses|affinity|3 attacks');
    
    const [_, name, ...strengths] = args;
    const weaknesses = strengths.splice(3, 3);
    const affinity = strengths.pop();
    const attacks = strengths.splice(3).map(name => ({
      name,
      type: name.includes('Slash') ? 'Slash' : 
            name.includes('Pierce') ? 'Pierce' : 
            name.includes('Blunt') ? 'Blunt' : 'Magic'
    }));

    const newChar = new Character({
      userId: message.author.id,
      name,
      strengths,
      weaknesses,
      affinity,
      attacks
    });

    await newChar.save();
    return message.reply(`✅ Created character "${name}"!`);
  }

  if (message.content.startsWith('"') && activeProfiles.has(message.author.id)) {
    const character = await Character.findById(activeProfiles.get(message.author.id));
    if (!character) return;

    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.name === character.name);
    
    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: character.name,
        avatar: character.avatarURL
      });
    }

    await message.delete().catch(() => {});
    await webhook.send({
      content: message.content.slice(1),
      username: character.name,
      avatarURL: character.avatarURL
    });
  }
});

client.login(process.env.TOKEN)
  .catch(err => console.error('❌ Login failed:', err));
