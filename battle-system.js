// New Battle System Implementation
// This replaces the old /battle, /attack, and /roll commands with a unified options-based system

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// New unified battle command
const battleCommand = new SlashCommandBuilder()
  .setName('battle')
  .setDescription('Manage combat encounters with options-based interface')
  .addStringOption(option =>
    option.setName('action')
      .setDescription('Choose your battle action')
      .setRequired(true)
      .addChoices(
        { name: 'Start Battle', value: 'start' },
        { name: 'Show Status', value: 'status' },
        { name: 'End Battle', value: 'end' },
        { name: 'Attack', value: 'attack' },
        { name: 'Battle Action', value: 'battle_action' }
      ))
  .addStringOption(option =>
    option.setName('opponent')
      .setDescription('NPC opponent name (for start action)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('attack_name')
      .setDescription('Specific attack to use (for attack action)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('battle_option')
      .setDescription('Choose battle action (for battle_action)')
      .setRequired(false)
      .addChoices(
        { name: 'Runaway', value: 'runaway' },
        { name: 'Defend', value: 'defend' },
        { name: 'Focus', value: 'focus' },
        { name: 'Item', value: 'item' },
        { name: 'Special Action', value: 'special' }
      ))
  .addStringOption(option =>
    option.setName('custom_action')
      .setDescription('Custom action description (for special action)')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('dice')
      .setDescription('Dice notation for actions requiring rolls (e.g., 1d4, 2d6+3)')
      .setRequired(false));

// Battle action handlers
class BattleSystem {
  constructor(pgClient) {
    this.pgClient = pgClient;
  }

  async handleBattleStart(interaction, options) {
    const opponentName = options.getString('opponent');
    
    if (!opponentName) {
      return interaction.reply({ content: '❌ Please specify an opponent name.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      // Check for existing battle
      const activeBattleQuery = 'SELECT id FROM battles WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\';';
      const activeBattleResult = await this.pgClient.query(activeBattleQuery, [interaction.guildId, interaction.channelId]);
      
      if (activeBattleResult.rows.length > 0) {
        return interaction.editReply({ content: '❌ A battle is already active in this channel.' });
      }

      // Get player's character
      const charQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id]);
      const playerCharacter = charResult.rows[0];

      if (!playerCharacter) {
        return interaction.editReply({ content: '❌ You need to create a character first with `/character create`.' });
      }

      // Get NPC opponent
      const npcQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM npcs WHERE name = $1;';
      const npcResult = await this.pgClient.query(npcQuery, [opponentName]);
      const npcOpponent = npcResult.rows[0];

      if (!npcOpponent) {
        return interaction.editReply({ content: `❌ NPC "${opponentName}" not found.` });
      }

      // Create battle
      const createBattleQuery = 'INSERT INTO battles (guild_id, channel_id, status) VALUES ($1, $2, \'active\') RETURNING id;';
      const battleResult = await this.pgClient.query(createBattleQuery, [interaction.guildId, interaction.channelId]);
      const newBattleId = battleResult.rows[0].id;

      // Add participants
      const addPlayerParticipantQuery = 'INSERT INTO battle_participants (battle_id, character_id, current_health, current_sanity, is_player) VALUES ($1, $2, $3, $4, TRUE) RETURNING id;';
      const playerParticipantResult = await this.pgClient.query(addPlayerParticipantQuery, [newBattleId, playerCharacter.id, playerCharacter.health_max, playerCharacter.sanity_max]);
      const playerParticipantId = playerParticipantResult.rows[0].id;

      const addNpcParticipantQuery = 'INSERT INTO battle_participants (battle_id, npc_id, current_health, current_sanity, is_player) VALUES ($1, $2, $3, $4, FALSE) RETURNING id;';
      const npcParticipantResult = await this.pgClient.query(addNpcParticipantQuery, [newBattleId, npcOpponent.id, npcOpponent.health_max, npcOpponent.sanity_max]);
      const npcParticipantId = npcParticipantResult.rows[0].id;

      // Set turn order
      const turnOrder = [
        { type: 'character', id: playerParticipantId },
        { type: 'npc', id: npcParticipantId }
      ];
      await this.pgClient.query('UPDATE battles SET turn_order = $1, current_turn_participant_id = $2 WHERE id = $3;', [JSON.stringify(turnOrder), playerParticipantId, newBattleId]);

      const battleEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('⚔️ Battle Started! ⚔️')
        .setDescription(`**${playerCharacter.name}** vs. **${npcOpponent.name}**`)
        .addFields(
          { name: 'Your Character', value: `${playerCharacter.name} (HP: ${playerCharacter.health_max}, SP: ${playerCharacter.sanity_max})`, inline: true },
          { name: 'Opponent', value: `${npcOpponent.name} (HP: ${npcOpponent.health_max}, SP: ${npcOpponent.sanity_max})`, inline: true },
          { name: 'Current Turn', value: playerCharacter.name, inline: false }
        )
        .setThumbnail(playerCharacter.avatar_url || null)
        .setImage(npcOpponent.avatar_url || null)
        .setFooter({ text: `Battle ID: ${newBattleId}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [battleEmbed] });

    } catch (error) {
      console.error('Error starting battle:', error);
      await interaction.editReply({ content: '❌ An error occurred while starting the battle.' });
    }
  }

  async handleBattleAttack(interaction, options) {
    await interaction.deferReply();

    try {
      // Check for active battle
      const battleQuery = 'SELECT id FROM battles WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\';';
      const battleResult = await this.pgClient.query(battleQuery, [interaction.guildId, interaction.channelId]);
      
      if (battleResult.rows.length === 0) {
        return interaction.editReply({ content: '❌ No active battle found. Start one with `/battle action:start`.' });
      }

      const battleId = battleResult.rows[0].id;

      // Get player's character
      const charQuery = 'SELECT id, name, level, cxp FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id]);
      const character = charResult.rows[0];

      if (!character) {
        return interaction.editReply({ content: '❌ You need to create a character first with `/character create`.' });
      }

      // Get unlocked attacks
      const attacksQuery = `
        SELECT a.id, a.name, a.base_damage_dice, ca.level AS attack_level
        FROM character_attacks ca
        JOIN attacks a ON ca.attack_id = a.id
        WHERE ca.character_id = $1 AND ca.is_unlocked = TRUE;
      `;
      const attacksResult = await this.pgClient.query(attacksQuery, [character.id]);
      const attacks = attacksResult.rows;

      if (attacks.length === 0) {
        return interaction.editReply({ content: '❌ Your character has no unlocked attacks to use.' });
      }

      // Determine attack to use
      let attack;
      const attackName = options.getString('attack_name');
      
      if (attackName) {
        attack = attacks.find(a => a.name.toLowerCase() === attackName.toLowerCase());
        if (!attack) {
          return interaction.editReply(`❌ Attack "${attackName}" is not unlocked or does not exist.`);
        }
      } else {
        attack = attacks[0]; // Default to first available
      }

      // Calculate damage dice
      const damageDice = calculateDamageDice(attack.base_damage_dice, character.level);
      const rollResult = rollDice(damageDice);

      // Determine result
      let resultText = '';
      let gifUrl = '';
      
      if (rollResult.total === rollResult.maxPossible) {
        resultText = '# **AMAZING!!!!!** (Perfect hit!)';
        gifUrl = await this.getUserRatingGif(interaction.user.id, 'amazing');
      } else if (rollResult.total >= 3) {
        resultText = '# **GREAT!!!**';
        gifUrl = await this.getUserRatingGif(interaction.user.id, 'great');
      } else if (rollResult.total === 2) {
        resultText = '# **GOOD!!**';
        gifUrl = await this.getUserRatingGif(interaction.user.id, 'good');
      } else {
        resultText = 'bleh... (Attack deflected)';
        gifUrl = await this.getUserRatingGif(interaction.user.id, 'deflected');
      }

      const attackEmbed = new EmbedBuilder()
        .setTitle(`${character.name} uses ${attack.name}!`)
        .setDescription(`${resultText}\nRolled: [${rollResult.rolls.join(', ')}] Total: **${rollResult.total}**`)
        .setImage(gifUrl)
        .setTimestamp();

      await interaction.editReply({ embeds: [attackEmbed] });

    } catch (error) {
      console.error('Error handling battle attack:', error);
      await interaction.editReply({ content: '❌ An error occurred while executing the attack.' });
    }
  }

  async handleBattleAction(interaction, options) {
    await interaction.deferReply();

    try {
      const battleOption = options.getString('battle_option');
      const customAction = options.getString('custom_action');
      const dice = options.getString('dice');

      if (!battleOption) {
        return interaction.editReply({ content: '❌ Please specify a battle option.' });
      }

      let resultText = '';
      let rollResult = null;

      switch (battleOption) {
        case 'runaway':
          if (dice) {
            rollResult = rollDice(dice);
            const successThreshold = Math.floor(rollResult.maxPossible / 2);
            if (rollResult.total > successThreshold) {
              resultText = `✅ Successfully ran away! Rolled ${rollResult.total} (needed > ${successThreshold})`;
            } else {
              resultText = `❌ Failed to run away! Rolled ${rollResult.total} (needed > ${successThreshold})`;
            }
          } else {
            resultText = '❌ Please provide dice notation for runaway attempt (e.g., 1d4)';
          }
          break;

        case 'defend':
          resultText = '🛡️ Defending! Taking 20% reduced damage from next attack.';
          break;

        case 'focus':
          if (dice) {
            rollResult = rollDice(dice);
            if (rollResult.maxRoll) {
              resultText = '✨ Perfect Focus! +2 to all stats for next attack, but cannot act next turn.';
            } else {
              resultText = `Focused! Rolled ${rollResult.total}`;
            }
          } else {
            resultText = '❌ Please provide dice notation for focus attempt (e.g., 1d4)';
          }
          break;

        case 'item':
          resultText = '🎒 Using item from inventory...';
          break;

        case 'special':
          if (customAction) {
            if (dice) {
              rollResult = rollDice(dice);
              resultText = `🎯 Special Action: ${customAction}\nRolled: ${rollResult.total}`;
            } else {
              resultText = `🎯 Special Action: ${customAction}`;
            }
          } else {
            resultText = '❌ Please provide a description for your special action.';
          }
          break;
      }

      const actionEmbed = new EmbedBuilder()
        .setTitle('Battle Action')
        .setDescription(resultText)
        .setTimestamp();

      await interaction.editReply({ embeds: [actionEmbed] });

    } catch (error) {
      console.error('Error handling battle action:', error);
      await interaction.editReply({ content: '❌ An error occurred while executing the battle action.' });
    }
  }

  async getUserRatingGif(userId, rating) {
    try {
      const query = 'SELECT gif_url FROM user_rating_gifs WHERE user_id = $1 AND rating = $2;';
      const result = await this.pgClient.query(query, [userId, rating]);
      
      if (result.rows.length > 0) {
        return result.rows[0].gif_url;
      }
      
      // Return default gifs if no custom ones found
      const defaultGifs = {
        'amazing': 'https://example.com/amazing.gif',
        'great': 'https://example.com/great.gif',
        'good': 'https://example.com/good.gif',
        'deflected': 'https://example.com/deflected.gif'
      };
      
      return defaultGifs[rating] || 'https://example.com/default.gif';
    } catch (error) {
      console.error('Error getting user rating gif:', error);
      return 'https://example.com/default.gif';
    }
  }
}

// Export the battle system
module.exports = BattleSystem;
