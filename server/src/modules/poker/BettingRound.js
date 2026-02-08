// BettingRound: encapsulates betting logic for a single street
// (preflop, flop, turn, river) at a single table.

export class BettingRound {
  constructor({ smallBlind, bigBlind, startingPot = 0 }) {
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.pot = startingPot;
    this.currentBet = 0;
    this.minimumRaise = bigBlind;
    this.playerBets = new Map();
  }

  getTotalPot() {
    // Only return the sum of player bets for this betting round
    // The startingPot (this.pot) is only for tracking, not included in getTotalPot
    // because it's already been added to state.pot when the betting round was created
    let total = 0;
    for (const amount of this.playerBets.values()) {
      total += amount;
    }
    return total;
  }

  getPlayerContribution(playerId) {
    return this.playerBets.get(playerId) ?? 0;
  }

  bet(playerId, amount) {
    const contribution = this.getPlayerContribution(playerId);
    const newContribution = contribution + amount;

    if (amount <= 0) {
      throw new Error("Bet amount must be positive");
    }

    if (newContribution <= this.currentBet) {
      throw new Error("Bet must increase current bet");
    }

    const raiseAmount = newContribution - this.currentBet;
    if (raiseAmount < this.minimumRaise) {
      throw new Error("Raise below minimum raise size");
    }

    this.playerBets.set(playerId, newContribution);
    this.currentBet = newContribution;
    this.minimumRaise = raiseAmount;
  }

  call(playerId, maxStack) {
    const contribution = this.getPlayerContribution(playerId);
    const toCall = this.currentBet - contribution;
    const amount = Math.min(toCall, maxStack);

    if (amount < 0) {
      throw new Error("Cannot call negative amount");
    }

    this.playerBets.set(playerId, contribution + amount);
    return amount;
  }

  /**
   * Post blinds - directly set player contributions without raise validation
   * This is used at the start of a hand to post small blind and big blind
   * @param {string} smallBlindPlayerId - Player ID posting small blind
   * @param {string} bigBlindPlayerId - Player ID posting big blind
   * @param {number} smallBlindAmount - Actual small blind amount (may be less if player has insufficient chips)
   * @param {number} bigBlindAmount - Actual big blind amount (may be less if player has insufficient chips)
   */
  postBlinds(smallBlindPlayerId, bigBlindPlayerId, smallBlindAmount = null, bigBlindAmount = null) {
    const sbAmount = smallBlindAmount !== null ? smallBlindAmount : this.smallBlind;
    const bbAmount = bigBlindAmount !== null ? bigBlindAmount : this.bigBlind;
    this.playerBets.set(smallBlindPlayerId, sbAmount);
    this.playerBets.set(bigBlindPlayerId, bbAmount);
    this.currentBet = bbAmount; // Big blind is the current bet to call (may be adjusted if insufficient chips)
  }

  /**
   * Check if all active players are all-in (have zero chips remaining)
   * @param {string[]} activePlayerIds - IDs of active players
   * @param {Array} allPlayers - All players with their chips and userIds
   * @returns {boolean} True if all active players have zero chips
   */
  areAllPlayersAllIn(activePlayerIds, allPlayers) {
    if (activePlayerIds.length === 0) return false;
    
    return activePlayerIds.every(id => {
      const player = allPlayers.find(p => p.id === id);
      return player && player.chips === 0;
    });
  }

  /**
   * Check if betting round is complete
   * Round is complete when all active players have contributed equally (or are all-in/folded)
   * and there are no pending actions (no one has raised and is waiting for others to act)
   * 
   * @param {string[]} activePlayerIds - IDs of active (non-folded, non-eliminated) players
   * @param {string|null} lastRaiseUserId - User ID of the last player who raised (null if no raises)
   * @param {string|null} currentTurnUserId - User ID of the player whose turn it currently is
   * @param {Array} allPlayers - All players with their userIds and seatNumbers (to determine turn order)
   * @param {Set} actedPlayersInRound - Set of userIds who have acted in this betting round
   * @param {Set|null} [presentPlayerIds] - If provided, only require these players to have acted (ignore ghosts)
   */
  isBettingComplete(activePlayerIds, lastRaiseUserId, currentTurnUserId, allPlayers, actedPlayersInRound = new Set(), presentPlayerIds = null) {
    if (activePlayerIds.length <= 1) return true; // Only one or zero active players
    
    // Get contributions for all active players
    const contributions = activePlayerIds.map(id => {
      const player = allPlayers.find(p => p.id === id);
      return {
        id,
        contribution: this.getPlayerContribution(id),
        chips: player?.chips || 0,
        isAllIn: (player?.chips || 0) === 0
      };
    });
    const maxContribution = Math.max(...contributions.map(c => c.contribution));
    
    // All active players must have contributed the max amount they CAN contribute
    // This means either:
    // 1. They match the max contribution (contribution === maxContribution), OR
    // 2. They're all-in and have contributed their maximum possible amount
    const allContributed = contributions.every(c => {
      // If player is all-in, they've contributed all they can - they're done
      if (c.isAllIn) {
        return true; // All-in players have contributed their maximum
      }
      // If player is not all-in, they must match the max contribution
      return c.contribution === maxContribution;
    });
    
    if (!allContributed) {
      const contribStrings = contributions.map(c => `${c.isAllIn ? 'ALL-IN' : c.contribution}`);
      console.log(`[BETTING] Not complete: contributions not equal. Max: ${maxContribution}, contributions: [${contribStrings.join(', ')}]`);
      return false; // Can't be complete if contributions aren't equal
    }
    
    // If no one has raised, betting is complete when:
    // 1. All have equal contributions (checked above)
    // 2. AND all active players have either acted OR are all-in (can't act)
    if (!lastRaiseUserId) {
      // No raise - betting is complete when all active players have acted once OR are all-in
      // If presentPlayerIds given, only consider those (ignore ghosts/consolidated players)
      const idsToCheck = presentPlayerIds
        ? activePlayerIds.filter(id => presentPlayerIds.has(id))
        : activePlayerIds;
      const activePlayerInfo = idsToCheck.map(id => {
        const player = allPlayers.find(p => p.id === id);
        return {
          userId: player?.userId || id,
          isAllIn: (player?.chips || 0) === 0
        };
      });
      
      // Check if all active players (present at table) have either acted OR are all-in
      const allHaveActedOrAllIn = activePlayerInfo.every(({ userId, isAllIn }) => {
        if (isAllIn) {
          return true; // All-in players can't act, so they're considered "done"
        }
        return actedPlayersInRound.has(userId); // Non-all-in players must have acted
      });
      
      if (allHaveActedOrAllIn) {
        console.log(`[BETTING] Complete: all contributed equally, no raises, all active players have acted or are all-in`);
        return true;
      } else {
        // Still have players who haven't acted and aren't all-in - they still need to act
        const notActed = activePlayerInfo
          .filter(({ userId, isAllIn }) => !isAllIn && !actedPlayersInRound.has(userId))
          .map(({ userId }) => userId);
        console.log(`[BETTING] Not complete: all contributed equally, no raises, but players haven't acted: ${notActed.join(', ')}`);
        return false;
      }
    }
    
    // If someone raised, we need to ensure action has come back to them
    // This means the current turn should be the player AFTER the last raiser (clockwise)
    if (!currentTurnUserId) {
      // No current turn - this could mean:
      // 1. Betting is complete and everyone has acted, OR
      // 2. All remaining players are all-in and can't act further
      
      // Find the last raiser
      const lastRaiser = allPlayers.find(p => p.userId === lastRaiseUserId);
      if (!lastRaiser) {
        console.log(`[BETTING] Not complete: no current turn and last raiser not found`);
        return false;
      }
      
      // Check if the last raiser has acted (they should be in actedPlayersInRound)
      const lastRaiserHasActed = actedPlayersInRound.has(lastRaiseUserId);
      
      // Check if all other active players (excluding the last raiser) are all-in or have acted
      const otherActivePlayers = contributions.filter(c => {
        const player = allPlayers.find(p => p.id === c.id);
        return player && player.userId !== lastRaiseUserId;
      });
      
      // All other active players must be either:
      // 1. All-in (0 chips), OR
      // 2. Have already acted in this round
      const allOthersCantAct = otherActivePlayers.every(c => {
        if (c.isAllIn) {
          return true; // All-in players can't act further
        }
        const player = allPlayers.find(p => p.id === c.id);
        return player && actedPlayersInRound.has(player.userId);
      });
      
      // If the last raiser has acted AND all others can't act (all-in or already acted),
      // then betting is complete even though currentTurnUserId is null
      if (lastRaiserHasActed && allOthersCantAct) {
        console.log(`[BETTING] Complete: no current turn, last raiser has acted, all others are all-in or have acted`);
        return true;
      }
      
      console.log(`[BETTING] Not complete: no current turn, lastRaiserHasActed=${lastRaiserHasActed}, allOthersCantAct=${allOthersCantAct}`);
      return false; // No current turn and betting not complete
    }
    
    // Find the last raiser and current turn player
    const lastRaiser = allPlayers.find(p => p.userId === lastRaiseUserId);
    const currentTurnPlayer = allPlayers.find(p => p.userId === currentTurnUserId);
    
    if (!lastRaiser || !currentTurnPlayer) {
      console.log(`[BETTING] Not complete: players not found. lastRaiser: ${!!lastRaiser}, currentTurnPlayer: ${!!currentTurnPlayer}`);
      return false; // Can't determine if players not found
    }
    
    // If current turn is the last raiser, betting is NOT complete (they need to act again)
    if (currentTurnUserId === lastRaiseUserId) {
      console.log(`[BETTING] Not complete: current turn is last raiser (seat ${lastRaiser.seatNumber})`);
      return false;
    }
    
    // Get seat numbers for turn order check
    const seats = allPlayers.map(p => p.seatNumber);
    const minSeat = Math.min(...seats);
    const maxSeat = Math.max(...seats);
    const lastRaiserSeat = lastRaiser.seatNumber;
    const currentSeat = currentTurnPlayer.seatNumber;
    
    // Check if we've passed the last raiser (clockwise = decreasing seat numbers)
    // Clockwise path from lastRaiserSeat: decreases until minSeat, then wraps to maxSeat
    // Example: if raiser at seat 3, clockwise: 3 -> 2 -> 1 -> 7 -> 6 -> 5 -> 4 -> 3
    // If current is at seat 5, we've gone: 3 -> 2 -> 1 -> 7 -> 6 -> 5 (we HAVE passed 3)
    
    let hasPassedLastRaiser = false;
    
    // Clockwise movement means DECREASING seat numbers (for anticlockwise seat numbering)
    // If raiser is at seat 3 and current is at seat 5:
    // Clockwise: 3 -> 2 -> 1 -> 7 -> 6 -> 5
    // So we've passed 3 (we're at 5, which comes after 3 in clockwise order)
    
    if (lastRaiserSeat === minSeat) {
      // Raiser at minimum seat - clockwise wraps: minSeat -> maxSeat -> ... -> minSeat
      // We've passed if current is NOT minSeat (anywhere else in rotation)
      hasPassedLastRaiser = currentSeat !== minSeat;
    } else {
      // Raiser not at min seat
      // Clockwise path: raiser -> (raiser-1) -> ... -> minSeat -> maxSeat -> ... -> back to raiser
      // If currentSeat > lastRaiserSeat: we've wrapped (gone past minSeat and around to maxSeat side)
      // If currentSeat < lastRaiserSeat: we've passed going down from raiser
      // If currentSeat == lastRaiserSeat: we're back at raiser (NOT passed yet - they need to act)
      // So we've passed if current != raiser AND (current < raiser OR current > raiser with wrap consideration)
      
      // Actually simpler: if current is NOT the raiser and all contributions equal, 
      // and we've moved from raiser, we've passed them
      // Clockwise from raiser: if current is higher numbered, we wrapped (passed)
      // If current is lower numbered, we went down (passed)
      // The only case we haven't passed is if current == raiser
      
      hasPassedLastRaiser = currentSeat !== lastRaiserSeat;
    }
    
    console.log(`[BETTING] Check: lastRaiser=seat${lastRaiserSeat}, current=seat${currentSeat}, min=${minSeat}, max=${maxSeat}, hasPassed=${hasPassedLastRaiser}, allContributed=${allContributed}`);
    
    // Betting is complete if all have equal contributions AND we've passed the last raiser
    return hasPassedLastRaiser;
  }
}

