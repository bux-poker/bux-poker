/**
 * Table-test harness: pick any in-game modal/popup to review styling over the table.
 */
import { useEffect, useState } from "react";
import PlayerStatsModal from "../../components/modals/PlayerStatsModal";
import {
  BuxBanner,
  BuxModal,
  BuxModalButton,
} from "../../components/ui/BuxModal";
import { PrizeClaimSummary } from "../../components/tournament/PrizeClaimSummary";

const MOCK_WALLET_PRIZE_TOURNAMENT = {
  prizePlaces: 3,
  prizeMode: "WALLET" as const,
  hasPrizes: true,
  prizeStructure: [
    {
      place: 1,
      items: [
        { kind: "SOL", lamports: "500000000" },
        { kind: "NFT", mint: "BuXNfT1111111111111111111111111111111111111" },
      ],
    },
    {
      place: 2,
      items: [{ kind: "SPL", mint: "BuXTok2222222222222222222222222222222222222", amount: "1000000", decimals: 6 }],
    },
    {
      place: 3,
      items: [{ kind: "SOL", lamports: "100000000" }],
    },
  ],
  myPrizeClaim: {
    id: "mock-claim",
    finishingPlace: 1,
    status: "ELIGIBLE",
    eligibleUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
  },
};

const MOCK_MANUAL_PRIZE_TOURNAMENT = {
  prizePlaces: 3,
  prizeMode: "MANUAL" as const,
  hasPrizes: true,
  prizeStructure: [
    { place: 1, description: "1 SOL + BUX Champion NFT" },
    { place: 2, description: "0.5 SOL" },
    { place: 3, description: "Discord role + merch" },
  ],
  prizeClaimServer: {
    serverName: "BUX Poker Official",
    inviteLink: "https://discord.gg/example",
  },
  myPrizeClaim: {
    id: "mock-manual-claim",
    finishingPlace: 2,
    status: "MANUAL_PENDING",
  },
};

export const TABLE_TEST_MODAL_OPTIONS = [
  { id: "none", label: "None (clear)" },
  { id: "elimination", label: "Elimination" },
  { id: "winner", label: "Tournament winner" },
  { id: "break", label: "Tournament break" },
  { id: "level-up", label: "Blind level up" },
  { id: "consolidation", label: "Consolidation wait banner" },
  { id: "blind-wait", label: "Blind sync wait banner" },
  { id: "connection-lost", label: "Connection lost banner" },
  { id: "player-stats", label: "Player stats" },
  { id: "tournament-lobby", label: "Tournament lobby" },
  { id: "tournament-lobby-loading", label: "Tournament lobby (loading)" },
  { id: "tournament-lobby-error", label: "Tournament lobby (error)" },
  { id: "add-to-home", label: "Add to home screen" },
  { id: "starting-countdown", label: "Game starting countdown" },
  { id: "close-table", label: "Close table (persistent)" },
  { id: "confirm-fold", label: "Confirm fold (custom preview)" },
  { id: "confirm-generic", label: "Confirm action (custom preview)" },
] as const;

export type TableTestModalId = (typeof TABLE_TEST_MODAL_OPTIONS)[number]["id"];

type Props = {
  selected: TableTestModalId;
  onSelect: (id: TableTestModalId) => void;
  onClear: () => void;
};

export function TableTestModalPicker({ selected, onSelect }: Props) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-500/40 bg-slate-950/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
      <label
        htmlFor="table-test-modal"
        className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-amber-200/90"
      >
        Preview modal
      </label>
      <select
        id="table-test-modal"
        value={selected}
        onChange={(e) => onSelect(e.target.value as TableTestModalId)}
        className="max-w-[220px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-amber-400"
      >
        {TABLE_TEST_MODAL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MockLobbyShell({
  onClose,
  title = "Friday Night MTT",
}: {
  onClose: () => void;
  title?: string;
}) {
  const [tab, setTab] = useState<"players" | "blinds" | "prizes" | "tables">("players");
  return (
    <BuxModal
      title={title}
      icon="lobby"
      onClose={onClose}
      maxWidth="xl"
      align="left"
      zIndexClass="z-[130]"
    >
      <div className="-mx-1 border-b border-slate-700/80">
        <nav className="flex -mb-px overflow-x-auto">
          {(
            [
              ["players", "Players"],
              ["blinds", "Blind Levels"],
              ["prizes", "Prizes"],
              ["tables", "Tables"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
                tab === id
                  ? "border-b-2 border-emerald-500 text-emerald-400"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-[200px] pt-4 text-sm text-slate-300">
        {tab === "players" && (
          <ul className="space-y-2">
            {["You", "AceHigh", "RiverRat", "BluffBot"].map((name, i) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg border border-slate-700/80 bg-slate-800/50 px-3 py-2"
              >
                <span className="font-medium text-slate-100">
                  {i + 1}. {name}
                </span>
                <span className="tabular-nums text-emerald-300">
                  {(12000 - i * 1500).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        {tab === "blinds" && (
          <p>Sample blind schedule preview — level 3 · 100/200 · next in 8:00</p>
        )}
        {tab === "prizes" && (
          <p>Sample prize pool preview — 1st 50% · 2nd 30% · 3rd 20%</p>
        )}
        {tab === "tables" && <p>Sample tables list — Table 1 (9/9) · Table 2 (8/9)</p>}
      </div>
    </BuxModal>
  );
}

export function TableTestModalPreview({
  selected,
  onClear,
}: {
  selected: TableTestModalId;
  onClear: () => void;
}) {
  const [breakRemainSec, setBreakRemainSec] = useState(4 * 60 + 32);

  useEffect(() => {
    if (selected !== "break") return;
    setBreakRemainSec(4 * 60 + 32);
    const t = window.setInterval(() => {
      setBreakRemainSec((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, [selected]);

  if (selected === "none") return null;

  if (selected === "elimination") {
    return (
      <BuxModal
        title="Cashed — eliminated"
        icon="eliminated"
        tone="success"
        maxWidth="md"
        onClose={onClear}
        zIndexClass="z-[130]"
        footer={
          <>
            <BuxModalButton onClick={onClear}>Stay and Spectate</BuxModalButton>
            <BuxModalButton variant="primary" onClick={onClear}>
              Close Table
            </BuxModalButton>
          </>
        }
      >
        <p>You finished in position 2.</p>
        <PrizeClaimSummary
          place={2}
          tournament={{
            ...MOCK_MANUAL_PRIZE_TOURNAMENT,
            myPrizeClaim: { ...MOCK_MANUAL_PRIZE_TOURNAMENT.myPrizeClaim, finishingPlace: 2 },
          }}
        />
      </BuxModal>
    );
  }

  if (selected === "winner") {
    return (
      <BuxModal
        title="Tournament Winner!"
        icon="trophy"
        tone="success"
        maxWidth="md"
        onClose={onClear}
        zIndexClass="z-[130]"
        footer={
          <>
            <BuxModalButton onClick={onClear}>Stay at Table</BuxModalButton>
            <BuxModalButton variant="primary" onClick={onClear}>
              Close Table
            </BuxModalButton>
          </>
        }
      >
        <p>
          Congratulations, you finished <span className="font-semibold">1st</span> in this
          tournament.
        </p>
        <PrizeClaimSummary
          place={1}
          tournament={MOCK_WALLET_PRIZE_TOURNAMENT}
          claimEndpoint="/api/tournaments/table-test/claim-prize"
        />
      </BuxModal>
    );
  }

  if (selected === "break") {
    return (
      <BuxModal title="Tournament break" icon="break" maxWidth="md" zIndexClass="z-[130]">
        <p className="text-slate-300">Stretch your legs — play resumes soon.</p>
        <p className="mt-4 font-mono text-4xl font-semibold tabular-nums text-white">
          {Math.floor(breakRemainSec / 60)}:
          {(breakRemainSec % 60).toString().padStart(2, "0")}
        </p>
        <p className="mt-2 text-sm text-slate-400">
          No new hands until the break ends. This closes automatically when the timer hits zero.
        </p>
        <div className="pointer-events-auto mt-4 text-center">
          <button type="button" onClick={onClear} className="text-xs text-slate-500 underline">
            Clear preview
          </button>
        </div>
      </BuxModal>
    );
  }

  if (selected === "level-up") {
    return (
      <BuxModal
        title="Blind level up"
        icon="blinds"
        tone="warning"
        onClose={onClear}
        maxWidth="md"
        zIndexClass="z-[130]"
        footer={<BuxModalButton onClick={onClear}>OK</BuxModalButton>}
      >
        <p>Blinds are now 100/200.</p>
        <p className="mt-2 text-sm text-slate-400">
          The blind timer restarts once every table has started the next hand.
        </p>
      </BuxModal>
    );
  }

  if (selected === "consolidation") {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[130] w-full max-w-lg -translate-x-1/2 px-4">
        <BuxBanner title="Tables consolidating" icon="wait">
          Waiting for other tables to finish before reseating… Please wait.
        </BuxBanner>
        <div className="pointer-events-auto mt-2 text-center">
          <button type="button" onClick={onClear} className="text-xs text-slate-400 underline">
            Clear preview
          </button>
        </div>
      </div>
    );
  }

  if (selected === "blind-wait") {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[130] w-full max-w-lg -translate-x-1/2 px-4">
        <BuxBanner title="Syncing blind level" icon="blinds" tone="warning">
          Blinds rise together when every table finishes the current hand.
        </BuxBanner>
        <div className="pointer-events-auto mt-2 text-center">
          <button type="button" onClick={onClear} className="text-xs text-slate-400 underline">
            Clear preview
          </button>
        </div>
      </div>
    );
  }

  if (selected === "connection-lost") {
    return (
      <div className="absolute left-0 right-0 top-0 z-[130] px-3 pt-3">
        <BuxBanner
          title="Connection lost"
          icon="wifi"
          tone="warning"
          action={
            <BuxModalButton variant="primary" onClick={onClear}>
              Reconnect
            </BuxModalButton>
          }
        >
          Game may be out of date until you reconnect.
        </BuxBanner>
      </div>
    );
  }

  if (selected === "player-stats") {
    return (
      <PlayerStatsModal
        isOpen
        onClose={onClear}
        containToParent
        player={{
          id: "preview-player",
          name: "AceHigh",
          chips: 12500,
          status: "ACTIVE",
          seatNumber: 4,
        } as any}
      />
    );
  }

  if (selected === "tournament-lobby") {
    return <MockLobbyShell onClose={onClear} />;
  }

  if (selected === "tournament-lobby-loading") {
    return (
      <BuxModal
        title="Loading tournament"
        icon="loading"
        onClose={onClear}
        zIndexClass="z-[130]"
        footer={<BuxModalButton onClick={onClear}>Cancel</BuxModalButton>}
      >
        <p className="text-slate-300">Fetching lobby details…</p>
      </BuxModal>
    );
  }

  if (selected === "tournament-lobby-error") {
    return (
      <BuxModal
        title="Tournament not found"
        icon="error"
        tone="danger"
        onClose={onClear}
        zIndexClass="z-[130]"
        footer={<BuxModalButton onClick={onClear}>Close</BuxModalButton>}
      >
        <p>This tournament could not be loaded.</p>
      </BuxModal>
    );
  }

  if (selected === "add-to-home") {
    return (
      <BuxModal
        title="Full Screen Play"
        icon="home"
        onClose={onClear}
        maxWidth="md"
        align="left"
        zIndexClass="z-[130]"
      >
        <p className="mb-4 text-sm text-slate-300">
          Add BUX Poker to your home screen for full screen gameplay without the browser bar.
        </p>
        <ol className="space-y-3 text-sm text-slate-200">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">
              1
            </span>
            <span>
              Tap the <strong>Share</strong> button at the bottom of Safari
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">
              2
            </span>
            <span>
              Tap <strong>Add to Home Screen</strong>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">
              3
            </span>
            <span>
              Tap <strong>Add</strong>, then open BUX Poker from your home screen
            </span>
          </li>
        </ol>
      </BuxModal>
    );
  }

  if (selected === "close-table") {
    return (
      <div className="absolute bottom-4 left-1/2 z-[130] -translate-x-1/2">
        <BuxModalButton variant="primary" onClick={onClear}>
          Close Table
        </BuxModalButton>
      </div>
    );
  }

  if (selected === "confirm-fold" || selected === "confirm-generic") {
    const fold = selected === "confirm-fold";
    return (
      <BuxModal
        title={fold ? "Fold for free?" : "Confirm action"}
        icon={fold ? "fold" : "confirm"}
        tone={fold ? "danger" : "warning"}
        onClose={onClear}
        zIndexClass="z-[130]"
        footer={
          <>
            <BuxModalButton onClick={onClear}>Cancel</BuxModalButton>
            <BuxModalButton variant={fold ? "danger" : "primary"} onClick={onClear}>
              {fold ? "Fold" : "Confirm"}
            </BuxModalButton>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          {fold
            ? "It's free to check. Are you sure you want to fold?"
            : "This action cannot be undone. Continue?"}
        </p>
      </BuxModal>
    );
  }

  return null;
}
