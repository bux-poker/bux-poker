import assert from "node:assert/strict";
import {
  buildAwardableSidePots,
  computePotLayerPreview,
} from "./sidePotMath.js";

function mapContribs(entries) {
  return new Map(entries);
}

// Scenario A: P1=1000 all-in, P2=700 call, P3 fold (0 contrib)
{
  const contribs = mapContribs([
    ["p1", 1000],
    ["p2", 700],
    ["p3", 0],
  ]);
  const nonFolded = new Set(["p1", "p2"]);
  const { awardablePots, uncalledReturns } = buildAwardableSidePots(
    contribs,
    nonFolded
  );
  assert.equal(uncalledReturns.get("p1"), 300);
  assert.equal(awardablePots.length, 1);
  assert.equal(awardablePots[0].amount, 1400);
  const awardableTotal =
    awardablePots.reduce((s, p) => s + p.amount, 0) +
    [...uncalledReturns.values()].reduce((a, b) => a + b, 0);
  assert.equal(awardableTotal, 1700);
}

// Scenario B: P1=1000, P2=700, P3=500 all call
{
  const contribs = mapContribs([
    ["p1", 1000],
    ["p2", 700],
    ["p3", 500],
  ]);
  const nonFolded = new Set(["p1", "p2", "p3"]);
  const { awardablePots, uncalledReturns } = buildAwardableSidePots(
    contribs,
    nonFolded
  );
  assert.equal(uncalledReturns.get("p1"), 300);
  assert.equal(awardablePots.length, 2);
  assert.equal(awardablePots[0].amount, 1500);
  assert.equal(awardablePots[1].amount, 400);
}

// Preview: uncalled subtracted from displayed total pot
{
  const state = {
    pot: 0,
    bettingRound: {
      getTotalPot: () => 1700,
      getPlayerContribution: (id) =>
        ({ p1: 1000, p2: 700, p3: 0 })[id] || 0,
    },
    players: [
      { id: "p1", status: "ALL_IN", contributions: 0, chips: 0 },
      { id: "p2", status: "ACTIVE", contributions: 0, chips: 0 },
      { id: "p3", status: "FOLDED", contributions: 0, chips: 500 },
    ],
  };
  const preview = computePotLayerPreview(state);
  assert.equal(preview.totalPot, 1400);
  assert.equal(preview.sidePots[0].amount, 1400);
  assert.equal(preview.uncalledReturns[0].amount, 300);
  assert.equal(preview.showPotBreakdown, false);
}

// Raise in progress (50 vs 100) with no all-in — no side-pot UI
{
  const contribs = { p1: 100, p2: 100, p3: 100, p4: 50, p5: 50, p6: 50 };
  const state = {
    pot: 0,
    bettingRound: {
      getTotalPot: () => 450,
      getPlayerContribution: (id) => contribs[id] || 0,
    },
    players: Object.entries(contribs).map(([id, c]) => ({
      id,
      status: "ACTIVE",
      contributions: 0,
      chips: 1000 - c,
    })),
  };
  const preview = computePotLayerPreview(state);
  assert.equal(preview.showPotBreakdown, false);
  assert.equal(preview.totalPot, 450);
}

// All-in with side pot — show breakdown
{
  const state = {
    pot: 0,
    bettingRound: {
      getTotalPot: () => 2200,
      getPlayerContribution: (id) =>
        ({ p1: 1000, p2: 700, p3: 500 })[id] || 0,
    },
    players: [
      { id: "p1", status: "ALL_IN", contributions: 0, chips: 0 },
      { id: "p2", status: "ALL_IN", contributions: 0, chips: 0 },
      { id: "p3", status: "ALL_IN", contributions: 0, chips: 0 },
    ],
  };
  const preview = computePotLayerPreview(state);
  assert.equal(preview.showPotBreakdown, true);
  assert.equal(preview.sidePots.length, 2);
}

console.log("sidePotMath tests passed");
