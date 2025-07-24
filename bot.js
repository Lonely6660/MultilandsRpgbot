require('dotenv').config();

// --- START DEBUGGING LINES (KEEP THESE FOR NOW) ---
console.log('--- Environment Variables Check ---');
console.log('process.env.NEON_POSTGRES_URI:', process.env.NEON_POSTGRES_URI ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.DISCORD_TOKEN:', process.env.DISCORD_TOKEN ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.CLIENT_ID:', process.env.CLIENT_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('process.env.TEST_GUILD_ID:', process.env.TEST_GUILD_ID ? '***** (value present)' : 'UNDEFINED or EMPTY');
console.log('---------------------------------');
// --- END DEBUGGING LINES ---

const { Client, IntentsBitField, EmbedBuilder, REST, Routes, SlashCommandBuilder, GatewayIntentBits } = require('discord.js');
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

// Connect to PostgreSQL
pgClient.connect()
  .then(async () => {
    console.log('✅ PostgreSQL Connected');
    // Create 'characters' table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS characters (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar_url TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
    `;
    await pgClient.query(createTableQuery);
    console.log('📝 "characters" table ensured.');
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
            .setRequired(true)))
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

        // Basic URL validation
        try {
            new URL(avatarURL);
        } catch (e) {
            return interaction.reply({ content: '❌ Invalid URL for avatar. Please provide a valid image URL.', ephemeral: true });
        }

        try {
            // Check if character already exists for this user
            const checkQuery = 'SELECT * FROM characters WHERE user_id = $1 AND name = $2;';
            const checkResult = await pgClient.query(checkQuery, [userId, name]);

            if (checkResult.rows.length > 0) {
              return interaction.reply({ content: `❌ You already have a character named "${name}".`, ephemeral: true });
            }

            // Insert new character
            const insertQuery = 'INSERT INTO characters (user_id, name, avatar_url) VALUES ($1, $2, $3);';
            await pgClient.query(insertQuery, [userId, name, avatarURL]);

            await interaction.reply({ content: `✅ Character "${name}" created successfully!`, ephemeral: true });

        } catch (dbError) {
            console.error('Error creating character in DB:', dbError);
            return interaction.reply({ content: '❌ An error occurred while saving your character.', ephemeral: true });
        }


      } else if (subcommand === 'list') {
        try {
            const query = 'SELECT name, avatar_url FROM characters WHERE user_id = $1;';
            const result = await pgClient.query(query, [userId]);
            const characters = result.rows;

            if (characters.length === 0) {
              return interaction.reply({ content: 'You have no characters yet. Create one with `/character create`.', ephemeral: true });
            }

            const characterList = characters.map(char => `- ${char.name} (<${char.avatar_url}>)`).join('\n');
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
