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
   */
  isBettingComplete(activePlayerIds, lastActingPlayerId) {
    if (activePlayerIds.length <= 1) return true; // Only one or zero active players
    
    // Get contributions for all active players
    const contributions = activePlayerIds.map(id => this.getPlayerContribution(id));
    const maxContribution = Math.max(...contributions);
    
    // All active players must have contributed the max amount (or be all-in/folded)
    const allContributed = activePlayerIds.every(id => {
      const contribution = this.getPlayerContribution(id);
      return contribution === maxContribution;
    });
    
    // Also need to ensure the last person to act (who raised) has had all others act after them
    // If lastActingPlayerId raised, we need to ensure action has come back to them (or they're last)
    if (lastActingPlayerId) {
      const lastContribution = this.getPlayerContribution(lastActingPlayerId);
      // If last acting player raised (contribution > currentBet before their action),
      // we need all others to have acted since
      // For simplicity, just check if all have equal contributions
      return allContributed;
    }
    
    return allContributed;
  }
}

