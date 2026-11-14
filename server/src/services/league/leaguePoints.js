/**
 * League points ladder from registration count at close (T-2m), per product spec.
 * @param {number} registrationCount - CONFIRMED count at registration close
 * @returns {number[]} points for 1st, 2nd, ... (empty if no game / cancelled tier)
 */
export function getLeaguePointsDistribution(registrationCount) {
  if (registrationCount < 5) return [];
  if (registrationCount === 5) return [3, 1];
  if (registrationCount <= 8) return [5, 3, 1];
  const k = Math.floor((registrationCount - 8) / 5);
  let arr = [5, 3, 1];
  for (let i = 0; i < k; i++) {
    arr = arr.map((x) => x + 2);
    arr.push(1);
  }
  return arr;
}

/**
 * Participation bonus from share of scheduled league games played.
 * Tiered (not cumulative): ≥80% → +10, else ≥50% → +5, else 0.
 * @param {number} gamesPlayed
 * @param {number} totalGames
 * @returns {number}
 */
export function getLeagueParticipationBonus(gamesPlayed, totalGames) {
  const played = Number(gamesPlayed) || 0;
  const total = Number(totalGames) || 0;
  if (played <= 0 || total <= 0) return 0;
  const ratio = played / total;
  if (ratio >= 0.8) return 10;
  if (ratio >= 0.5) return 5;
  return 0;
}
