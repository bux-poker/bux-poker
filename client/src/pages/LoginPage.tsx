import { Link, useSearchParams } from 'react-router-dom';
import { LoginButton } from '../components/auth/LoginButton';

const MESSAGES: Record<string, string> = {
  discord_cloudflare:
    'Discord is blocking login from the game server’s network (global / Cloudflare rate limits on shared hosting). Wait a few hours and try again, or in Render use Manual Deploy (may get a different IP). This is not your password or redirect URL being wrong.',
  discord_auth_failed:
    'Discord sign-in failed (server could not complete login). Check Render env DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_CALLBACK_URL, and that the same redirect URL is listed in the Discord Developer Portal.',
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
    <div className="bux-page mx-auto max-w-lg space-y-6 py-12">
      <p className="bux-section-label">Account</p>
      <h1 className="font-display text-2xl font-bold text-white">Sign in</h1>
      {message && (
        <div
          className="bux-surface p-4 text-sm text-amber-100"
          style={{ borderColor: "color-mix(in srgb, var(--bux-warn) 45%, transparent)" }}
        >
          {message}
        </div>
      )}
      {!message && (
        <p className="bux-muted text-sm">Use Discord to sign in to BUX Poker.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <LoginButton />
        <Link to="/" className="bux-nav-link text-sm">
          Back to home
        </Link>
      </div>
    </div>
  );
}
