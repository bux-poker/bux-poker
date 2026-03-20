# Module map & refactor queue

Line counts are **non-blank lines** (approximate). Use `wc -l <file>` for raw lines.

## Client — largest files (refactor first)

| File | ~lines | Suggested split (purpose-named modules) |
|------|--------|----------------------------------------|
| `features/game/PokerGameView.tsx` | ~1100+ | **Done (phase 1):** `pokerGameViewTypes.ts`, `parseCommunityCards.ts`, `handBlocksConsolidationWaitOverlay.ts`. **Next:** `usePokerGameSocket.ts`, blind timer helpers, `PokerGameViewLayout.tsx`. |
| `components/tournament/TournamentLobby.tsx` | 885+ | `useTournamentLobbyState.ts`, `TournamentLobbyHeader.tsx`, `TournamentLobbyTableList.tsx`, `tournamentLobbyFormatters.ts` |
| `components/poker/PokerTable.tsx` | ~670 (after split) | **Done (phase 1):** `table/BetChip.tsx`, `table/PokerCardImage.tsx`, `table/formatHandCategory.ts`, `table/pokerTableConstants.ts`, `table/pokerTableTypes.ts`, `table/pokerTableActionOverlayUtils.ts`, `table/usePokerTableActionOverlays.ts`. **Next:** corner HUD, community row, seat renderer. |
| `components/admin/CreateTournament.tsx` | 516+ | Form sections per step + `createTournamentSchema.ts` |
| `components/tournament/TournamentList.tsx` | 481+ | Row/card components + `useTournamentListFilters.ts` |
| `components/tournament/TournamentLobbyModal.tsx` | 396+ | Modal frame vs tab content components |
| `components/poker/BettingControls.tsx` | 328+ | `bettingControlsDerived.ts` (min/max math), `BettingSlider.tsx`, `PresetBetButtons.tsx` |

Shared types already live under `shared/` — prefer **importing** `Player`, `Card`, evaluators from there instead of duplicating interfaces in views.

## Server — largest files (refactor first)

| File | ~lines | Suggested split |
|------|--------|-----------------|
| `discord/bot.js` | 809+ | `discord/embeds/*.js`, `discord/commands/*.js`, `discord/clientSetup.js` |
| `routes/admin.js` | 490+ | One route file per resource (`adminTournaments.js`, `adminUsers.js`, …) mounted from `routes/admin/index.js` |
| `modules/poker/showdown.js` | 474+ | `showdownSidePots.js`, `showdownDistribution.js`, `showdownEmit.js` |
| `modules/poker/startHand.js` | 432+ | `startHandBlinds.js`, `startHandDeal.js`, `startHandPersist.js` |
| `modules/poker/advanceStreet.js` | 430+ | `advanceStreetBettingComplete.js`, `advanceStreetRunout.js` |
| `modules/poker/testPlayers.js` | 385+ | `testPlayerTimers.js`, `testPlayerActions.js` |
| `modules/poker/turnOrder.js` | 383+ | `turnOrderBettingComplete.js`, `turnOrderNextActor.js` |
| `services/tournament/consolidateTables.js` | 345+ | `consolidationWaitForHands.js`, `consolidationRebalance.js`, `consolidationClearState.js` (already partially logical) |
| `modules/poker/actions.js` | 309+ | One file per action family: `actionFold.js`, `actionBetRaise.js`, `actionCheckCall.js` re-exported from `actions.js` |
| `modules/poker/BettingRound.js` | 299+ | `BettingRoundContributions.js`, `BettingRoundSidePots.js` (class stays thin) |
| `services/TournamentService.js` | 300+ | CRUD vs “running tournament” orchestration split |

## Duplicate / conflict surfaces (review when debugging)

1. **Hand active detection** — `tableState.hasActiveHand` (memory) vs **DB `game.pot > 0`** (consolidation guard). Both must agree during tournament ops; mismatches caused past chip/consolidation bugs.
2. **Tournament completion** — `completeIfOneLeft.js` vs `busts.js` both complete + audit/reconcile chips; keep behavior aligned.
3. **Player cleanup** — `safeHandCleanupDb.js` + `handCleanup.js` + showdown/advance paths; ensure eliminated players are never reset to `ACTIVE`.
4. **Stale pot** — `stalePotRecovery.js` vs normal showdown/zero pot; idle poll must not fight consolidation (`isTournamentConsolidationWaiting`).
5. **Eval / hand text** — `@shared/utils/handEvaluator` on client; `HandEvaluator.js` on server — keep rule parity (document differences if any).

## Naming convention for new modules

- **Verb phrase** for orchestrators: `startHandDeal.js`, `waitForConsolidationHands.js`
- **Noun + role** for data/helpers: `gameStateTypes.ts`, `bettingControlsDerived.ts`
- **One default export** only for React components; pure helpers use named exports
