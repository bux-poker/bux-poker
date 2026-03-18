import { prisma } from "../../config/database.js";

/**
 * Seat registered players into tables with balanced distribution.
 * All tables are within 1 player of each other.
 * @param {string} tournamentId
 * @returns {Promise<import('@prisma/client').Game[]>}
 */
export async function seatPlayers(tournamentId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      registrations: {
        where: { status: "CONFIRMED" }
      }
    }
  });

  if (!tournament) {
    throw new Error("Tournament not found");
  }

  const { seatsPerTable } = tournament;
  const registrations = tournament.registrations;

  if (registrations.length === 0) {
    throw new Error("No registered players to seat");
  }

  // Shuffle players randomly
  const shuffled = [...registrations].sort(() => Math.random() - 0.5);

  // Calculate number of tables needed
  const totalPlayers = shuffled.length;
  const numTables = Math.ceil(totalPlayers / seatsPerTable);

  // Balanced distribution: each table has floor(players/tables) or ceil(players/tables)
  const basePlayersPerTable = Math.floor(totalPlayers / numTables);
  const extraPlayers = totalPlayers % numTables;

  const tables = [];
  let playerIndex = 0;

  for (let tableNumber = 1; tableNumber <= numTables; tableNumber++) {
    const playersForThisTable = tableNumber <= extraPlayers
      ? basePlayersPerTable + 1
      : basePlayersPerTable;

    const tablePlayers = shuffled.slice(playerIndex, playerIndex + playersForThisTable);
    playerIndex += playersForThisTable;

    if (tablePlayers.length === 0) continue;

    const game = await prisma.game.create({
      data: {
        tournamentId,
        tableNumber,
        status: "ACTIVE",
        pot: 0,
        communityCards: ""
      }
    });

    for (let i = 0; i < tablePlayers.length; i++) {
      const reg = tablePlayers[i];
      await prisma.player.create({
        data: {
          gameId: game.id,
          userId: reg.userId,
          seatNumber: i + 1,
          chips: tournament.startingChips,
          holeCards: "",
          status: "ACTIVE"
        }
      });
    }

    tables.push(game);
  }

  console.log(`[TOURNAMENT] Seated ${totalPlayers} players into ${tables.length} balanced tables`);
  const gamesWithPlayers = await prisma.game.findMany({
    where: { tournamentId },
    include: { _count: { select: { players: true } } }
  });
  gamesWithPlayers.forEach((g) => {
    console.log(`[TOURNAMENT]   Table ${g.tableNumber}: ${g._count.players} players`);
  });

  return tables;
}
