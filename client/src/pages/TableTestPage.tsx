/**
 * Test page for table position adjustments.
 * Mirrors the real game screen: header (top bar), table, action buttons, chat.
 * Open /table-test to tweak PLAYER_POSITIONS in components/poker/table/pokerTableConstants.ts while viewing.
 * Also used to try emoji reactions (self + throw) with socket sync in the table-test room.
 */
import { useEffect, useMemo, useState } from "react";
import { PokerTable } from "../components/poker/PokerTable";
import { PokerCardImage } from "../components/poker/table/PokerCardImage";
import { BettingControls } from "../components/poker/BettingControls";
import Chat from "@shared/components/chat/Chat";
import { useAuth } from "@shared/features/auth/AuthContext";
import PlayerStatsModal from "../components/modals/PlayerStatsModal";
import { useIsMobile } from "../hooks/useIsMobile";
import { useTableReactions } from "../hooks/useTableReactions";
import { getHandDescription } from "@shared/utils/handEvaluator";
import type { Card } from "@shared/types/poker";
import {
  TableTestModalPicker,
  TableTestModalPreview,
  type TableTestModalId,
} from "./tableTest/TableTestModalPreview";

const COMMUNITY_CARDS: Card[] = [
  { suit: "SPADES", rank: "K" },
  { suit: "HEARTS", rank: "Q" },
  { suit: "DIAMONDS", rank: "J" },
  { suit: "CLUBS", rank: "10" },
  { suit: "SPADES", rank: "9" },
];

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const POT = 500;
const CURRENT_BET = 20;

const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5"] as const;
const SUITS: Card["suit"][] = ["HEARTS", "DIAMONDS", "CLUBS", "SPADES"];

function buildTestPlayers(myUserId?: string) {
  return Array.from({ length: 10 }, (_, i) => {
    const isMe = i === 0 && !!myUserId;
    return {
      id: isMe ? myUserId! : `test-player-${i + 1}`,
      userId: isMe ? myUserId! : `test-player-${i + 1}`,
      name: isMe ? "You" : `Player ${i + 1}`,
      chips: 100,
      seatNumber: i + 1,
      status: "ACTIVE",
      holeCards: [
        { suit: SUITS[i % SUITS.length], rank: RANKS[i] },
        { suit: SUITS[(i + 1) % SUITS.length], rank: RANKS[(i + 2) % RANKS.length] },
      ] as Card[],
      contribution: 100,
      avatarUrl: isMe ? undefined : undefined,
    };
  });
}

export function TableTestPage() {
  const { user } = useAuth();
  const players = useMemo(() => buildTestPlayers(user?.id), [user?.id]);
  const { reactions, sendReaction, cooldownRemainingMs } = useTableReactions(
    "table-test",
    user?.id
  );
  const isMobile = useIsMobile();
  // Drawer always starts collapsed so the felt keeps full width; open as overlay.
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [showDealerMessages, setShowDealerMessages] = useState(true);
  const [previewModal, setPreviewModal] = useState<TableTestModalId>("none");
  const [communityCardSize, setCommunityCardSize] = useState({ width: 64, height: 90 });
  useEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement);
      setCommunityCardSize({
        width: parseInt(styles.getPropertyValue("--community-card-width"), 10) || 64,
        height: parseInt(styles.getPropertyValue("--community-card-height"), 10) || 90,
      });
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const chatPlayers = players.map((p) => ({
    id: p.id,
    userId: p.id,
    name: p.name,
    team: 1,
    position: p.seatNumber,
    seatIndex: p.seatNumber - 1,
    isDealer: false,
    hand: [],
    avatarUrl: undefined,
    isBot: false,
    chips: p.chips,
    seatNumber: p.seatNumber,
    status: p.status,
  }));

  return (
    <div className="flex h-[100dvh] min-h-screen w-screen flex-col overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900">
      {/* Main area: table + controls | chat */}
      <div className="relative z-20 flex min-h-0 flex-1 overflow-hidden">
        {/* Table column — modals are contained here so chat stays clear */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Modal preview picker — centered over table column */}
          <div className="pointer-events-none absolute left-1/2 top-2 z-[140] -translate-x-1/2">
            <TableTestModalPicker
              selected={previewModal}
              onSelect={setPreviewModal}
              onClear={() => setPreviewModal("none")}
            />
          </div>
          <TableTestModalPreview
            selected={previewModal}
            onClear={() => setPreviewModal("none")}
          />
          <div className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900">
            {/* Opponents face-down; hero seat cards face-up at 60% community size */}
            <PokerTable
              gameId="table-test"
              players={players}
              communityCards={COMMUNITY_CARDS}
              pot={POT}
              currentBet={CURRENT_BET}
              smallBlind={SMALL_BLIND}
              bigBlind={BIG_BLIND}
              forceSeatCardsFaceDown
              myUserId={user?.id}
              topLeftBlinds="50/100"
              topLeftTimer="2:15 mins"
              onTournamentLobbyClick={() => setPreviewModal("tournament-lobby")}
              topRightPosition="13th"
              topRightPlayers="28/45"
              reactions={reactions}
              onSendReaction={user?.id ? sendReaction : undefined}
              reactionCooldownMs={cooldownRemainingMs}
              tournamentCountdown={
                previewModal === "starting-countdown"
                  ? { startTime: new Date().toISOString(), seconds: 87 }
                  : undefined
              }
            />
          </div>

          {/* Transparent flow row keeps the felt above the corners without a full-width dock. */}
          <div
            className={`pointer-events-none relative z-[60] flex w-full shrink-0 items-end justify-between gap-3 px-2 pb-2 ${
              isMobile ? "pt-2" : "pt-1"
            }`}
          >
            {(() => {
              const myHoleCards = players[0]?.holeCards;
              if (!myHoleCards || !Array.isArray(myHoleCards) || myHoleCards.length === 0) {
                return <div className="min-w-0" />;
              }
              return (
                <div className="pointer-events-auto bux-action-corner bux-action-corner-hand flex flex-col items-start gap-1">
                  <span
                    className="font-display text-[10px] sm:text-sm font-semibold uppercase tracking-wide whitespace-nowrap leading-tight"
                    style={{ color: "var(--bux-brass)" }}
                  >
                    {getHandDescription(myHoleCards, COMMUNITY_CARDS, "FLOP")}
                  </span>
                  <div className="flex items-center" style={{ gap: "var(--community-card-gap, 8px)" }}>
                    {myHoleCards.map((card: Card, idx: number) => (
                      <PokerCardImage
                        key={`${idx}-${communityCardSize.width}x${communityCardSize.height}`}
                        card={card}
                        width={communityCardSize.width}
                        height={communityCardSize.height}
                        className="shadow-lg"
                        useTextCard={isMobile}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="pointer-events-auto bux-action-corner bux-action-corner-controls flex flex-col items-end justify-center gap-1 sm:gap-2">
              <BettingControls
                onAction={() => {}}
                currentBet={CURRENT_BET}
                bigBlind={BIG_BLIND}
                myChips={1000}
                street="PREFLOP"
                minimumRaise={BIG_BLIND}
                isBigBlind={false}
                isMyTurn={false}
                myContribution={0}
                players={players}
                myUserId={user?.id}
              />
            </div>
          </div>
        </div>

        {/* Chat drawer — keep mounted (draft persists); slide both ways; click-outside closes */}
        {chatCollapsed && (
          <button
            onClick={() => setChatCollapsed(false)}
            className="absolute right-0 top-1/2 z-[110] flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 shadow-lg"
            style={{
              background: "color-mix(in srgb, var(--bux-panel) 95%, transparent)",
              borderColor: "var(--bux-panel-border)",
            }}
            aria-label="Open chat"
          >
            <svg className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}
        {!chatCollapsed && (
          <button
            type="button"
            className="bux-chat-drawer-backdrop"
            aria-label="Close chat"
            onClick={() => {
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
              }
              setChatCollapsed(true);
            }}
          />
        )}
        <div
          className={`bux-chat-drawer absolute bottom-0 right-0 top-0 z-[110] flex w-80 max-w-[85vw] flex-col overflow-hidden border-l shadow-2xl ${
            chatCollapsed ? "is-closed" : ""
          }`}
          style={{
            background: "color-mix(in srgb, var(--bux-ink-elevated) 97%, transparent)",
            borderColor: "var(--bux-panel-border)",
          }}
          aria-hidden={chatCollapsed}
        >
          <div
            className="flex items-center justify-between border-b px-2 py-1.5"
            style={{ borderColor: "var(--bux-panel-border)" }}
          >
            <span className="font-display text-xs font-semibold uppercase tracking-wide text-slate-300">
              Table chat
            </span>
            <div className="flex items-center gap-2">
              {user && (
                <>
                  <span className="text-[10px] text-slate-500">Dealer</span>
                  <button
                    onClick={() => setShowDealerMessages(!showDealerMessages)}
                    className={`relative inline-flex items-center rounded-full transition-colors ${
                      showDealerMessages ? "bg-emerald-600" : "bg-slate-600"
                    }`}
                    style={{ height: "20px", width: "36px" }}
                    aria-label="Toggle dealer messages"
                  >
                    <span
                      className={`inline-block rounded-full bg-white transition-transform ${
                        showDealerMessages ? "translate-x-4" : "translate-x-0"
                      }`}
                      style={{ height: "16px", width: "16px", marginLeft: "2px" }}
                    />
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  setChatCollapsed(true);
                }}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                aria-label="Close chat"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {user ? (
              <Chat
                gameId="table-test"
                userId={user.id}
                userName={user.username || "Player"}
                players={chatPlayers}
                spectators={[]}
                userAvatar={user.avatarUrl}
                showPlayerListTab={false}
                chatType="game"
                isSpectator={false}
                PlayerStatsModal={PlayerStatsModal}
                showDealerMessages={showDealerMessages}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="text-sm text-slate-500">Log in to see chat</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
