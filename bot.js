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
        health_max INTEGER DEFAULT 100,      -- ADDED THIS
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
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS health_max INTEGER DEFAULT 100;      -- ADDED THIS
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
        effect_value JSONB,        -- Store complex effect data as JSON
        inflicted_status VARCHAR(50) -- e.g., 'Fire', 'Bleed'
      );
    `;
    await pgClient.query(createAffinitiesTableQuery);
    console.log('📝 "affinities" table ensured.');

    // --- Insert default affinities if they don't exist ---
    const defaultAffinities = [
      { name: 'Wrath', description: 'Extra damage on the next attack after you take damage.', effect_type: 'damage_multiplier', effect_value: { multiplier: 1.5 }, inflicted_status: null },
      { name: 'Focus', description: 'Increased accuracy or critical chance for a short duration.', effect_type: 'crit_chance_boost', effect_value: { chance_increase: 0.15, duration_turns: 2 }, inflicted_status: null },
      { name: 'Dodge', description: 'Increased chance to evade attacks.', effect_type: 'evasion_chance_boost', effect_value: { chance_increase: 0.20, duration_turns: 1 }, inflicted_status: null },
      { name: 'Regeneration', description: 'Heal a small amount of health each turn.', effect_type: 'health_regen', effect_value: { amount: 5, duration_turns: 3 }, inflicted_status: null },
      { name: 'Poison', description: 'Deals damage over time.', effect_type: 'damage_over_time', effect_value: { amount: 3, duration_turns: 4 }, inflicted_status: 'Poisoned' },
      { name: 'Stun', description: 'Prevents target from acting for a turn.', effect_type: 'status_effect', effect_value: { effect: 'stun', duration_turns: 1 }, inflicted_status: 'Stunned' },
      { name: 'Bleed', description: 'Deals physical damage over time.', effect_type: 'damage_over_time', effect_value: { amount: 4, duration_turns: 3 }, inflicted_status: 'Bleeding' },
      { name: 'Fire', description: 'Deals fire damage over time.', effect_type: 'damage_over_time', effect_value: { amount: 5, duration_turns: 2 }, inflicted_status: 'Burning' },
    ];

    for (const affinity of defaultAffinities) {
      const { name, description, effect_type, effect_value, inflicted_status } = affinity;
      const query = `
        INSERT INTO affinities (name, description, effect_type, effect_value, inflicted_status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO NOTHING;
      `;
      await pgClient.query(query, [name, description, effect_type, JSON.stringify(effect_value), inflicted_status]);
    }
    console.log('📝 Default affinities ensured.');

    // --- Ensure 'attacks' table ---
    const createAttacksTableQuery = `
      CREATE TABLE IF NOT EXISTS attacks (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        base_damage_dice VARCHAR(50) NOT NULL, -- e.g., '1d6', '2d4+2'
        damage_type VARCHAR(50), -- e.g., 'physical', 'magical', 'fire'
        sanity_cost INTEGER DEFAULT 0,
        health_cost INTEGER DEFAULT 0,
        cooldown_turns INTEGER DEFAULT 0,
        affinity_id INTEGER REFERENCES affinities(id) ON DELETE SET NULL
      );
    `;
    await pgClient.query(createAttacksTableQuery);
    console.log('📝 "attacks" table ensured.');

    // --- Insert default attacks if they don't exist ---
    const defaultAttacks = [
      { name: 'Punch', description: 'A basic physical attack.', base_damage_dice: '1d4', damage_type: 'physical', sanity_cost: 0, health_cost: 0, cooldown_turns: 0, affinity_name: null },
      { name: 'Kick', description: 'A stronger physical attack.', base_damage_dice: '1d6', damage_type: 'physical', sanity_cost: 0, health_cost: 0, cooldown_turns: 0, affinity_name: null },
      { name: 'Fireball', description: 'Hurl a ball of fire at your enemy.', base_damage_dice: '2d6', damage_type: 'fire', sanity_cost: 10, health_cost: 0, cooldown_turns: 1, affinity_name: 'Fire' },
      { name: 'Mind Blast', description: 'Assault your foe\'s mind, causing sanity damage.', base_damage_dice: '1d8', damage_type: 'sanity', sanity_cost: 5, health_cost: 0, cooldown_turns: 2, affinity_name: null },
      { name: 'Poison Dart', description: 'Launch a dart tipped with potent poison.', base_damage_dice: '1d2', damage_type: 'physical', sanity_cost: 3, health_cost: 0, cooldown_turns: 1, affinity_name: 'Poison' },
      { name: 'Stunning Strike', description: 'A precise strike that can stun your opponent.', base_damage_dice: '1d4', damage_type: 'physical', sanity_cost: 7, health_cost: 0, cooldown_turns: 2, affinity_name: 'Stun' },
    ];

    for (const attack of defaultAttacks) {
      const { name, description, base_damage_dice, damage_type, sanity_cost, health_cost, cooldown_turns, affinity_name } = attack;
      let affinityId = null;
      if (affinity_name) {
        const res = await pgClient.query('SELECT id FROM affinities WHERE name = $1', [affinity_name]);
        if (res.rows.length > 0) {
          affinityId = res.rows[0].id;
        }
      }
      const query = `
        INSERT INTO attacks (name, description, base_damage_dice, damage_type, sanity_cost, health_cost, cooldown_turns, affinity_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (name) DO NOTHING;
      `;
      await pgClient.query(query, [name, description, base_damage_dice, damage_type, sanity_cost, health_cost, cooldown_turns, affinityId]);
    }
    console.log('📝 Default attacks ensured.');

    // --- Ensure 'character_attacks' join table ---
    const createCharacterAttacksTableQuery = `
      CREATE TABLE IF NOT EXISTS character_attacks (
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        attack_id INTEGER REFERENCES attacks(id) ON DELETE CASCADE,
        PRIMARY KEY (character_id, attack_id)
      );
    `;
    await pgClient.query(createCharacterAttacksTableQuery);
    console.log('📝 "character_attacks" table ensured.');

    // --- Ensure 'character_affinities' join table ---
    const createCharacterAffinitiesTableQuery = `
      CREATE TABLE IF NOT EXISTS character_affinities (
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        affinity_id INTEGER REFERENCES affinities(id) ON DELETE CASCADE,
        PRIMARY KEY (character_id, affinity_id)
      );
    `;
    await pgClient.query(createCharacterAffinitiesTableQuery);
    console.log('📝 "character_affinities" table ensured.');

    // --- Ensure 'character_inventory' table ---
    const createCharacterInventoryTableQuery = `
      CREATE TABLE IF NOT EXISTS character_inventory (
        id SERIAL PRIMARY KEY,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        quantity INTEGER DEFAULT 1,
        UNIQUE(character_id, item_name)
      );
    `;
    await pgClient.query(createCharacterInventoryTableQuery);
    console.log('📝 "character_inventory" table ensured.');

    // --- Ensure 'character_status_effects' table ---
    const createCharacterStatusEffectsTableQuery = `
      CREATE TABLE IF NOT EXISTS character_status_effects (
        id SERIAL PRIMARY KEY,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        status_name VARCHAR(100) NOT NULL,
        duration_turns INTEGER NOT NULL,
        effect_value JSONB, -- e.g., for poison damage per turn
        UNIQUE(character_id, status_name)
      );
    `;
    await pgClient.query(createCharacterStatusEffectsTableQuery);
    console.log('📝 "character_status_effects" table ensured.');

  })
  .catch(err => {
    console.error('❌ PostgreSQL Connection Error:', err);
  });


// Discord Bot Commands
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('createcharacter')
    .setDescription('Creates a new RPG character for you.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Your character\'s name')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('avatar_url')
        .setDescription('A URL for your character\'s avatar image')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('gender')
        .setDescription('Your character\'s gender')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('age')
        .setDescription('Your character\'s age')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('species')
        .setDescription('Your character\'s species')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('occupation')
        .setDescription('Your character\'s occupation')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('appearance_url')
        .setDescription('A URL for a full appearance image of your character')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('mycharacter')
    .setDescription('Displays your current character\'s stats.'),
  new SlashCommandBuilder()
    .setName('deletecharacter')
    .setDescription('Deletes your current character.'),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rolls dice (e.g., 1d6, 2d8+3).')
    .addStringOption(option =>
      option.setName('dice')
        .setDescription('The dice notation (e.g., 1d6, 2d8+3)')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('attack')
    .setDescription('Perform an attack with your character.')
    .addStringOption(option =>
      option.setName('attack_name')
        .setDescription('The name of the attack to use (e.g., Punch, Fireball)')
        .setRequired(true))
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user you want to attack (optional, for PvP or specific targets)')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('addattack')
    .setDescription('Adds an attack to your character\'s available attacks.')
    .addStringOption(option =>
      option.setName('attack_name')
        .setDescription('The name of the attack to add (e.g., Fireball, Stun)')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('removeattack')
    .setDescription('Removes an attack from your character\'s available attacks.')
    .addStringOption(option =>
      option.setName('attack_name')
        .setDescription('The name of the attack to remove')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('additem')
    .setDescription('Adds an item to your character\'s inventory.')
    .addStringOption(option =>
      option.setName('item_name')
        .setDescription('The name of the item to add')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('The quantity of the item (default: 1)')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('removeitem')
    .setDescription('Removes an item from your character\'s inventory.')
    .addStringOption(option =>
      option.setName('item_name')
        .setDescription('The name of the item to remove')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('quantity')
        .setDescription('The quantity of the item to remove (default: 1)')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Displays your character\'s inventory.'),
  new SlashCommandBuilder()
    .setName('heal')
    .setDescription('Heals your character.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount of health to heal')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('recover_sanity')
    .setDescription('Recovers your character\'s sanity.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount of sanity to recover')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('set_sanity_desc')
    .setDescription('Set descriptions for sanity changes (increase/decrease).')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Type of description (increase or decrease)')
        .setRequired(true)
        .addChoices(
          { name: 'Increase', value: 'increase' },
          { name: 'Decrease', value: 'decrease' }
        ))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('The description text')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('level_up')
    .setDescription('Manually levels up your character (for testing/GM use).')
    .addIntegerOption(option =>
      option.setName('levels')
        .setDescription('Number of levels to add')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('give_cxp')
    .setDescription('Gives CXP (Character Experience Points) to your character.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The amount of CXP to give')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('set_attack_chain_max')
    .setDescription('Sets the maximum attack chain for your character.')
    .addIntegerOption(option =>
      option.setName('max_chain')
        .setDescription('The maximum number of attacks in a chain')
        .setRequired(true)),
];

// Register Slash Commands
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // Use TEST_GUILD_ID for guild-specific commands during development
    // For global commands, use Routes.applicationCommands(process.env.CLIENT_ID)
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error refreshing commands:', error);
  }
})();


// Discord Bot Events
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const userId = interaction.user.id;

  // Helper to fetch character
  const getCharacter = async (uid) => {
    const res = await pgClient.query('SELECT * FROM characters WHERE user_id = $1', [uid]);
    return res.rows[0];
  };

  // Helper to update character health/sanity
  const updateCharacterStats = async (charId, healthChange = 0, sanityChange = 0) => {
    const char = await pgClient.query('SELECT health_current, health_max, sanity_current, sanity_max FROM characters WHERE id = $1', [charId]);
    if (!char.rows[0]) return;

    let newHealth = char.rows[0].health_current + healthChange;
    let newSanity = char.rows[0].sanity_current + sanityChange;

    newHealth = Math.min(Math.max(0, newHealth), char.rows[0].health_max);
    newSanity = Math.min(Math.max(0, newSanity), char.rows[0].sanity_max);

    await pgClient.query(
      'UPDATE characters SET health_current = $1, sanity_current = $2 WHERE id = $3',
      [newHealth, newSanity, charId]
    );
    return { newHealth, newSanity };
  };

  // Helper to add/remove status effects
  const manageStatusEffect = async (charId, statusName, duration, effectValue = null, action = 'add') => {
    if (action === 'add') {
      await pgClient.query(
        `INSERT INTO character_status_effects (character_id, status_name, duration_turns, effect_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (character_id, status_name) DO UPDATE SET duration_turns = EXCLUDED.duration_turns, effect_value = EXCLUDED.effect_value;`,
        [charId, statusName, duration, effectValue ? JSON.stringify(effectValue) : null]
      );
    } else if (action === 'remove') {
      await pgClient.query(
        'DELETE FROM character_status_effects WHERE character_id = $1 AND status_name = $2',
        [charId, statusName]
      );
    }
  };

  switch (commandName) {
    case 'ping':
      await interaction.reply('Pong!');
      break;

    case 'createcharacter':
      try {
        const name = interaction.options.getString('name');
        const avatarUrl = interaction.options.getString('avatar_url');
        const gender = interaction.options.getString('gender');
        const age = interaction.options.getInteger('age');
        const species = interaction.options.getString('species');
        const occupation = interaction.options.getString('occupation');
        const appearanceUrl = interaction.options.getString('appearance_url');

        // Check if character already exists for this user
        const existingChar = await getCharacter(userId);
        if (existingChar) {
          await interaction.reply({ content: `You already have a character named **${existingChar.name}**. You can only have one character at a time.`, ephemeral: true });
          return;
        }

        const res = await pgClient.query(
          `INSERT INTO characters (user_id, name, avatar_url, gender, age, species, occupation, appearance_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *;`,
          [userId, name, avatarUrl, gender, age, species, occupation, appearanceUrl]
        );
        const newCharacter = res.rows[0];

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`✨ Character Created: ${newCharacter.name} ✨`)
          .setDescription(`Welcome, **${newCharacter.name}**! Your adventure begins now.`)
          .setThumbnail(newCharacter.avatar_url)
          .addFields(
            { name: 'Gender', value: newCharacter.gender || 'N/A', inline: true },
            { name: 'Age', value: newCharacter.age ? newCharacter.age.toString() : 'N/A', inline: true },
            { name: 'Species', value: newCharacter.species || 'N/A', inline: true },
            { name: 'Occupation', value: newCharacter.occupation || 'N/A', inline: true },
            { name: 'Health', value: `${newCharacter.health_current}/${newCharacter.health_max}`, inline: true },
            { name: 'Sanity', value: `${newCharacter.sanity_current}/${newCharacter.sanity_max}`, inline: true },
            { name: 'Level', value: newCharacter.level.toString(), inline: true },
            { name: 'CXP', value: newCharacter.cxp.toString(), inline: true }
          )
          .setImage(newCharacter.appearance_url || null) // Add full appearance image if provided
          .setTimestamp()
          .setFooter({ text: `Character ID: ${newCharacter.id}` });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error creating character:', error);
        if (error.message.includes('duplicate key value violates unique constraint "characters_user_id_name_key"')) {
          await interaction.reply({ content: 'You already have a character with that name, or you already have a character created. Please choose a different name or delete your existing character first.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'There was an error creating your character. Please try again later.', ephemeral: true });
        }
      }
      break;

    case 'mycharacter':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You don\'t have a character yet! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        // Fetch character's attacks
        const attacksRes = await pgClient.query(
          `SELECT a.name, a.description, a.base_damage_dice
           FROM attacks a
           JOIN character_attacks ca ON a.id = ca.attack_id
           WHERE ca.character_id = $1;`,
          [character.id]
        );
        const characterAttacks = attacksRes.rows.map(a => `${a.name} (${a.base_damage_dice})`).join(', ') || 'None';

        // Fetch character's inventory
        const inventoryRes = await pgClient.query(
          `SELECT item_name, quantity FROM character_inventory WHERE character_id = $1;`,
          [character.id]
        );
        const inventoryItems = inventoryRes.rows.map(item => `${item.item_name} x${item.quantity}`).join(', ') || 'Empty';

        // Fetch character's active status effects
        const statusEffectsRes = await pgClient.query(
          `SELECT status_name, duration_turns FROM character_status_effects WHERE character_id = $1;`,
          [character.id]
        );
        const activeStatusEffects = statusEffectsRes.rows.map(se => `${se.status_name} (${se.duration_turns} turns left)`).join(', ') || 'None';

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`👤 ${character.name}'s Profile`)
          .setThumbnail(character.avatar_url)
          .addFields(
            { name: 'Health ❤️', value: `${character.health_current}/${character.health_max}`, inline: true },
            { name: 'Sanity 🧠', value: `${character.sanity_current}/${character.sanity_max}`, inline: true },
            { name: 'Level ⬆️', value: character.level.toString(), inline: true },
            { name: 'CXP ✨', value: character.cxp.toString(), inline: true },
            { name: 'Attack Chain Max ⛓️', value: character.attack_chain_max.toString(), inline: true },
            { name: 'Gender', value: character.gender || 'N/A', inline: true },
            { name: 'Age', value: character.age ? character.age.toString() : 'N/A', inline: true },
            { name: 'Species', value: character.species || 'N/A', inline: true },
            { name: 'Occupation', value: character.occupation || 'N/A', inline: true },
            { name: 'Known Attacks ⚔️', value: characterAttacks },
            { name: 'Inventory 🎒', value: inventoryItems },
            { name: 'Active Status Effects 🌡️', value: activeStatusEffects },
            { name: 'Sanity Increase Description', value: character.sanity_increase_desc || 'N/A' },
            { name: 'Sanity Decrease Description', value: character.sanity_decrease_desc || 'N/A' }
          )
          .setImage(character.appearance_url || null)
          .setTimestamp()
          .setFooter({ text: `Character ID: ${character.id}` });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error fetching character:', error);
        await interaction.reply({ content: 'There was an error fetching your character. Please try again later.', ephemeral: true });
      }
      break;

    case 'deletecharacter':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You don\'t have a character to delete!', ephemeral: true });
          return;
        }

        await pgClient.query('DELETE FROM characters WHERE user_id = $1;', [userId]);
        await interaction.reply({ content: `Your character **${character.name}** has been deleted.`, ephemeral: false }); // Not ephemeral, so others see it
      } catch (error) {
        console.error('Error deleting character:', error);
        await interaction.reply({ content: 'There was an error deleting your character. Please try again later.', ephemeral: true });
      }
      break;

    case 'roll':
      try {
        const diceNotation = interaction.options.getString('dice');
        const { total, rolls, maxRoll, maxPossible } = rollDice(diceNotation);

        let rollMessage = `You rolled **${diceNotation}**:\n`;
        rollMessage += `Individual rolls: [${rolls.join(', ')}]\n`;
        rollMessage += `Total: **${total}**`;

        if (maxRoll) {
          rollMessage += ` ✨ (Perfect Roll! Max possible: ${maxPossible})`;
        } else if (total === 1 && diceNotation.includes('d1')) { // Special case for 1d1 rolls
          rollMessage += ` (As expected!)`;
        } else if (total === maxPossible) { // If total is max possible, but not all individual dice were max (e.g., 1d4+3, roll 1, total 4)
          rollMessage += ` (Max total achieved!)`;
        } else if (total === 1 && !diceNotation.includes('+')) { // If total is 1 and no modifier
          rollMessage += ` (Critical Fail! 💀)`;
        }

        await interaction.reply(rollMessage);
      } catch (error) {
        console.error('Error rolling dice:', error);
        await interaction.reply({ content: `Error: ${error.message}`, ephemeral: true });
      }
      break;

    case 'attack':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to attack! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const attackName = interaction.options.getString('attack_name');
        const targetUser = interaction.options.getUser('target'); // Get the target user object

        // Fetch the attack details
        const attackRes = await pgClient.query(
          `SELECT a.*, aff.name as affinity_name
           FROM attacks a
           LEFT JOIN affinities aff ON a.affinity_id = aff.id
           WHERE a.name ILIKE $1;`,
          [attackName]
        );
        const attack = attackRes.rows[0];

        if (!attack) {
          await interaction.reply({ content: `Attack "${attackName}" not found.`, ephemeral: true });
          return;
        }

        // Check if character knows this attack (optional, based on game design)
        const knowsAttackRes = await pgClient.query(
          `SELECT 1 FROM character_attacks WHERE character_id = $1 AND attack_id = $2;`,
          [character.id, attack.id]
        );
        if (knowsAttackRes.rows.length === 0) {
          await interaction.reply({ content: `Your character doesn't know the attack "${attackName}". Use \`/addattack\` to learn it.`, ephemeral: true });
          return;
        }

        // Check sanity/health costs
        if (character.sanity_current < attack.sanity_cost) {
          await interaction.reply({ content: `You don't have enough sanity (${attack.sanity_cost} needed) to use ${attack.name}!`, ephemeral: true });
          return;
        }
        if (character.health_current < attack.health_cost) {
          await interaction.reply({ content: `You don't have enough health (${attack.health_cost} needed) to use ${attack.name}!`, ephemeral: true });
          return;
        }

        // Deduct costs
        await updateCharacterStats(character.id, -attack.health_cost, -attack.sanity_cost);

        // Calculate actual damage dice based on character level
        const actualDamageDice = calculateDamageDice(attack.base_damage_dice, character.level);
        const { total: damageDealt, rolls } = rollDice(actualDamageDice);

        let replyMessage = `**${character.name}** used **${attack.name}**! (Cost: ${attack.health_cost} HP, ${attack.sanity_cost} SP)\n`;
        replyMessage += `Rolled ${actualDamageDice}: [${rolls.join(', ')}] for **${damageDealt}** ${attack.damage_type} damage.`;

        // Handle target if provided
        if (targetUser) {
          const targetCharacter = await getCharacter(targetUser.id);
          if (targetCharacter) {
            // Apply damage to target
            const { newHealth, newSanity } = await updateCharacterStats(targetCharacter.id, -damageDealt, attack.damage_type === 'sanity' ? -damageDealt : 0);
            replyMessage += `\n**${targetCharacter.name}** took **${damageDealt}** damage! Their health is now ${newHealth}/${targetCharacter.health_max}.`;

            // Apply status effect if attack has one
            if (attack.affinity_id && attack.affinity_name) {
              const affinityRes = await pgClient.query('SELECT * FROM affinities WHERE id = $1', [attack.affinity_id]);
              const affinity = affinityRes.rows[0];
              if (affinity && affinity.inflicted_status) {
                await manageStatusEffect(targetCharacter.id, affinity.inflicted_status, affinity.effect_value.duration_turns, affinity.effect_value);
                replyMessage += `\n**${targetCharacter.name}** is now **${affinity.inflicted_status}** for ${affinity.effect_value.duration_turns} turns!`;
              }
            }

            // Check if target is defeated
            if (newHealth <= 0) {
              replyMessage += `\n**${targetCharacter.name}** has been defeated!`;
              // Potentially add logic for character defeat (e.g., reset health, temporary disable)
            }
          } else {
            replyMessage += `\n(Target user **${targetUser.username}** does not have a character.)`;
          }
        } else {
          replyMessage += `\n(No specific target, damage dealt to an imaginary foe or for testing.)`;
        }

        await interaction.reply(replyMessage);
      } catch (error) {
        console.error('Error performing attack:', error);
        await interaction.reply({ content: 'There was an error performing the attack. Please try again later.', ephemeral: true });
      }
      break;

    case 'addattack':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to add attacks to! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const attackName = interaction.options.getString('attack_name');

        // Find the attack in the attacks table
        const attackRes = await pgClient.query('SELECT id, name FROM attacks WHERE name ILIKE $1;', [attackName]);
        const attack = attackRes.rows[0];

        if (!attack) {
          await interaction.reply({ content: `Attack "${attackName}" not found in the available attacks.`, ephemeral: true });
          return;
        }

        // Check if character already knows this attack
        const knowsAttackRes = await pgClient.query(
          `SELECT 1 FROM character_attacks WHERE character_id = $1 AND attack_id = $2;`,
          [character.id, attack.id]
        );
        if (knowsAttackRes.rows.length > 0) {
          await interaction.reply({ content: `Your character already knows the attack "${attack.name}".`, ephemeral: true });
          return;
        }

        // Add the attack to the character_attacks join table
        await pgClient.query(
          `INSERT INTO character_attacks (character_id, attack_id) VALUES ($1, $2);`,
          [character.id, attack.id]
        );

        await interaction.reply({ content: `**${character.name}** has learned the attack **${attack.name}**!`, ephemeral: false });
      } catch (error) {
        console.error('Error adding attack:', error);
        await interaction.reply({ content: 'There was an error adding the attack. Please try again later.', ephemeral: true });
      }
      break;

    case 'removeattack':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to remove attacks from!', ephemeral: true });
          return;
        }

        const attackName = interaction.options.getString('attack_name');

        // Find the attack in the attacks table
        const attackRes = await pgClient.query('SELECT id, name FROM attacks WHERE name ILIKE $1;', [attackName]);
        const attack = attackRes.rows[0];

        if (!attack) {
          await interaction.reply({ content: `Attack "${attackName}" not found.`, ephemeral: true });
          return;
        }

        // Check if character actually knows this attack
        const knowsAttackRes = await pgClient.query(
          `SELECT 1 FROM character_attacks WHERE character_id = $1 AND attack_id = $2;`,
          [character.id, attack.id]
        );
        if (knowsAttackRes.rows.length === 0) {
          await interaction.reply({ content: `Your character doesn't know the attack "${attack.name}".`, ephemeral: true });
          return;
        }

        // Remove the attack from the character_attacks join table
        await pgClient.query(
          `DELETE FROM character_attacks WHERE character_id = $1 AND attack_id = $2;`,
          [character.id, attack.id]
        );

        await interaction.reply({ content: `**${character.name}** has forgotten the attack **${attack.name}**.`, ephemeral: false });
      } catch (error) {
        console.error('Error removing attack:', error);
        await interaction.reply({ content: 'There was an error removing the attack. Please try again later.', ephemeral: true });
      }
      break;

    case 'additem':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to add items to! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const itemName = interaction.options.getString('item_name');
        const quantity = interaction.options.getInteger('quantity') || 1;

        if (quantity <= 0) {
          await interaction.reply({ content: 'Quantity must be a positive number.', ephemeral: true });
          return;
        }

        await pgClient.query(
          `INSERT INTO character_inventory (character_id, item_name, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (character_id, item_name) DO UPDATE SET quantity = character_inventory.quantity + EXCLUDED.quantity;`,
          [character.id, itemName, quantity]
        );

        await interaction.reply({ content: `Added **${quantity}x ${itemName}** to **${character.name}**'s inventory.`, ephemeral: false });
      } catch (error) {
        console.error('Error adding item:', error);
        await interaction.reply({ content: 'There was an error adding the item. Please try again later.', ephemeral: true });
      }
      break;

    case 'removeitem':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to remove items from!', ephemeral: true });
          return;
        }

        const itemName = interaction.options.getString('item_name');
        const quantityToRemove = interaction.options.getInteger('quantity') || 1;

        if (quantityToRemove <= 0) {
          await interaction.reply({ content: 'Quantity to remove must be a positive number.', ephemeral: true });
          return;
        }

        const itemRes = await pgClient.query(
          `SELECT quantity FROM character_inventory WHERE character_id = $1 AND item_name ILIKE $2;`,
          [character.id, itemName]
        );
        const existingItem = itemRes.rows[0];

        if (!existingItem) {
          await interaction.reply({ content: `**${character.name}** does not have "${itemName}" in their inventory.`, ephemeral: true });
          return;
        }

        if (existingItem.quantity <= quantityToRemove) {
          // Remove the item entirely if quantity is less than or equal to quantityToRemove
          await pgClient.query(
            `DELETE FROM character_inventory WHERE character_id = $1 AND item_name ILIKE $2;`,
            [character.id, itemName]
          );
          await interaction.reply({ content: `Removed all **${existingItem.quantity}x ${itemName}** from **${character.name}**'s inventory.`, ephemeral: false });
        } else {
          // Decrease quantity
          await pgClient.query(
            `UPDATE character_inventory SET quantity = quantity - $1 WHERE character_id = $2 AND item_name ILIKE $3;`,
            [quantityToRemove, character.id, itemName]
          );
          await interaction.reply({ content: `Removed **${quantityToRemove}x ${itemName}** from **${character.name}**'s inventory.`, ephemeral: false });
        }
      } catch (error) {
        console.error('Error removing item:', error);
        await interaction.reply({ content: 'There was an error removing the item. Please try again later.', ephemeral: true });
      }
      break;

    case 'inventory':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to check inventory! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const inventoryRes = await pgClient.query(
          `SELECT item_name, quantity FROM character_inventory WHERE character_id = $1 ORDER BY item_name;`,
          [character.id]
        );

        if (inventoryRes.rows.length === 0) {
          await interaction.reply({ content: `**${character.name}**'s inventory is empty.`, ephemeral: true });
          return;
        }

        const inventoryList = inventoryRes.rows.map(item => `- ${item.item_name} x${item.quantity}`).join('\n');
        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`🎒 ${character.name}'s Inventory`)
          .setDescription(inventoryList)
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error fetching inventory:', error);
        await interaction.reply({ content: 'There was an error fetching your inventory. Please try again later.', ephemeral: true });
      }
      break;

    case 'heal':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to heal! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const amount = interaction.options.getInteger('amount');
        if (amount <= 0) {
          await interaction.reply({ content: 'Healing amount must be a positive number.', ephemeral: true });
          return;
        }

        const { newHealth } = await updateCharacterStats(character.id, amount, 0);
        await interaction.reply({ content: `**${character.name}** healed for **${amount}** health! Current Health: **${newHealth}/${character.health_max}**`, ephemeral: false });
      } catch (error) {
        console.error('Error healing character:', error);
        await interaction.reply({ content: 'There was an error healing your character. Please try again later.', ephemeral: true });
      }
      break;

    case 'recover_sanity':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to recover sanity! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const amount = interaction.options.getInteger('amount');
        if (amount <= 0) {
          await interaction.reply({ content: 'Sanity recovery amount must be a positive number.', ephemeral: true });
          return;
        }

        const { newSanity } = await updateCharacterStats(character.id, 0, amount);
        let replyMessage = `**${character.name}** recovered **${amount}** sanity! Current Sanity: **${newSanity}/${character.sanity_max}**`;

        if (character.sanity_increase_desc) {
          replyMessage += `\n*${character.sanity_increase_desc}*`;
        }

        await interaction.reply({ content: replyMessage, ephemeral: false });
      } catch (error) {
        console.error('Error recovering sanity:', error);
        await interaction.reply({ content: 'There was an error recovering your sanity. Please try again later.', ephemeral: true });
      }
      break;

    case 'set_sanity_desc':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to set sanity descriptions for! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const type = interaction.options.getString('type');
        const description = interaction.options.getString('description');

        let queryField;
        if (type === 'increase') {
          queryField = 'sanity_increase_desc';
        } else if (type === 'decrease') {
          queryField = 'sanity_decrease_desc';
        } else {
          await interaction.reply({ content: 'Invalid type. Please choose "increase" or "decrease".', ephemeral: true });
          return;
        }

        await pgClient.query(
          `UPDATE characters SET ${queryField} = $1 WHERE id = $2;`,
          [description, character.id]
        );

        await interaction.reply({ content: `Sanity ${type} description for **${character.name}** set to: "${description}"`, ephemeral: false });
      } catch (error) {
        console.error('Error setting sanity description:', error);
        await interaction.reply({ content: 'There was an error setting the sanity description. Please try again later.', ephemeral: true });
      }
      break;

    case 'level_up':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to level up! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const levelsToAdd = interaction.options.getInteger('levels');
        if (levelsToAdd <= 0) {
          await interaction.reply({ content: 'Number of levels must be a positive number.', ephemeral: true });
          return;
        }

        const newLevel = character.level + levelsToAdd;
        // Example: Increase max health and sanity on level up
        const newMaxHealth = character.health_max + (levelsToAdd * 10);
        const newMaxSanity = character.sanity_max + (levelsToAdd * 5);

        await pgClient.query(
          `UPDATE characters SET level = $1, health_max = $2, sanity_max = $3 WHERE id = $4;`,
          [newLevel, newMaxHealth, newMaxSanity, character.id]
        );

        // Also heal to new max health/sanity on level up
        await updateCharacterStats(character.id, newMaxHealth, newMaxSanity);

        await interaction.reply({ content: `**${character.name}** leveled up to **Level ${newLevel}**! Max Health: ${newMaxHealth}, Max Sanity: ${newMaxSanity}`, ephemeral: false });
      } catch (error) {
        console.error('Error leveling up character:', error);
        await interaction.reply({ content: 'There was an error leveling up your character. Please try again later.', ephemeral: true });
      }
      break;

    case 'give_cxp':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to give CXP to! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const amount = interaction.options.getInteger('amount');
        if (amount <= 0) {
          await interaction.reply({ content: 'CXP amount must be a positive number.', ephemeral: true });
          return;
        }

        const newCxp = character.cxp + amount;
        await pgClient.query(
          `UPDATE characters SET cxp = $1 WHERE id = $2;`,
          [newCxp, character.id]
        );

        await interaction.reply({ content: `**${character.name}** gained **${amount} CXP**! Total CXP: **${newCxp}**`, ephemeral: false });
      } catch (error) {
        console.error('Error giving CXP:', error);
        await interaction.reply({ content: 'There was an error giving CXP. Please try again later.', ephemeral: true });
      }
      break;

    case 'set_attack_chain_max':
      try {
        const character = await getCharacter(userId);
        if (!character) {
          await interaction.reply({ content: 'You need a character to set attack chain max for! Use `/createcharacter` to make one.', ephemeral: true });
          return;
        }

        const maxChain = interaction.options.getInteger('max_chain');
        if (maxChain <= 0) {
          await interaction.reply({ content: 'Max attack chain must be a positive number.', ephemeral: true });
          return;
        }

        await pgClient.query(
          `UPDATE characters SET attack_chain_max = $1 WHERE id = $2;`,
          [maxChain, character.id]
        );

        await interaction.reply({ content: `**${character.name}**'s maximum attack chain set to **${maxChain}**!`, ephemeral: false });
      } catch (error) {
        console.error('Error setting attack chain max:', error);
        await interaction.reply({ content: 'There was an error setting the attack chain max. Please try again later.', ephemeral: true });
      }
      break;

    default:
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      break;
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
