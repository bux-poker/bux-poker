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

// Discord bot commands - only /setup command
const commands = [
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

          if (commandName === 'setup') {
            await handleSetupCommand(interaction);
          }
        } else if (interaction.isButton()) {
          // Handle button interactions for tournament registration/unregistration
          if (interaction.customId.startsWith('register_')) {
            const tournamentId = interaction.customId.replace('register_', '');
            await handleRegisterButton(interaction, tournamentId);
          } else if (interaction.customId.startsWith('unregister_')) {
            const tournamentId = interaction.customId.replace('unregister_', '');
            await handleUnregisterButton(interaction, tournamentId);
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

    // Check if tournament exists and is still accepting registrations
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      await interaction.reply({
        content: '❌ Tournament not found.',
        ephemeral: true,
      });
      return;
    }

    if (tournament.status !== 'SCHEDULED' && tournament.status !== 'REGISTERING') {
      await interaction.reply({
        content: '❌ This tournament is no longer accepting registrations.',
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

    // Check if tournament is full
    const registrationCount = await prisma.tournamentRegistration.count({
      where: {
        tournamentId: tournamentId,
        status: 'CONFIRMED',
      },
    });

    if (registrationCount >= tournament.maxPlayers) {
      await interaction.reply({
        content: '❌ Tournament is full.',
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

async function handleUnregisterButton(interaction, tournamentId) {
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

    // Find registration
    const registration = await prisma.tournamentRegistration.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId: tournamentId,
          userId: user.id,
        },
      },
    });

    if (!registration) {
      await interaction.reply({
        content: '❌ You are not registered for this tournament.',
        ephemeral: true,
      });
      return;
    }

    // Check if tournament has started
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (tournament && (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE')) {
      await interaction.reply({
        content: '❌ Cannot unregister - tournament has already started.',
        ephemeral: true,
      });
      return;
    }

    // Delete registration
    await prisma.tournamentRegistration.delete({
      where: {
        id: registration.id,
      },
    });

    await interaction.reply({
      content: '✅ Successfully unregistered from the tournament.',
      ephemeral: true,
    });
  } catch (error) {
    console.error('[DISCORD BOT] Error unregistering user:', error);
    throw error;
  }
}

export async function postTournamentEmbed(tournament, serverIds) {
  if (!discordClient) {
    console.warn('[DISCORD BOT] Cannot post embed - bot not initialized');
    return [];
  }

  if (!serverIds || serverIds.length === 0) {
    console.log('[DISCORD BOT] No server IDs provided, skipping embed posting');
    return [];
  }

  console.log(`[DISCORD BOT] Attempting to post embed for tournament ${tournament.id} to servers:`, serverIds);

  const servers = await prisma.discordServer.findMany({
    where: {
      serverId: { in: serverIds },
      enabled: true,
      setupCompleted: true,
      announcementChannelId: { not: null },
    },
  });

  if (servers.length === 0) {
    console.warn(`[DISCORD BOT] No valid servers found for IDs: ${serverIds.join(', ')}`);
    return [];
  }

  console.log(`[DISCORD BOT] Found ${servers.length} valid server(s) to post to`);

  const startTime = new Date(tournament.startTime);
  const clientUrl = process.env.CLIENT_URL || 'https://bux-poker.pro';
  const logoUrl = `${clientUrl}/images/bux-poker.png`;
  
  const embed = new EmbedBuilder()
    .setTitle(`🃏 ${tournament.name}`)
    .setDescription(tournament.description || 'Join the tournament and compete for prizes!')
    .setThumbnail(logoUrl)
    .addFields(
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:F>`, inline: true },
      { name: 'Max Players', value: tournament.maxPlayers.toString(), inline: true },
      { name: 'Starting Chips', value: tournament.startingChips.toLocaleString(), inline: true },
      { name: 'Prize Places', value: tournament.prizePlaces.toString(), inline: true },
    )
    .setColor(0x00AE86)
    .setTimestamp();

  const registerButton = new ButtonBuilder()
    .setCustomId(`register_${tournament.id}`)
    .setLabel('Register')
    .setStyle(ButtonStyle.Primary);

  const unregisterButton = new ButtonBuilder()
    .setCustomId(`unregister_${tournament.id}`)
    .setLabel('Unregister')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(registerButton, unregisterButton);

  const posts = [];

  for (const server of servers) {
    try {
      console.log(`[DISCORD BOT] Posting to server: ${server.serverName} (${server.serverId})`);
      const guild = await discordClient.guilds.fetch(server.serverId);
      const channel = await guild.channels.fetch(server.announcementChannelId);

      if (!channel || !channel.isTextBased()) {
        console.warn(`[DISCORD BOT] Invalid channel for server ${server.serverName}`);
        continue;
      }

      // Check bot permissions
      const permissions = channel.permissionsFor(guild.members.me);
      if (!permissions.has('SendMessages') || !permissions.has('EmbedLinks')) {
        console.error(`[DISCORD BOT] Bot lacks permissions in channel ${channel.name} for server ${server.serverName}`);
        continue;
      }

      const message = await channel.send({
        embeds: [embed],
        components: [row],
      });

      console.log(`[DISCORD BOT] Successfully posted embed to ${server.serverName}, message ID: ${message.id}`);

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
      console.error(`[DISCORD BOT] Error posting to server ${server.serverName}:`, error.message || error);
      console.error(`[DISCORD BOT] Error details:`, error);
    }
  }

  console.log(`[DISCORD BOT] Posted embed to ${posts.length} server(s) successfully`);

  return posts;
}

export function getDiscordClient() {
  return discordClient;
}
