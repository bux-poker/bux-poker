// Build the client-facing representation of a game + in-memory hand state.
// Extracted from pokerHandler so it can be reused without pulling in the entire socket handler.

export function buildClientGameState(game, state) {
  // Calculate total pot: state.pot (accumulated from previous streets) + current betting round
  const totalPot = state
    ? (state.pot || 0) + (state.bettingRound?.getTotalPot() || 0)
    : game.pot || 0;

  // Start of new hand: never send stale card data from previous hand
  const street = state?.street || "PREFLOP";
  const isNewHand = street === "PREFLOP" && !state?.showdownActive;
  const communityCardsEncoded = isNewHand
    ? "[]"
    : JSON.stringify(state?.communityCards ?? []);

  return {
    id: game.id,
    tournamentId: game.tournamentId,
    tableNumber: game.tableNumber,
    pot: totalPot,
    communityCards: communityCardsEncoded,
    street,
    currentBet: state?.bettingRound?.currentBet || 0,
    minimumRaise:
      state?.bettingRound?.minimumRaise ||
      state?.bettingRound?.bigBlind ||
      20,
    smallBlind: state?.bettingRound?.smallBlind || 10,
    bigBlind: state?.bettingRound?.bigBlind || 20,
    dealerSeat: state?.dealerSeat ?? game.dealerSeat,
    smallBlindSeat: state?.smallBlindSeat ?? game.smallBlindSeat,
    bigBlindSeat: state?.bigBlindSeat ?? game.bigBlindSeat,
    currentTurnUserId: state?.currentTurnUserId,
    showdownActive: isNewHand ? false : state?.showdownActive || false,
    showdownResults: isNewHand ? null : state?.showdownResults || null,
    players: (state?.players ?? game.players)
      .filter((p) => p.status !== "ELIMINATED")
      .map((p) => ({
        id: p.id,
        userId: p.userId,
        name: p.user?.username || "Player",
        chips: p.chips,
        seatNumber: p.seatNumber,
        status: p.status,
        avatarUrl: p.user?.avatarUrl || null,
        lastAction: p.lastAction || null,
        holeCards: (() => {
          if (!p.holeCards) return null;
          if (typeof p.holeCards === "object") return p.holeCards;
          if (typeof p.holeCards === "string") {
            try {
              return JSON.parse(p.holeCards);
            } catch (e) {
              console.warn(
                `[POKER] Failed to parse holeCards for player ${p.id}:`,
                e.message
              );
              return null;
            }
          }
          return null;
        })(),
        contribution: state?.bettingRound?.getPlayerContribution(p.id) || 0,
      })),
  };
}

