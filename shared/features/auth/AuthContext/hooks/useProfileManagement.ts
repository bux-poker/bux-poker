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

interface UseProfileManagementProps {
  user: User | null;
  setUser: (user: User | null) => void;
  setError: (error: string | null) => void;
}

export const useProfileManagement = ({ user, setUser, setError }: UseProfileManagementProps) => {
  const updateProfile = useCallback(async (username: string, avatarUrl: string) => {
    try {
      setError(null);
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const response = await axios.put(
        '/api/auth/profile',
        { username, avatar: avatarUrl },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (response.data) {
        const updatedUser = {
          ...user,
          username: response.data.username || username,
          avatar: response.data.avatar || avatarUrl
        };
        setUser(updatedUser as User);
        
        // Update localStorage
        try {
          localStorage.setItem('userData', JSON.stringify(updatedUser));
        } catch (storageError) {
          console.warn('Failed to update user data in localStorage:', storageError);
        }
      }
    } catch (error: any) {
      console.error('Profile update error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Profile update failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [user, setUser, setError]);

  const updateSoundPreference = useCallback((soundEnabled: boolean) => {
    if (user) {
      const updatedUser = { ...user, soundEnabled };
      setUser(updatedUser);
      
      // Update localStorage immediately for instant feedback
      try {
        const userData = localStorage.getItem("userData");
        if (userData) {
          const parsedUserData = JSON.parse(userData);
          const updatedUserData = { ...parsedUserData, soundEnabled };
          localStorage.setItem("userData", JSON.stringify(updatedUserData));
        }
      } catch (error) {
        console.error("Failed to update sound preference in localStorage:", error);
      }
    }
  }, [user, setUser]);

  return {
    updateProfile,
    updateSoundPreference
  };
};
