import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDiscordCallbackUrl } from "../_lib/discordOAuthVercel";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").end("Method Not Allowed");
    return;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.status(500).end("DISCORD_CLIENT_ID not configured");
    return;
  }

  const redirectUri = getDiscordCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify email",
  });

  res.redirect(302, `https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
