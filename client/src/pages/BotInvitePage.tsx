const DISCORD_BOT_INVITE_URL =
  import.meta.env.VITE_DISCORD_BOT_INVITE_URL ??
  "https://discord.com/oauth2/authorize?client_id=1461311075428601959&permissions=84992&integration_type=0&scope=bot+applications.commands";

const DEFAULT_SHARE_URL = "https://bux-poker.xyz/invite";

function shareUrl() {
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}/invite`;
  }
  return DEFAULT_SHARE_URL;
}

export function BotInvitePage() {
  const pageUrl = shareUrl();

  return (
    <div className="bux-page mx-auto max-w-3xl py-10 sm:py-14">
      <p className="bux-section-label mb-3">Discord</p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Add BUX Poker to your server
      </h1>
      <p className="bux-muted mt-3 text-sm sm:text-base">
        For community founders. Invite the bot, grant channel permissions, then run{" "}
        <code className="bux-code">/setup</code> once per server.
      </p>

      <div className="bux-surface mt-8 p-6">
        <h2 className="font-display text-lg font-semibold text-white">1. Invite the bot</h2>
        <p className="bux-muted mt-2 text-sm">
          You need <strong className="text-slate-200">Manage Server</strong> (or Administrator) on
          the Discord server. The invite includes scopes{" "}
          <code className="bux-code">bot</code> and{" "}
          <code className="bux-code">applications.commands</code> so slash commands work.
        </p>
        <a
          href={DISCORD_BOT_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="bux-btn-accent mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm shadow-lg"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M20.317 4.369A19.791 19.791 0 0 0 16.885 3a14.5 14.5 0 0 0-.673 1.477 18.27 18.27 0 0 0-5.487 0A14.5 14.5 0 0 0 9.042 3 19.736 19.736 0 0 0 5.61 4.369 20.015 20.015 0 0 0 2.163 16.9a19.9 19.9 0 0 0 6.086 3.073 14.3 14.3 0 0 0 1.226-1.994 12.9 12.9 0 0 1-1.872-.907 8.4 8.4 0 0 0 .362-.293c3.593 1.677 7.482 1.677 11.035 0 .12.1.237.2.362.293a12.9 12.9 0 0 1-1.873.907 14.3 14.3 0 0 0 1.225 1.994 19.9 19.9 0 0 0 6.088-3.073A19.78 19.78 0 0 0 21.837 16.9a19.96 19.96 0 0 0-1.52-12.531ZM8.02 14.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.946 2.419-2.157 2.419Z" />
          </svg>
          Invite BUX Poker bot
        </a>
      </div>

      <div className="bux-surface mt-6 p-6">
        <h2 className="font-display text-lg font-semibold text-white">2. Channel permissions</h2>
        <p className="bux-muted mt-2 text-sm">
          Pick the channel where tournament announcements should post. The bot must be able to post
          embeds there:
        </p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-300">
          <li>
            <strong className="text-slate-200">View channel</strong>
          </li>
          <li>
            <strong className="text-slate-200">Send messages</strong>
          </li>
          <li>
            <strong className="text-slate-200">Embed links</strong> (required for tournament embeds)
          </li>
          <li>
            <strong className="text-slate-200">Read message history</strong> (recommended)
          </li>
        </ul>
        <p className="bux-muted mt-3 text-sm">
          In Discord: open the channel → <strong className="text-slate-300">Edit channel</strong> →{" "}
          <strong className="text-slate-300">Permissions</strong> → add or select the bot’s role and
          enable the above. If the channel is private, explicitly allow the bot role for that channel.
        </p>
      </div>

      <div className="bux-surface mt-6 p-6">
        <h2 className="font-display text-lg font-semibold text-white">3. Run /setup</h2>
        <p className="bux-muted mt-2 text-sm">
          Only members with <strong className="text-slate-200">Administrator</strong> can run this
          command. In any channel of the server:
        </p>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-300">
          <li>
            Type <code className="bux-code">/setup</code>
          </li>
          <li>
            <strong className="text-slate-200">channel</strong> — select the announcement channel
          </li>
          <li>
            <strong className="text-slate-200">invite-link</strong> — a permanent invite to this
            Discord server
          </li>
          <li>
            <strong className="text-slate-200">admin-role</strong> — role that may manage BUX Poker
            admin actions on the site for this server
          </li>
        </ol>
        <p className="mt-4 text-sm text-amber-200/80">
          If <code className="bux-code">/setup</code> doesn’t appear, wait up to an hour for slash
          commands to sync, or ask the BUX Poker team to confirm the bot is online.
        </p>
      </div>

      <div className="bux-surface mt-6 p-6">
        <h2 className="font-display text-lg font-semibold text-white">4. Start testing</h2>
        <p className="bux-muted mt-2 text-sm">
          After setup, log in at{" "}
          <a href="/" className="text-[color:var(--bux-brass-bright)] hover:underline">
            bux-poker.xyz
          </a>{" "}
          with Discord (use an account that has the admin role you configured). Create a tournament
          from Admin — the bot posts a registration embed in your announcement channel. Players
          register via the embed buttons and play in the browser.
        </p>
      </div>

      <p className="bux-muted mt-8 text-center text-xs">
        Share this page:{" "}
        <a href={pageUrl} className="text-[color:var(--bux-brass-bright)] hover:underline">
          {pageUrl}
        </a>
      </p>
    </div>
  );
}
