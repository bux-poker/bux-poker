# Tournament flow checklist (pre-event)

## Flow summary
1. **Registration** → Close registration (seats players into balanced tables).
2. **Start** → 2‑min countdown, then status RUNNING; hands start for each table (2+ players).
3. **Play** → Blinds advance by time; eliminations mark ELIMINATED; when a table has &lt;2 ACTIVE players or tables are uneven, consolidation runs.
4. **Consolidation** → Waits for all tables to finish current hand; closes emptiest tables first; clears in‑memory state for all ACTIVE games; deletes/recreates players at remaining tables; starts hands on kept tables; emits `tournament_updated` (clients refetch and redirect if their table changed).
5. **End** → When 1 player remains (ACTIVE, chips &gt; 0), tournament set COMPLETED; `tournament_completed` broadcast to all clients.

## Fixes applied (full audit)
- **Consolidation**: Close tables with fewest players first (keep tables that have players). Clear state for all ACTIVE game IDs (including tables we close). Remove ELIMINATED players from target games before recreating seats (avoids unique constraint on `(gameId, seatNumber)`).
- **Showdown**: Chip updates ignore P2025 (record not found) when a player was already removed by consolidation. Same for elimination and reset updates.
- **Remaining count**: Tournament winner/remaining uses `status: "ACTIVE"` and `chips > 0`.
- **Tournament completed**: Emit `tournament_completed` with `io.emit()` so all clients (including winner on another table) see it.
- **startHandForGame**: Return early if `game.status !== "ACTIVE"` (no hands on COMPLETED games).
- **Lobby**: Tables tab shows only ACTIVE games; player count/list per table excludes ELIMINATED.

## Before first tournament
- [ ] Run migrations if schema changed.
- [ ] Confirm blind levels and start time in tournament config.
- [ ] Close registration only when ready; then start tournament (2‑min countdown).
- [ ] If something breaks: check server logs for `[TOURNAMENT]` and `[SHOWDOWN]`; clients should refetch on `tournament_updated` and redirect to new table when moved.
