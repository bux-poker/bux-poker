import { useState, useEffect } from 'react';
import { api } from '../services/api';

export interface League {
  id: string;
  name: string;
  month: number;
  year: number;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';
  totalGames: number;
  createdAt: Date | string;
}

export interface LeagueStanding {
  userId: string;
  username?: string;
  points: number;
  gamesPlayed: number;
  bestFinish: number;
}

export function useLeagues() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeagues = async () => {
      try {
        setLoading(true);
        const response = await api.get('/api/leagues');
        setLeagues(response.data);
        setError(null);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch leagues');
        console.error('Error fetching leagues:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeagues();
  }, []);

  return { leagues, loading, error };
}

export function useLeague(id: string | undefined) {
  const [league, setLeague] = useState<League | null>(null);
  const [standings, setStandings] = useState<LeagueStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    const fetchLeague = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/leagues/${id}`);
        setLeague(response.data.league);
        setStandings(response.data.standings || []);
        setError(null);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to fetch league');
        console.error('Error fetching league:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLeague();
  }, [id]);

  return { league, standings, loading, error };
}
