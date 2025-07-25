require('dotenv').config();

// --- START DEBUGGING LINES (KEEP THESE FOR NOW) ---
console.log('--- Environment Variables Check ---');
console.log('process.env.NEON_POSTGRES_URI:', process.env.NEON_POSTGRES_URI ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.CLIENT_ID:', process.env.CLIENT_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.TEST_GUILD_ID:', process.env.TEST_GUILD_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('---------------------------------');
// --- END DEBUGGING LINES ---

const { Client, EmbedBuilder, REST, Routes, SlashCommandBuilder, GatewayIntentBits, MessageFlags } = require('discord.js');
const { Client: PgClient } = require('pg'); // Import the PostgreSQL Client

// Initialize Discord Client with updated Intents
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
    rejectUnauthorized: false // Required for Neon to connect from Codespaces if not using certificates
  }
});

/**
 * Rolls dice based on a given notation (e.g., "1d4", "2d6+3").
 * @param {string} diceNotation - The dice string (e.g., "1d4", "2d6+3").
 * @returns {{total: number, rolls: number[], maxRoll: boolean, maxPossible: number}} - Object with total, individual rolls, and if it was a max roll.
 */
function rollDice(diceNotation) {
  const match = diceNotation.match(/^(\d+)d(\d+)(?:([+-]\d+))?$/);
  if (!match) {
    throw new Error('Invalid dice notation. Use format like "1d4" or "2d6+3".');
  }

  const numDice = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let total = 0;
  const rolls = [];
  let isPerfectRoll = true; // Assume perfect until proven otherwise

  for (let i = 0; i < numDice; i++) {
    const roll = Math.floor(Math.random() * dieSize) + 1;
    rolls.push(roll);
    total += roll;
    if (roll !== dieSize) {
      isPerfectRoll = false; // If any die isn't max, it's not a perfect roll
    }
  }

  total += modifier;
  return {
    total: total,
    rolls: rolls,
    maxRoll: isPerfectRoll,
    maxPossible: numDice * dieSize + modifier // Max possible value for the roll
  };
}

/**
 * Calculates the current damage dice for an attack based on its base dice and level.
 * Example: 1d4 + level -> 1d(4+level)
 * This is a simplified example. You might want a more complex progression.
 * @param {string} baseDice - The base dice notation (e.g., '1d4').
 * @param {number} level - The attack's current level.
 * @returns {string} The new dice notation.
 */
function calculateDamageDice(baseDice, level) {
    const match = baseDice.match(/^(\d+)d(\d+)$/);
    if (!match) return baseDice; // Return original if invalid format

    const numDice = parseInt(match[1], 10);
    const dieSize = parseInt(match[2], 10);

    // Example progression: increase die size by 1 for every 5 levels
    // Or, increase die size by 1 for every level for simpler progression
    const newDieSize = dieSize + level; // Simple progression: +1 to die size per level
    // const newDieSize = dieSize + Math.floor(level / 5); // Example: +1 to die size every 5 levels

    return `${numDice}d${newDieSize}`;
}


// Connect to PostgreSQL and ensure tables
pgClient.connect()
  .then(async () => {
    console.log('✅ PostgreSQL Connected');

    // --- Ensure 'characters' table with new fields ---
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
        health_current INTEGER DEFAULT 100, -- ADDED THIS
        health_max INTEGER DEFAULT 100,     -- ADDED THIS
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
    console.log('📝 "characters" table ensured.');

    // --- Add new columns to 'characters' if they don't exist (for existing tables) ---
    await pgClient.query(`
      DO $$ BEGIN
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS age INTEGER;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS species VARCHAR(100);
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS appearance_url TEXT;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS health_current INTEGER DEFAULT 100; -- ADDED THIS
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS health_max INTEGER DEFAULT 100;     -- ADDED THIS
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_current INTEGER DEFAULT 100;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_max INTEGER DEFAULT 100;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS cxp INTEGER DEFAULT 0;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS attack_chain_max INTEGER DEFAULT 1;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_increase_desc TEXT;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_decrease_desc TEXT;
      END $$;
    `).catch(err => {
        // Log errors but don't crash if columns already exist
        if (!err.message.includes('already exists')) {
            console.error('Error ensuring new character columns:', err);
        }
    });

    // --- Ensure 'affinities' table ---
    const createAffinitiesTableQuery = `
      CREATE TABLE IF NOT EXISTS affinities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        effect_type VARCHAR(100), -- e.g., 'damage_multiplier', 'sanity_reduction'
        effect_value JSONB,       -- Store complex effect data as JSON
        inflicted_status VARCHAR(50) -- e.g., 'Fire', 'Bleed'
      );
    `;
    await pgClient.query(createAffinitiesTableQuery);
    console.log('📝 "affinities" table ensured.');

    // --- Insert default affinities if they don't exist ---
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
      try {
        await pgClient.query(
          'INSERT INTO affinities (name, description, effect_type, effect_value, inflicted_status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING;',
          [affinity.name, affinity.description, affinity.effect_type, JSON.stringify(affinity.effect_value), affinity.inflicted_status]
        );
      } catch (err) {
        console.error(`Error inserting affinity ${affinity.name}:`, err);
      }
    }
    console.log('📝 Default affinities ensured.');

    // --- Ensure 'attack_types' table ---
    const createAttackTypesTableQuery = `
      CREATE TABLE IF NOT EXISTS attack_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT
      );
    `;
    await pgClient.query(createAttackTypesTableQuery);
    console.log('📝 "attack_types" table ensured.');

    // --- Insert default attack types if they don't exist ---
    const defaultAttackTypes = [
      { name: 'Slash', description: 'Clean, precise, fast. Low-damage yet fast weapon.' },
      { name: 'Pierce', description: 'Calculated, surgical, deadly. Jack-of-all-trades, master-of-none weapon.' },
      { name: 'Blunt', description: 'Crushing, chaotic, stunning. Slow yet damaging weapon.' },
      { name: 'Magic', description: 'Weird, wild, do whatever you want. Balanced.' },
    ];

    for (const type of defaultAttackTypes) {
      try {
        await pgClient.query(
          'INSERT INTO attack_types (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING;',
          [type.name, type.description]
        );
      } catch (err) {
        console.error(`Error inserting attack type ${type.name}:`, err);
      }
    }
    console.log('📝 Default attack types ensured.');

    // --- Ensure 'attacks' table (definitions of all attacks) ---
    const createAttacksTableQuery = `
      CREATE TABLE IF NOT EXISTS attacks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        type_id INTEGER REFERENCES attack_types(id),
        affinity_id INTEGER REFERENCES affinities(id),
        description TEXT,
        base_damage_dice VARCHAR(20), -- e.g., '1d4', '1d8'
        effect_description TEXT,
        is_locked_default BOOLEAN DEFAULT FALSE
      );
    `;
    await pgClient.query(createAttacksTableQuery);
    console.log('📝 "attacks" definition table ensured.');

    // --- Insert default attacks if they don't exist ---
    // First, fetch IDs for attack_types and affinities
    const attackTypesMap = (await pgClient.query('SELECT id, name FROM attack_types;')).rows.reduce((map, row) => {
      map[row.name] = row.id;
      return map;
    }, {});
    const affinitiesMap = (await pgClient.query('SELECT id, name FROM affinities;')).rows.reduce((map, row) => {
      map[row.name] = row.id;
      return map;
    }, {});

    const defaultAttacks = [
      {
        name: 'Night Weaver\'s Grasp',
        type: 'Magic',
        affinity: 'Lust',
        description: 'Summons shadowy tendrils to ensnare a target.',
        base_damage_dice: '1d4',
        effect_description: 'On hit, the target is inflicted with Slowed (reduces the target\'s speed by 1 for 2 turns) and reduces the target\'s sanity by 1.',
        is_locked_default: false
      },
      {
        name: 'Overfluxing Blinkboot',
        type: 'Magic',
        affinity: 'Lust',
        description: 'Teleports a short distance, allowing him to reposition.',
        base_damage_dice: '1d8',
        effect_description: 'On hit, the target is inflicted with Weakness (reduces the target\'s attack roll by 1 for 2 turns).',
        is_locked_default: true // This attack is locked by default
      },
      {
        name: 'Waving Wrath',
        type: 'Magic',
        affinity: 'Lust',
        description: 'Launches a wave of shadowy energy that divides into telegraphed Evil souls.',
        base_damage_dice: '1d4',
        effect_description: 'On hit, the target is inflicted with Weakness and Blindness for 2 turns.',
        is_locked_default: true // This attack is locked by default
      }
    ];

    for (const attack of defaultAttacks) {
      try {
        const typeId = attackTypesMap[attack.type];
        const affinityId = affinitiesMap[attack.affinity];
        if (!typeId || !affinityId) {
          console.error(`Missing ID for attack type ${attack.type} or affinity ${attack.affinity} for attack ${attack.name}.`);
          continue;
        }
        await pgClient.query(
          'INSERT INTO attacks (name, type_id, affinity_id, description, base_damage_dice, effect_description, is_locked_default) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (name) DO NOTHING;',
          [attack.name, typeId, affinityId, attack.description, attack.base_damage_dice, attack.effect_description, attack.is_locked_default]
        );
      } catch (err) {
        console.error(`Error inserting attack ${attack.name}:`, err);
      }
    }
    console.log('📝 Default attacks ensured.');

    // --- Ensure 'character_attacks' table (links characters to their attacks) ---
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
    console.log('📝 "character_attacks" table ensured.');

    // --- Ensure 'items' table ---
    const createItemsTableQuery = `
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        item_type VARCHAR(50),      -- e.g., 'Consumable', 'Weapon', 'Armor', 'Quest Item'
        rarity VARCHAR(50),         -- e.g., 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'
        effect_description TEXT,    -- What does it do when used/equipped?
        effect_data JSONB           -- For structured effects (e.g., { "health_restore": 20, "sanity_restore": 10 })
      );
    `;
    await pgClient.query(createItemsTableQuery);
    console.log('📝 "items" table ensured.');

    // --- Ensure 'character_items' (inventory) table ---
    const createCharacterItemsTableQuery = `
      CREATE TABLE IF NOT EXISTS character_items (
        id SERIAL PRIMARY KEY,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
        quantity INTEGER DEFAULT 1 CHECK (quantity >= 0),
        UNIQUE(character_id, item_id)
      );
    `;
    await pgClient.query(createCharacterItemsTableQuery);
    console.log('📝 "character_items" table ensured.');

    // --- NEW: Ensure 'npcs' table ---
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
        base_damage_dice VARCHAR(20), -- e.g., '1d6' for basic attacks
        attack_chain_max INTEGER DEFAULT 1,
        sanity_increase_desc TEXT,
        sanity_decrease_desc TEXT,
        is_boss BOOLEAN DEFAULT FALSE,
        rarity VARCHAR(50) -- e.g., 'Common', 'Elite', 'Boss'
      );
    `;
    await pgClient.query(createNpcsTableQuery);
    console.log('📝 "npcs" table ensured.');

    // --- Insert some default NPCs for testing ---
    const defaultNpcs = [
      {
        name: 'Water Bottle',
        description: 'A water bottle🥀',
        avatar_url: 'https://i.imgur.com/exampleSpider.png', // Replace with a real URL
        health_max: 45, health_current: 45,
        sanity_max: 30, sanity_current: 30,
        level: 2, base_damage_dice: '1d6', attack_chain_max: 1,
        effect_description: 'Hydration.', // Custom field
        is_boss: false, rarity: 'Common'
      },
      {
        name: 'GOOFY NEBULA',
        description: 'nebulas inner demon',
        avatar_url: 'https://media.discordapp.net/attachments/1302304033611976777/1357875925123072010/image.png?ex=6884cb40&is=688379c0&hm=4579d788f29eed591602b5f197a2f7eaaf6fafec52f1c3b76de1d61ebb79dd8f&=&format=webp&quality=lossless&width=1474&height=680', // Replace with a real URL
        health_max: 500, health_current: 500,
        sanity_max: 300, sanity_current: 300,
        level: 20, base_damage_dice: '4d12+10', attack_chain_max: 3,
        sanity_decrease_desc: 'about_blank.',
        is_boss: true, rarity: 'Boss'
      }
        {
        name: 'Wingslompson',
        description: 'eldsnackldson brother',
        avatar_url: 'https://i.imgur.com/exampleSpider.png', // Replace with a real URL
        health_max: 45, health_current: 45,
        sanity_max: 30, sanity_current: 30,
        level: 2, base_damage_dice: '1d6', attack_chain_max: 1,
        effect_description: 'Hydration.', // Custom field
        is_boss: false, rarity: 'Common'
      },
    ];

    for (const npc of defaultNpcs) { // Corrected from defaultNpts
      try {
        await pgClient.query(
          `INSERT INTO npcs (name, description, avatar_url, health_current, health_max, sanity_current, sanity_max, level, base_damage_dice, attack_chain_max, sanity_increase_desc, sanity_decrease_desc, is_boss, rarity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (name) DO NOTHING;`,
          [npc.name, npc.description, npc.avatar_url, npc.health_current, npc.health_max, npc.sanity_current, npc.sanity_max, npc.level, npc.base_damage_dice, npc.attack_chain_max, npc.sanity_increase_desc || null, npc.sanity_decrease_desc || null, npc.is_boss, npc.rarity]
        );
      } catch (err) {
        console.error(`Error inserting NPC ${npc.name}:`, err);
      }
    }
    console.log('📝 Default NPCs ensured.');

    // --- NEW: Ensure 'battles' table ---
    const createBattlesTableQuery = `
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active', -- 'active', 'ended', 'paused'
        current_turn_participant_id INTEGER, -- Refers to battle_participants.id
        turn_order JSONB,                   -- Array of { type: 'character'|'npc', battle_participant_id: id }
        round_number INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW()
      );
    `;
    await pgClient.query(createBattlesTableQuery);
    console.log('📝 "battles" table ensured.');

    // --- NEW: Ensure 'battle_participants' table ---
    const createBattleParticipantsTableQuery = `
      CREATE TABLE IF NOT EXISTS battle_participants (
        id SERIAL PRIMARY KEY,
        battle_id INTEGER REFERENCES battles(id) ON DELETE CASCADE,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE, -- NULL for NPCs
        npc_id INTEGER REFERENCES npcs(id) ON DELETE CASCADE,             -- NULL for characters
        current_health INTEGER NOT NULL,
        current_sanity INTEGER NOT NULL,
        is_player BOOLEAN NOT NULL,                                       -- True if character, False if NPC
        UNIQUE(battle_id, character_id, npc_id) -- Ensures unique participant per battle. Handle NULLs for one-or-the-other.
      );
    `;
    await pgClient.query(createBattleParticipantsTableQuery);
    console.log('📝 "battle_participants" table ensured.');


  })
  .catch(err => console.error('❌ PostgreSQL Connection Error:', err));


// Command Registration
const commands = [
  new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage your in-character personas.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new character.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of your character.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('avatar_url')
            .setDescription('The URL for your character\'s avatar image.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('gender')
            .setDescription('The character\'s gender.')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('age')
            .setDescription('The character\'s age.')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('species')
            .setDescription('The character\'s species.')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('occupation')
            .setDescription('The character\'s occupation.')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('appearance_url')
            .setDescription('The URL for your character\'s full appearance image.')
            .setRequired(false))
        .addStringOption(option =>
            option.setName('sanity_increase')
            .setDescription('What makes your character\'s sanity increase?')
            .setRequired(false))
        .addStringOption(option =>
            option.setName('sanity_decrease')
            .setDescription('What makes your character\'s sanity decrease?')
            .setRequired(false))
        .addStringOption(option =>
            option.setName('starting_attack')
            .setDescription('The name of your character\'s starting attack (e.g., "Night Weaver\'s Grasp").')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('sheet') // New subcommand to display full character sheet
        .setDescription('Display your character\'s full sheet.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of the character to display (defaults to your latest).')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List your created characters.'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('set_default')
        .setDescription('Set a character as your default.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of the character to set as default.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a character.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of the character to delete.')
            .setRequired(true))),

  new SlashCommandBuilder()
    .setName('rp')
    .setDescription('Send an in-character message.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message to send as your character.')
        .setRequired(true))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send the message in (defaults to current).')
        .addChannelTypes(0)), // 0 for Text Channels

  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rolls dice with a specified notation (e.g., 1d4, 2d6+3).')
    .addStringOption(option =>
      option.setName('dice')
        .setDescription('The dice notation (e.g., 1d4, 2d6+3).')
        .setRequired(true)),

  // --- /item command for managing item definitions ---
  new SlashCommandBuilder()
    .setName('item')
    .setDescription('Manage game item definitions (admin only).')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Define a new item type.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of the item.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('A brief description of the item.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('type')
            .setDescription('The type of item (e.g., Consumable, Weapon, Armor, Quest Item).')
            .setRequired(true)
            .addChoices(
                { name: 'Consumable', value: 'Consumable' },
                { name: 'Weapon', value: 'Weapon' },
                { name: 'Armor', value: 'Armor' },
                { name: 'Quest Item', value: 'Quest Item' },
                { name: 'Misc', value: 'Misc' }
            ))
        .addStringOption(option =>
          option.setName('rarity')
            .setDescription('The rarity of the item (e.g., Common, Rare, Legendary).')
            .setRequired(true)
            .addChoices(
                { name: 'Common', value: 'Common' },
                { name: 'Uncommon', value: 'Uncommon' },
                { name: 'Rare', value: 'Rare' },
                { name: 'Epic', value: 'Epic' },
                { name: 'Legendary', value: 'Legendary' }
            ))
        .addStringOption(option =>
          option.setName('effect_description')
            .setDescription('What the item does (e.g., "Restores 20 HP").')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('effect_data')
            .setDescription('JSON data for item effects (e.g., {"hp_restore":20, "sanity_restore":10}).')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View details of an item type.')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('The name of the item to view.')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all defined item types.')
        .addStringOption(option =>
          option.setName('type')
            .setDescription('Filter by item type (e.g., Consumable, Weapon).')
            .setRequired(false)
            .addChoices(
                { name: 'Consumable', value: 'Consumable' },
                { name: 'Weapon', value: 'Weapon' },
                { name: 'Armor', value: 'Armor' },
                { name: 'Quest Item', value: 'Quest Item' },
                { name: 'Misc', value: 'Misc' }
            ))),

  // --- /inventory command for managing character inventories ---
  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Manage character inventories and items.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View a character\'s inventory.')
        .addStringOption(option =>
          option.setName('character_name')
            .setDescription('The name of the character whose inventory to view (defaults to your latest).')
            .setRequired(false)))
    .addSubcommand(subcommand => // Admin-only for now
      subcommand
        .setName('add')
        .setDescription('Add an item to a character\'s inventory (admin only).')
        .addStringOption(option =>
          option.setName('character_name')
            .setDescription('The name of the character to add the item to.')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('item_name')
            .setDescription('The name of the item to add.')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('quantity')
            .setDescription('The quantity of the item to add (default is 1).')
            .setRequired(false))),

  // --- NEW: /battle command for initiating and managing battles ---
  new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Initiate and manage combat encounters.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Start a new battle against an opponent.')
        .addStringOption(option =>
          option.setName('opponent_name')
            .setDescription('The name of the NPC opponent to fight (e.g., "Goblin Scavenger").')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View the current status of the battle in this channel.'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('End the current battle in this channel (admin only).')) // Admin-only initially
];

// .map(command => command.toJSON(); is called after the array of commands.
// It's not part of the individual SlashCommandBuilder definition.
// So, it's defined once at the end.

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`🚀 ${client.user.tag} is online!`);

  try {
    console.log('⌛ Registering slash commands...');
    // Register commands globally if TEST_GUILD_ID is not set, otherwise only in test guild
    if (process.env.TEST_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
        { body: commands.map(command => command.toJSON()) }, // Correctly map here
      );
      console.log('⚡ Commands registered in test server');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands.map(command => command.toJSON()) }, // Correctly map here
      );
      console.log('⚡ Commands registered globally');
    }
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
});

// --- GLOBAL ERROR HANDLERS ---
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
  // Optional: Perform graceful shutdown or notify
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught exception:', error);
  // This is a synchronous error that wasn't caught.
  // It's critical to handle these, but after logging,
  // the process might be in an unstable state.
  // Optional: Perform graceful shutdown
  process.exit(1); // Exit with a failure code
});

// Discord.js client error handling
client.on('error', err => {
    console.error('❌ Discord.js Client Error:', err);
});

client.on('shardError', err => {
    console.error('❌ Discord.js Shard Error:', err);
});

// --- DEDICATED POSTGRESQL CLIENT ERROR HANDLER ---
pgClient.on('error', err => {
    console.error('❌ PostgreSQL Client Error (Caught by Listener):', err);
    // This is crucial. When the pg client emits an error, it often means the connection is bad.
    // You might want to implement a reconnection strategy here.
    // For now, logging it will help identify the cause without crashing the process immediately.
});
// --- END DEDICATED POSTGRESQL CLIENT ERROR HANDLER ---


client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  try {
    if (commandName === 'character') {
      const subcommand = options.getSubcommand();
      const userId = interaction.user.id;

      if (subcommand === 'create') {
        const name = options.getString('name');
        const avatarURL = options.getString('avatar_url');
        const gender = options.getString('gender');
        const age = options.getInteger('age');
        const species = options.getString('species');
        const occupation = options.getString('occupation');
        const appearanceURL = options.getString('appearance_url');
        const sanityIncrease = options.getString('sanity_increase');
        const sanityDecrease = options.getString('sanity_decrease');
        const startingAttackName = options.getString('starting_attack');

        // --- Defer the reply immediately to prevent "Unknown interaction" ---
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Basic URL validation for avatar_url
        try {
            new URL(avatarURL);
        } catch (e) {
            // Use editReply as the interaction is already deferred
            return interaction.editReply({ content: '❌ Invalid URL for avatar. Please provide a valid image URL.' });
        }
        // Basic URL validation for appearance_url if provided
        if (appearanceURL) {
            try {
                new URL(appearanceURL);
            } catch (e) {
                // Use editReply as the interaction is already deferred
                return interaction.editReply({ content: '❌ Invalid URL for appearance. Please provide a valid image URL.' });
            }
        }

        try {
            // Check if character already exists for this user
            const checkQuery = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
            const checkResult = await pgClient.query(checkQuery, [userId, name]);

            if (checkResult.rows.length > 0) {
              // Use editReply as the interaction is already deferred
              return interaction.editReply({ content: `❌ You already have a character named "${name}".` });
            }

            // Insert new character with all new fields, including sanity descriptions
            const insertQuery = `
              INSERT INTO characters (user_id, name, avatar_url, gender, age, species, occupation, appearance_url, sanity_increase_desc, sanity_decrease_desc)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, sanity_max; -- Return the character ID and max sanity
            `;
            const insertResult = await pgClient.query(insertQuery, [userId, name, avatarURL, gender, age, species, occupation, appearanceURL, sanityIncrease, sanityDecrease]);
            const newCharacterId = insertResult.rows[0].id;

            let finalAttackToAssign = 'Night Weaver\'s Grasp'; // Default fallback attack
            if (startingAttackName) {
                // Validate if the chosen starting attack exists in the 'attacks' table
                const checkAttackQuery = 'SELECT id FROM attacks WHERE name = $1;';
                const checkAttackResult = await pgClient.query(checkAttackQuery, [startingAttackName]);
                if (checkAttackResult.rows.length > 0) {
                    finalAttackToAssign = startingAttackName;
                } else {
                    // Use followUp here to send an additional message after the initial deferReply
                    await interaction.followUp({ content: `⚠️ The starting attack "${startingAttackName}" was not found in my database. Using "${finalAttackToAssign}" as your default starting attack.`, flags: MessageFlags.Ephemeral });
                }
            }

            const getInitialAttackIdQuery = 'SELECT id FROM attacks WHERE name = $1;';
            const initialAttackResult = await pgClient.query(getInitialAttackIdQuery, [finalAttackToAssign]);

            if (initialAttackResult.rows.length > 0) {
                const initialAttackId = initialAttackResult.rows[0].id;
                const assignAttackQuery = `
                    INSERT INTO character_attacks (character_id, attack_id, is_unlocked, level, perfect_hits)
                    VALUES ($1, $2, TRUE, 0, 0); -- Start unlocked, level 0, 0 perfect hits
                `;
                await pgClient.query(assignAttackQuery, [newCharacterId, initialAttackId]);
                console.log(`Assigned ${finalAttackToAssign} to new character ${name}.`);
            } else {
                console.error(`Initial attack "${finalAttackToAssign}" not found in 'attacks' table. This should not happen if default is 'Night Weaver\'s Grasp'.`);
            }

            // Final reply uses editReply as the interaction is already deferred
            await interaction.editReply({ content: `✅ Character "${name}" created successfully!` + (startingAttackName && startingAttackName !== finalAttackToAssign ? ` (Used "${finalAttackToAssign}" as starting attack).` : '') });

        } catch (dbError) {
            console.error('Error creating character in DB:', dbError);
            // Ensure you use editReply if deferred/replied, otherwise reply
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ An error occurred while saving your character.' });
            } else {
                return interaction.reply({ content: '❌ An error occurred while saving your character.', flags: MessageFlags.Ephemeral });
            }
        }


      } else if (subcommand === 'sheet') { // 'sheet' subcommand handler
        const characterName = options.getString('name');
        let character;

        // Defer reply for sheet command, could be ephemeral or not
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // Made ephemeral for sheet for privacy

        try {
          if (characterName) {
            const query = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
            const result = await pgClient.query(query, [userId, characterName]);
            character = result.rows[0];
          } else {
            // Fetch the latest created character if no name is provided
            const query = 'SELECT * FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
            const result = await pgClient.query(query, [userId]);
            character = result.rows[0];
          }

          if (!character) {
            return interaction.editReply({ content: `❌ Character "${characterName || 'latest'}" not found. Create one with \`/character create\`.` });
          }

          // Fetch character's attacks
          const characterAttacksQuery = `
            SELECT a.name, ca.level, ca.perfect_hits, at.name AS type_name, af.name AS affinity_name, a.base_damage_dice
            FROM character_attacks ca
            JOIN attacks a ON ca.attack_id = a.id
            JOIN attack_types at ON a.type_id = at.id
            JOIN affinities af ON a.affinity_id = af.id
            WHERE ca.character_id = $1 AND ca.is_unlocked = TRUE;
          `;
          const characterAttacksResult = await pgClient.query(characterAttacksQuery, [character.id]);
          const unlockedAttacks = characterAttacksResult.rows;

          const characterEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(character.name)
            .setDescription(`**${character.gender || 'N/A'}**, ${character.age || 'N/A'} years old ${character.species ? `(${character.species})` : ''}`)
            .setThumbnail(character.avatar_url)
            .addFields(
              { name: 'Occupation', value: character.occupation || 'N/A', inline: true },
              { name: 'Level', value: character.level.toString(), inline: true },
              { name: 'CXP', value: character.cxp.toString(), inline: true },
              { name: 'Health', value: `${character.health_current}/${character.health_max}`, inline: true }, // ADDED THIS
              { name: 'Sanity', value: `${character.sanity_current}/${character.sanity_max}`, inline: true },
              { name: 'Attack Chain Max', value: character.attack_chain_max.toString(), inline: true },
              { name: 'Sanity Increases With', value: character.sanity_increase_desc || 'N/A', inline: false },
              { name: 'Sanity Decreases With', value: character.sanity_decrease_desc || 'N/A', inline: false }
              // Add more fields as you implement them (Skills, Affinities, Passives, Weaponry, Friendships)
            );

          if (unlockedAttacks.length > 0) {
            const attacksField = unlockedAttacks.map(att => {
              const currentDamageDice = calculateDamageDice(att.base_damage_dice, att.level);
              return `**${att.name}** (Lvl ${att.level}, Hits: ${att.perfect_hits}/5)\n` +
                     `  Type: ${att.type_name}, Affinity: ${att.affinity_name}, Damage: ${currentDamageDice}`;
            }).join('\n');
            characterEmbed.addFields({ name: 'Unlocked Attacks', value: attacksField, inline: false });
          } else {
            characterEmbed.addFields({ name: 'Unlocked Attacks', value: 'None yet.', inline: false });
          }

          characterEmbed.setImage(character.appearance_url || null)
            .setFooter({ text: `Character ID: ${character.id} | User ID: ${character.user_id}` })
            .setTimestamp();

          await interaction.editReply({ embeds: [characterEmbed] }); // Use editReply

        } catch (dbError) {
          console.error('Error fetching character sheet from DB:', dbError);
          if (interaction.deferred || interaction.replied) {
              return interaction.editReply({ content: '❌ An error occurred while fetching your character sheet.' });
          } else {
              return interaction.reply({ content: '❌ An error occurred while fetching your character sheet.', flags: MessageFlags.Ephemeral });
          }
        }

      } else if (subcommand === 'list') {
        // Defer reply for list command
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const query = 'SELECT name, avatar_url, level, cxp FROM characters WHERE user_id = $1;';
            const result = await pgClient.query(query, [userId]);
            const characters = result.rows;

            if (characters.length === 0) {
              return interaction.editReply({ content: 'You have no characters yet. Create one with `/character create`.' });
            }

            const characterList = characters.map(char => `- ${char.name} (Lvl ${char.level}, CXP ${char.cxp})`).join('\n');
            await interaction.editReply({ content: `Your characters:\n${characterList}` });

        } catch (dbError) {
            console.error('Error listing characters from DB:', dbError);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ An error occurred while fetching your characters.' });
            } else {
                return interaction.reply({ content: '❌ An error occurred while fetching your characters.', flags: MessageFlags.Ephemeral });
            }
        }

      } else if (subcommand === 'set_default') {
        // Implement default character logic here if needed,
        // e.g., by adding a 'isDefault' field to schema or a separate UserPreferences model.
        await interaction.reply({ content: 'Default character setting is not yet implemented.', flags: MessageFlags.Ephemeral });

      } else if (subcommand === 'delete') {
        const name = options.getString('name');
        // Defer reply immediately
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const query = 'DELETE FROM characters WHERE user_id = $1 AND name = $2;';
            const result = await pgClient.query(query, [userId, name]);

            if (result.rowCount === 0) {
              return interaction.editReply({ content: `❌ Character "${name}" not found.` });
            }

            await interaction.editReply({ content: `✅ Character "${name}" deleted successfully!` });
        } catch (dbError) {
            console.error('Error deleting character from DB:', dbError);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply({ content: '❌ An error occurred while deleting your character.' });
            } else {
                return interaction.reply({ content: '❌ An error occurred while deleting your character.', flags: MessageFlags.Ephemeral });
            }
        }
      }

    } else if (commandName === 'rp') {
      const userId = interaction.user.id;
      try {
        const query = 'SELECT name, avatar_url FROM characters WHERE user_id = $1 LIMIT 1;';
        const result = await pgClient.query(query, [userId]);
        const character = result.rows[0];

        if (!character) {
          return interaction.reply({ content: 'You need to create a character first with `/character create`.', flags: MessageFlags.Ephemeral });
        }

        const channel = options.getChannel('channel') || interaction.channel;

        if (!channel.permissionsFor(client.user).has(['ManageWebhooks', 'SendMessages'])) {
          return interaction.reply({
              content: `❌ I don't have permission to create webhooks or send messages in ${channel.name}.`,
              flags: MessageFlags.Ephemeral
          });
        }

        const message = options.getString('message');

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(w => w.owner.id === client.user.id && w.name === 'RP Webhook');

        if (!webhook) {
          webhook = await channel.createWebhook({
            name: 'RP Webhook',
            avatar: client.user.displayAvatarURL(),
            reason: 'Webhook for roleplaying messages'
          });
        }

        await webhook.send({
          content: message,
          username: character.name,
          avatarURL: character.avatar_url
        });

        await interaction.editReply({ content: 'Your in-character message has been sent!' });

      } catch (dbError) {
        console.error('Error during RP command DB lookup or webhook:', dbError);
        if (interaction.deferred || interaction.replied) {
            return interaction.editReply({ content: '❌ An error occurred during RP command.' });
        } else {
            return interaction.reply({ content: '❌ An error occurred during RP command.', flags: MessageFlags.Ephemeral });
        }
      }
    } else if (commandName === 'roll') {
      const diceNotation = options.getString('dice');
      await interaction.deferReply(); // Not ephemeral as rolls are often public
      try {
        const rollResult = rollDice(diceNotation);
        await interaction.editReply({
          content: `🎲 Rolled ${diceNotation}: [${rollResult.rolls.join(', ')}] Total: **${rollResult.total}**` +
                   (rollResult.maxRoll ? ' (Perfect Roll!)' : '')
        });
      } catch (error) {
        console.error('Error handling /roll command:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: `❌ Error rolling dice: ${error.message}` });
        } else {
            await interaction.reply({ content: `❌ Error rolling dice: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
      }
    }

    // --- /item command handler ---
    else if (commandName === 'item') {
        const subcommand = options.getSubcommand();
        const userId = interaction.user.id; // For potential admin checks later

        if (subcommand === 'create') {
            // TODO: Implement admin check here if desired
            // if (userId !== 'YOUR_DISCORD_USER_ID') {
            //     return interaction.reply({ content: 'You do not have permission to create items.', flags: MessageFlags.Ephemeral });
            // }

            const name = options.getString('name');
            const description = options.getString('description');
            const type = options.getString('type');
            const rarity = options.getString('rarity');
            const effectDescription = options.getString('effect_description');
            const effectDataString = options.getString('effect_data');
            let effectData = null;

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            if (effectDataString) {
                try {
                    effectData = JSON.parse(effectDataString);
                } catch (e) {
                    return interaction.editReply({ content: '❌ Invalid JSON for `effect_data`. Please ensure it\'s valid JSON (e.g., `{"hp_restore":20}`).' });
                }
            }

            try {
                const checkQuery = 'SELECT * FROM items WHERE name = $1;';
                const checkResult = await pgClient.query(checkQuery, [name]);
                if (checkResult.rows.length > 0) {
                    return interaction.editReply({ content: `❌ An item named "${name}" already exists.` });
                }

                const insertQuery = `
                    INSERT INTO items (name, description, item_type, rarity, effect_description, effect_data)
                    VALUES ($1, $2, $3, $4, $5, $6);
                `;
                await pgClient.query(insertQuery, [name, description, type, rarity, effectDescription, effectData]);

                await interaction.editReply({ content: `✅ Item "${name}" (${type}, ${rarity}) created successfully!` });

            } catch (dbError) {
                console.error('Error creating item in DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while creating the item.' });
            }
        } else if (subcommand === 'view') {
            const name = options.getString('name');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const query = 'SELECT * FROM items WHERE name = $1;';
                const result = await pgClient.query(query, [name]);
                const item = result.rows[0];

                if (!item) {
                    return interaction.editReply({ content: `❌ Item "${name}" not found.` });
                }

                const itemEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(item.name)
                    .setDescription(item.description || 'No description provided.')
                    .addFields(
                        { name: 'Type', value: item.item_type || 'N/A', inline: true },
                        { name: 'Rarity', value: item.rarity || 'N/A', inline: true },
                        { name: 'Effect', value: item.effect_description || 'None', inline: false }
                    );

                if (item.effect_data) {
                    itemEmbed.addFields({ name: 'Effect Data (JSON)', value: `\`\`\`json\n${JSON.stringify(item.effect_data, null, 2)}\n\`\`\``, inline: false });
                }

                await interaction.editReply({ embeds: [itemEmbed] });

            } catch (dbError) {
                console.error('Error viewing item from DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while fetching item details.' });
            }
        } else if (subcommand === 'list') {
            const typeFilter = options.getString('type');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                let query = 'SELECT name, item_type, rarity FROM items';
                const params = [];
                if (typeFilter) {
                    query += ' WHERE item_type = $1';
                    params.push(typeFilter);
                }
                query += ' ORDER BY name;';

                const result = await pgClient.query(query, params);
                const items = result.rows;

                if (items.length === 0) {
                    return interaction.editReply({ content: `No items found${typeFilter ? ` for type "${typeFilter}"` : ''}.` });
                }

                const itemList = items.map(item => `- **${item.name}** (${item.item_type}, ${item.rarity})`).join('\n');
                await interaction.editReply({ content: `**Available Items${typeFilter ? ` (${typeFilter})` : ''}:**\n${itemList}` });

            } catch (dbError) {
                console.error('Error listing items from DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while listing items.' });
            }
        }
    }

    // --- /inventory command handler ---
    else if (commandName === 'inventory') {
        const subcommand = options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === 'view') {
            const characterName = options.getString('character_name');
            let character;

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                if (characterName) {
                    const query = 'SELECT id, name FROM characters WHERE user_id = $1 AND name = $2;';
                    const result = await pgClient.query(query, [userId, characterName]);
                    character = result.rows[0];
                } else {
                    const query = 'SELECT id, name, avatar_url FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;'; // Fetch avatar_url
                    const result = await pgClient.query(query, [userId]);
                    character = result.rows[0];
                }

                if (!character) {
                    return interaction.editReply({ content: `❌ Character "${characterName || 'latest'}" not found. Create one with \`/character create\`.` });
                }

                const inventoryQuery = `
                    SELECT i.name, i.item_type, i.rarity, ci.quantity
                    FROM character_items ci
                    JOIN items i ON ci.item_id = i.id
                    WHERE ci.character_id = $1
                    ORDER BY i.name;
                `;
                const inventoryResult = await pgClient.query(inventoryQuery, [character.id]);
                const itemsInInventory = inventoryResult.rows;

                const inventoryEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle(`${character.name}'s Inventory`)
                    .setThumbnail(character.avatar_url || null); // Use character's avatar as thumbnail

                if (itemsInInventory.length === 0) {
                    inventoryEmbed.setDescription('Inventory is empty.');
                } else {
                    const itemFields = itemsInInventory.map(item =>
                        `**${item.name}** (x${item.quantity}) - ${item.item_type} (${item.rarity})`
                    ).join('\n');
                    inventoryEmbed.setDescription(itemFields);
                }

                await interaction.editReply({ embeds: [inventoryEmbed] });

            } catch (dbError) {
                console.error('Error viewing inventory from DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while fetching the inventory.' });
            }
        } else if (subcommand === 'add') {
            // TODO: Implement admin check here if desired
            // if (userId !== 'YOUR_DISCORD_USER_ID') {
            //     return interaction.reply({ content: 'You do not have permission to add items to inventories.', flags: MessageFlags.Ephemeral });
            // }

            const characterName = options.getString('character_name');
            const itemName = options.getString('item_name');
            const quantity = options.getInteger('quantity') || 1;

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const characterQuery = 'SELECT id FROM characters WHERE user_id = $1 AND name = $2;';
                const characterResult = await pgClient.query(characterQuery, [userId, characterName]);
                const character = characterResult.rows[0];

                if (!character) {
                    return interaction.editReply({ content: `❌ Character "${characterName}" not found for your user ID.` });
                }

                const itemQuery = 'SELECT id FROM items WHERE name = $1;';
                const itemResult = await pgClient.query(itemQuery, [itemName]);
                const item = itemResult.rows[0];

                if (!item) {
                    return interaction.editReply({ content: `❌ Item "${itemName}" not found in item definitions. Use \`/item create\` first.` });
                }

                // Check if character already has the item
                const checkInventoryQuery = 'SELECT quantity FROM character_items WHERE character_id = $1 AND item_id = $2;';
                const checkInventoryResult = await pgClient.query(checkInventoryQuery, [character.id, item.id]);

                if (checkInventoryResult.rows.length > 0) {
                    // Update quantity if item already exists
                    const currentQuantity = checkInventoryResult.rows[0].quantity;
                    const newQuantity = currentQuantity + quantity;
                    const updateQuery = 'UPDATE character_items SET quantity = $1 WHERE character_id = $2 AND item_id = $3;';
                    await pgClient.query(updateQuery, [newQuantity, character.id, item.id]);
                    await interaction.editReply({ content: `✅ Added ${quantity}x "${itemName}" to ${characterName}'s inventory. Total: ${newQuantity}.` });
                } else {
                    // Insert new entry if item not found in inventory
                    const insertQuery = 'INSERT INTO character_items (character_id, item_id, quantity) VALUES ($1, $2, $3);';
                    await pgClient.query(insertQuery, [character.id, item.id, quantity]);
                    await interaction.editReply({ content: `✅ Added ${quantity}x "${itemName}" to ${characterName}'s inventory.` });
                }

            } catch (dbError) {
                console.error('Error adding item to inventory in DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while adding the item to inventory.' });
            }
        }
    }

    // --- NEW: /battle command handler ---
    else if (commandName === 'battle') {
        const subcommand = options.getSubcommand();
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        const userId = interaction.user.id;

        if (subcommand === 'start') {
            const opponentName = options.getString('opponent_name');
            await interaction.deferReply(); // Make visible to all in channel

            try {
                // 1. Check if a battle is already active in this channel
                const activeBattleQuery = 'SELECT id FROM battles WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\';';
                const activeBattleResult = await pgClient.query(activeBattleQuery, [guildId, channelId]);
                if (activeBattleResult.rows.length > 0) {
                    return interaction.editReply({ content: '❌ A battle is already active in this channel. Use `/battle status` to check it or `/battle end` to force end it (admin only).' });
                }

                // 2. Get the user's latest character
                const charQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
                const charResult = await pgClient.query(charQuery, [userId]);
                const playerCharacter = charResult.rows[0];

                if (!playerCharacter) {
                    return interaction.editReply({ content: '❌ You need to create a character first with `/character create` to start a battle.' });
                }

                // 3. Get the NPC opponent
                const npcQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM npcs WHERE name = $1;';
                const npcResult = await pgClient.query(npcQuery, [opponentName]);
                const npcOpponent = npcResult.rows[0];

                if (!npcOpponent) {
                    return interaction.editReply({ content: `❌ NPC "${opponentName}" not found. Make sure the name is spelled correctly.` });
                }

                // 4. Create a new battle entry
                const createBattleQuery = `
                    INSERT INTO battles (guild_id, channel_id, status)
                    VALUES ($1, $2, 'active') RETURNING id;
                `;
                const battleResult = await pgClient.query(createBattleQuery, [guildId, channelId]);
                const newBattleId = battleResult.rows[0].id;

                // 5. Add participants to battle_participants table
                const addPlayerParticipantQuery = `
                    INSERT INTO battle_participants (battle_id, character_id, current_health, current_sanity, is_player)
                    VALUES ($1, $2, $3, $4, TRUE) RETURNING id;
                `;
                const playerParticipantResult = await pgClient.query(addPlayerParticipantQuery, [newBattleId, playerCharacter.id, playerCharacter.health_max, playerCharacter.sanity_max]);
                const playerParticipantId = playerParticipantResult.rows[0].id;

                const addNpcParticipantQuery = `
                    INSERT INTO battle_participants (battle_id, npc_id, current_health, current_sanity, is_player)
                    VALUES ($1, $2, $3, $4, FALSE) RETURNING id;
                `;
                const npcParticipantResult = await pgClient.query(addNpcParticipantQuery, [newBattleId, npcOpponent.id, npcOpponent.health_max, npcOpponent.sanity_max]);
                const npcParticipantId = npcParticipantResult.rows[0].id;

                // 6. Determine turn order and set current_turn_participant_id (for now, player goes first)
                const turnOrder = [
                    { type: 'character', id: playerParticipantId },
                    { type: 'npc', id: npcParticipantId }
                ];
                await pgClient.query(
                    'UPDATE battles SET turn_order = $1, current_turn_participant_id = $2 WHERE id = $3;',
                    [JSON.stringify(turnOrder), playerParticipantId, newBattleId]
                );

                const battleEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('⚔️ Battle Started! ⚔️')
                    .setDescription(`**${playerCharacter.name}** vs. **${npcOpponent.name}**`)
                    .addFields(
                        { name: 'Your Character', value: `${playerCharacter.name} (HP: ${playerCharacter.health_max}, SP: ${playerCharacter.sanity_max})`, inline: true },
                        { name: 'Opponent', value: `${npcOpponent.name} (HP: ${npcOpponent.health_max}, SP: ${npcOpponent.sanity_max})`, inline: true },
                        { name: 'Current Turn', value: currentTurnName, inline: false }
                    )
                    .setThumbnail(playerCharacter.avatar_url || null)
                    .setImage(npcOpponent.avatar_url || null)
                    .setFooter({ text: `Battle ID: ${newBattleId}` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [battleEmbed] });

            } catch (dbError) {
                console.error('Error starting battle in DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while trying to start the battle.' });
            }
        } else if (subcommand === 'status') {
            await interaction.deferReply(); // Visible to all

            try {
                const battleQuery = `
                    SELECT
                        b.id AS battle_id, b.status, b.round_number, b.turn_order, b.current_turn_participant_id,
                        bp.id AS participant_id, bp.is_player, bp.current_health, bp.current_sanity,
                        COALESCE(c.name, n.name) AS participant_name,
                        COALESCE(c.avatar_url, n.avatar_url) AS participant_avatar_url,
                        COALESCE(c.health_max, n.health_max) AS max_health,
                        COALESCE(c.sanity_max, n.sanity_max) AS max_sanity
                    FROM battles b
                    JOIN battle_participants bp ON b.id = bp.battle_id
                    LEFT JOIN characters c ON bp.character_id = c.id
                    LEFT JOIN npcs n ON bp.npc_id = n.id
                    WHERE b.guild_id = $1 AND b.channel_id = $2 AND b.status = 'active'
                    ORDER BY bp.is_player DESC, participant_name; -- Players first, then NPCs
                `;
                const battleResult = await pgClient.query(battleQuery, [guildId, channelId]);

                if (battleResult.rows.length === 0) {
                    return interaction.editReply({ content: 'No active battle found in this channel. Use `/battle start` to begin one!' });
                }

                const battle = battleResult.rows[0]; // First row has battle details
                const participants = battleResult.rows;

                let playerStatus = '';
                let npcStatus = '';
                let currentTurnName = 'Unknown';
                let currentTurnAvatar = null;

                for (const p of participants) {
                    const statusLine = `**${p.participant_name}** (HP: ${p.current_health}/${p.max_health}, SP: ${p.current_sanity}/${p.max_sanity})`;
                    if (p.is_player) {
                        playerStatus += statusLine + '\n';
                    } else {
                        npcStatus += statusLine + '\n';
                    }

                    if (p.participant_id === battle.current_turn_participant_id) {
                        currentTurnName = p.participant_name;
                        currentTurnAvatar = p.participant_avatar_url;
                    }
                }

                const statusEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle('Current Battle Status 📊')
                    .setDescription(`**Round ${battle.round_number}**`)
                    .addFields(
                        { name: 'Current Turn', value: currentTurnName, inline: false },
                        { name: 'Your Character(s)', value: playerStatus || 'None', inline: true },
                        { name: 'Opponent(s)', value: npcStatus || 'None', inline: true }
                    )
                    .setThumbnail(currentTurnAvatar || null)
                    .setFooter({ text: `Battle ID: ${battle.battle_id}` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [statusEmbed] });

            } catch (dbError) {
                console.error('Error fetching battle status from DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while fetching battle status.' });
            }
        } else if (subcommand === 'end') {
            // TODO: Implement admin check
            // if (userId !== 'YOUR_DISCORD_USER_ID') {
            //     return interaction.reply({ content: 'You do not have permission to end battles.', flags: MessageFlags.Ephemeral });
            // }
            await interaction.deferReply();

            try {
                const query = 'UPDATE battles SET status = \'ended\' WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\' RETURNING id;';
                const result = await pgClient.query(query, [guildId, channelId]);

                if (result.rowCount === 0) {
                    return interaction.editReply({ content: '❌ No active battle found in this channel to end.' });
                }

                await interaction.editReply({ content: '✅ Battle successfully ended!' });
            } catch (dbError) {
                console.error('Error ending battle in DB:', dbError);
                return interaction.editReply({ content: '❌ An error occurred while trying to end the battle.' });
            }
        }
    }

  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ An unexpected error occurred while executing this command.', flags: MessageFlags.Ephemeral });
    } else {
        await interaction.reply({ content: '❌ An unexpected error occurred while executing this command.', flags: MessageFlags.Ephemeral });
    }
  }
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .catch(err => console.error('❌ Login failed:', err));
