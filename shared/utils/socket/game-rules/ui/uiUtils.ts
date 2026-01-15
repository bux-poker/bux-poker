/**
 * Gets the player color for Solo mode
 */
export function getPlayerColor(playerIndex: number): { bg: string; text: string; name: string } {
  const colors = [
    { bg: 'bg-red-500', text: 'text-red-500', name: 'Red' },
    { bg: 'bg-blue-500', text: 'text-blue-500', name: 'Blue' },
    { bg: 'bg-orange-500', text: 'text-orange-500', name: 'Orange' },
    { bg: 'bg-green-500', text: 'text-green-500', name: 'Green' }
  ];
  
  return colors[playerIndex] || colors[0];
}
