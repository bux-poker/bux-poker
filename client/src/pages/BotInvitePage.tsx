/**
 * Unlisted page for founders — not linked in nav.
 * In Discord DMs, share https://www.bux-poker.pro/discord-founders.html (static file = correct embed).
 * In the browser, open the discord-bot route for the full React page; bot-invite redirects there.
 */
const DISCORD_BOT_INVITE_URL =
  import.meta.env.VITE_DISCORD_BOT_INVITE_URL ??
  "https://discord.com/oauth2/authorize?client_id=1461311075428601959&permissions=84992&integration_type=0&scope=bot+applications.commands";

export function BotInvitePage() {
  return (
    <div className="mx-auto max-w-3xl py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        BUX Poker — Discord bot
      </h1>
      <p className="mt-3 text-slate-400">
        Add the bot to your server, fix channel permissions, then run{" "}
        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">/setup</code> once.
      </p>

      <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white">1. Invite the bot</h2>
        <p className="mt-2 text-sm text-slate-400">
          You need <strong className="text-slate-300">Manage Server</strong> (or Administrator) on the
          Discord server. The invite includes scopes <code className="text-slate-300">bot</code> and{" "}
          <code className="text-slate-300">applications.commands</code> so slash commands work.
        </p>
        <a
          href={DISCORD_BOT_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-[#5865F2] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#4752C4]"
        >
          Invite BUX Poker bot
        </a>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">2. Channel permissions</h2>
        <p className="mt-2 text-sm text-slate-400">
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
        <p className="mt-3 text-sm text-slate-500">
          In Discord: open the channel → <strong className="text-slate-400">Edit channel</strong> →{" "}
          <strong className="text-slate-400">Permissions</strong> → add or select the bot’s role and
          enable the above. If the channel is private, explicitly allow the bot role (or @BUX Poker)
          for that channel.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">3. Run /setup</h2>
        <p className="mt-2 text-sm text-slate-400">
          Only members with <strong className="text-slate-300">Administrator</strong> can run this
          command. In any channel of the server:
        </p>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-300">
          <li>
            Type <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300">/setup</code>
          </li>
          <li>
            <strong className="text-slate-200">channel</strong> — select the announcement channel
            (same one you granted permissions above)
          </li>
          <li>
            <strong className="text-slate-200">invite-link</strong> — a permanent invite to this
            Discord server (<code className="text-slate-400">https://discord.gg/...</code> or{" "}
            <code className="text-slate-400">https://discord.com/invite/...</code>)
          </li>
          <li>
            <strong className="text-slate-200">admin-role</strong> — role that may manage BUX Poker
            admin actions on the site for this server
          </li>
        </ol>
        <p className="mt-4 text-sm text-amber-200/80">
          If <code className="text-amber-100/90">/setup</code> doesn’t appear, wait up to an hour for
          global slash commands to sync, or ask the BUX Poker team to confirm the bot is using global
          command registration.
        </p>
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">
        This page is not linked on the public site — keep it private to your team.
        <br />
        <span className="text-slate-500">
          <strong className="text-slate-400">For Discord embeds</strong>, paste only:{" "}
          <strong className="text-emerald-400/90">https://www.bux-poker.pro/discord-founders.html</strong>
          <br />
          (static page — not <code className="text-slate-500">/discord-bot</code>, which can still preview as
          the main site in DMs). Then open the green link on that page to get back here.
        </span>
      </p>
    </div>
  );
}
