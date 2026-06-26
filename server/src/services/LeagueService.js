import { prisma } from "../config/database.js";
import { canManageLeague } from "../utils/tournamentAdminAccess.js";
import {
  parsePrizeStructureJson,
  lamportsToSolString,
} from "./prizes/prizeStructure.js";
import { getViewerLeaguePrizeClaim, ensureLeaguePrizeClaims } from "./prizes/prizeClaims.js";
import { isPrizeWalletConfigured } from "./prizes/prizeWallet.js";

/** League domain service */
export class LeagueService {
  async listLeagues() {
    return prisma.league.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }]
    });
  }

  async getLeagueById(id, viewer = null) {
    const league = await prisma.league.findUnique({
      where: { id },
      include: {
        standings: {
          include: {
            user: { select: { id: true, username: true, avatarUrl: true } },
          },
        },
        games: {
          orderBy: { gameNumber: "asc" },
          include: {
            tournament: {
              select: {
                id: true,
                name: true,
                startTime: true,
                status: true,
              },
            },
          },
        },
        prizeClaimServer: {
          select: {
            id: true,
            serverName: true,
            inviteLink: true,
          },
        },
      },
    });
    if (!league) return null;

    if (
      league.status === "COMPLETED" &&
      (league.prizePlaces ?? 0) > 0 &&
      league.prizeMode
    ) {
      const claimCount = await prisma.prizeClaim.count({ where: { leagueId: id } });
      if (claimCount === 0) {
        await ensureLeaguePrizeClaims(id).catch((err) =>
          console.error("[PRIZES] backfill ensureLeaguePrizeClaims:", err?.message || err)
        );
      }
    }

    const standings = [...league.standings].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const af = a.bestFinish ?? 999;
      const bf = b.bestFinish ?? 999;
      return af - bf;
    });

    const result = {
      ...league,
      standings,
      prizePlaces: league.prizePlaces ?? 0,
      prizeMode: league.prizeMode ?? null,
      prizeStructure: parsePrizeStructureJson(league.prizeStructureJson),
      prizeFundingStatus: league.prizeFundingStatus ?? null,
      prizeWalletAddress: league.prizeWalletAddress ?? null,
      walletConfigured: isPrizeWalletConfigured(league),
      requiredFeeSol: league.prizeFeeSolLamports
        ? lamportsToSolString(league.prizeFeeSolLamports)
        : null,
      prizeClaimServer: league.prizeClaimServer
        ? {
            serverName: league.prizeClaimServer.serverName,
            inviteLink: league.prizeClaimServer.inviteLink,
          }
        : null,
      hasPrizes: (league.prizePlaces ?? 0) > 0 && !!league.prizeMode,
    };

    if (viewer?.id) {
      result.canManage = await canManageLeague({
        userId: viewer.id,
        discordId: viewer.discordId,
        leagueId: id,
      });
      result.myPrizeClaim = await getViewerLeaguePrizeClaim(id, viewer.id);
    } else {
      result.canManage = false;
      result.myPrizeClaim = null;
    }

    return result;
  }

  /**
   * Public league list: in-progress leagues (at least one leg not finished) plus
   * recently finished leagues so players can open final standings.
   */
  async listActiveLeagues() {
    const includeGames = {
      games: {
        include: {
          tournament: { select: { id: true, status: true, startTime: true } },
        },
      },
    };

    const inProgress = await prisma.league.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      include: includeGames,
    });
    const inProgressFiltered = inProgress.filter((L) =>
      L.games.some(
        (g) =>
          g.tournament.status !== "COMPLETED" &&
          g.tournament.status !== "CANCELLED"
      )
    );

    const completed = await prisma.league.findMany({
      where: { status: "COMPLETED" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 100,
      include: includeGames,
    });

    return [...inProgressFiltered, ...completed];
  }
}
