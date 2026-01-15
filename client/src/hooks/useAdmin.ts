import { useState, useEffect } from 'react';
import { useAuth } from '@shared/features/auth/AuthContext';
import api from '../services/api';

export function useAdmin() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem('sessionToken');
        if (!token) {
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        const response = await api.get('/api/admin/check', {
          headers: { Authorization: `Bearer ${token}` },
        });

        setIsAdmin(response.data?.isAdmin || false);
      } catch (error: any) {
        // User is not an admin or not authenticated
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    checkAdmin();
  }, [user]);

  return { isAdmin, loading };
}
