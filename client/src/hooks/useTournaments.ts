import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import axios from 'axios';

export interface TournamentServer {
  id: string;
  serverId: string;
  serverName: string;
  inviteLink: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  startTime: Date | string;
  startedAt?: Date | string | null; // Actual start time when tournament starts
  status: 'UPCOMING' | 'REGISTRATION' | 'ACTIVE' | 'COMPLETED' | 'SCHEDULED' | 'CANCELLED' | 'REGISTERING' | 'SEATED' | 'RUNNING';
  maxPlayers: number;
  seatsPerTable: number;
  startingChips: number;
  blindLevels: any; // JSON structure
  prizePlaces: number;
  registeredCount?: number;
  createdBy: string | any;
  createdAt: Date | string;
  servers?: TournamentServer[];
}

export function useTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        setLoading(true);
        const response = await api.get('/api/tournaments');
        setTournaments(response.data);
        setError(null);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch tournaments');
        console.error('Error fetching tournaments:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTournaments();
  }, []);

  return { tournaments, loading, error, refetch: () => {
    const fetchTournaments = async () => {
      try {
        setLoading(true);
        const response = await api.get('/api/tournaments');
        setTournaments(response.data);
        setError(null);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch tournaments');
      } finally {
        setLoading(false);
      }
    };
    fetchTournaments();
  }};
}

export function useTournament(id: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchTournament = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setLoading(true);
      const response = await api.get(`/api/tournaments/${id}`, {
        signal: abortController.signal,
      });
      
      // Only update state if request wasn't aborted
      if (!abortController.signal.aborted) {
        setTournament(response.data);
        setError(null);
      }
    } catch (err: any) {
      // Ignore cancelation errors (expected when aborting previous requests)
      // Check multiple ways axios might indicate cancellation
      const isCanceled = 
        axios.isCancel && axios.isCancel(err) ||
        err.name === 'AbortError' || 
        err.name === 'CanceledError' ||
        err.code === 'ECONNABORTED' || 
        err.code === 'ERR_CANCELED' ||
        err.message === 'canceled' ||
        (err.message && err.message.toLowerCase() === 'canceled');
      
      if (isCanceled) {
        // Silently ignore - this is expected when canceling previous requests
        return;
      }
      setError(err.response?.data?.error || 'Failed to fetch tournament');
      console.error('Error fetching tournament:', err);
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    fetchTournament();
    
    // Cleanup: abort request on unmount or id change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchTournament]);

  const register = async () => {
    if (!id) return;
    try {
      await api.post(`/api/tournaments/${id}/register`);
      // Refetch tournament to get updated registration count
      await fetchTournament();
      return { success: true };
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to register for tournament';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  return { tournament, loading, error, register, refetch: fetchTournament };
}
