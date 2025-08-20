const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const autorpCommand = new SlashCommandBuilder()
  .setName('autorp')
  .setDescription('Toggle automatic roleplay mode for your character')
  .addSubcommand(subcommand =>
    subcommand
      .setName('on')
      .setDescription('Enable automatic roleplay mode for a character')
      .addStringOption(option =>
        option.setName('character')
          .setDescription('The character name to use for auto RP')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('off')
      .setDescription('Disable automatic roleplay mode'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Check your current auto RP status'));

class AutoRPHandler {
  constructor(pgClient) {
    this.pgClient = pgClient;
  }

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
      case 'on':
        return this.handleOn(interaction);
      case 'off':
        return this.handleOff(interaction);
      case 'status':
        return this.handleStatus(interaction);
      default:
        return interaction.reply({ content: '❌ Invalid subcommand.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleOn(interaction) {
    const characterName = interaction.options.getString('character');
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Verify character exists and belongs to user
      const charQuery = 'SELECT id, name, avatar_url FROM characters WHERE user_id = $1 AND name = $2;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id, characterName]);
      
      if (charResult.rows.length === 0) {
        return interaction.editReply({ content: `❌ Character "${characterName}" not found or doesn't belong to you.` });
      }

      const character = charResult.rows[0];

      // Enable auto RP for this character
      const updateQuery = `
        INSERT INTO user_settings (user_id, auto_rp_enabled, auto_rp_character_id, auto_rp_character_name, auto_rp_character_avatar)
        VALUES ($1, TRUE, $2, $3, $4)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          auto_rp_enabled = TRUE,
          auto_rp_character_id = $2,
          auto_rp_character_name = $3,
          auto_rp_character_avatar = $4;
      `;
      
      await this.pgClient.query(updateQuery, [
        interaction.user.id,
        character.id,
        character.name,
        character.avatar_url
      ]);

      await interaction.editReply({ content: `✅ Auto RP enabled for character "${character.name}". Your messages will now automatically appear as this character.` });
    } catch (error) {
      console.error('Error enabling auto RP:', error);
      await interaction.editReply({ content: '❌ An error occurred while enabling auto RP.' });
    }
  }

  async handleOff(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const updateQuery = `
        INSERT INTO user_settings (user_id, auto_rp_enabled)
        VALUES ($1, FALSE)
        ON CONFLICT (user_id) 
        DO UPDATE SET auto_rp_enabled = FALSE;
      `;
      
      await this.pgClient.query(updateQuery, [interaction.user.id]);
      
      await interaction.editReply({ content: '✅ Auto RP disabled. Your messages will now appear as yourself.' });
    } catch (error) {
      console.error('Error disabling auto RP:', error);
      await interaction.editReply({ content: '❌ An error occurred while disabling auto RP.' });
    }
  }

  async handleStatus(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const query = 'SELECT auto_rp_enabled, auto_rp_character_name FROM user_settings WHERE user_id = $1;';
      const result = await this.pgClient.query(query, [interaction.user.id]);
      
      if (result.rows.length === 0 || !result.rows[0].auto_rp_enabled) {
        return interaction.editReply({ content: 'Auto RP is currently **disabled**.' });
      }

      const settings = result.rows[0];
      
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Auto RP Status')
        .setDescription(`Auto RP is **enabled** for character: **${settings.auto_rp_character_name}**`);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error checking auto RP status:', error);
      await interaction.editReply({ content: '❌ An error occurred while checking auto RP status.' });
    }
  }
}

module.exports = { autorpCommand, AutoRPHandler };
