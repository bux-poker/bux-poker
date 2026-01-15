import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // Optional: for guild-specific commands

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.warn('[DISCORD BOT] Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID - Discord bot disabled');
}

// Discord bot commands
const commands = [
  {
    name: 'tournament',
    description: 'Create a new poker tournament',
    options: [
      {
        name: 'name',
        type: 3, // STRING
        description: 'Tournament name',
        required: true,
      },
      {
        name: 'start-time',
        type: 3, // STRING (ISO date string)
        description: 'Start time (ISO format, e.g., 2024-01-20T18:00:00Z)',
        required: true,
      },
      {
        name: 'max-players',
        type: 4, // INTEGER
        description: 'Maximum number of players',
        required: false,
      },
      {
        name: 'starting-chips',
        type: 4, // INTEGER
        description: 'Starting chips per player',
        required: false,
      },
    ],
  },
  {
    name: 'list-tournaments',
    description: 'List all active tournaments',
  },
  {
    name: 'register',
    description: 'Register for a tournament',
    options: [
      {
        name: 'tournament-id',
        type: 3, // STRING
        description: 'Tournament ID',
        required: true,
      },
    ],
  },
];

let discordClient = null;

export async function initializeDiscordBot() {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    console.log('[DISCORD BOT] Skipping initialization - missing credentials');
    return null;
  }

  try {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
      ],
    });

    // Register slash commands
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    console.log('[DISCORD BOT] Registering slash commands...');

    if (GUILD_ID) {
      // Guild-specific commands (faster, for testing)
      await rest.put(
        Routes.applicationGuildCommands(DISCORD_CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`[DISCORD BOT] Registered ${commands.length} guild commands`);
    } else {
      // Global commands (takes up to 1 hour to propagate)
      await rest.put(
        Routes.applicationCommands(DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log(`[DISCORD BOT] Registered ${commands.length} global commands`);
    }

    // Handle interactions (slash commands)
    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const { commandName } = interaction;

      try {
        if (commandName === 'tournament') {
          await handleTournamentCommand(interaction);
        } else if (commandName === 'list-tournaments') {
          await handleListTournamentsCommand(interaction);
        } else if (commandName === 'register') {
          await handleRegisterCommand(interaction);
        }
      } catch (error) {
        console.error(`[DISCORD BOT] Error handling command ${commandName}:`, error);
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true,
        });
      }
    });

    client.once('ready', () => {
      console.log(`[DISCORD BOT] Logged in as ${client.user.tag}`);
    });

    await client.login(DISCORD_TOKEN);
    discordClient = client;
    return client;
  } catch (error) {
    console.error('[DISCORD BOT] Failed to initialize:', error);
    return null;
  }
}

async function handleTournamentCommand(interaction) {
  const name = interaction.options.getString('name');
  const startTimeStr = interaction.options.getString('start-time');
  const maxPlayers = interaction.options.getInteger('max-players') || 100;
  const startingChips = interaction.options.getInteger('starting-chips') || 10000;

  let startTime;
  try {
    startTime = new Date(startTimeStr);
    if (isNaN(startTime.getTime())) {
      throw new Error('Invalid date format');
    }
  } catch (error) {
    await interaction.reply({
      content: '❌ Invalid date format. Use ISO format: 2024-01-20T18:00:00Z',
      ephemeral: true,
    });
    return;
  }

  // Call backend API to create tournament
  const apiUrl = process.env.API_BASE_URL || 'http://localhost:3001';
  const response = await fetch(`${apiUrl}/api/admin/tournaments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Note: In production, you'd need to authenticate the Discord user
      // For now, we'll need to handle this differently
    },
    body: JSON.stringify({
      name,
      startTime: startTime.toISOString(),
      maxPlayers,
      startingChips,
      seatsPerTable: 9,
      blindLevelsJson: JSON.stringify([
        { level: 1, smallBlind: 25, bigBlind: 50, duration: 15 },
        { level: 2, smallBlind: 50, bigBlind: 100, duration: 15 },
        { level: 3, smallBlind: 100, bigBlind: 200, duration: 15 },
      ]),
      prizePlaces: 3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create tournament: ${error}`);
  }

  const tournament = await response.json();

  await interaction.reply({
    content: `✅ Tournament created!\n**${tournament.name}**\nStarts: <t:${Math.floor(startTime.getTime() / 1000)}:F>\nMax players: ${maxPlayers}\nStarting chips: ${startingChips}`,
    ephemeral: false,
  });
}

async function handleListTournamentsCommand(interaction) {
  const apiUrl = process.env.API_BASE_URL || 'http://localhost:3001';
  const response = await fetch(`${apiUrl}/api/tournaments`);

  if (!response.ok) {
    throw new Error('Failed to fetch tournaments');
  }

  const tournaments = await response.json();

  if (tournaments.length === 0) {
    await interaction.reply({
      content: '📋 No tournaments available',
      ephemeral: true,
    });
    return;
  }

  const tournamentList = tournaments
    .slice(0, 10) // Limit to 10
    .map((t) => {
      const startTime = new Date(t.startTime);
      return `**${t.name}** (ID: ${t.id})\nStarts: <t:${Math.floor(startTime.getTime() / 1000)}:F>\nStatus: ${t.status}`;
    })
    .join('\n\n');

  await interaction.reply({
    content: `📋 **Active Tournaments:**\n\n${tournamentList}`,
    ephemeral: true,
  });
}

async function handleRegisterCommand(interaction) {
  const tournamentId = interaction.options.getString('tournament-id');
  const userId = interaction.user.id;

  // Call backend API to register
  const apiUrl = process.env.API_BASE_URL || 'http://localhost:3001';
  const response = await fetch(`${apiUrl}/api/tournaments/${tournamentId}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Would need Discord user authentication here
    },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to register: ${error}`);
  }

  await interaction.reply({
    content: `✅ Registered for tournament!`,
    ephemeral: true,
  });
}

export function getDiscordClient() {
  return discordClient;
}
