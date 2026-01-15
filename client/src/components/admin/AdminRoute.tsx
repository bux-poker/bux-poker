import { Navigate } from 'react-router-dom';
import { useAdmin } from '../../hooks/useAdmin';
import { useAuth } from '@shared/features/auth/AuthContext';

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth();
  const { isAdmin, loading } = useAdmin();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-red-200">Access Denied</h2>
          <p className="text-red-300">
            You don't have permission to access this page. Admin role required.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
