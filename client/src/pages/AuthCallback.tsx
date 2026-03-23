import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@shared/features/auth/AuthContext';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchProfile } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/login?error=no_token', { replace: true });
      return;
    }

    localStorage.setItem('sessionToken', token);

    void fetchProfile().then((user) => {
      if (user) {
        navigate(user.isAdmin ? '/admin' : '/tournaments', { replace: true });
      } else {
        navigate('/login?error=profile_fetch_failed', { replace: true });
      }
    });
  }, [searchParams, navigate, fetchProfile]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-lg font-semibold">Completing login...</div>
        <div className="text-sm text-slate-400">Please wait</div>
      </div>
    </div>
  );
}
