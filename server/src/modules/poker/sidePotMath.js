/**
 * Standard Texas Hold'em side-pot construction and uncalled-bet returns.
 *
 * Uses whole-hand contribution totals (all streets). Folded players' chips stay
 * in the pot but they are not eligible to win. Layers where only one player
 * contributed at that level are uncalled excess and returned before awards.
 */

function isAllInForPotDisplay(player) {
  if (!player) return false;
  if (player.status === "ALL_IN") return true;
  return (player.chips ?? 0) === 0;
}

/** At least one non-folded player cannot put more chips in (true side-pot territory). */
export function hasAllInPlayerInHand(state) {
  return (state?.players || []).some(
    (p) =>
      p.status !== "FOLDED" &&
      p.status !== "ELIMINATED" &&
      isAllInForPotDisplay(p)
  );
}

/**
 * @param {Map<string, number>} totalContributions playerId -> chips put in this hand
 * @param {Set<string>} nonFoldedPlayerIds players still contesting the pot
 * @returns {{ awardablePots: { level: number, amount: number, eligiblePlayerIds: string[] }[], uncalledReturns: Map<string, number> }}
 */
export function buildAwardableSidePots(totalContributions, nonFoldedPlayerIds) {
  const levels = [
    ...new Set([...totalContributions.values()].filter((x) => x > 0)),
  ].sort((a, b) => a - b);

  const layers = [];
  let previousLevel = 0;

  for (const currentLevel of levels) {
    const contributorCount = [...totalContributions.entries()].filter(
      ([, c]) => c >= currentLevel
    ).length;
    if (contributorCount === 0) continue;

    const amount = (currentLevel - previousLevel) * contributorCount;
    if (amount <= 0) {
      previousLevel = currentLevel;
      continue;
    }

    const eligiblePlayerIds = [...totalContributions.entries()]
      .filter(
        ([id, contribution]) =>
          contribution >= currentLevel && nonFoldedPlayerIds.has(id)
      )
      .map(([id]) => id);

    layers.push({ level: currentLevel, amount, eligiblePlayerIds });
    previousLevel = currentLevel;
  }

  const awardablePots = [];
  const uncalledReturns = new Map();

  for (const layer of layers) {
    const contributorCount = [...totalContributions.entries()].filter(
      ([, c]) => c >= layer.level
    ).length;

    // Excess above what any opponent matched — return to the sole contributor at this level.
    if (contributorCount === 1) {
      const [pid] = [...totalContributions.entries()].find(
        ([, c]) => c >= layer.level
      );
      uncalledReturns.set(pid, (uncalledReturns.get(pid) || 0) + layer.amount);
      continue;
    }

    if (layer.eligiblePlayerIds.length >= 1) {
      awardablePots.push(layer);
    }
  }

  return { awardablePots, uncalledReturns };
}

/**
 * Return uncalled chips to players and reduce state.pot accordingly.
 * Also reduces player.contributions so showdown math matches stacks.
 *
 * @returns {Array<{ playerId: string, userId: string, name: string, amount: number }>}
 */
export function applyUncalledReturns(state, uncalledReturns) {
  const events = [];
  if (!state || !uncalledReturns?.size) return events;

  for (const [playerId, amount] of uncalledReturns.entries()) {
    if (amount <= 0) continue;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) continue;

    player.chips = (player.chips || 0) + amount;
    player.contributions = Math.max(0, (player.contributions || 0) - amount);
    state.pot = Math.max(0, (state.pot || 0) - amount);

    events.push({
      playerId,
      userId: player.userId,
      name: player.name || player.user?.username || `Seat ${player.seatNumber}`,
      amount,
    });
  }

  return events;
}

/**
 * Rebuild contribution map from state (prior streets + current betting round).
 */
export function getTotalContributionsFromState(state) {
  const map = new Map();
  const players = (state?.players || []).filter((p) => p.status !== "ELIMINATED");
  for (const player of players) {
    const handContribution = player.contributions || 0;
    const currentContribution =
      state.bettingRound?.getPlayerContribution?.(player.id) || 0;
    map.set(player.id, handContribution + currentContribution);
  }
  return map;
}

/**
 * Merge current street into state.pot + player.contributions (same as advanceStreet).
 */
export function mergeCurrentStreetIntoPot(state) {
  if (!state?.bettingRound) return;
  const collectedPot = state.bettingRound.getTotalPot();
  state.pot = (state.pot || 0) + collectedPot;
  state.players.forEach((player) => {
    const currentContribution = state.bettingRound.getPlayerContribution(player.id);
    player.contributions = (player.contributions || 0) + currentContribution;
  });
  state.bettingRound.playerBets.clear();
  state.bettingRound.currentBet = 0;
}

/**
 * Preview pot layers for UI (no stack mutation). Optionally includes pending uncalled returns.
 */
export function computePotLayerPreview(state) {
  if (!state) return { totalPot: 0, sidePots: [], uncalledReturns: [], showPotBreakdown: false };

  const roundPot = state.bettingRound?.getTotalPot?.() || 0;
  const mergedPot = (state.pot || 0) + roundPot;

  // Side-pot layers only matter once someone is all-in; normal raises stay a single total pot in UI.
  if (!hasAllInPlayerInHand(state)) {
    return {
      totalPot: mergedPot,
      displayPot: mergedPot,
      sidePots: [],
      uncalledReturns: [],
      showPotBreakdown: false,
    };
  }

  const totalContributions = getTotalContributionsFromState(state);
  const nonFolded = new Set(
    state.players
      .filter((p) => p.status !== "FOLDED" && p.status !== "ELIMINATED")
      .map((p) => p.id)
  );

  const { awardablePots, uncalledReturns } = buildAwardableSidePots(
    totalContributions,
    nonFolded
  );

  const uncalledTotal = [...uncalledReturns.values()].reduce((a, b) => a + b, 0);
  const sidePots = awardablePots.map((p, i) => ({
    amount: p.amount,
    label: i === 0 ? "Main" : `Side ${i}`,
    eligiblePlayerIds: p.eligiblePlayerIds,
  }));

  const uncalledReturnsList = [];
  for (const [playerId, amount] of uncalledReturns.entries()) {
    if (amount <= 0) continue;
    const player = state.players.find((p) => p.id === playerId);
    uncalledReturnsList.push({
      playerId,
      userId: player?.userId,
      name:
        player?.name ||
        player?.user?.username ||
        (player ? `Seat ${player.seatNumber}` : playerId),
      amount,
    });
  }

  return {
    totalPot: Math.max(0, mergedPot - uncalledTotal),
    displayPot: mergedPot,
    sidePots,
    uncalledReturns: uncalledReturnsList,
    /** Only surface MAIN/SIDE labels when someone is all-in and layers exist. */
    showPotBreakdown:
      sidePots.length > 1 && hasAllInPlayerInHand(state),
  };
}

/**
 * After a street is merged into state.pot, return uncalled excess and expose pot layers.
 */
export function settleUncalledBetsOnState(state) {
  if (!state) return [];

  const totalContributions = getTotalContributionsFromState(state);
  const nonFolded = new Set(
    state.players
      .filter((p) => p.status !== "FOLDED" && p.status !== "ELIMINATED")
      .map((p) => p.id)
  );

  const { awardablePots, uncalledReturns } = buildAwardableSidePots(
    totalContributions,
    nonFolded
  );
  const uncalledEvents = applyUncalledReturns(state, uncalledReturns);

  state.sidePots = awardablePots.map((p, i) => ({
    ...p,
    label: i === 0 ? "Main" : `Side ${i}`,
  }));

  return uncalledEvents;
}

/**
 * Merge street, return uncalled excess, leave state.pot as awardable total.
 * Use before fold-win awards.
 */
export function resolvePotBeforeAward(state) {
  if (!state) return { uncalledEvents: [], potToAward: 0 };

  const roundPot = state.bettingRound?.getTotalPot?.() || 0;
  if (roundPot > 0) {
    mergeCurrentStreetIntoPot(state);
  }

  const uncalledEvents = settleUncalledBetsOnState(state);
  return { uncalledEvents, potToAward: state.pot || 0, awardablePots: state.sidePots || [] };
}

/** Before showdown: merge last street, return uncalled excess, expose pot layers on state. */
export function finalizePotLayersForShowdown(state) {
  if (!state) return { uncalledEvents: [], awardablePots: [] };

  const roundPot = state.bettingRound?.getTotalPot?.() || 0;
  if (roundPot > 0) {
    mergeCurrentStreetIntoPot(state);
  }

  const uncalledEvents = settleUncalledBetsOnState(state);
  return { uncalledEvents, awardablePots: state.sidePots || [] };
}

/**
 * Fold-win path: merge street, return uncalled excess, award remaining pot to sole winner.
 */
export function awardPotToSingleWinner(state, winner) {
  const { uncalledEvents, potToAward } = resolvePotBeforeAward(state);
  if (winner && potToAward > 0) {
    winner.chips = (winner.chips || 0) + potToAward;
  }
  state.pot = 0;
  return { potToAward, uncalledEvents };
}
