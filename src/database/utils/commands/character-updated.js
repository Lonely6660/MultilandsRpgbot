const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { calculateDamageDice } = require('../utils/dice');

const characterCommand = new SlashCommandBuilder()
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
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('sheet')
      .setDescription('Display your character\'s full sheet.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the character to display (defaults to your latest).')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit your character\'s sheet.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the character to edit (required).')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('avatar_url')
          .setDescription('The URL for your character\'s avatar image.')
          .setRequired(false))
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
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List your created characters.'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('select')
      .setDescription('Select a character for use in commands')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the character to select')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete a character.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of the character to delete.')
          .setRequired(true)));

class CharacterHandler {
  constructor(pgClient) {
    this.pgClient = pgClient;
  }

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
      case 'create':
        return this.handleCreate(interaction);
      case 'sheet':
        return this.handleSheet(interaction);
      case 'edit':
        return this.handleEdit(interaction);
      case 'list':
        return this.handleList(interaction);
      case 'select':
        return this.handleSelect(interaction);
      case 'delete':
        return this.handleDelete(interaction);
      default:
        return interaction.reply({ content: '❌ Invalid subcommand.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleCreate(interaction) {
    const name = interaction.options.getString('name');
    const avatarURL = interaction.options.getString('avatar_url');
    const gender = interaction.options.getString('gender');
    const age = interaction.options.getInteger('age');
    const species = interaction.options.getString('species');
    const occupation = interaction.options.getString('occupation');
    const appearanceURL = interaction.options.getString('appearance_url');
    const sanityIncrease = interaction.options.getString('sanity_increase');
    const sanityDecrease = interaction.options.getString('sanity_decrease');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const checkQuery = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
      const checkResult = await this.pgClient.query(checkQuery, [interaction.user.id, name]);

      if (checkResult.rows.length > 0) {
        return interaction.editReply({ content: `❌ You already have a character named "${name}".` });
      }

      const insertQuery = `
        INSERT INTO characters (user_id, name, avatar_url, gender, age, species, occupation, appearance_url, sanity_increase_desc, sanity_decrease_desc)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;
      `;
      await this.pgClient.query(insertQuery, [
        interaction.user.id, name, avatarURL, gender, age, species, occupation, appearanceURL, sanityIncrease, sanityDecrease
      ]);

      await interaction.editReply({ content: `✅ Character "${name}" created successfully!` });
    } catch (error) {
      console.error('Error creating character:', error);
      await interaction.editReply({ content: '❌ An error occurred while creating your character.' });
    }
  }

  async handleSheet(interaction) {
    const characterName = interaction.options.getString('name');
    const userId = interaction.user.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let character;
      if (characterName) {
        const query = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
        const result = await this.pgClient.query(query, [userId, characterName]);
        character = result.rows[0];
      } else {
        const query = 'SELECT * FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
        const result = await this.pgClient.query(query, [userId]);
        character = result.rows[0];
      }

      if (!character) {
        return interaction.editReply({ content: `❌ Character "${characterName || 'latest'}" not found. Create one with \`/character create\`.` });
      }

      const attacksQuery = `
        SELECT a.name, ca.level, ca.perfect_hits, at.name AS type_name, af.name AS affinity_name, a.base_damage_dice
        FROM character_attacks ca
        JOIN attacks a ON ca.attack_id = a.id
        JOIN attack_types at ON a.type_id = at.id
        JOIN affinities af ON a.affinity_id = af.id
        WHERE ca.character_id = $1 AND ca.is_unlocked = TRUE;
      `;
      const attacksResult = await this.pgClient.query(attacksQuery, [character.id]);
      const unlockedAttacks = attacksResult.rows;

      let attacksField = 'None yet.';
      if (unlockedAttacks.length > 0) {
        attacksField = unlockedAttacks.map(att => {
          const currentDamageDice = calculateDamageDice(att.base_damage_dice, att.level);
          return `**${att.name}** (Lvl ${att.level}, Hits: ${att.perfect_hits}/5)\n` +
                 `  Type: ${att.type_name}, Affinity: ${att.affinity_name}, Damage: ${currentDamageDice}`;
        }).join('\n');
      }

      let appearanceDisplay = '';
      if (character.appearance_url) {
        appearanceDisplay = `[Image](${character.appearance_url})`;
      } else {
        appearanceDisplay = 'N/A';
      }

      const tokenDescription = `
--Character Token--

**Name:** ${character.name}
**Gender:** ${character.gender || 'N/A'}
**Age:** ${character.age || 'N/A'}
**Species:** ${character.species || 'N/A'}
**Occupation:** ${character.occupation || 'N/A'}
**What increases your sanity:** ${character.sanity_increase_desc || 'N/A'}
**What decreases your sanity:** ${character.sanity_decrease_desc || 'N/A'}
**Attacks:** 
${attacksField}
**Appearance:** ${appearanceDisplay}
      `.trim();

      const characterEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`${character.name}'s Character Token`)
        .setDescription(tokenDescription)
        .setThumbnail(character.avatar_url)
        .setFooter({ text: `Character ID: ${character.id} | User ID: ${character.user_id}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [characterEmbed] });
    } catch (error) {
      console.error('Error fetching character sheet:', error);
      await interaction.editReply({ content: '❌ An error occurred while fetching your character sheet.' });
    }
  }

  async handleList(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const query = 'SELECT name, avatar_url, level, cxp FROM characters WHERE user_id = $1;';
      const result = await this.pgClient.query(query, [interaction.user.id]);
      const characters = result.rows;

      if (characters.length === 0) {
        return interaction.editReply({ content: 'You have no characters yet. Create one with `/character create`.' });
      }

      const characterList = characters.map(char => `- ${char.name} (Lvl ${char.level}, CXP ${char.cxp})`).join('\n');
      await interaction.editReply({ content: `Your characters:\n${characterList}` });
    } catch (error) {
      console.error('Error listing characters:', error);
      await interaction.editReply({ content: '❌ An error occurred while fetching your characters.' });
    }
  }

  async handleSelect(interaction) {
    const characterName = interaction.options.getString('name');
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const query = 'SELECT id, name FROM characters WHERE user_id = $1 AND name = $2;';
      const result = await this.pgClient.query(query, [interaction.user.id, characterName]);
      
      if (result.rows.length === 0) {
        return interaction.editReply({ content: `❌ Character "${characterName}" not found or doesn't belong to you.` });
      }

      const character = result.rows[0];

      // Update selected character
      const updateQuery = `
        INSERT INTO user_settings (user_id, selected_character_id, selected_character_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          selected_character_id = $2,
          selected_character_name = $3;
      `;
      
      await this.pgClient.query(updateQuery, [interaction.user.id, character.id, character.name]);
      
      await interaction.editReply({ content: `✅ Character "${character.name}" selected as your active character.` });
    } catch (error) {
      console.error('Error selecting character:', error);
      await interaction.editReply({ content: '❌ An error occurred while selecting your character.' });
    }
  }

  async handleDelete(interaction) {
    const name = interaction.options.getString('name');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const query = 'DELETE FROM characters WHERE user_id = $1 AND name = $2;';
      const result = await this.pgClient.query(query, [interaction.user.id, name]);

      if (result.rowCount === 0) {
        return interaction.editReply({ content: `❌ Character "${name}" not found.` });
      }

      await interaction.editReply({ content: `✅ Character "${name}" deleted successfully!` });
    } catch (error) {
      console.error('Error deleting character:', error);
      await interaction.editReply({ content: '❌ An error occurred while deleting your character.' });
    }
  }
}

module.exports = { characterCommand, CharacterHandler };
