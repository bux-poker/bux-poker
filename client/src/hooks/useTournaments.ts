import { useState, useEffect } from 'react';
import { api } from '../services/api';

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
  status: 'UPCOMING' | 'REGISTRATION' | 'ACTIVE' | 'COMPLETED' | 'SCHEDULED' | 'CANCELLED' | 'REGISTERING' | 'RUNNING';
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

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const fetchTournament = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/tournaments/${id}`);
        setTournament(response.data);
        setError(null);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch tournament');
        console.error('Error fetching tournament:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTournament();
  }, [id]);

  const register = async () => {
    if (!id) return;
    try {
      await api.post(`/api/tournaments/${id}/register`);
      // Refetch tournament to get updated registration count
      const response = await api.get(`/api/tournaments/${id}`);
      setTournament(response.data);
      return { success: true };
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to register for tournament';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  return { tournament, loading, error, register };
}
