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
    
    if (!allContributed) return false; // Can't be complete if contributions aren't equal
    
    // If no one has raised, betting is complete when all have equal contributions
    if (!lastRaiseUserId) return true;
    
    // If someone raised, we need to ensure action has come back to them
    // This means the current turn should be the player AFTER the last raiser (clockwise)
    if (!currentTurnUserId) return false; // No current turn means not complete
    
    // Find the last raiser and current turn player
    const lastRaiser = allPlayers.find(p => p.userId === lastRaiseUserId);
    const currentTurnPlayer = allPlayers.find(p => p.userId === currentTurnUserId);
    
    if (!lastRaiser || !currentTurnPlayer) return false; // Can't determine if players not found
    
    // If current turn is the last raiser, betting is NOT complete (they need to act again)
    if (currentTurnUserId === lastRaiseUserId) return false;
    
    // Get seat numbers for turn order check
    const seats = allPlayers.map(p => p.seatNumber);
    const minSeat = Math.min(...seats);
    const maxSeat = Math.max(...seats);
    const lastRaiserSeat = lastRaiser.seatNumber;
    const currentSeat = currentTurnPlayer.seatNumber;
    
    // Check if we've passed the last raiser (clockwise = decreasing seat numbers)
    // If last raiser is at seat X, and current is at seat X-1 (or wrapped around), we've passed them
    let hasPassedLastRaiser = false;
    
    // Check if we're between last raiser and min seat (going clockwise)
    if (lastRaiserSeat === minSeat) {
      // Last raiser is at minimum seat, so we've passed them if we're at maxSeat or any seat < maxSeat
      hasPassedLastRaiser = currentSeat >= maxSeat || currentSeat < lastRaiserSeat;
    } else {
      // Normal case: we've passed if current seat < last raiser seat (moving clockwise/decreasing)
      hasPassedLastRaiser = currentSeat < lastRaiserSeat;
    }
    
    // Betting is complete if all have equal contributions AND we've passed the last raiser
    return hasPassedLastRaiser;
  }
}

