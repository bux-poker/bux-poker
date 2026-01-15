import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { prisma } from '../config/database.js';

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
  {
    name: 'setup',
    description: 'Configure the bot for this server',
    options: [
      {
        name: 'channel',
        type: 7, // CHANNEL
        description: 'Channel where tournament embeds will be posted',
        required: true,
      },
      {
        name: 'invite-link',
        type: 3, // STRING
        description: 'Invite link for people to join this server',
        required: true,
      },
      {
        name: 'admin-role',
        type: 8, // ROLE
        description: 'Role ID that grants admin access',
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
        GatewayIntentBits.GuildMessages,
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

    // Handle interactions (slash commands and buttons)
    client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          const { commandName } = interaction;

          if (commandName === 'tournament') {
            await handleTournamentCommand(interaction);
          } else if (commandName === 'list-tournaments') {
            await handleListTournamentsCommand(interaction);
          } else if (commandName === 'register') {
            await handleRegisterCommand(interaction);
          } else if (commandName === 'setup') {
            await handleSetupCommand(interaction);
          }
        } else if (interaction.isButton()) {
          // Handle button interactions for tournament registration
          if (interaction.customId.startsWith('register_')) {
            const tournamentId = interaction.customId.replace('register_', '');
            await handleRegisterButton(interaction, tournamentId);
          }
        }
      } catch (error) {
        console.error(`[DISCORD BOT] Error handling interaction:`, error);
        const replyContent = { content: `❌ Error: ${error.message}`, ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyContent);
        } else {
          await interaction.reply(replyContent);
        }
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

async function handleSetupCommand(interaction) {
  // Check if user has admin permissions
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({
      content: '❌ You need Administrator permissions to configure the bot.',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel');
  const inviteLink = interaction.options.getString('invite-link');
  const adminRole = interaction.options.getRole('admin-role');

  if (!channel || !inviteLink || !adminRole) {
    await interaction.reply({
      content: '❌ All fields are required.',
      ephemeral: true,
    });
    return;
  }

  // Validate invite link format
  if (!inviteLink.startsWith('https://discord.gg/') && !inviteLink.startsWith('https://discord.com/invite/')) {
    await interaction.reply({
      content: '❌ Invalid invite link format. Please provide a valid Discord invite link.',
      ephemeral: true,
    });
    return;
  }

  try {
    const guild = interaction.guild;
    
    // Upsert server configuration
    await prisma.discordServer.upsert({
      where: { serverId: guild.id },
      update: {
        serverName: guild.name,
        announcementChannelId: channel.id,
        inviteLink: inviteLink,
        adminRoleId: adminRole.id,
        setupCompleted: true,
        enabled: true,
      },
      create: {
        serverId: guild.id,
        serverName: guild.name,
        announcementChannelId: channel.id,
        inviteLink: inviteLink,
        adminRoleId: adminRole.id,
        setupCompleted: true,
        enabled: true,
      },
    });

    await interaction.reply({
      content: `✅ Bot configured successfully!\n\n**Channel:** ${channel}\n**Invite Link:** ${inviteLink}\n**Admin Role:** ${adminRole}\n\nThe bot will now post tournament embeds in ${channel}.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('[DISCORD BOT] Error in setup command:', error);
    throw error;
  }
}

async function handleRegisterButton(interaction, tournamentId) {
  const discordUserId = interaction.user.id;

  try {
    // Find user by Discord ID
    const user = await prisma.user.findUnique({
      where: { discordId: discordUserId },
    });

    if (!user) {
      await interaction.reply({
        content: '❌ You must be logged in on the website first. Please visit https://bux-poker.pro and log in with Discord.',
        ephemeral: true,
      });
      return;
    }

    // Check if already registered
    const existingRegistration = await prisma.tournamentRegistration.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId: tournamentId,
          userId: user.id,
        },
      },
    });

    if (existingRegistration) {
      await interaction.reply({
        content: '✅ You are already registered for this tournament!',
        ephemeral: true,
      });
      return;
    }

    // Register user
    await prisma.tournamentRegistration.create({
      data: {
        tournamentId: tournamentId,
        userId: user.id,
        status: 'CONFIRMED',
      },
    });

    await interaction.reply({
      content: '✅ Successfully registered for the tournament!',
      ephemeral: true,
    });
  } catch (error) {
    console.error('[DISCORD BOT] Error registering user:', error);
    throw error;
  }
}

export async function postTournamentEmbed(tournament, serverIds) {
  if (!discordClient) {
    console.warn('[DISCORD BOT] Cannot post embed - bot not initialized');
    return;
  }

  const servers = await prisma.discordServer.findMany({
    where: {
      serverId: { in: serverIds },
      enabled: true,
      setupCompleted: true,
      announcementChannelId: { not: null },
    },
  });

  const startTime = new Date(tournament.startTime);
  const embed = new EmbedBuilder()
    .setTitle(`🃏 ${tournament.name}`)
    .setDescription(tournament.description || 'Join the tournament and compete for prizes!')
    .addFields(
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:F>`, inline: true },
      { name: 'Max Players', value: tournament.maxPlayers.toString(), inline: true },
      { name: 'Starting Chips', value: tournament.startingChips.toLocaleString(), inline: true },
      { name: 'Prize Places', value: tournament.prizePlaces.toString(), inline: true },
    )
    .setColor(0x00AE86)
    .setTimestamp();

  const button = new ButtonBuilder()
    .setCustomId(`register_${tournament.id}`)
    .setLabel('Register for Tournament')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  const posts = [];

  for (const server of servers) {
    try {
      const guild = await discordClient.guilds.fetch(server.serverId);
      const channel = await guild.channels.fetch(server.announcementChannelId);

      if (!channel || !channel.isTextBased()) {
        console.warn(`[DISCORD BOT] Invalid channel for server ${server.serverName}`);
        continue;
      }

      const message = await channel.send({
        embeds: [embed],
        components: [row],
      });

      // Save tournament post to database
      await prisma.tournamentPost.create({
        data: {
          tournamentId: tournament.id,
          serverId: server.id,
          messageId: message.id,
          postedAt: new Date(),
        },
      });

      posts.push({ serverId: server.serverId, messageId: message.id });
    } catch (error) {
      console.error(`[DISCORD BOT] Error posting to server ${server.serverName}:`, error);
    }
  }

  return posts;
}

export function getDiscordClient() {
  return discordClient;
}
