import type { ManualPrizePlace, MyPrizeClaim, WalletPrizePlace } from "./PrizesTab";
import { WalletClaimPanel } from "./WalletClaimPanel";
import { ManualPrizeVisual, PrizeAssetVisual } from "./PrizeAssetVisual";

type PrizeStructureRow = ManualPrizePlace | WalletPrizePlace;

type PrizeTournamentSlice = {
  prizePlaces?: number;
  prizeMode?: "MANUAL" | "WALLET" | null;
  prizeStructure?: PrizeStructureRow[];
  prizeClaimServer?: { serverName: string; inviteLink: string | null } | null;
  /** Fallback if claim server missing — first posted project Discord. */
  servers?: Array<{ serverName: string; inviteLink: string | null }> | null;
  myPrizeClaim?: MyPrizeClaim | null;
  hasPrizes?: boolean;
};

function placeLabel(place: number) {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
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

function resolveClaimServer(tournament: PrizeTournamentSlice) {
  if (tournament.prizeClaimServer?.serverName) return tournament.prizeClaimServer;
  const first = tournament.servers?.[0];
  if (first?.serverName) {
    return { serverName: first.serverName, inviteLink: first.inviteLink ?? null };
  }
  return null;
}

type Props = {
  place: number;
  tournament: PrizeTournamentSlice;
  claimEndpoint?: string;
  onUpdated?: () => void;
};

/**
 * Prize details + claim instructions for a finishing place (wallet address or Discord).
 */
export function PrizeClaimSummary({
  place,
  tournament,
  claimEndpoint,
  onUpdated,
}: Props) {
  const row = getPrizeRowForPlace(tournament, place);
  if (!row) return null;

  const myClaim =
    tournament.myPrizeClaim &&
    Number(tournament.myPrizeClaim.finishingPlace) === Number(place)
      ? tournament.myPrizeClaim
      : tournament.myPrizeClaim ?? null;

  const isManual = tournament.prizeMode === "MANUAL" || "description" in row;
  const claimServer = resolveClaimServer(tournament);

  return (
    <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-4 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-wide text-emerald-300">
        {placeLabel(place)} place prize
      </p>

      <div className="mt-3 flex flex-col items-center gap-4">
        {"description" in row && row.description ? (
          <ManualPrizeVisual description={row.description} />
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-4">
            {(row as WalletPrizePlace).items?.map((item, i) => (
              <PrizeAssetVisual key={i} item={item} />
            ))}
          </div>
        )}
      </div>

      {isManual && claimServer && (
        <div className="mt-4 border-t border-emerald-500/20 pt-3">
          <p className="text-sm text-slate-300">
            To claim, join{" "}
            <span className="font-semibold text-slate-100">{claimServer.serverName}</span> on
            Discord and open a prize ticket.
          </p>
          {claimServer.inviteLink && (
            <a
              href={claimServer.inviteLink}
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
        <div className="mt-4 border-t border-emerald-500/20 pt-3 text-left">
          {myClaim ? (
            claimEndpoint &&
            (myClaim.status === "ELIGIBLE" || myClaim.status === "CLAIMED") ? (
              <WalletClaimPanel
                claimEndpoint={claimEndpoint}
                myClaim={myClaim}
                onUpdated={onUpdated}
              />
            ) : (
              <p className="text-center text-sm text-slate-300">
                {myClaim.status === "MANUAL_PENDING"
                  ? "Open a Discord ticket to claim."
                  : myClaim.status === "CLAIMED"
                    ? "Prize claimed."
                    : `Claim status: ${myClaim.status}`}
              </p>
            )
          ) : (
            <p className="text-center text-sm text-slate-300">
              Paste your Solana wallet address below once your claim is ready.
            </p>
          )}
        </div>
      )}

      {isManual && !claimServer && (
        <p className="mt-3 text-sm text-slate-400">
          Claim Discord server was not configured for this tournament.
        </p>
      )}
    </div>
  );
}
