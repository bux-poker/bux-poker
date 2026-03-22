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
