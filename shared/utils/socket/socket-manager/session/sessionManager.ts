import { apiFetch } from '@/services/lib/api';

export interface Session {
  token: string;
  userId: string;
  username: string;
}

export class SessionManager {
  private session: Session | null = null;

  public getSession(): Session | null {
    return this.session;
  }

  public setSession(session: Session): void {
    this.session = session;
  }

  public clearSession(): void {
    this.session = null;
  }

  public getTokenFromStorage(): string | null {
    return localStorage.getItem('sessionToken') || 
           localStorage.getItem('token') || 
           sessionStorage.getItem('sessionToken') || 
           (window as any).__tempSessionToken;
  }

  public async initializeSession(): Promise<{ userId: string; username: string; avatar?: string } | null> {
    const token = this.getTokenFromStorage();
    if (!token) {
      console.error('No token found in localStorage');
      return null;
    }
    
    try {
      console.log('Fetching profile with token:', token);
      const response = await apiFetch('/api/auth/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch profile: ${response.status}`);
      }
      
      const session = await response.json();
      
      if (session?.user) {
        // Create a proper session object with the token
        const sessionWithToken = {
          user: {
            ...session.user,
            sessionToken: token // Use the token from localStorage
          }
        };
        
        console.log('Session initialized with token:', {
          userId: sessionWithToken.user.id,
          username: sessionWithToken.user.username,
          hasToken: !!sessionWithToken.user.sessionToken,
          token: sessionWithToken.user.sessionToken // Log the actual token for debugging
        });
        
        return {
          userId: sessionWithToken.user.id,
          username: sessionWithToken.user.username,
          avatar: sessionWithToken.user.avatar
        };
      } else {
        console.error('Invalid session response:', session);
        // Clear invalid token from all possible storage keys
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('token');
        localStorage.removeItem('userData');
        return null;
      }
    } catch (error) {
      console.error('Error fetching session:', error);
      // Clear token on error from all possible storage keys
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('token');
      localStorage.removeItem('userData');
      return null;
    }
  }
}
