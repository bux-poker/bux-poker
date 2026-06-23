import assert from "node:assert/strict";
import {
  isFinalTablePhase,
  tournamentNeedsConsolidation,
} from "./tableBalanceTargets.js";

assert.equal(isFinalTablePhase(8, 8), true);
assert.equal(isFinalTablePhase(9, 8), false);
assert.equal(isFinalTablePhase(1, 8), false);

// 8 live in tournament but only 3 seated on ACTIVE tables (5 stranded off-table)
assert.equal(
  tournamentNeedsConsolidation([{ id: "g1", players: [1, 2, 3] }], 8, 8),
  true
);

// Final table: must be one table with all 8 — split across two tables is invalid
assert.equal(
  tournamentNeedsConsolidation(
    [
      { id: "g1", players: [1, 2, 3] },
      { id: "g2", players: [4, 5, 6, 7, 8] },
    ],
    8,
    8
  ),
  true
);

// Final table: single full table — OK
assert.equal(
  tournamentNeedsConsolidation(
    [{ id: "g1", players: [1, 2, 3, 4, 5, 6, 7, 8] }],
    8,
    8
  ),
  false
);

console.log("tableBalanceTargets.test.mjs: all passed");
