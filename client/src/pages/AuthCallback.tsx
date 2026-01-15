import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@shared/features/auth/AuthContext';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      // Store token
      localStorage.setItem('sessionToken', token);

      // Fetch user profile
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
      fetch(`${apiBaseUrl}/api/auth/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            const userData = {
              ...data.user,
              isAuthenticated: true,
            };
            setUser(userData);
            localStorage.setItem('userData', JSON.stringify(userData));
            navigate('/admin');
          } else {
            navigate('/login?error=profile_fetch_failed');
          }
        })
        .catch((error) => {
          console.error('Profile fetch error:', error);
          navigate('/login?error=profile_fetch_failed');
        });
    } else {
      navigate('/login?error=no_token');
    }
  }, [searchParams, navigate, setUser]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4 text-lg font-semibold">Completing login...</div>
        <div className="text-sm text-slate-400">Please wait</div>
      </div>
    </div>
  );
}
