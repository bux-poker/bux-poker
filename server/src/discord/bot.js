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
        try {
          const replyContent = { content: `❌ Error: ${error.message}`, ephemeral: true };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(replyContent);
          } else {
            await interaction.reply(replyContent);
          }
        } catch (replyError) {
          // Interaction might already be acknowledged, log but don't crash
          console.error(`[DISCORD BOT] Error replying to interaction:`, replyError);
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

    // Update the embed message with new button states
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
      });

      if (tournament && interaction.message && !interaction.replied && !interaction.deferred) {
        // Don't pass discordUserId - we want buttons to be enabled for everyone
        // The button handlers will check individual registration status
        const { embed: updatedEmbed, components: updatedComponents } = await buildTournamentEmbed(
          tournament,
          null
        );

        await interaction.update({
          embeds: [updatedEmbed],
          components: updatedComponents,
        });
        return; // Successfully updated, don't reply
      }
    } catch (updateError) {
      console.error('[DISCORD BOT] Error updating embed:', updateError);
      // If update fails, we'll fall through to reply
    }

    // Fallback to ephemeral reply if update failed or not possible
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '✅ Successfully registered for the tournament!',
        ephemeral: true,
      });
    }
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

    // Update the embed message with new button states
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
      });

      if (tournament && interaction.message && !interaction.replied && !interaction.deferred) {
        // Don't pass discordUserId - we want buttons to be enabled for everyone
        // The button handlers will check individual registration status
        const { embed: updatedEmbed, components: updatedComponents } = await buildTournamentEmbed(
          tournament,
          null
        );

        await interaction.update({
          embeds: [updatedEmbed],
          components: updatedComponents,
        });
        return; // Successfully updated, don't reply
      }
    } catch (updateError) {
      console.error('[DISCORD BOT] Error updating embed:', updateError);
      // If update fails, we'll fall through to reply
    }

    // Fallback to ephemeral reply if update failed or not possible
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '✅ Successfully unregistered from the tournament.',
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error('[DISCORD BOT] Error unregistering user:', error);
    throw error;
  }
}

// Helper function to build tournament embed with buttons
async function buildTournamentEmbed(tournament, discordUserId = null) {
  const startTime = new Date(tournament.startTime);
  const clientUrl = process.env.CLIENT_URL || 'https://bux-poker.pro';
  const logoUrl = `${clientUrl}/images/bux-poker.png`;
  const tournamentUrl = `${clientUrl}/tournaments/${tournament.id}`;
  
  // Get current registration count first
  let registrationCount = 0;
  try {
    registrationCount = await prisma.tournamentRegistration.count({
      where: {
        tournamentId: tournament.id,
        status: 'CONFIRMED',
      },
    });
  } catch (error) {
    console.error('[DISCORD BOT] Error getting registration count:', error);
  }

  // Check if user is registered (if discordUserId provided)
  let isRegistered = false;
  if (discordUserId) {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId: discordUserId },
      });
      
      if (user) {
        const registration = await prisma.tournamentRegistration.findUnique({
          where: {
            tournamentId_userId: {
              tournamentId: tournament.id,
              userId: user.id,
            },
          },
        });
        isRegistered = !!registration && registration.status === 'CONFIRMED';
      }
    } catch (error) {
      console.error('[DISCORD BOT] Error checking registration:', error);
    }
  }
  
  // Build description based on tournament status
  let description = tournament.description || 'Join the tournament and compete for prizes!';
  if (tournament.status === 'SEATED') {
    description = '🔒 **Registration Closed** - Tournament starting soon!';
  } else if (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE') {
    description = '▶️ **Tournament In Progress**';
  } else if (tournament.status === 'COMPLETED') {
    description = '✅ **Tournament Completed**';
  } else if (tournament.status === 'CANCELLED') {
    description = '❌ **Tournament Cancelled**';
  }

  const embed = new EmbedBuilder()
    .setTitle(`🃏 ${tournament.name}`)
    .setDescription(description)
    .setThumbnail(logoUrl)
    .addFields(
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:F>`, inline: true },
      { name: 'Players', value: `${registrationCount} / ${tournament.maxPlayers}`, inline: true },
      { name: 'Starting Chips', value: tournament.startingChips.toLocaleString(), inline: true },
      { name: 'Prize Places', value: tournament.prizePlaces.toString(), inline: true },
    )
    .setColor(tournament.status === 'SEATED' ? 0xFFD700 : (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE' ? 0x00FF00 : 0x00AE86))
    .setTimestamp();

  const isFull = registrationCount >= tournament.maxPlayers;
  // Can register only if SCHEDULED or REGISTERING and not full and not SEATED
  const canRegister = (tournament.status === 'SCHEDULED' || tournament.status === 'REGISTERING') && !isFull && tournament.status !== 'SEATED';

  // Build buttons
  // Note: We don't disable based on isRegistered because Discord embeds are shared
  // The button handler will check registration status and show appropriate messages
  const registerButton = new ButtonBuilder()
    .setCustomId(`register_${tournament.id}`)
    .setLabel(isFull ? 'Full' : 'Register')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!canRegister); // Only disable if tournament is full or not accepting registrations

  // Unregister button: Only disable if tournament has started/completed
  // Don't check isRegistered - the handler will check individual registration status
  const unregisterButton = new ButtonBuilder()
    .setCustomId(`unregister_${tournament.id}`)
    .setLabel('Unregister')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(tournament.status === 'RUNNING' || tournament.status === 'ACTIVE' || tournament.status === 'COMPLETED');

  const viewLobbyButton = new ButtonBuilder()
    .setLabel('View Tournament Lobby')
    .setURL(tournamentUrl)
    .setStyle(ButtonStyle.Link);

  const row1 = new ActionRowBuilder().addComponents(registerButton, unregisterButton);
  const row2 = new ActionRowBuilder().addComponents(viewLobbyButton);

  return { embed, components: [row1, row2], isRegistered, registrationCount };
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

  // Build embed without user context (initial post)
  // Get registration count to include in embed
  const initialRegistrationCount = await prisma.tournamentRegistration.count({
    where: {
      tournamentId: tournament.id,
      status: 'CONFIRMED',
    },
  });
  
  const { embed, components } = await buildTournamentEmbed(tournament);

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
        components: components,
      });

      console.log(`[DISCORD BOT] Successfully posted embed to ${server.serverName}, message ID: ${message.id}`);

      // Update tournament post with message ID (post should already exist)
      await prisma.tournamentPost.upsert({
        where: {
          tournamentId_serverId: {
            tournamentId: tournament.id,
            serverId: server.id,
          },
        },
        update: {
          messageId: message.id,
          postedAt: new Date(),
        },
        create: {
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

/**
 * Update all Discord embeds for a tournament (e.g., when registration closes)
 */
export async function updateTournamentEmbeds(tournamentId) {
  if (!discordClient) {
    console.warn('[DISCORD BOT] Cannot update embeds - bot not initialized');
    return;
  }

  try {
    // Get tournament with posts
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        posts: {
          include: {
            server: true
          }
        }
      }
    });

    if (!tournament || !tournament.posts || tournament.posts.length === 0) {
      console.log(`[DISCORD BOT] No posts found for tournament ${tournamentId}`);
      return;
    }

    // Build updated embed (without user context)
    const { embed, components } = await buildTournamentEmbed(tournament, null);

    // Update each embed
    for (const post of tournament.posts) {
      if (!post.messageId || !post.server) continue;

      try {
        const guild = await discordClient.guilds.fetch(post.server.serverId);
        const channel = await guild.channels.fetch(post.server.announcementChannelId);

        if (!channel || !channel.isTextBased()) {
          console.warn(`[DISCORD BOT] Invalid channel for server ${post.server.serverName}`);
          continue;
        }

        // Check bot permissions
        const permissions = channel.permissionsFor(guild.members.me);
        if (!permissions.has('SendMessages') || !permissions.has('EmbedLinks')) {
          console.error(`[DISCORD BOT] Bot lacks permissions in channel ${channel.name} for server ${post.server.serverName}`);
          continue;
        }

        // Update the message
        const message = await channel.messages.fetch(post.messageId);
        await message.edit({
          embeds: [embed],
          components: components,
        });

        console.log(`[DISCORD BOT] Successfully updated embed for tournament ${tournamentId} in server ${post.server.serverName}`);
      } catch (error) {
        console.error(`[DISCORD BOT] Error updating embed for server ${post.server.serverName}:`, error.message || error);
      }
    }
  } catch (error) {
    console.error(`[DISCORD BOT] Error updating tournament embeds:`, error);
  }
}

export function getDiscordClient() {
  return discordClient;
}
