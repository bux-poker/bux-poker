import { Link, useSearchParams } from 'react-router-dom';
import { LoginButton } from '../components/auth/LoginButton';

const MESSAGES: Record<string, string> = {
  discord_auth_failed:
    'Discord sign-in failed (server could not complete login). This is usually a configuration issue: check Render env DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, and that the same redirect URL is listed in the Discord Developer Portal.',
  no_user: 'No user returned from Discord. Try again.',
  invalid_user: 'Invalid user data from Discord. Try again.',
  server_config: 'Server is missing JWT configuration.',
  token_generation_failed: 'Could not create session. Try again.',
  profile_fetch_failed: 'Could not load your profile. Try again.',
  no_token: 'Missing login token. Try signing in again.',
};

/**
 * OAuth failures redirect here (?error=...) so users see a message instead of a blank route.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const code = params.get('error') || '';
  const message = code ? MESSAGES[code] || `Something went wrong (${code}).` : null;

  return (
    <div className="mx-auto max-w-lg space-y-6 py-12">
      <h1 className="text-2xl font-semibold text-white">Sign in</h1>
      {message && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          {message}
        </div>
      )}
      {!message && (
        <p className="text-slate-400">Use Discord to sign in to BUX Poker.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <LoginButton />
        <Link to="/" className="text-sm text-emerald-400 hover:underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}
