import { useState, useEffect } from 'react';

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

export const useUserState = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSessionInvalidatedModal, setShowSessionInvalidatedModal] = useState(false);

  // Listen for session invalidation events
  useEffect(() => {
    const handleSessionInvalidated = (event: CustomEvent) => {
      console.log('Session invalidated event received:', event.detail);
      setShowSessionInvalidatedModal(true);
      // Clear user data
      setUser(null);
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('userData');
    };

    window.addEventListener('sessionInvalidated', handleSessionInvalidated as EventListener);
    
    return () => {
      window.removeEventListener('sessionInvalidated', handleSessionInvalidated as EventListener);
    };
  }, []);

  return {
    user,
    setUser,
    loading,
    setLoading,
    error,
    setError,
    showSessionInvalidatedModal,
    setShowSessionInvalidatedModal
  };
};
