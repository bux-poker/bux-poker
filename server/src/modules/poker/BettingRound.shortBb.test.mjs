import assert from "node:assert/strict";
import { BettingRound } from "./BettingRound.js";

/** Short BB must not lower the call line below the full big blind. */
{
  const round = new BettingRound({ smallBlind: 50, bigBlind: 100 });
  round.postBlinds("sb", "bb", 50, 30);
  assert.equal(round.currentBet, 100, "currentBet stays full BB");
  assert.equal(round.getPlayerContribution("bb"), 30);
  assert.equal(round.call("utg", 5000), 100, "UTG must put in full BB");
}

/** Covered all-in call still uses currentBet line after a short BB post. */
{
  const round = new BettingRound({ smallBlind: 50, bigBlind: 100 });
  round.postBlinds("sb", "bb", 50, 30);
  const spent = round.call("sb", 5000);
  assert.equal(spent, 50, "SB completes to full BB");
  assert.equal(round.getPlayerContribution("sb"), 100);
}

console.log("BettingRound.shortBb.test.mjs: ok");
