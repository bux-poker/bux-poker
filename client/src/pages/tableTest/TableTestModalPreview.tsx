/**
 * Table-test harness: pick any in-game modal/popup to review styling over the table.
 */
import { useEffect, useState } from "react";
import PlayerStatsModal from "../../components/modals/PlayerStatsModal";

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
      <label htmlFor="table-test-modal" className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
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
    <div
      className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-3 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3 sm:px-6">
          <h2 className="truncate text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="border-b border-slate-800">
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
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors sm:px-6 ${
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
        <div className="min-h-[220px] overflow-y-auto p-4 text-sm text-slate-300 sm:p-6">
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
                  <span className="tabular-nums text-emerald-300">{(12000 - i * 1500).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {tab === "blinds" && (
            <p>Sample blind schedule preview — level 3 · 100/200 · next in 8:00</p>
          )}
          {tab === "prizes" && <p>Sample prize pool preview — 1st 50% · 2nd 30% · 3rd 20%</p>}
          {tab === "tables" && <p>Sample tables list — Table 1 (9/9) · Table 2 (8/9)</p>}
        </div>
      </div>
    </div>
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
      <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <h2 className="mb-2 text-xl font-bold text-red-300">You have been eliminated</h2>
          <p className="mb-4 text-slate-200">You finished in position 13.</p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={onClear}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
            >
              Stay and Spectate
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Close Table
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selected === "winner") {
    return (
      <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-sm rounded-lg border border-emerald-500 bg-slate-900 p-6 text-center shadow-2xl">
          <h2 className="mb-2 text-2xl font-bold text-emerald-300">🏆 Tournament Winner!</h2>
          <p className="mb-4 text-slate-200">
            Congratulations, you finished <span className="font-semibold">1st</span> in this
            tournament.
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={onClear}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
            >
              Stay at Table
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Close Table
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selected === "break" || selected === "level-up") {
    return (
      <div
        className="absolute inset-0 z-[130] flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
      >
        <div className="bux-panel w-full max-w-md rounded-xl px-8 py-6 text-center shadow-2xl">
          {selected === "break" ? (
            <>
              <p className="text-lg font-medium text-slate-200">Tournament break</p>
              <p className="mt-2 text-base text-slate-300">Stretch your legs — play resumes soon.</p>
              <p className="mt-4 font-mono text-4xl font-semibold tabular-nums text-white">
                {Math.floor(breakRemainSec / 60)}:
                {(breakRemainSec % 60).toString().padStart(2, "0")}
              </p>
              <p className="mt-2 text-sm text-slate-400">No new hands until the break ends.</p>
              <button
                type="button"
                className="mt-6 rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                onClick={onClear}
              >
                Dismiss
              </button>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-slate-200">Blind level up</p>
              <p className="mt-2 text-lg text-slate-200">Blinds are now 100/200.</p>
              <p className="mt-3 text-sm text-slate-400">
                The blind timer restarts once every table has started the next hand.
              </p>
              <button
                type="button"
                className="mt-6 rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                onClick={onClear}
              >
                OK
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (selected === "consolidation") {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[130] max-w-lg -translate-x-1/2 px-4">
        <div className="bux-banner rounded-xl px-5 py-3 text-center">
          <p className="text-sm font-medium text-slate-100">
            Waiting for other tables to finish before reseating…
          </p>
          <p className="mt-1 text-xs text-slate-400">Please wait…</p>
        </div>
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
      <div className="pointer-events-none absolute left-1/2 top-3 z-[130] max-w-lg -translate-x-1/2 px-4">
        <div className="bux-banner rounded-xl px-5 py-3 text-center">
          <p className="text-sm font-medium text-amber-100">
            Waiting for all tables to finish the current hand…
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Blinds rise together when every table finishes the current hand.
          </p>
        </div>
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
      <div className="absolute left-0 right-0 top-0 z-[130] flex items-center justify-between gap-4 border-b border-amber-500/40 bg-amber-500/20 px-4 py-2 text-sm text-amber-200">
        <span>Connection lost. Game may be out of date.</span>
        <button
          type="button"
          onClick={onClear}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
        >
          Reconnect
        </button>
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
      <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
        <div className="rounded-lg bg-slate-800 px-6 py-4 text-slate-300">
          Loading tournament…
          <div className="mt-3 text-center">
            <button type="button" onClick={onClear} className="text-xs text-slate-400 underline">
              Clear
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selected === "tournament-lobby-error") {
    return (
      <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
        <div className="max-w-md rounded-lg border border-red-500/30 bg-slate-800 p-6 text-red-200">
          <p>Tournament not found</p>
          <button
            type="button"
            onClick={onClear}
            className="mt-4 rounded bg-slate-600 px-4 py-2 text-sm text-white hover:bg-slate-500"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (selected === "add-to-home") {
    return (
      <div
        className="absolute inset-0 z-[130] flex items-center justify-center bg-black/70 p-4"
        onClick={onClear}
      >
        <div
          className="max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Full Screen Play</h3>
            <button
              type="button"
              onClick={onClear}
              className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
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
        </div>
      </div>
    );
  }

  if (selected === "close-table") {
    return (
      <div className="absolute bottom-4 left-1/2 z-[130] -translate-x-1/2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-black/40 hover:bg-emerald-500"
        >
          Close Table
        </button>
      </div>
    );
  }

  if (selected === "confirm-fold" || selected === "confirm-generic") {
    const fold = selected === "confirm-fold";
    return (
      <div className="absolute inset-0 z-[130] flex items-center justify-center bg-black/60 px-4">
        <div className="bux-panel w-full max-w-sm rounded-xl px-6 py-5 text-center shadow-2xl">
          <p className="text-lg font-semibold text-slate-100">
            {fold ? "Fold for free?" : "Confirm action"}
          </p>
          <p className="mt-2 text-sm text-slate-300">
            {fold
              ? "It's free to check. Are you sure you want to fold?"
              : "This action cannot be undone. Continue?"}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClear}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                fold ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"
              }`}
            >
              {fold ? "Fold" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
