import { useAuth } from '@shared/features/auth/AuthContext';

/**
 * Admin flag comes from GET /api/auth/profile (`user.isAdmin`) — same logic as /api/admin/check.
 * Avoids a second cross-origin request, CORS edge cases, and races with the auth bootstrap.
 */
export function useAdmin() {
  const { user, loading } = useAuth();

  return {
    isAdmin: user?.isAdmin === true,
    loading,
  };
}
