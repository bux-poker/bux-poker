// Core Texas Hold'em mechanics (deck, dealing, turn progression).
// This is intentionally a thin engine; validation and persistence
// live in higher-level services.

export class TexasHoldem {
  constructor(config) {
    this.smallBlind = config.smallBlind ?? 10;
    this.bigBlind = config.bigBlind ?? 20;
  }

  createShuffledDeck() {
    const suits = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES"];
    const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    const deck = [];

    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank });
      }
    }

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  dealHoleCards(deck, playerCount) {
    const players = Array.from({ length: playerCount }, () => []);

    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < playerCount; i++) {
        players[i].push(deck.shift());
      }
    }

    return { deck, players };
  }

  dealFlop(deck) {
    deck.shift();
    const cards = deck.splice(0, 3);
    return { deck, cards };
  }

  dealTurnOrRiver(deck) {
    deck.shift();
    const [card] = deck.splice(0, 1);
    return { deck, card };
  }
}

