import { prisma } from "../config/database.js";
import { TexasHoldem } from "../modules/poker/TexasHoldem.js";
import { HandEvaluator } from "../modules/poker/HandEvaluator.js";

export class PokerGameService {
  constructor() {
    this.engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });
    this.evaluator = new HandEvaluator();
  }

  /**
   * Initialize a new game for a tournament table.
   */
  async createGameForTournament({ tournamentId, tableNumber, playerIds }) {
    // TODO: implement real persistence + mapping to Prisma Game/Player models
    const deck = this.engine.createShuffledDeck();
    const { deck: remainingDeck, players: dealtHands } = this.engine.dealHoleCards(
      deck,
      playerIds.length
    );

    // Placeholder: just return structure; real version will persist via Prisma.
    return {
      tournamentId,
      tableNumber,
      deck: remainingDeck,
      players: playerIds.map((id, index) => ({
        playerId: id,
        holeCards: dealtHands[index]
      }))
    };
  }

  /**
   * Evaluate winners given final community cards and player hole cards.
   */
  evaluateShowdown({ communityCards, players }) {
    const results = players.map((p) => {
      const sevenCards = [...communityCards, ...p.holeCards];
      const hand = this.evaluator.evaluateBestHand(sevenCards);
      return { playerId: p.playerId, hand };
    });

    // Determine highest strength and winners (supporting ties).
    let maxStrength = -Infinity;
    for (const r of results) {
      if (r.hand.strength > maxStrength) {
        maxStrength = r.hand.strength;
      }
    }

    const winners = results.filter((r) => r.hand.strength === maxStrength);

    return {
      results,
      winners
    };
  }
}

