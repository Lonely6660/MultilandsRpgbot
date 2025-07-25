require('dotenv').config();

// --- START DEBUGGING LINES (KEEP THESE FOR NOW) ---
console.log('--- Environment Variables Check ---');
console.log('process.env.NEON_POSTGRES_URI:', process.env.NEON_POSTGRES_URI ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.CLIENT_ID:', process.env.CLIENT_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.TEST_GUILD_ID:', process.env.TEST_GUILD_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('---------------------------------');
// --- END DEBUGGING LINES ---

const { Client, EmbedBuilder, REST, Routes, SlashCommandBuilder, GatewayIntentBits } = require('discord.js');
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
        sanity_current INTEGER DEFAULT 100,
        sanity_max INTEGER DEFAULT 100,
        level INTEGER DEFAULT 1,
        cxp INTEGER DEFAULT 0,
        attack_chain_max INTEGER DEFAULT 1,
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
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_current INTEGER DEFAULT 100;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS sanity_max INTEGER DEFAULT 100;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS cxp INTEGER DEFAULT 0;
        ALTER TABLE characters ADD COLUMN IF NOT EXISTS attack_chain_max INTEGER DEFAULT 1;
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
  
  new SlashCommandBuilder() // New /roll command
    .setName('roll')
    .setDescription('Rolls dice with a specified notation (e.g., 1d4, 2d6+3).')
    .addStringOption(option =>
      option.setName('dice')
        .setDescription('The dice notation (e.g., 1d4, 2d6+3).')
        .setRequired(true)),

].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`🚀 ${client.user.tag} is online!`);

  try {
    console.log('⌛ Registering slash commands...');
    // Register commands globally if TEST_GUILD_ID is not set, otherwise only in test guild
    if (process.env.TEST_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.TEST_GUILD_ID),
        { body: commands },
      );
      console.log('⚡ Commands registered in test server');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
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
// --- END GLOBAL ERROR HANDLERS ---


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

        // Basic URL validation for avatar_url
        try {
            new URL(avatarURL);
        } catch (e) {
            return interaction.reply({ content: '❌ Invalid URL for avatar. Please provide a valid image URL.', ephemeral: true });
        }
        // Basic URL validation for appearance_url if provided
        if (appearanceURL) {
            try {
                new URL(appearanceURL);
            } catch (e) {
                return interaction.reply({ content: '❌ Invalid URL for appearance. Please provide a valid image URL.', ephemeral: true });
            }
        }


        try {
            // Check if character already exists for this user
            const checkQuery = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
            const checkResult = await pgClient.query(checkQuery, [userId, name]);

            if (checkResult.rows.length > 0) {
              return interaction.reply({ content: `❌ You already have a character named "${name}".`, ephemeral: true });
            }

            // Insert new character with all new fields
            const insertQuery = `
              INSERT INTO characters (user_id, name, avatar_url, gender, age, species, occupation, appearance_url)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id; -- Return the character ID
            `;
            const insertResult = await pgClient.query(insertQuery, [userId, name, avatarURL, gender, age, species, occupation, appearanceURL]);
            const newCharacterId = insertResult.rows[0].id;

            // Assign initial attacks to the new character
            const initialAttackName = 'Night Weaver\'s Grasp'; // Your starting attack
            const getInitialAttackIdQuery = 'SELECT id FROM attacks WHERE name = $1;';
            const initialAttackResult = await pgClient.query(getInitialAttackIdQuery, [initialAttackName]);

            if (initialAttackResult.rows.length > 0) {
                const initialAttackId = initialAttackResult.rows[0].id;
                const assignAttackQuery = `
                    INSERT INTO character_attacks (character_id, attack_id, is_unlocked, level, perfect_hits)
                    VALUES ($1, $2, TRUE, 0, 0); -- Start unlocked, level 0, 0 perfect hits
                `;
                await pgClient.query(assignAttackQuery, [newCharacterId, initialAttackId]);
                console.log(`Assigned ${initialAttackName} to new character ${name}.`);
            } else {
                console.error(`Initial attack "${initialAttackName}" not found in 'attacks' table.`);
            }


            await interaction.reply({ content: `✅ Character "${name}" created successfully!`, ephemeral: true });

        } catch (dbError) {
            console.error('Error creating character in DB:', dbError);
            return interaction.reply({ content: '❌ An error occurred while saving your character.', ephemeral: true });
        }


      } else if (subcommand === 'sheet') { // New 'sheet' subcommand handler
        const characterName = options.getString('name');
        let character;

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
            return interaction.reply({ content: `❌ Character "${characterName || 'latest'}" not found. Create one with \`/character create\`.`, ephemeral: true });
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
              { name: 'Sanity', value: `${character.sanity_current}/${character.sanity_max}`, inline: true },
              { name: 'Attack Chain Max', value: character.attack_chain_max.toString(), inline: true },
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

          characterEmbed.setImage(character.appearance_url || null) // Use full appearance image if available
            .setFooter({ text: `Character ID: ${character.id} | User ID: ${character.user_id}` })
            .setTimestamp();

          await interaction.reply({ embeds: [characterEmbed], ephemeral: false }); // ephemeral: false to show to everyone

        } catch (dbError) {
          console.error('Error fetching character sheet from DB:', dbError);
          return interaction.reply({ content: '❌ An error occurred while fetching your character sheet.', ephemeral: true });
        }

      } else if (subcommand === 'list') {
        try {
            const query = 'SELECT name, avatar_url, level, cxp FROM characters WHERE user_id = $1;';
            const result = await pgClient.query(query, [userId]);
            const characters = result.rows;

            if (characters.length === 0) {
              return interaction.reply({ content: 'You have no characters yet. Create one with `/character create`.', ephemeral: true });
            }

            const characterList = characters.map(char => `- ${char.name} (Lvl ${char.level}, CXP ${char.cxp})`).join('\n');
            await interaction.reply({ content: `Your characters:\n${characterList}`, ephemeral: true });

        } catch (dbError) {
            console.error('Error listing characters from DB:', dbError);
            return interaction.reply({ content: '❌ An error occurred while fetching your characters.', ephemeral: true });
        }

      } else if (subcommand === 'set_default') {
        // Implement default character logic here if needed,
        // e.g., by adding a 'isDefault' field to schema or a separate UserPreferences model.
        await interaction.reply({ content: 'Default character setting is not yet implemented.', ephemeral: true });

      } else if (subcommand === 'delete') {
        const name = options.getString('name');
        try {
            const query = 'DELETE FROM characters WHERE user_id = $1 AND name = $2;';
            const result = await pgClient.query(query, [userId, name]);

            if (result.rowCount === 0) {
              return interaction.reply({ content: `❌ Character "${name}" not found.`, ephemeral: true });
            }

            await interaction.reply({ content: `✅ Character "${name}" deleted successfully!`, ephemeral: true });
        } catch (dbError) {
            console.error('Error deleting character from DB:', dbError);
            return interaction.reply({ content: '❌ An error occurred while deleting your character.', ephemeral: true });
        }
      }

    } else if (commandName === 'rp') {
      const userId = interaction.user.id;
      // For now, assume a default character if no 'set_default' implemented,
      // or prompt user to create/select one.
      try {
        const query = 'SELECT name, avatar_url FROM characters WHERE user_id = $1 LIMIT 1;'; // Just pick one for now
        const result = await pgClient.query(query, [userId]);
        const character = result.rows[0];

        if (!character) {
          return interaction.reply({ content: 'You need to create a character first with `/character create`.', ephemeral: true });
        }

        const channel = options.getChannel('channel') || interaction.channel;

        // Ensure the bot has permissions to create webhooks and send messages in the target channel
        if (!channel.permissionsFor(client.user).has(['ManageWebhooks', 'SendMessages'])) {
          return interaction.reply({
              content: `❌ I don't have permission to create webhooks or send messages in ${channel.name}.`,
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
          avatarURL: character.avatar_url // Use avatar_url from DB query
        });

        // Confirm to the user that the message was sent.
        await interaction.editReply({ content: 'Your in-character message has been sent!' });

      } catch (dbError) {
        console.error('Error during RP command DB lookup or webhook:', dbError);
        return interaction.reply({ content: '❌ An error occurred during RP command.', ephemeral: true });
      }
    } else if (commandName === 'roll') { // New /roll command handler
      const diceNotation = options.getString('dice');
      try {
        const rollResult = rollDice(diceNotation);
        await interaction.reply({
          content: `🎲 Rolled ${diceNotation}: [${rollResult.rolls.join(', ')}] Total: **${rollResult.total}**` +
                   (rollResult.maxRoll ? ' (Perfect Roll!)' : ''),
          ephemeral: false // Make roll visible to everyone
        });
      } catch (error) {
        console.error('Error handling /roll command:', error);
        await interaction.reply({ content: `❌ Error rolling dice: ${error.message}`, ephemeral: true });
      }
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
