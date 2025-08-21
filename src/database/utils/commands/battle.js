const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { rollDice, calculateDamageDice } = require('../utils/dice');
const { getUserRatingGif } = require('../utils/gifs');

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

class BattleHandler {
  constructor(pgClient) {
    this.pgClient = pgClient;
  }

  async execute(interaction) {
    const action = interaction.options.getString('action');
    
    switch (action) {
      case 'start':
        return this.handleStart(interaction);
      case 'status':
        return this.handleStatus(interaction);
      case 'end':
        return this.handleEnd(interaction);
      case 'attack':
        return this.handleAttack(interaction);
      case 'battle_action':
        return this.handleBattleAction(interaction);
      default:
        return interaction.reply({ content: '❌ Invalid action.', flags: MessageFlags.Ephemeral });
    }
  }

  async handleStart(interaction) {
    const opponentName = interaction.options.getString('opponent');
    
    if (!opponentName) {
      return interaction.reply({ content: '❌ Please specify an opponent name.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const activeBattleQuery = 'SELECT id FROM battles WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\';';
      const activeBattleResult = await this.pgClient.query(activeBattleQuery, [interaction.guildId, interaction.channelId]);
      
      if (activeBattleResult.rows.length > 0) {
        return interaction.editReply({ content: '❌ A battle is already active in this channel.' });
      }

      const charQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id]);
      const playerCharacter = charResult.rows[0];

      if (!playerCharacter) {
        return interaction.editReply({ content: '❌ You need to create a character first with `/character create`.' });
      }

      const npcQuery = 'SELECT id, name, health_max, sanity_max, avatar_url FROM npcs WHERE name = $1;';
      const npcResult = await this.pgClient.query(npcQuery, [opponentName]);
      const npcOpponent = npcResult.rows[0];

      if (!npcOpponent) {
        return interaction.editReply({ content: `❌ NPC "${opponentName}" not found.` });
      }

      const createBattleQuery = 'INSERT INTO battles (guild_id, channel_id, status) VALUES ($1, $2, \'active\') RETURNING id;';
      const battleResult = await this.pgClient.query(createBattleQuery, [interaction.guildId, interaction.channelId]);
      const newBattleId = battleResult.rows[0].id;

      const addPlayerParticipantQuery = 'INSERT INTO battle_participants (battle_id, character_id, current_health, current_sanity, is_player) VALUES ($1, $2, $3, $4, TRUE) RETURNING id;';
      const playerParticipantResult = await this.pgClient.query(addPlayerParticipantQuery, [newBattleId, playerCharacter.id, playerCharacter.health_max, playerCharacter.sanity_max]);
      const playerParticipantId = playerParticipantResult.rows[0].id;

      const addNpcParticipantQuery = 'INSERT INTO battle_participants (battle_id, npc_id, current_health, current_sanity, is_player) VALUES ($1, $2, $3, $4, FALSE) RETURNING id;';
      const npcParticipantResult = await this.pgClient.query(addNpcParticipantQuery, [newBattleId, npcOpponent.id, npcOpponent.health_max, npcOpponent.sanity_max]);
      const npcParticipantId = npcParticipantResult.rows[0].id;

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

  async handleStatus(interaction) {
    await interaction.deferReply();

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
        ORDER BY bp.is_player DESC, participant_name;
      `;
      const battleResult = await this.pgClient.query(battleQuery, [interaction.guildId, interaction.channelId]);

      if (battleResult.rows.length === 0) {
        return interaction.editReply({ content: 'No active battle found in this channel. Use `/battle start` to begin one!' });
      }

      const battle = battleResult.rows[0];
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

    } catch (error) {
      console.error('Error fetching battle status:', error);
      await interaction.editReply({ content: '❌ An error occurred while fetching battle status.' });
    }
  }

  async handleEnd(interaction) {
    await interaction.deferReply();

    try {
      const query = 'UPDATE battles SET status = \'ended\' WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\' RETURNING id;';
      const result = await this.pgClient.query(query, [interaction.guildId, interaction.channelId]);

      if (result.rowCount === 0) {
        return interaction.editReply({ content: '❌ No active battle found in this channel to end.' });
      }

      await interaction.editReply({ content: '✅ Battle successfully ended!' });
    } catch (error) {
      console.error('Error ending battle:', error);
      await interaction.editReply({ content: '❌ An error occurred while trying to end the battle.' });
    }
  }

  async handleAttack(interaction) {
    await interaction.deferReply();

    try {
      const battleQuery = 'SELECT id FROM battles WHERE guild_id = $1 AND channel_id = $2 AND status = \'active\';';
      const battleResult = await this.pgClient.query(battleQuery, [interaction.guildId, interaction.channelId]);
      
      if (battleResult.rows.length === 0) {
        return interaction.editReply({ content: '❌ No active battle found. Start one with `/battle start`.' });
      }

      const charQuery = 'SELECT id, name, level, cxp FROM characters WHERE user_id = $1 ORDER BY id DESC LIMIT 1;';
      const charResult = await this.pgClient.query(charQuery, [interaction.user.id]);
      const character = charResult.rows[0];

      if (!character) {
        return interaction.editReply({ content: '❌ You need to create a character first with `/character create`.' });
      }

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

      let attack;
      const attackName = interaction.options.getString('attack_name');
      
      if (attackName) {
        attack = attacks.find(a => a.name.toLowerCase() === attackName.toLowerCase());
        if (!attack) {
          return interaction.editReply(`❌ Attack "${attackName}" is not unlocked or does not exist.`);
        }
      } else {
        attack = attacks[0];
      }

      const damageDice = calculateDamageDice(attack.base_damage_dice, character.level);
      const rollResult = rollDice(damageDice);

      let resultText = '';
      let gifUrl = '';
      
      if (rollResult.total === rollResult.maxPossible) {
        resultText = '# **AMAZING!!!!!** (Perfect hit!)';
        gifUrl = await getUserRatingGif(interaction.user.id, 'amazing');
      } else if (rollResult.total >= 3) {
        resultText = '# **GREAT!!!**';
        gifUrl = await getUserRatingGif(interaction.user.id, 'great');
      } else if (rollResult.total === 2) {
        resultText = '# **GOOD!!**';
        gifUrl = await getUserRatingGif(interaction.user.id, 'good');
      } else {
        resultText = 'bleh... (Attack deflected)';
        gifUrl = await getUserRatingGif(interaction.user.id, 'deflected');
      }

      const attackEmbed = new EmbedBuilder()
        .setTitle(`${character.name} uses ${attack.name}!`)
        .setDescription(`${resultText}\nRolled: [${rollResult.rolls.join(', ')}] Total: **${rollResult.total}**`)
        .setImage(gifUrl)
        .setTimestamp();

      await interaction.editReply({ embeds: [attackEmbed] });

    } catch (error) {
      console.error('Error handling attack:', error);
      await interaction.editReply({ content: '❌ An error occurred while executing the attack.' });
    }
  }

  async handleBattleAction(interaction) {
    await interaction.deferReply();

    try {
      const battleOption = interaction.options.getString('battle_option');
      const customAction = interaction.options.getString('custom_action');
      const dice = interaction.options.getString('dice');

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
}

module.exports = { battleCommand, BattleHandler };

