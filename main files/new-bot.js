require('dotenv').config();
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { Client: PgClient } = require('pg');

// Import command handlers
const { characterCommand, CharacterHandler } = require('./src/commands/character-updated');
const { battleCommand, BattleHandler } = require('./src/commands/battle');
const { attackCommand, AttackHandler } = require('./src/commands/attack');

// Import utilities
const { rollDice, calculateDamageDice } = require('./src/utils/dice');
const { getUserRatingGif } = require('./src/utils/gifs');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildWebhooks
  ]
});

// PostgreSQL Client Setup
const pgClient = new PgClient({
  connectionString: process.env.NEON_POSTGRES_URI,
  ssl: {
    rejectUnauthorized: false
  }
});

// Command collection
client.commands = new Collection();

// Initialize command handlers
const characterHandler = new CharacterHandler(pgClient);
const battleHandler = new BattleHandler(pgClient);
const attackHandler = new AttackHandler(pgClient);

// Store handlers for easy access
client.commandHandlers = {
  character: characterHandler,
  battle: battleHandler,
  attack: attackHandler
};

// Database connection and table setup
async function initializeDatabase() {
  try {
    await pgClient.connect();
    console.log('✅ PostgreSQL Connected');

    // Create user_settings table for selected characters
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id VARCHAR(255) PRIMARY KEY,
        selected_character_id INTEGER,
        selected_character_name VARCHAR(255)
      );
    `);

    // Ensure all other tables exist (from original bot.js)
    const createCharactersTableQuery = `
      CREATE TABLE IF NOT EXISTS characters (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar_url TEXT NOT NULL,
        gender VARCHAR(50),
        age INTEGER,
        species VARCHAR(100),
        occupation VARCHAR(100),
        appearance_url TEXT,
        health_current INTEGER DEFAULT 100,
        health_max INTEGER DEFAULT 100,
        sanity_current INTEGER DEFAULT 100,
        sanity_max INTEGER DEFAULT 100,
        level INTEGER DEFAULT 1,
        cxp INTEGER DEFAULT 0,
        attack_chain_max INTEGER DEFAULT 1,
        sanity_increase_desc TEXT,
        sanity_decrease_desc TEXT,
        UNIQUE(user_id, name)
      );
    `;
    await pgClient.query(createCharactersTableQuery);

    const createAffinitiesTableQuery = `
      CREATE TABLE IF NOT EXISTS affinities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        effect_type VARCHAR(100),
        effect_value JSONB,
        inflicted_status VARCHAR(50)
      );
    `;
    await pgClient.query(createAffinitiesTableQuery);

    const createAttackTypesTableQuery = `
      CREATE TABLE IF NOT EXISTS attack_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT
      );
    `;
    await pgClient.query(createAttackTypesTableQuery);

    const createAttacksTableQuery = `
      CREATE TABLE IF NOT EXISTS attacks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        type_id INTEGER REFERENCES attack_types(id),
        affinity_id INTEGER REFERENCES affinities(id),
        description TEXT,
        base_damage_dice VARCHAR(20),
        effect_description TEXT,
        is_locked_default BOOLEAN DEFAULT FALSE
      );
    `;
    await pgClient.query(createAttacksTableQuery);

    const createCharacterAttacksTableQuery = `
      CREATE TABLE IF NOT EXISTS character_attacks (
        id SERIAL PRIMARY KEY,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        attack_id INTEGER REFERENCES attacks(id) ON DELETE CASCADE,
        is_unlocked BOOLEAN DEFAULT FALSE,
        level INTEGER DEFAULT 0,
        perfect_hits INTEGER DEFAULT 0,
        UNIQUE(character_id, attack_id)
      );
    `;
    await pgClient.query(createCharacterAttacksTableQuery);

    const createNpcsTableQuery = `
      CREATE TABLE IF NOT EXISTS npcs (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        avatar_url TEXT,
        health_current INTEGER DEFAULT 100,
        health_max INTEGER DEFAULT 100,
        sanity_current INTEGER DEFAULT 100,
        sanity_max INTEGER DEFAULT 100,
        level INTEGER DEFAULT 1,
        base_damage_dice VARCHAR(20),
        attack_chain_max INTEGER DEFAULT 1,
        sanity_increase_desc TEXT,
        sanity_decrease_desc TEXT,
        is_boss BOOLEAN DEFAULT FALSE,
        rarity VARCHAR(50)
      );
    `;
    await pgClient.query(createNpcsTableQuery);

    const createBattlesTableQuery = `
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        current_turn_participant_id INTEGER,
        turn_order JSONB,
        round_number INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW()
      );
    `;
    await pgClient.query(createBattlesTableQuery);

    const createBattleParticipantsTableQuery = `
      CREATE table IF NOT EXISTS battle_participants (
        id SERIAL PRIMARY KEY,
        battle_id INTEGER REFERENCES battles(id) ON DELETE CASCADE,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        npc_id INTEGER REFERENCES npcs(id) ON DELETE CASCADE,
        current_health INTEGER NOT NULL,
        current_sanity INTEGER NOT NULL,
        is_player BOOLEAN NOT NULL,
        UNIQUE(battle_id, character_id, npc_id)
      );
    `;
    await pgClient.query(createBattleParticipantsTableQuery);

    const createUserRatingGifsTableQuery = `
      CREATE TABLE IF NOT EXISTS user_rating_gifs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        rating VARCHAR(20) NOT NULL,
        gif_url TEXT NOT NULL,
        UNIQUE(user_id, rating)
      );
    `;
    await pgClient.query(createUserRatingGifsTableQuery);

    // Insert default data
    await insertDefaultData();
    
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  }
}

async function insertDefaultData() {
  // Default affinities
  const defaultAffinities = [
    { name: 'Wrath', description: 'Extra damage on the next attack after you take damage.', effect_type: 'damage_multiplier', effect_value: { multiplier: 1.5 }, inflicted_status: 'Fire' },
    { name: 'Lust', description: 'Divides your opponent\'s dice by 1.5x.', effect_type: 'dice_division', effect_value: { divisor: 1.5 }, inflicted_status: 'Bleed' },
    { name: 'Sloth', description: 'Reduces your opponent\'s sanity by 1 every 1 damage in an attack. Stacks.', effect_type: 'sanity_reduction_per_damage', effect_value: {}, inflicted_status: 'Slowness' },
    { name: 'Gluttony', description: '"Steals" 5 sanity every attack you do.', effect_type: 'sanity_steal', effect_value: { amount: 5 }, inflicted_status: 'Electrified' },
    { name: 'Greed', description: 'Gets stronger the more the battle goes on for.', effect_type: 'battle_scaling', effect_value: {}, inflicted_status: 'Weakness' },
    { name: 'Pride', description: 'Reflects damage if you take more than half your health bar.', effect_type: 'damage_reflection', effect_value: {}, inflicted_status: 'Blindness' },
    { name: 'Envy', description: 'Can "lock" an attack from an enemy.', effect_type: 'attack_lock', effect_value: {}, inflicted_status: 'Poison' },
  ];

  for (const affinity of defaultAffinities) {
    await pgClient.query(
      'INSERT INTO affinities (name, description, effect_type, effect_value, inflicted_status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING;',
      [affinity.name, affinity.description, affinity.effect_type, JSON.stringify(affinity.effect_value), affinity.inflicted_status]
    );
  }

  // Default attack types
  const defaultAttackTypes = [
    { name: 'Slash', description: 'Clean, precise, fast. Low-damage yet fast weapon.' },
    { name: 'Pierce', description: 'Calculated, surgical, deadly. Jack-of-all-trades, master-of-none weapon.' },
    { name: 'Blunt', description: 'Crushing, chaotic, stunning. Slow yet damaging weapon.' },
    { name: 'Magic', description: 'Weird, wild, do whatever you want. Balanced.' },
  ];

  for (const type of defaultAttackTypes) {
    await pgClient.query(
      'INSERT INTO attack_types (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING;',
      [type.name, type.description]
    );
  }

  // Default NPCs
  const defaultNpcs = [
    {
      name: 'Water Bottle',
      description: 'A water bottle🥀',
      avatar_url: 'https://i.imgur.com/exampleSpider.png',
      health_max: 45, health_current: 45,
      sanity_max: 30, sanity_current: 30,
      level: 2, base_damage_dice: '1d6', attack_chain_max: 1,
      is_boss: false, rarity: 'Common'
    },
    {
      name: 'GOOFY NEBULA',
      description: 'nebulas inner demon',
      avatar_url: 'https://media.discordapp.net/attachments/1302304033611976777/1357875925123072010/image.png',
      health_max: 500, health_current: 500,
      sanity_max: 300, sanity_current: 300,
      level: 20, base_damage_dice: '4d12+10', attack_chain_max: 3,
      is_boss: true, rarity: 'Boss'
    },
    {
      name: 'Wingslompson',
      description: 'eldsnackldson brother',
      avatar_url: 'https://i.imgur.com/exampleSpider.png',
      health_max: 45, health_current: 45,
      sanity_max: 30, sanity_current: 30,
      level: 2, base_damage_dice: '1d6', attack_chain_max: 1,
      is_boss: false, rarity: 'Common'
    },
  ];

  for (const npc of defaultNpcs) {
    await pgClient.query(
      `INSERT INTO npcs (name, description, avatar_url, health_current, health_max, sanity_current, sanity_max, level, base_damage_dice, attack_chain_max, sanity_increase_desc, sanity_decrease_desc, is_boss, rarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (name) DO NOTHING;`,
      [npc.name, npc.description, npc.avatar_url, npc.health_current, npc.health_max, npc.sanity_current, npc.sanity_max, npc.level, npc.base_damage_dice, npc.attack_chain_max, npc.sanity_increase_desc || null, npc.sanity_decrease_desc || null, npc.is_boss, npc.rarity]
    );
  }
}

// Command registration
const { REST, Routes } = require('discord.js');
const commands = [
  characterCommand,
  battleCommand,
  attackCommand
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('⌛ Registering slash commands...');
    
    if (process.env.TEST_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
        { body: commands.map(command => command.toJSON()) },
      );
      console.log('⚡ Commands registered in test server');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands.map(command => command.toJSON()) },
      );
      console.log('⚡ Commands registered globally');
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

// Event handlers
client.once('ready', async () => {
  console.log(`🚀 ${client.user.tag} is online!`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;
  const handler = client.commandHandlers[commandName];

  if (!handler) {
    console.error(`No handler found for command: ${commandName}`);
    return;
  }

  try {
    await handler.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ An unexpected error occurred while executing this command.', flags: 64 });
    } else {
      await interaction.reply({ content: '❌ An unexpected error occurred while executing this command.', flags: 64 });
    }
  }
});

// Error handlers
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

client.on('error', err => {
  console.error('❌ Discord.js Client Error:', err);
});

pgClient.on('error', err => {
  console.error('❌ PostgreSQL Client Error:', err);
});

// Auto RP functionality
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.type !== 0) return;

  try {
    const userId = message.author.id;
    const query = 'SELECT name, avatar_url FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
    const result = await pgClient.query(query, [userId]);
    const character = result.rows[0];
    
    if (!character) return;

    if (!message.channel.permissionsFor(client.user).has(['ManageWebhooks', 'SendMessages'])) return;

    const webhooks = await message.channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.owner.id === client.user.id && w.name === 'Auto RP Webhook');

    if (!webhook) {
      webhook = await message.channel.createWebhook({
        name: 'Auto RP Webhook',
        avatar: client.user.displayAvatarURL(),
        reason: 'Webhook for auto RP messages'
      });
    }

    await webhook.send({
      content: message.content,
      username: character.name,
      avatarURL: character.avatar_url
    });

    await message.delete();
  } catch (err) {
    console.error('Error in auto RP message handler:', err);
  }
});

// Start the bot
async function start() {
  try {
    await initializeDatabase();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

start();
