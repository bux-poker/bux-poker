// Admin utility functions
// Checks if a user is an admin based on their Discord ID

const ADMIN_DISCORD_IDS = import.meta.env.VITE_ADMIN_DISCORD_IDS?.split(',') || [];

/**
 * Check if a user is an admin
 * @param discordId - The user's Discord ID
 * @returns true if user is an admin
 */
export const isAdmin = (discordId: string | undefined | null): boolean => {
  if (!discordId) return false;
  return ADMIN_DISCORD_IDS.includes(discordId);
};

/**
 * Get the list of admin Discord IDs
 * @returns Array of admin Discord IDs
 */
export const getAdminIds = (): string[] => {
  return ADMIN_DISCORD_IDS;
};

