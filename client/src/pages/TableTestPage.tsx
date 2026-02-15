/**
 * Test page for table position adjustments.
 * Mirrors the real game screen: header (top bar), table, action buttons, chat.
 * Open /table-test to tweak PLAYER_POSITIONS in PokerTable.tsx while viewing.
 */
import { useState, useEffect } from "react";
import { PokerTable } from "../components/poker/PokerTable";
import { BettingControls } from "../components/poker/BettingControls";
import Chat from "@shared/components/chat/Chat";
import { useAuth } from "@shared/features/auth/AuthContext";
import PlayerStatsModal from "../components/modals/PlayerStatsModal";
import type { Card } from "@shared/types/poker";

const PLACEHOLDER_CARD: Card = { suit: "HEARTS", rank: "A" };
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

function buildTestPlayers() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `test-player-${i + 1}`,
    name: `Player ${i + 1}`,
    chips: 100,
    seatNumber: i + 1,
    status: "ACTIVE",
    holeCards: [PLACEHOLDER_CARD, { ...PLACEHOLDER_CARD, rank: "K" }] as Card[],
    contribution: 100,
  }));
}

export function TableTestPage() {
  const players = buildTestPlayers();
  const { user } = useAuth();
  const [chatCollapsed, setChatCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  const [showDealerMessages, setShowDealerMessages] = useState(true);
  const [isMobileWidth, setIsMobileWidth] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);

  useEffect(() => {
    const check = () => setIsMobileWidth(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
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
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br from-slate-950 to-slate-900">
            <PokerTable
              gameId="table-test"
              players={players}
              communityCards={COMMUNITY_CARDS}
              pot={POT}
              currentBet={CURRENT_BET}
              smallBlind={SMALL_BLIND}
              bigBlind={BIG_BLIND}
              forceSeatCardsFaceDown
              topLeftBlinds="50/100"
              topLeftTimer="2:15 mins"
              topRightPosition="13th"
              topRightPlayers="28/45"
            />
          </div>

          {/* Betting controls bar - same as game view */}
          <div className="relative border-t border-slate-800 bg-slate-900/95 px-2 py-1 backdrop-blur-sm sm:px-4 sm:py-2">
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

        {/* Right side - Chat (collapsible on mobile, same as game view) */}
        {user ? (
          <>
            {/* Chat icon tab - mobile only, when collapsed */}
            {isMobileWidth && chatCollapsed && (
              <button
                onClick={() => setChatCollapsed(false)}
                className="absolute right-0 top-1/2 z-40 flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-slate-600 bg-slate-800/95 shadow-lg"
                aria-label="Open chat"
              >
                <svg className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            )}
            {/* Chat panel - hidden on mobile when collapsed */}
            {(!isMobileWidth || !chatCollapsed) && (
              <div
                className={`relative flex-shrink-0 border-l border-slate-800 ${isMobileWidth ? "w-72 max-w-[45%]" : ""}`}
                style={!isMobileWidth ? { width: "var(--chat-width, 320px)" } : undefined}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/50 px-2 py-1">
                    <span className="text-xs text-slate-300">Dealer Messages</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowDealerMessages(!showDealerMessages)}
                        className={`relative inline-flex items-center rounded-full transition-colors ${showDealerMessages ? "bg-blue-600" : "bg-slate-600"}`}
                        style={{ height: "20px", width: "36px" }}
                      >
                        <span
                          className={`inline-block rounded-full bg-white transition-transform ${showDealerMessages ? "translate-x-4" : "translate-x-0"}`}
                          style={{ height: "16px", width: "16px", marginLeft: "2px" }}
                        />
                      </button>
                      {isMobileWidth && (
                        <button
                          onClick={() => setChatCollapsed(true)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-white"
                          aria-label="Collapse chat"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
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
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Placeholder when not logged in - also collapsible on mobile */
          <>
            {isMobileWidth && chatCollapsed && (
              <button
                onClick={() => setChatCollapsed(false)}
                className="absolute right-0 top-1/2 z-40 flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-slate-600 bg-slate-800/95 shadow-lg"
                aria-label="Open chat"
              >
                <svg className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            )}
            {(!isMobileWidth || !chatCollapsed) && (
              <div
                className={`relative flex-shrink-0 border-l border-slate-800 ${isMobileWidth ? "w-72 max-w-[45%]" : ""}`}
                style={!isMobileWidth ? { width: "var(--chat-width, 320px)" } : undefined}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800/50 px-2 py-1">
                    <span className="text-xs text-slate-300">Chat</span>
                    {isMobileWidth && (
                      <button
                        onClick={() => setChatCollapsed(true)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-600 hover:text-white"
                        aria-label="Collapse chat"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex flex-1 items-center justify-center">
                    <span className="text-sm text-slate-500">Log in to see chat</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
