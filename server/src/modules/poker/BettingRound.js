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
}

