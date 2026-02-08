# Code Review: Tournament Implementation vs Robert's Rules of Poker

This document compares the bux-poker implementation against **Robert's Rules of Poker** (Bob Ciaffone) and identifies errors, inconsistencies, and pitfalls preventing full tournament completion.

---

## CRITICAL BUGS (Blocking Full Tournaments)

### 1. **ensureHandState Uses Wrong Blinds and Is Broken**
**Rule:** Blinds must match tournament level.

**Location:** `server/src/modules/socket-handlers/pokerHandler.js:147-203`

**Issue:** `ensureHandState()` is a fallback called only from `applyPlayerAction` when no state exists. It uses the global `engine` with hardcoded 10/20 blinds:
```javascript
const engine = new TexasHoldem({ smallBlind: 10, bigBlind: 20 });  // Line 11 - global
// ...
const bettingRound = new BettingRound({
  smallBlind: engine.smallBlind,   // Always 10/20
  bigBlind: engine.bigBlind,
});
```
- Never posts blinds, sets dealer, or UTG
- Deals to `game.players` without filtering ELIMINATED
- Would create a corrupt hand if ever triggered (e.g., race on action before `startHandForGame` completes)

**Fix:** Remove or refactor; if kept, must fetch game/tournament blinds and properly initialize.

---

### 2. **Side Pot Contributions Bug: Wrong Initial Values**
**Rule:** "Each side pot must be awarded separately. Only players who contributed to a given side pot are eligible to win it."

**Location:** `server/src/modules/socket-handlers/pokerHandler.js:1052`

**Issue:** Initial `player.contributions` uses **nominal** blinds instead of **actual** amounts posted:
```javascript
contributions: (p.id === sbPlayer.id ? smallBlind : 0) + (p.id === bbPlayer.id ? bigBlind : 0),
```
When a player has insufficient chips (e.g., SB has 5 chips, smallBlind is 25), they post 5 but we record 25. This corrupts side pot calculation and can misallocate chips.

**Fix:** Use `sbAmount` and `bbAmount` (the actual posted amounts).

---

### 3. **Two+ Players Bust Same Hand: Wrong Finishing Order**
**Rule:** *"If two (or more) players go broke during the same hand, the player starting the hand with the larger amount of money finishes in the higher tournament place."*

**Location:** `server/src/services/TournamentEngine.js:578-597` (`onPlayersBust` / `_markPlayerBust`)

**Issue:** `finishingPlace` is set as `remaining + 1` for each busted player. When multiple players bust in the same hand, they get the **same** `finishingPlace` because `remaining` is recalculated after each update. Robert's Rules require the player who had **more chips at the start of the hand** to get the better (lower) place.

**Fix:** Sort `playerIds` by starting stack (at hand start) descending before assigning places; assign places in that order.

---

### 4. **Table Balance Rule for 7+ Tables**
**Rule:** *"With more than six tables, table size is kept within two players. With six tables or fewer, table size is kept within one."*

**Location:** `server/src/services/TournamentEngine.js:457-458`

**Issue:** Consolidation always requires `spread <= 1`:
```javascript
if (games.length <= tablesNeeded && spread <= 1) {
```
For 7+ tables, a spread of 2 is acceptable per rules. Current code may over-consolidate or fail to skip when it should.

**Fix:** `spread <= (games.length > 6 ? 2 : 1)`.

---

## RULES COMPLIANCE GAPS

### 5. **Initial Dealer Button: High-Card Deal**
**Rule:** *"In all tournament games using a dealer button, the starting position of the button is determined by dealing for the high card."*

**Current:** First-hand dealer is assigned randomly (`Math.floor(Math.random() * activePlayersForDealer.length)`).

**Impact:** Minor; random is fair but not strictly rule-compliant.

---

### 6. **New Blinds Apply on Next Deal**
**Rule:** *"If there is a signal designating the end of a betting level, the new limits apply on the next deal. (A deal begins with the first riffle of the shuffle.)"*

**Current:** Blind levels advance based on elapsed time and are synced to games. It's unclear whether a hand already in progress keeps old blinds or if the sync can mid-hand change them.

**Recommendation:** Ensure new blind levels apply only when starting the **next** hand, not during an active hand.

---

### 7. **Redraw at 3, 2, and 1 Table**
**Rule:** *"In all events, there is a redraw for seating when the field is reduced to three tables, two tables, and one table."*

**Current:** Consolidation redistributes players randomly across remaining tables but does not explicitly perform a "redraw" (reseat by draw) at those milestones. The behavior may be equivalent in effect; worth verifying.

---

### 8. **Absent Players**
**Rule:** *"An absent player is always dealt a hand, and is put up for blinds, antes, and the forced bet if low."*

**Current:** No explicit handling of absent/disconnected players; turn timers may auto-fold. Need to confirm whether absent players are dealt in and charged blinds.

---

## OTHER INCONSISTENCIES

### 9. **Consolidation Transaction: Redundant Delete**
**Location:** `server/src/services/TournamentEngine.js:479-499`

The transaction deletes all players by id, then runs `deleteMany` per assignment `gameId`. After the first loop, those rows are already gone, so `deleteMany` is redundant. Harmless but noisy.

---

### 10. **Prize Places Calculation**
**Location:** `TournamentEngine.js:137`, `TournamentService.js:176`

Prize places use `Math.floor(registeredCount / 4)`. This is a design choice, not a rules violation, but may differ from typical payout structures (e.g., top 10–15%).

---

## FIX PRIORITY

| Priority | Issue                         | Impact                                  |
|----------|-------------------------------|-----------------------------------------|
| P0       | ensureHandState broken        | Corrupt hand if fallback triggers       |
| P0       | Contributions (sbAmount/bbAmount) | Wrong side pots, chip leaks        |
| P0       | Bust order (starting stack)   | Incorrect finishing places              |
| P1       | Table balance 7+ tables       | Over-consolidation or incorrect balance |
| P2       | Initial dealer (high card)    | Rule compliance                         |
| P2       | New blinds on next deal       | Rule compliance                         |

---

## FIXES APPLIED

1. **ensureHandState:** Now throws immediately instead of creating corrupt state. Fail-fast so client can retry.
2. **contributions:** Replaced `smallBlind`/`bigBlind` with `sbAmount`/`bbAmount` at state creation.
3. **Bust order:** Sort busted players by starting stack (total contribution) descending; assign places in that order per Robert's Rules.
4. **Table balance:** Use `maxSpread = games.length > 6 ? 2 : 1` in consolidation skip logic, idle poll, and showdown consolidation check.
