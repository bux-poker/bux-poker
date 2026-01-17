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
    let total = this.pot;
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
   */
  postBlinds(smallBlindPlayerId, bigBlindPlayerId) {
    this.playerBets.set(smallBlindPlayerId, this.smallBlind);
    this.playerBets.set(bigBlindPlayerId, this.bigBlind);
    this.currentBet = this.bigBlind; // Big blind is the current bet to call
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
   */
  isBettingComplete(activePlayerIds, lastRaiseUserId, currentTurnUserId, allPlayers) {
    if (activePlayerIds.length <= 1) return true; // Only one or zero active players
    
    // Get contributions for all active players
    const contributions = activePlayerIds.map(id => this.getPlayerContribution(id));
    const maxContribution = Math.max(...contributions);
    
    // All active players must have contributed the max amount (or be all-in/folded)
    const allContributed = activePlayerIds.every(id => {
      const contribution = this.getPlayerContribution(id);
      return contribution === maxContribution;
    });
    
    if (!allContributed) {
      console.log(`[BETTING] Not complete: contributions not equal. Max: ${maxContribution}, contributions:`, contributions);
      return false; // Can't be complete if contributions aren't equal
    }
    
    // If no one has raised, betting is complete when:
    // 1. All have equal contributions (checked above)
    // 2. AND there's no current turn (meaning action has gone around to all players)
    // OR currentTurnUserId is null (no player needs to act)
    if (!lastRaiseUserId) {
      // No raise - betting is complete only if no player needs to act (currentTurnUserId is null)
      // This means action has gone around to all players
      if (!currentTurnUserId) {
        console.log(`[BETTING] Complete: all contributed equally, no raises, no player needs to act`);
        return true;
      } else {
        // Still have a current turn - players still need to act
        console.log(`[BETTING] Not complete: all contributed equally, no raises, but currentTurnUserId is ${currentTurnUserId} - players still need to act`);
        return false;
      }
    }
    
    // If someone raised, we need to ensure action has come back to them
    // This means the current turn should be the player AFTER the last raiser (clockwise)
    if (!currentTurnUserId) {
      console.log(`[BETTING] Not complete: no current turn`);
      return false; // No current turn means not complete
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

