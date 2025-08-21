const { SlashCommandBuilder } = require('discord.js');
const { rollDice, calculateDamageDice } = require('../utils/dice');
const { getUserRatingGif } = require('../utils/gifs');

const attackCommand = new SlashCommandBuilder()
  .setName('attack')
  .setDescription('Manage and perform attacks.')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new attack.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('The name of your attack.')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('type')
          .setDescription('The type of your attack (Slash, Pierce, Blunt, Magic).')
          .setRequired(true)
          .addChoices(
            { name: 'Slash', value: 'Slash' },
            { name: 'Pierce', value: 'Pierce' },
            { name: 'Blunt', value: 'Blunt' },
            { name: 'Magic', value: 'Magic' }
          ))
      .addStringOption(option =>
        option.setName('affinity')
          .setDescription('The affinity of your attack (Wrath, Lust, Sloth, Gluttony, Greed, Pride, Envy).')
          .setRequired(true)
          .addChoices(
            { name: 'Wrath', value: 'Wrath' },
            { name: 'Lust', value: 'Lust' },
            { name: 'Sloth', value: 'Sloth' },
            { name: 'Gluttony', value: 'Gluttony' },
            { name: 'Greed', value: 'Greed' },
            { name: 'Pride', value: 'Pride' },
            { name: 'Envy', value: 'Envy' }
          ))
      .addStringOption(option =>
        option.setName('base_damage_dice')
          .setDescription('The base damage dice for your attack (e.g., 1d4, 1d6).')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('description')
          .setDescription('A description of your attack.')
          .setRequired(false))
      .addStringOption(option =>
        option.setName('effect_description')
          .setDescription('A description of your attack\'s effect.')
          .setRequired(false)));

class AttackHandler {
  constructor(pgClient) {
    this.pgClient = pgClient;
  }

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'create') {
      return this.handleCreate(interaction);
    }
  }

  async handleCreate(interaction) {
    const attackName = interaction.options.getString('name');
    const attackType = interaction.options.getString('type');
    const attackAffinity = interaction.options.getString('affinity');
    const baseDamageDice = interaction.options.getString('base_damage_dice');
    const attackDescription = interaction.options.getString('description') || '';
    const effectDescription = interaction.options.getString('effect_description') || '';

    try {
      rollDice(baseDamageDice);
    } catch (e) {
      return interaction.reply({ content: '❌ Invalid dice notation. Use format like "1d4" or "2d6+3".', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const charQuery = 'SELECT id FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id]);
      const character = charResult.rows[0];
      
      if (!character) {
        return interaction.editReply({ content: '❌ You need to create a character first with `/character create` to create attacks.' });
      }

      const checkQuery = 'SELECT id FROM attacks WHERE name = $1;';
      const checkResult = await this.pgClient.query(checkQuery, [attackName]);
      
      if (checkResult.rows.length > 0) {
        return interaction.editReply({ content: `❌ An attack named "${attackName}" already exists.` });
      }

      const typeQuery = 'SELECT id FROM attack_types WHERE name = $1;';
      const typeResult = await this.pgClient.query(typeQuery, [attackType]);
      if (typeResult.rows.length === 0) {
        return interaction.editReply({ content: `❌ Attack type "${attackType}" not found.` });
      }
      const typeId = typeResult.rows[0].id;

      const affinityQuery = 'SELECT id FROM affinities WHERE name = $1;';
      const affinityResult = await this.pgClient.query(affinityQuery, [attackAffinity]);
      if (affinityResult.rows.length === 0) {
        return interaction.editReply({ content: `❌ Affinity "${attackAffinity}" not found.` });
      }
      const affinityId = affinityResult.rows[0].id;

      const insertAttackQuery = `
        INSERT INTO attacks (name, type_id, affinity_id, description, base_damage_dice, effect_description)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;
      `;
      const insertResult = await this.pgClient.query(insertAttackQuery, [
        attackName, typeId, affinityId, attackDescription, baseDamageDice, effectDescription
      ]);
      const attackId = insertResult.rows[0].id;

      const linkAttackQuery = `
        INSERT INTO character_attacks (character_id, attack_id, is_unlocked, level, perfect_hits)
        VALUES ($1, $2, TRUE, 0, 0);
      `;
      await this.pgClient.query(linkAttackQuery, [character.id, attackId]);

      await interaction.editReply({ content: `✅ Attack "${attackName}" created successfully!` });
    } catch (error) {
      console.error('Error creating attack:', error);
      await interaction.editReply({ content: '❌ An error occurred while creating your attack.' });
    }
  }
}

module.exports = { attackCommand, AttackHandler };
