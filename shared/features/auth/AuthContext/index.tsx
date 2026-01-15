import React, { createContext, useContext, useEffect } from 'react';
import { useUserState } from './hooks/useUserState';
import { useAuthMethods } from './hooks/useAuthMethods';
import { useProfileManagement } from './hooks/useProfileManagement';

interface User {
  id: string;
  username: string;
  email: string;
  avatar: string | null;
  avatarUrl?: string; // Support both avatar and avatarUrl properties
  discordId?: string; // Discord ID for admin authentication
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

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  setUser: (user: User | null) => void;
  login: (username: string, password: string) => Promise<{ activeGame?: { id: string; status: string } }>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  updateProfile: (username: string, avatarUrl: string) => Promise<void>;
  updateSoundPreference: (soundEnabled: boolean) => void;
  showSessionInvalidatedModal: boolean;
  setShowSessionInvalidatedModal: (show: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    user,
    setUser,
    loading,
    setLoading,
    error,
    setError,
    showSessionInvalidatedModal,
    setShowSessionInvalidatedModal
  } = useUserState();

  const { fetchProfile, login, register, logout } = useAuthMethods({
    setUser,
    setError,
    setLoading
  });

  const { updateProfile, updateSoundPreference } = useProfileManagement({
    user,
    setUser,
    setError
  });

  // Initialize auth state
  useEffect(() => {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      // First try to load user data from localStorage for immediate display
      try {
        const userData = localStorage.getItem('userData');
        if (userData) {
          const parsedUserData = JSON.parse(userData);
          // Handle both nested and flat user data structures
          const user = parsedUserData.user ? parsedUserData.user : parsedUserData;
          if (user && user.id) {
            setUser(user);
          }
        }
      } catch (error) {
        console.warn('Failed to load user data from localStorage:', error);
      }
      
      // Then fetch fresh data from API
      fetchProfile();
    } else {
      setLoading(false);
    }
  }, [fetchProfile, setLoading, setUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        setUser,
        login,
        register,
        logout,
        updateProfile,
        updateSoundPreference,
        showSessionInvalidatedModal,
        setShowSessionInvalidatedModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
