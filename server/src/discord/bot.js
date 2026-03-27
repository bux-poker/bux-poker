import { Client, Events, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { prisma } from '../config/database.js';

dotenv.config();

/** Render/secret managers often append a newline — breaks Bot auth silently or hangs gateway. */
function getBotToken() {
  const raw = process.env.DISCORD_BOT_TOKEN;
  return typeof raw === 'string' ? raw.trim() : '';
}

const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const GUILD_ID = (process.env.DISCORD_GUILD_ID || '').trim() || undefined; // Optional: guild-specific commands

if (!getBotToken() || !DISCORD_CLIENT_ID) {
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
let discordInitPromise = null;
const DISCORD_LOGIN_TIMEOUT_MS = Number(process.env.DISCORD_LOGIN_TIMEOUT_MS || 45000);
let cachedRestClient = null;
let cachedRestToken = null;

function getRestClient() {
  const token = getBotToken();
  if (!token) return null;
  if (cachedRestToken !== token) {
    cachedRestClient = new REST({ version: '10' }).setToken(token);
    cachedRestToken = token;
  }
  return cachedRestClient;
}

/**
 * Optional REST check. Only 401 is treated as fatal (bad token).
 * Cloudflare often returns HTML "Access denied" / 429 from datacenter IPs (e.g. some PaaS);
 * that blocks REST but the gateway (wss://gateway.discord.gg) may still work — we must not abort init.
 */
async function verifyDiscordRestToken(token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        console.log(`[DISCORD BOT] REST token OK (bot user id=${j.id})`);
      } catch {
        console.log('[DISCORD BOT] REST token OK');
      }
      return { ok: true };
    }
    if (res.status === 401) {
      console.error('[DISCORD BOT] REST /users/@me unauthorized (401):', text.slice(0, 200));
      return {
        ok: false,
        fatal: true,
        message:
          'Discord bot token rejected (401). Regenerate the bot token in the Developer Portal and update DISCORD_BOT_TOKEN (no quotes or newlines).',
      };
    }
    const looksLikeCloudflareHtml =
      text.includes('Cloudflare') ||
      text.includes('Access denied') ||
      /^\s*<!doctype html/i.test(text);
    if (looksLikeCloudflareHtml || res.status === 429 || res.status === 403) {
      console.warn(
        `[DISCORD BOT] REST /users/@me not usable from this host (HTTP ${res.status}, likely Cloudflare/WAF). ` +
          'Trying Discord gateway login anyway — REST-only features may fail until you use an egress IP Discord allows.'
      );
      return { ok: false, fatal: false, reason: 'rest_blocked_or_waf' };
    }
    console.warn('[DISCORD BOT] REST /users/@me failed:', res.status, text.slice(0, 300));
    return { ok: false, fatal: false, reason: `http_${res.status}` };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'request timed out (15s)' : (e?.message || String(e));
    console.warn('[DISCORD BOT] REST /users/@me error; will still try gateway:', msg);
    return { ok: false, fatal: false, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

async function sendMessageViaDiscordRest(channelId, payload) {
  const restClient = getRestClient();
  if (!restClient || !channelId) return null;
  return restClient.post(Routes.channelMessages(channelId), { body: payload });
}

async function registerSlashCommandsInBackground(token, appId, guildId, commandBodies) {
  const rest = new REST({ version: '10' }).setToken(token);
  console.log('[DISCORD BOT] Registering slash commands (background)...');
  try {
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(appId, guildId),
        { body: commandBodies }
      );
      console.log(`[DISCORD BOT] Registered ${commandBodies.length} guild commands`);
    } else {
      await rest.put(
        Routes.applicationCommands(appId),
        { body: commandBodies }
      );
      console.log(`[DISCORD BOT] Registered ${commandBodies.length} global commands`);
    }
  } catch (err) {
    console.error('[DISCORD BOT] Slash command registration failed (bot stays online):', err?.message || err);
  }
}

export async function initializeDiscordBot() {
  if (discordClient?.isReady?.()) {
    return discordClient;
  }
  if (discordInitPromise) {
    return discordInitPromise;
  }

  const token = getBotToken();
  console.log(
    `[DISCORD BOT] Init requested (token=${token ? 'set' : 'missing'}, clientId=${DISCORD_CLIENT_ID ? 'set' : 'missing'}, loginTimeoutMs=${DISCORD_LOGIN_TIMEOUT_MS})`
  );
  if (!token || !DISCORD_CLIENT_ID) {
    console.log('[DISCORD BOT] Skipping initialization - missing credentials');
    return null;
  }

  const initTask = (async () => {
    try {
      // Preflight is opt-in: hitting discord.com/api from some PaaS IPs triggers Cloudflare HTML (429)
      // and adds noise; gateway uses a different path. Set DISCORD_REST_PREFLIGHT=true to debug token/REST.
      const enablePreflight =
        process.env.DISCORD_REST_PREFLIGHT === '1' ||
        process.env.DISCORD_REST_PREFLIGHT === 'true';
      if (enablePreflight) {
        const restCheck = await verifyDiscordRestToken(token);
        if (!restCheck.ok && restCheck.fatal) {
          throw new Error(restCheck.message);
        }
      }

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          // Required so we can fetch guild members and read role assignments for /api/admin/check
          GatewayIntentBits.GuildMembers,
        ],
      });

      client.on('error', (err) => console.error('[DISCORD BOT] Gateway client error:', err?.message || err));
      client.on('warn', (msg) => console.warn('[DISCORD BOT] Gateway client warn:', msg));

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

    client.once(Events.ClientReady, () => {
      console.log(`[DISCORD BOT] Logged in as ${client.user.tag}`);
    });

      console.log('[DISCORD BOT] Calling client.login() (gateway)...');
      const loginResult = await Promise.race([
        client.login(token),
        new Promise((resolve) => setTimeout(() => resolve("__login_timeout__"), DISCORD_LOGIN_TIMEOUT_MS)),
      ]);
      if (loginResult === "__login_timeout__") {
        try {
          client.destroy();
        } catch {}
        throw new Error(
          `Discord gateway login timed out after ${DISCORD_LOGIN_TIMEOUT_MS}ms. ` +
            'If logs also show Cloudflare blocking REST from this host, run the bot from hosting with a different egress IP (Discord often blocks some datacenter ranges).'
        );
      }
      // Mark online only after successful login.
      discordClient = client;
      // Command registration must never block process startup/port binding.
      void registerSlashCommandsInBackground(
        token,
        DISCORD_CLIENT_ID,
        GUILD_ID,
        commands
      );
      return client;
    } catch (error) {
      console.error('[DISCORD BOT] Failed to initialize:', error);
      discordClient = null;
      return null;
    } finally {
      discordInitPromise = null;
    }
  })();

  discordInitPromise = initTask;
  return initTask;
}

async function handleSetupCommand(interaction) {
  // Defer once so we never double-acknowledge; use editReply for all outcomes
  const deferred = await interaction.deferReply({ ephemeral: true }).catch(() => false);
  if (!deferred) return;

  const send = (content) =>
    interaction.editReply({ content }).catch((err) => console.error('[DISCORD BOT] editReply error:', err));

  if (!interaction.memberPermissions?.has('Administrator')) {
    await send('❌ You need Administrator permissions to configure the bot.');
    return;
  }

  const channel = interaction.options.getChannel('channel');
  const inviteLink = interaction.options.getString('invite-link');
  const adminRole = interaction.options.getRole('admin-role');

  if (!channel || !inviteLink || !adminRole) {
    await send('❌ All fields are required.');
    return;
  }

  if (!inviteLink.startsWith('https://discord.gg/') && !inviteLink.startsWith('https://discord.com/invite/')) {
    await send('❌ Invalid invite link format. Please provide a valid Discord invite link.');
    return;
  }

  try {
    let guild = interaction.guild;
    if (!guild && interaction.guildId && discordClient) {
      try {
        guild = await discordClient.guilds.fetch(interaction.guildId);
      } catch (fetchErr) {
        console.warn('[DISCORD BOT] Could not fetch guild:', fetchErr);
      }
    }

    const serverId = guild?.id ?? interaction.guildId;
    const serverName = guild?.name ?? 'Server';
    const channelId = channel?.id;
    const adminRoleId = adminRole?.id;

    if (!serverId || !channelId || !adminRoleId) {
      await send('❌ Could not resolve server, channel, or role. Please try again or re-invite the bot with the correct permissions.');
      return;
    }

    await prisma.discordServer.upsert({
      where: { serverId },
      update: {
        serverName,
        announcementChannelId: channelId,
        inviteLink,
        adminRoleId,
        setupCompleted: true,
        enabled: true,
      },
      create: {
        serverId,
        serverName,
        announcementChannelId: channelId,
        inviteLink,
        adminRoleId,
        setupCompleted: true,
        enabled: true,
      },
    });

    await send(`✅ Bot configured successfully!\n\n**Channel:** <#${channelId}>\n**Invite Link:** ${inviteLink}\n**Admin Role:** <@&${adminRoleId}>\n\nThe bot will now post tournament embeds in <#${channelId}>.`);
  } catch (error) {
    console.error('[DISCORD BOT] Error in setup command:', error);
    await send(`❌ Error: ${error.message || 'Setup failed.'}`);
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

    if (tournament.registrationOpensAt && new Date(tournament.registrationOpensAt) > new Date()) {
      await interaction.reply({
        content: '⏳ Registration opens 1 hour before the scheduled start.',
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

    // Check if tournament is full (before attempting registration)
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
      // Update status to CONFIRMED if it's not already
      if (existingRegistration.status !== 'CONFIRMED') {
        await prisma.tournamentRegistration.update({
          where: { id: existingRegistration.id },
          data: { status: 'CONFIRMED' },
        });
      }
      
      await interaction.reply({
        content: '✅ You are already registered for this tournament!',
        ephemeral: true,
      });
      return;
    }

    // Register user (race-safe)
    try {
      await prisma.tournamentRegistration.create({
        data: {
          tournamentId: tournamentId,
          userId: user.id,
          status: 'CONFIRMED',
        },
      });
    } catch (error) {
      // Prisma meta.target can be "tournamentId_userId" or ["tournamentId","userId"].
      const target = error?.meta?.target;
      const targetText = Array.isArray(target) ? target.join(',') : String(target || '');
      const isTournamentUserUnique =
        error?.code === 'P2002' &&
        (targetText.includes('tournamentId_userId') ||
          (targetText.includes('tournamentId') && targetText.includes('userId')));

      if (isTournamentUserUnique) {
        console.log('[DISCORD BOT] Race condition: registration already exists, continuing...');
      } else {
        throw error; // Re-throw if it's a different error
      }
    }

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
/** Hostname for copy (e.g. bux-poker.pro) from CLIENT_URL */
function siteHostnameFromClientUrl(clientUrl) {
  try {
    return new URL(clientUrl).hostname.replace(/^www\./i, '');
  } catch {
    return 'bux-poker.pro';
  }
}

async function buildTournamentEmbed(tournament, discordUserId = null) {
  const startTime = new Date(tournament.startTime);
  const clientUrl = process.env.CLIENT_URL || 'https://bux-poker.pro';
  const siteHost = siteHostnameFromClientUrl(clientUrl);
  const logoUrl = `${clientUrl}/images/bux-poker.png`;
  const tournamentUrl = `${clientUrl}/tournaments/${tournament.id}`;

  const leagueGame = await prisma.leagueGame.findFirst({
    where: { tournamentId: tournament.id },
    include: { league: true },
  });

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
  if (leagueGame) {
    description = `**${tournament.name}**\n\n${description}`;
  }

  const embedTitle = leagueGame
    ? `🏆 ${leagueGame.league.name} — Game ${leagueGame.gameNumber}/${leagueGame.league.totalGames}`
    : `🃏 ${tournament.name}`;

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription(description)
    .setThumbnail(logoUrl)
    .addFields(
      { name: 'Start Time', value: `<t:${Math.floor(startTime.getTime() / 1000)}:F>`, inline: true },
      { name: 'Players', value: `${registrationCount} / ${tournament.maxPlayers}`, inline: true },
      { name: 'Starting Chips', value: tournament.startingChips.toLocaleString(), inline: true },
      { name: 'Prize Places', value: Math.floor(registrationCount / 4).toString(), inline: true },
    )
    .setColor(tournament.status === 'SEATED' ? 0xFFD700 : (tournament.status === 'RUNNING' || tournament.status === 'ACTIVE' ? 0x00FF00 : 0x00AE86))
    .setTimestamp();

  const registrationOpen =
    tournament.status === 'SCHEDULED' || tournament.status === 'REGISTERING';
  if (registrationOpen) {
    embed.addFields({
      name: '📱 Mobile — fullscreen',
      value:
        `For the best fullscreen experience on **phone or tablet**, add **${siteHost}** to your home screen. Use the **Add to Home** section on the homepage for **iOS and Android** steps.\n\n` +
        `**Do not use Discord's in-app browser** — open **${clientUrl}** in **Safari** or **Chrome** first, then add to home screen. Links opened only inside Discord usually **cannot** be installed to your home screen.`,
    });
  }

  const isFull = registrationCount >= tournament.maxPlayers;
  const beforeRegistrationOpen =
    !!tournament.registrationOpensAt &&
    Date.now() < new Date(tournament.registrationOpensAt).getTime();
  // Can register only if SCHEDULED or REGISTERING and not full and not SEATED
  const canRegister =
    (tournament.status === 'SCHEDULED' || tournament.status === 'REGISTERING') &&
    !isFull &&
    tournament.status !== 'SEATED' &&
    !beforeRegistrationOpen;

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
      let message = null;
      const canUseGateway = !!discordClient?.isReady?.();

      if (canUseGateway) {
        let channel = null;
        let guild = await discordClient.guilds.fetch(server.serverId).catch(() => null);
        if (guild) {
          channel = await guild.channels.fetch(server.announcementChannelId).catch(() => null);
        }
        // Fallback for stale/incorrect stored guild IDs: channel id is globally unique.
        if (!channel && server.announcementChannelId) {
          channel = await discordClient.channels.fetch(server.announcementChannelId).catch(() => null);
          if (channel?.guild) {
            guild = channel.guild;
            if (String(guild.id) !== String(server.serverId)) {
              console.warn(
                `[DISCORD BOT] Server ID mismatch for ${server.serverName}: stored=${server.serverId}, channelGuild=${guild.id}`
              );
            }
          }
        }

        if (!channel || !channel.isTextBased() || !guild) {
          console.warn(`[DISCORD BOT] Gateway channel/guild resolve failed for ${server.serverName}; trying REST send`);
        } else {
          const permissions = channel.permissionsFor(guild.members.me);
          if (permissions.has('SendMessages') && permissions.has('EmbedLinks')) {
            message = await channel.send({
              embeds: [embed],
              components: components,
            });
          } else {
            console.warn(`[DISCORD BOT] Missing channel perms via gateway for ${server.serverName}; trying REST send`);
          }
        }
      }

      // Gateway unavailable or failed: direct REST send by channel ID.
      if (!message) {
        if (!server.announcementChannelId) {
          console.warn(`[DISCORD BOT] No announcementChannelId for ${server.serverName}`);
          continue;
        }
        message = await sendMessageViaDiscordRest(server.announcementChannelId, {
          embeds: [embed.toJSON()],
          components: components.map((c) => c.toJSON()),
        });
      }

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
        const guild = await discordClient.guilds.fetch(post.server.serverId).catch(() => null);
        if (!guild) {
          console.warn(`[DISCORD BOT] Bot not in server ${post.server.serverName}, skipping embed update`);
          continue;
        }
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

/**
 * Announce league leg cancelled (fewer than 5 registered at T-2m).
 */
export async function postLeagueLegCancelledEmbed(tournamentId, registeredCount) {
  if (!discordClient) {
    console.warn("[DISCORD BOT] Cannot post league cancel embed - bot not initialized");
    return [];
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      posts: { include: { server: true } },
    },
  });
  if (!tournament?.posts?.length) return [];

  const leagueGame = await prisma.leagueGame.findFirst({
    where: { tournamentId },
    include: { league: true },
  });
  const leagueName = leagueGame?.league?.name ?? "League";
  const gameLabel = leagueGame
    ? `Game ${leagueGame.gameNumber}/${leagueGame.league.totalGames}`
    : "";

  const clientUrl = process.env.CLIENT_URL || "https://bux-poker.pro";
  const logoUrl = `${clientUrl}/images/bux-poker.png`;

  const embed = new EmbedBuilder()
    .setTitle(`❌ ${leagueName} — leg cancelled`)
    .setDescription(
      `${gameLabel ? `**${gameLabel}** — ` : ""}**${tournament.name}**\n\nNot enough players registered at close (**${registeredCount}** confirmed, minimum **5**). No league points awarded for this leg.`
    )
    .setThumbnail(logoUrl)
    .setColor(0xed4245)
    .setTimestamp();

  const posts = [];
  for (const post of tournament.posts) {
    if (!post.server?.announcementChannelId) continue;
    try {
      const guild = await discordClient.guilds.fetch(post.server.serverId).catch(() => null);
      if (!guild) continue;
      const channel = await guild.channels.fetch(post.server.announcementChannelId);
      if (!channel || !channel.isTextBased()) continue;
      const permissions = channel.permissionsFor(guild.members.me);
      if (!permissions.has("SendMessages") || !permissions.has("EmbedLinks")) continue;
      const message = await channel.send({ embeds: [embed] });
      posts.push({ serverId: post.server.serverId, messageId: message.id });
    } catch (e) {
      console.error(
        `[DISCORD BOT] League cancel embed failed (${post.server?.serverName}):`,
        e?.message || e
      );
    }
  }
  return posts;
}

function sortLeagueStandingsRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const af = a.bestFinish ?? 999;
    const bf = b.bestFinish ?? 999;
    return af - bf;
  });
}

/**
 * Post a winners embed to Discord with final standings.
 */
export async function postTournamentWinnersEmbed(tournament) {
  if (!discordClient) {
    console.warn('[DISCORD BOT] Cannot post winners embed - bot not initialized');
    return [];
  }

  try {
    // Reload tournament with posts and full player data to ensure we have
    // finishing places for everyone.
    const tournamentWithRelations = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: {
        posts: {
          include: {
            server: true,
          },
        },
        registrations: {
          where: { status: { in: ['CONFIRMED', 'PENDING'] } },
          select: { id: true },
        },
        games: {
          include: {
            players: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!tournamentWithRelations) {
      console.warn(`[DISCORD BOT] Tournament ${tournament.id} not found for winners embed`);
      return [];
    }

    if (!tournamentWithRelations.posts || tournamentWithRelations.posts.length === 0) {
      console.log(`[DISCORD BOT] No posts found for tournament ${tournament.id}, skipping winners embed`);
      return [];
    }

    // Flatten all players across games and build a final standings list
    const allPlayers = [];
    for (const game of tournamentWithRelations.games || []) {
      for (const player of game.players || []) {
        allPlayers.push(player);
      }
    }

    if (allPlayers.length === 0) {
      console.log(`[DISCORD BOT] No players found for tournament ${tournament.id}, skipping winners embed`);
      return [];
    }

    // Sort by finishingPlace ascending (1 = winner). Fallback: higher chips first.
    const standings = allPlayers
      .filter(p => p.finishingPlace !== null && p.finishingPlace !== undefined)
      .sort((a, b) => (a.finishingPlace || 0) - (b.finishingPlace || 0));

    if (standings.length === 0) {
      console.log(`[DISCORD BOT] No finishingPlace data for players in tournament ${tournament.id}, skipping winners embed`);
      return [];
    }

    const registeredCount = tournamentWithRelations.registrations?.length ?? standings.length;
    const topPlacesToShow = Math.max(1, Math.ceil(registeredCount * 0.2)); // Top 20%
    const topStandings = standings.slice(0, topPlacesToShow);

    const clientUrl = process.env.CLIENT_URL || 'https://bux-poker.pro';
    const logoUrl = `${clientUrl}/images/bux-poker.png`;
    const tournamentUrl = `${clientUrl}/tournaments/${tournament.id}`;

    const winner = standings[0];
    // Use display rank (1, 2, 3...) for consecutive numbering; finishingPlace can have ties/gaps
    const lines = topStandings.map((p, i) => {
      const name = p.user?.username || 'Unknown';
      const displayRank = i + 1;
      return `**${displayRank}.** ${name}`;
    });

    const leagueGame = await prisma.leagueGame.findFirst({
      where: { tournamentId: tournament.id },
      include: { league: true },
    });

    let leagueTableText = '';
    const leagueComponents = [];
    if (leagueGame) {
      const leaguePageUrl = `${clientUrl}/leagues/${leagueGame.leagueId}`;
      const standingRows = await prisma.leagueStanding.findMany({
        where: { leagueId: leagueGame.leagueId },
        include: { user: { select: { username: true } } },
      });
      const sorted = sortLeagueStandingsRows(standingRows);
      const top10 = sorted.slice(0, 10);
      leagueTableText = top10
        .map(
          (row, i) =>
            `**${i + 1}.** ${row.user?.username ?? "Unknown"} — **${row.points}** pts`
        )
        .join("\n");
      if (!leagueTableText) leagueTableText = "_No standings yet._";

      const viewTableBtn = new ButtonBuilder()
        .setLabel("View league table")
        .setURL(leaguePageUrl)
        .setStyle(ButtonStyle.Link);
      leagueComponents.push(new ActionRowBuilder().addComponents(viewTableBtn));
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${tournamentWithRelations.name} — Final Standings`)
      .setDescription(lines.join('\n'))
      .setThumbnail(logoUrl)
      .addFields(
        { name: 'Winner', value: winner.user?.username || 'Unknown', inline: true },
        { name: 'Players', value: `${registeredCount}`, inline: true },
      )
      .setURL(tournamentUrl)
      .setColor(0xFFD700)
      .setTimestamp();

    if (leagueGame && leagueTableText) {
      embed.addFields({
        name: `${leagueGame.league.name} — top 10`,
        value: leagueTableText.slice(0, 1024),
      });
    }

    const posts = [];

    for (const post of tournamentWithRelations.posts) {
      if (!post.server || !post.server.announcementChannelId) continue;

      try {
        const guild = await discordClient.guilds.fetch(post.server.serverId).catch(() => null);
        if (!guild) {
          console.warn(`[DISCORD BOT] Bot not in server ${post.server.serverName}, skipping starting notification`);
          continue;
        }
        const channel = await guild.channels.fetch(post.server.announcementChannelId);

        if (!channel || !channel.isTextBased()) {
          console.warn(`[DISCORD BOT] Invalid channel for server ${post.server.serverName}`);
          continue;
        }

        const permissions = channel.permissionsFor(guild.members.me);
        if (!permissions.has('SendMessages') || !permissions.has('EmbedLinks')) {
          console.error(`[DISCORD BOT] Bot lacks permissions in channel ${channel.name} for server ${post.server.serverName}`);
          continue;
        }

        const message = await channel.send({
          embeds: [embed],
          components: leagueComponents.length > 0 ? leagueComponents : undefined,
        });

        console.log(`[DISCORD BOT] Posted winners embed for tournament ${tournament.id} to ${post.server.serverName}, message ID: ${message.id}`);
        posts.push({ serverId: post.server.serverId, messageId: message.id });
      } catch (error) {
        console.error(`[DISCORD BOT] Error posting winners embed to server ${post.server.serverName}:`, error.message || error);
      }
    }

    return posts;
  } catch (error) {
    console.error('[DISCORD BOT] Error posting tournament winners embed:', error);
    return [];
  }
}

/**
 * Post a "Game starting in 2 minutes" notification to all Discord servers
 */
export async function postTournamentStartingEmbed(tournament) {
  if (!discordClient) {
    console.warn('[DISCORD BOT] Cannot post starting embed - bot not initialized');
    return [];
  }

  try {
    // Get tournament with posts
    const tournamentWithPosts = await prisma.tournament.findUnique({
      where: { id: tournament.id },
      include: {
        posts: {
          include: {
            server: true
          }
        }
      }
    });

    if (!tournamentWithPosts || !tournamentWithPosts.posts || tournamentWithPosts.posts.length === 0) {
      console.log(`[DISCORD BOT] No posts found for tournament ${tournament.id}, skipping starting notification`);
      return [];
    }

    const clientUrl = process.env.CLIENT_URL || 'https://bux-poker.pro';
    const logoUrl = `${clientUrl}/images/bux-poker.png`;
    const tournamentUrl = `${clientUrl}/tournaments/${tournament.id}`;

    // Create starting notification embed
    const embed = new EmbedBuilder()
      .setTitle('🎮 Game Starting Soon!')
      .setDescription(`**${tournament.name}** is starting in **2 minutes**!\n\n🎯 **Take your seats now!**\n\n[Join Tournament](${tournamentUrl})`)
      .setThumbnail(logoUrl)
      .setColor(0xFFD700) // Gold color
      .setTimestamp(new Date(Date.now() + 2 * 60 * 1000));

    const posts = [];

    // Post to each server that has a post for this tournament
    for (const post of tournamentWithPosts.posts) {
      if (!post.server || !post.server.announcementChannelId) continue;

      try {
        const guild = await discordClient.guilds.fetch(post.server.serverId).catch(() => null);
        if (!guild) {
          console.warn(`[DISCORD BOT] Bot not in server ${post.server.serverName}, skipping winners embed`);
          continue;
        }
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

        const message = await channel.send({
          embeds: [embed],
        });

        console.log(`[DISCORD BOT] Successfully posted starting notification to ${post.server.serverName}, message ID: ${message.id}`);
        posts.push({ serverId: post.server.serverId, messageId: message.id });
      } catch (error) {
        console.error(`[DISCORD BOT] Error posting starting notification to server ${post.server.serverName}:`, error.message || error);
      }
    }

    return posts;
  } catch (error) {
    console.error(`[DISCORD BOT] Error posting tournament starting embed:`, error);
    return [];
  }
}

export function getDiscordClient() {
  return discordClient;
}
