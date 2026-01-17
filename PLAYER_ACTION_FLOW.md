# Player Action Flow and Turn Order - Detailed Explanation

## Key Concepts

### Seat Numbering
- **Seats are numbered ANTICLOCKWISE** (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
- **Clockwise movement = DECREASING seat numbers** (e.g., 7 → 6 → 5 → 4 → 3 → 2 → 1 → 10 → 9 → 8 → 7)
- When wrapping: if seat < minSeat, wrap to maxSeat

### Example Table Layout (Anticlockwise Numbering)
```
        10    9
      8          7
    6              5
  4                  3
    2              1
```

Clockwise order: 1 → 10 → 9 → 8 → 7 → 6 → 5 → 4 → 3 → 2 → 1

---

## Hand Start Sequence

### 1. Dealer Assignment
- Randomly selected from active players
- Example: Dealer = Seat 7

### 2. Blind Posting (Clockwise from Dealer)
- **Small Blind (SB)**: Dealer - 1 (clockwise = decreasing)
  - If dealer = 7, SB = 6
  - If dealer = 1, SB = 10 (wraps)
- **Big Blind (BB)**: SB - 1 (clockwise = decreasing)
  - If SB = 6, BB = 5
  - If SB = 1, BB = 10 (wraps)

### 3. First to Act (UTG - Under The Gun)
- **UTG = BB - 1** (clockwise = decreasing)
  - If BB = 5, UTG = 4
  - If BB = 1, UTG = 10 (wraps)

### Example Hand Start
```
Dealer = Seat 7
SB = Seat 6 (posts 10 chips)
BB = Seat 5 (posts 20 chips)
UTG = Seat 4 (first to act)
```

---

## Turn Order Logic

### Who Gets the Turn?
A player gets the turn **ONLY IF**:
1. They are active (not FOLDED, not ELIMINATED)
2. Their `contribution < currentBet` (they haven't matched the current bet yet)

### Turn Rotation Algorithm
After each action, `moveToNextPlayer()`:
1. Starts from `currentSeat - 1` (next seat clockwise)
2. Wraps if below minSeat: goes to maxSeat
3. Checks each seat clockwise until finding a player who needs to act
4. Skips players who have already matched the bet (`contribution >= currentBet`)

### Example Turn Sequence (Preflop, No Raises)
```
Initial: BB = 20, currentBet = 20
Players: Seat 1 (contribution=0), Seat 4 (contribution=0), Seat 5 (contribution=20), Seat 6 (contribution=10)

Turn order:
1. UTG (Seat 4) - contribution=0 < 20 → ACTS (calls 20)
2. Seat 3 - contribution=0 < 20 → ACTS (calls 20)
3. Seat 2 - contribution=0 < 20 → ACTS (calls 20)
4. Seat 1 - contribution=0 < 20 → ACTS (calls 20)
5. Seat 10 - (if exists, contribution=0 < 20) → ACTS
... continues clockwise until all have matched
6. Seat 5 (BB) - contribution=20 = 20 → SKIPPED (already matched)
7. Seat 6 (SB) - contribution=10 < 20 → ACTS (calls 10 more)
8. No more players need to act → Betting round complete
```

---

## Player Actions

### 1. BET (First to Act, No Bet Yet)
- **When**: `currentBet = 0` (no one has bet yet)
- **Effect**: Sets new `currentBet = amount`, tracks `lastRaiseUserId`
- **Example**: UTG bets 50 → `currentBet = 50`, `lastRaiseUserId = UTG`

### 2. RAISE (Increase Existing Bet)
- **When**: `currentBet > 0` and player wants to increase it
- **Requirement**: Must raise by at least `minimumRaise` (usually = big blind)
- **Effect**: Sets new `currentBet = playerContribution + amount`, tracks `lastRaiseUserId`
- **Example**: Current bet = 50, player raises to 100 → `currentBet = 100`, `lastRaiseUserId = player`

### 3. CALL (Match Current Bet)
- **When**: `currentBet > 0` and player's contribution < currentBet
- **Effect**: Player's contribution = currentBet (matches the bet)
- **Example**: Current bet = 100, player has contributed 20 → calls 80 more

### 4. CHECK (No Bet to Match)
- **When**: `currentBet = 0` (no one has bet)
- **Effect**: No chips moved, player passes action
- **Note**: Only valid when there's no bet to call

### 5. FOLD (Give Up Hand)
- **When**: Player doesn't want to match the bet
- **Effect**: 
  - Player status = "FOLDED"
  - Hole cards cleared (hidden from view)
  - Player skipped in future turns

### 6. ALL_IN (Bet All Chips)
- **When**: Player wants to bet all remaining chips
- **Effect**: 
  - If `allInContribution > currentBet`: Acts as a raise, tracks `lastRaiseUserId`
  - If `allInContribution <= currentBet`: Acts as a call
  - Player chips = 0

---

## Betting Round Completion

### When is a Betting Round Complete?

A betting round completes when **ALL** of these are true:

1. **All active players have equal contributions** (or are all-in/folded)
   - Example: Everyone has contributed 100, or some folded

2. **If no one raised** (`lastRaiseUserId = null`):
   - Complete when `currentTurnUserId = null` (no player needs to act)
   - This means action has gone around to all players

3. **If someone raised** (`lastRaiseUserId != null`):
   - Complete when action has **passed the last raiser** (clockwise)
   - AND all contributions are equal
   - Example: Raiser at seat 3, action goes: 3 → 2 → 1 → 10 → 9 → 8 → 7 → 6 → 5 → 4
   - When we reach seat 4 (after passing 3), and all contributions equal → Complete

### Example: Betting Round with Raise
```
Initial: BB = 20, currentBet = 20, lastRaiseUserId = null

1. Seat 4 (UTG) - Raises to 50
   → currentBet = 50, lastRaiseUserId = Seat 4

2. Seat 3 - Calls 50 (contribution = 50)
3. Seat 2 - Calls 50 (contribution = 50)
4. Seat 1 - Calls 50 (contribution = 50)
5. Seat 10 - Calls 50 (contribution = 50)
6. Seat 9 - Calls 50 (contribution = 50)
7. Seat 8 - Calls 50 (contribution = 50)
8. Seat 7 (Dealer) - Calls 50 (contribution = 50)
9. Seat 6 (SB) - Calls 40 more (contribution = 50)
10. Seat 5 (BB) - Calls 30 more (contribution = 50)

Now: All contributions = 50, currentTurnUserId = Seat 4 (raiser)
→ Seat 4 acts (checks/calls/folds/raises)
→ If Seat 4 checks/calls: currentTurnUserId moves to Seat 3
→ When currentTurnUserId passes Seat 4 (e.g., at Seat 3), betting complete
```

---

## Post-Flop Betting Rounds

### After Flop/Turn/River
1. **Deal community cards** (flop = 3, turn = 1, river = 1)
2. **Reset betting round**:
   - `currentBet = 0`
   - `lastRaiseUserId = null`
   - All player contributions reset to 0 for this street
3. **First to act**: First active player **clockwise from dealer** (not BB)
   - Example: Dealer = 7, first active after dealer = 6 (clockwise = decreasing)

### Example Post-Flop Sequence
```
Dealer = Seat 7
Active players: Seat 1, 3, 4, 5, 6, 7

First to act on flop: Seat 6 (first active clockwise from dealer)
Turn order: 6 → 5 → 4 → 3 → 1 → 10 → 9 → 8 → 7 → 6
```

---

## Test Player Behavior

### Test Player Timer
- **3 seconds total** (no grace period)
- Auto-acts after 3 seconds

### Test Player Action Logic
- **30% Fold**
- **40% Call/Check** (if can check, checks; otherwise calls)
- **30% Bet/Raise** (minimum raise or half pot)

### Test Player Turn Flow
1. Timer starts (3 seconds)
2. After 3 seconds: `handleTestPlayerAction()` called
3. Action applied (fold/call/check/bet/raise)
4. Check if betting complete
5. If complete → advance to next street
6. If not complete → move to next player

---

## Common Issues and Fixes

### Issue: Turn Order Skipping Players
**Cause**: Player's contribution already matches current bet
**Fix**: `moveToNextPlayer()` correctly skips players with `contribution >= currentBet`

### Issue: Betting Round Ending Prematurely
**Cause**: `isBettingComplete()` returning true too early
**Fix**: Must check:
- All contributions equal
- If raise occurred, action must have passed the raiser
- `currentTurnUserId` must be null or past the raiser

### Issue: Turn Order Going Backwards
**Cause**: Incorrect seat number calculation
**Fix**: Clockwise = decreasing seat numbers (for anticlockwise seat numbering)

### Issue: Players Acting Multiple Times
**Cause**: Not tracking who needs to act
**Fix**: Only give turn to players with `contribution < currentBet`

---

## Debug Logging

The code includes extensive logging:
- `[POKER] Turn rotation from seat X`: Shows current seat and active seats
- `[POKER] Turn rotation: seat X → seat Y`: Shows turn movement
- `[BETTING] Check: lastRaiser=seatX, current=seatY`: Shows betting completion check
- `[POKER] Test player X decided to ACTION`: Shows test player decisions

---

## Summary Flow Diagram

```
HAND START
  ↓
Assign Dealer (random)
  ↓
Post Blinds (SB = dealer-1, BB = SB-1)
  ↓
Set UTG (BB-1) as first to act
  ↓
START BETTING ROUND
  ↓
Player Acts (BET/CALL/CHECK/FOLD/RAISE/ALL_IN)
  ↓
Update contribution, currentBet, lastRaiseUserId
  ↓
Check: Betting Complete?
  ├─ NO → moveToNextPlayer() → Find next player who needs to act
  │         ↓
  │       Player Acts (repeat)
  │
  └─ YES → advanceToNextStreet()
            ↓
          Deal Community Cards (if not river)
            ↓
          Reset Betting Round
            ↓
          Set First to Act (clockwise from dealer)
            ↓
          START BETTING ROUND (repeat until river complete)
            ↓
          SHOWDOWN (determine winner)
```

---

## Example Full Hand Flow

### Preflop
```
Dealer = 7, SB = 6, BB = 5, UTG = 4

Turn 1: Seat 4 (UTG) - Raises to 50
  → currentBet = 50, lastRaiseUserId = 4

Turn 2: Seat 3 - Calls 50
Turn 3: Seat 2 - Calls 50
Turn 4: Seat 1 - Folds
Turn 5: Seat 10 - Calls 50
Turn 6: Seat 9 - Calls 50
Turn 7: Seat 8 - Calls 50
Turn 8: Seat 7 (Dealer) - Calls 50
Turn 9: Seat 6 (SB) - Calls 40 more (had 10)
Turn 10: Seat 5 (BB) - Calls 30 more (had 20)
Turn 11: Seat 4 (Raiser) - Checks (all matched)
  → Action passes to Seat 3
  → Betting complete (all equal, passed raiser)

Deal Flop (3 cards)
```

### Flop
```
First to act: Seat 6 (first active clockwise from dealer 7)

Turn 1: Seat 6 - Checks (currentBet = 0)
Turn 2: Seat 5 - Checks
Turn 3: Seat 4 - Checks
Turn 4: Seat 3 - Checks
Turn 5: Seat 2 - Checks
Turn 6: Seat 10 - Checks
Turn 7: Seat 9 - Checks
Turn 8: Seat 8 - Checks
Turn 9: Seat 7 (Dealer) - Checks
  → All checked, no bet → Betting complete

Deal Turn (1 card)
```

### Turn
```
First to act: Seat 6

Turn 1: Seat 6 - Bets 100
  → currentBet = 100, lastRaiseUserId = 6

Turn 2: Seat 5 - Calls 100
Turn 3: Seat 4 - Folds
Turn 4: Seat 3 - Calls 100
Turn 5: Seat 2 - Calls 100
Turn 6: Seat 10 - Calls 100
Turn 7: Seat 9 - Calls 100
Turn 8: Seat 8 - Calls 100
Turn 9: Seat 7 (Dealer) - Calls 100
Turn 10: Seat 6 (Raiser) - Checks
  → Action passes to Seat 5
  → Betting complete

Deal River (1 card)
```

### River
```
First to act: Seat 6

Turn 1: Seat 6 - Checks
Turn 2: Seat 5 - Checks
Turn 3: Seat 3 - Checks
Turn 4: Seat 2 - Checks
Turn 5: Seat 10 - Checks
Turn 6: Seat 9 - Checks
Turn 7: Seat 8 - Checks
Turn 8: Seat 7 (Dealer) - Checks
  → All checked → Betting complete

SHOWDOWN
  → Compare hands, determine winner
```

---

This document explains the complete flow of player actions and turn order in the poker game.
