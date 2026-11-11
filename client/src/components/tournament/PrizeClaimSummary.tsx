import type { ManualPrizePlace, MyPrizeClaim, WalletPrizePlace } from "./PrizesTab";
import { WalletClaimPanel } from "./WalletClaimPanel";

type PrizeStructureRow = ManualPrizePlace | WalletPrizePlace;

type PrizeTournamentSlice = {
  prizePlaces?: number;
  prizeMode?: "MANUAL" | "WALLET" | null;
  prizeStructure?: PrizeStructureRow[];
  prizeClaimServer?: { serverName: string; inviteLink: string | null } | null;
  myPrizeClaim?: MyPrizeClaim | null;
  hasPrizes?: boolean;
};

function placeLabel(place: number) {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
}

function formatWalletItem(
  item: { kind: string; lamports?: string; mint?: string; amount?: string; decimals?: number }
) {
  if (item.kind === "SOL") {
    const lamports = BigInt(item.lamports || "0");
    const sol = Number(lamports) / 1e9;
    return `${sol} SOL`;
  }
  if (item.kind === "NFT" && item.mint) {
    return `NFT · ${item.mint}`;
  }
  if (item.mint) {
    return `Token · ${item.amount ?? "?"} · mint ${item.mint}`;
  }
  return "Prize asset";
}

export function getPrizeRowForPlace(
  tournament: PrizeTournamentSlice | null | undefined,
  place: number | null | undefined
): PrizeStructureRow | null {
  if (!place || !tournament?.prizeStructure?.length) return null;
  return tournament.prizeStructure.find((row) => Number(row.place) === Number(place)) ?? null;
}

export function isPaidFinishingPlace(
  tournament: PrizeTournamentSlice | null | undefined,
  place: number | null | undefined
): boolean {
  if (!place || !tournament) return false;
  if (tournament.hasPrizes === false) return false;
  const places = tournament.prizePlaces ?? 0;
  if (places <= 0) return false;
  return place <= places && !!getPrizeRowForPlace(tournament, place);
}

type Props = {
  place: number;
  tournament: PrizeTournamentSlice;
  claimEndpoint?: string;
  onUpdated?: () => void;
  /** When true, lead with congratulations (paid elimination / winner). */
  congratulate?: boolean;
};

/**
 * Prize details + claim instructions for a finishing place (wallet address or Discord).
 */
export function PrizeClaimSummary({
  place,
  tournament,
  claimEndpoint,
  onUpdated,
  congratulate = true,
}: Props) {
  const row = getPrizeRowForPlace(tournament, place);
  if (!row) return null;

  const myClaim =
    tournament.myPrizeClaim &&
    Number(tournament.myPrizeClaim.finishingPlace) === Number(place)
      ? tournament.myPrizeClaim
      : tournament.myPrizeClaim ?? null;

  const isManual = tournament.prizeMode === "MANUAL" || "description" in row;

  return (
    <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-left">
      {congratulate && (
        <p className="font-display text-sm font-bold uppercase tracking-wide text-emerald-300">
          Congratulations — {placeLabel(place)} place prize
        </p>
      )}
      {"description" in row && row.description ? (
        <p className={`text-slate-100 ${congratulate ? "mt-2" : ""}`}>{row.description}</p>
      ) : (
        <ul className={`space-y-2 text-sm text-slate-200 ${congratulate ? "mt-2" : ""}`}>
          {(row as WalletPrizePlace).items?.map((item, i) => (
            <li key={i} className="break-all">
              <span className="font-medium text-emerald-200">{formatWalletItem(item)}</span>
              {item.kind === "NFT" && item.mint && (
                <a
                  href={`https://solscan.io/token/${item.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block text-xs text-emerald-400/90 hover:underline"
                >
                  View NFT mint on Solscan →
                </a>
              )}
              {item.kind === "SPL" && item.mint && (
                <a
                  href={`https://solscan.io/token/${item.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 block text-xs text-emerald-400/90 hover:underline"
                >
                  View token mint on Solscan →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {isManual && tournament.prizeClaimServer && (
        <div className="mt-3 border-t border-emerald-500/20 pt-3">
          <p className="text-sm text-slate-300">
            To claim, join{" "}
            <span className="font-semibold text-slate-100">
              {tournament.prizeClaimServer.serverName}
            </span>{" "}
            on Discord and open a prize ticket.
          </p>
          {tournament.prizeClaimServer.inviteLink && (
            <a
              href={tournament.prizeClaimServer.inviteLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-emerald-400 hover:underline"
            >
              Open Discord server →
            </a>
          )}
        </div>
      )}

      {!isManual && tournament.prizeMode === "WALLET" && (
        <div className="mt-3 border-t border-emerald-500/20 pt-3">
          {myClaim ? (
            claimEndpoint &&
            (myClaim.status === "ELIGIBLE" || myClaim.status === "CLAIMED") ? (
              <WalletClaimPanel
                claimEndpoint={claimEndpoint}
                myClaim={myClaim}
                onUpdated={onUpdated}
              />
            ) : (
              <p className="text-sm text-slate-300">
                {myClaim.status === "MANUAL_PENDING"
                  ? "Open a Discord ticket to claim."
                  : myClaim.status === "CLAIMED"
                    ? "Prize claimed."
                    : `Claim status: ${myClaim.status}`}
              </p>
            )
          ) : (
            <p className="text-sm text-slate-300">
              Paste your Solana wallet address in the lobby Prizes tab once your claim is ready, or
              wait a moment for claim eligibility to appear.
            </p>
          )}
        </div>
      )}

      {isManual && !tournament.prizeClaimServer && (
        <p className="mt-3 text-sm text-slate-400">
          Claim details will be shared by the tournament organizers (usually via Discord).
        </p>
      )}
    </div>
  );
}
