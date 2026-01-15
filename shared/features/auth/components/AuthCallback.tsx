import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import axios from 'axios';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();

  useEffect(() => {
    const fetchUserProfile = async (token: string) => {
      try {
        console.log('Fetching profile with token:', token);
        const response = await axios.get('/api/auth/profile', {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        });
        
        if (response.data?.user) {
          console.log('Login successful:', response.data);
          const userData = {
            ...response.data.user,
            sessionToken: token
          };
          setUser(userData);
          
          // Try to store user data in localStorage, but handle quota exceeded error
          try {
            localStorage.setItem('userData', JSON.stringify(userData));
          } catch (storageError) {
            console.warn('Failed to store user data in localStorage (quota exceeded):', storageError);
            // Clear localStorage and try again
            try {
              localStorage.clear();
              localStorage.setItem('userData', JSON.stringify(userData));
            } catch (retryError) {
              console.error('Failed to store user data even after clearing localStorage:', retryError);
              // Try storing just essential data
              try {
                const essentialData = {
                  id: userData.id,
                  username: userData.username,
                  sessionToken: userData.sessionToken
                };
                localStorage.setItem('userData', JSON.stringify(essentialData));
              } catch (finalError) {
                console.error('Failed to store even essential user data:', finalError);
                // Continue without storing - the user is still logged in via sessionToken
              }
            }
          }
          
          // Check if user has an active game
          if (response.data.activeGame) {
            console.log('User has active game, redirecting to game table:', response.data.activeGame);
            navigate(`/table/${response.data.activeGame.id}`, { replace: true });
          } else {
            console.log('No active game, redirecting to lobby');
            navigate('/', { replace: true });
          }
        } else {
          console.error('Invalid profile response:', response.data);
          localStorage.removeItem('sessionToken');
          navigate('/login', { replace: true });
        }
      } catch (error: any) {
        console.error('Error fetching profile after login:', error);
        localStorage.removeItem('sessionToken');
        navigate('/login', { replace: true });
      }
    };

    const token = searchParams.get('token');
    if (token) {
      console.log('Callback received token:', token);
      
      // Store the JWT token in localStorage
      try {
        localStorage.setItem('sessionToken', token);
      } catch (storageError) {
        console.warn('Failed to store session token in localStorage (quota exceeded):', storageError);
        // Clear localStorage and try again
        try {
          localStorage.clear();
          localStorage.setItem('sessionToken', token);
        } catch (retryError) {
          console.error('Failed to store session token even after clearing localStorage:', retryError);
          // Continue without storing - the user can still use the token for this session
        }
      }
      
      fetchUserProfile(token);
    } else {
      console.error('No token received from callback');
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-slate-200">Completing login...</h2>
        <p className="mt-2 text-slate-400">Please wait while we redirect you.</p>
      </div>
    </div>
  );
};

export default AuthCallback; 