import { useCallback } from 'react';
import axios from './AxiosConfig';

interface User {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  coins: number;
  isAuthenticated?: boolean;
  stats?: {
    gamesPlayed: number;
    gamesWon: number;
    nilsBid: number;
    nilsMade: number;
    blindNilsBid: number;
    blindNilsMade: number;
  };
}

interface UseAuthMethodsProps {
  setUser: (user: User | null) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthMethods = ({ setUser, setError, setLoading }: UseAuthMethodsProps) => {
  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await axios.get('/api/auth/profile', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.data) {
        // Handle both nested and flat user data structures
        const userData = response.data.user ? response.data.user : response.data;
        const finalUserData = {
          ...userData,
          isAuthenticated: true
        };
        setUser(finalUserData);
        
        // Store user data in localStorage
        try {
          localStorage.setItem('userData', JSON.stringify(finalUserData));
        } catch (storageError) {
          console.warn('Failed to store user data in localStorage:', storageError);
        }
      }
    } catch (error: any) {
      console.error('Profile fetch error:', error);
      if (error.response?.status === 401) {
        // Token is invalid, clear it
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('userData');
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [setUser, setLoading]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      setError(null);
      console.log('Attempting login with:', { username });
      const response = await axios.post(
        '/api/auth/login',
        { username, password },
        {
          withCredentials: true
        }
      );

      if (response.data?.user && response.data?.token) {
        console.log('Login successful:', response.data);
        const userData = {
          ...response.data.user,
          isAuthenticated: true
        };
        setUser(userData);
        
        // Store the JWT token
        localStorage.setItem('sessionToken', response.data.token);
        
        // Try to store user data in localStorage, but handle quota exceeded error
        try {
          localStorage.setItem('userData', JSON.stringify(userData));
        } catch (storageError) {
          console.warn('Failed to store user data in localStorage (quota exceeded):', storageError);
          // Clear some old data and try again
          try {
            localStorage.clear();
            localStorage.setItem('userData', JSON.stringify(userData));
            localStorage.setItem('sessionToken', response.data.token);
          } catch (retryError) {
            console.error('Failed to store user data even after clearing localStorage:', retryError);
            // Continue without storing - the user is still logged in via session
          }
        }

        return { activeGame: response.data.activeGame };
      } else {
        throw new Error('Invalid login response');
      }
    } catch (error: any) {
      console.error('Login error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Login failed';
      setError(errorMessage);
      throw error;
    }
  }, [setUser, setError]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    try {
      setError(null);
      console.log('Attempting registration with:', { username, email });
      const response = await axios.post('/api/auth/register', {
        username,
        email,
        password
      });

      if (response.data?.user && response.data?.token) {
        console.log('Registration successful:', response.data);
        const userData = {
          ...response.data.user,
          isAuthenticated: true
        };
        setUser(userData);
        
        // Store the JWT token
        localStorage.setItem('sessionToken', response.data.token);
        localStorage.setItem('userData', JSON.stringify(userData));
      } else {
        throw new Error('Invalid registration response');
      }
    } catch (error: any) {
      console.error('Registration error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Registration failed';
      setError(errorMessage);
      throw error;
    }
  }, [setUser, setError]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('userData');
  }, [setUser]);

  return {
    fetchProfile,
    login,
    register,
    logout
  };
};
