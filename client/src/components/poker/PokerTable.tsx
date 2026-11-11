import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Card } from "@shared/types/poker";
import { useIsMobile } from "../../hooks/useIsMobile";
import { BetChip } from "./table/BetChip";
import { formatHandCategory } from "./table/formatHandCategory";
import { PokerCardImage } from "./table/PokerCardImage";
import { PLAYER_POSITIONS } from "./table/pokerTableConstants";
import type { PokerTableProps } from "./table/pokerTableTypes";
import { usePokerTableActionOverlays } from "./table/usePokerTableActionOverlays";
import { EmojiReactionLayer } from "./table/EmojiReactionLayer";
import {
  playerKey,
  playerMatchesUser,
  type TableReactionEmojiId,
} from "./table/tableReactions";
import { soundManager } from "../../utils/soundManager";

export type { PokerTableProps } from "./table/pokerTableTypes";

export function PokerTable({
  gameId,
  turnTimer,
  players,
  communityCards,
  pot,
  sidePots = [],
  currentBet,
  currentPlayer,
  smallBlind = 10,
  bigBlind = 20,
  myUserId,
  forceSeatCardsFaceDown = false,
  debugAllSeatCardsFaceUp = false,
  topLeftBlinds,
  topLeftTimer,
  topRightPosition,
  topRightPlayers,
  showdownActive = false,
  showdownResults,
  tournamentCountdown,
  onTournamentLobbyClick,
  reactions = [],
  onSendReaction,
  reactionCooldownMs = 0,
}: PokerTableProps) {
  // Create array with 10 seats (empty seats if needed)
  const allSeats = Array.from({ length: 10 }, (_, idx) => {
    const seatNumber = idx + 1;
    return players.find(p => p.seatNumber === seatNumber) || null;
  });
  
  // Get player's own hole cards (face up) - shown separately at bottom
  const myPlayer = myUserId ? players.find(p => p.id === myUserId || p.userId === myUserId) : null;
  const myHoleCards = myPlayer?.holeCards || [];
  
  // Timer state for countdown
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [pickerTargetUserId, setPickerTargetUserId] = useState<string | null>(null);
  const tableRootRef = useRef<HTMLDivElement | null>(null);
  const seatRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  /** Visual seat orbit offset (0–9). Lets players sit where they like without changing server seats. */
  const [seatRotate, setSeatRotate] = useState(() => {
    try {
      const raw = localStorage.getItem("bux-poker-seat-rotate");
      const n = raw != null ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? ((n % 10) + 10) % 10 : 0;
    } catch {
      return 0;
    }
  });
  
  // Window size state to trigger re-renders when CSS variables change
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1400,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  const isMobile = useIsMobile();

  const rotateSeats = useCallback((dir: 1 | -1) => {
    setSeatRotate((prev) => {
      const next = ((prev + dir) % 10 + 10) % 10;
      try {
        localStorage.setItem("bux-poker-seat-rotate", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSeatAvatarClick = useCallback(
    (targetKey: string) => {
      if (!onSendReaction || !myUserId) return;
      soundManager.unlock();
      setPickerTargetUserId((prev) => (prev === targetKey ? null : targetKey));
    },
    [onSendReaction, myUserId]
  );

  const handlePickEmoji = useCallback(
    (emojiId: TableReactionEmojiId) => {
      if (!onSendReaction || !myUserId || !pickerTargetUserId) return;
      const myKey = myPlayer ? playerKey(myPlayer) : myUserId;
      const isSelf =
        pickerTargetUserId === myKey ||
        pickerTargetUserId === myUserId ||
        playerMatchesUser({ id: pickerTargetUserId, userId: pickerTargetUserId }, myUserId);
      onSendReaction({
        emojiId,
        fromUserId: myKey,
        toUserId: isSelf ? myKey : pickerTargetUserId,
        kind: isSelf ? "self" : "throw",
      });
      setPickerTargetUserId(null);
    },
    [onSendReaction, myUserId, pickerTargetUserId, myPlayer]
  );

  const { actionOverlays, ACTION_FADE_MS, isPermanentAction, getActionInfo } = usePokerTableActionOverlays(
    players,
    showdownActive,
    currentBet,
    communityCards
  );

  // Update timer every second
  useEffect(() => {
    if (turnTimer) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 100); // Update every 100ms for smooth countdown
      return () => clearInterval(interval);
    }
  }, [turnTimer]);
  
  // Listen for window resize to trigger re-render for CSS variable recalculation
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div 
      ref={tableRootRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at center, #121820 0%, var(--bux-ink, #0b0f14) 70%)",
        paddingTop: 'var(--table-padding-top, 56px)',
        paddingRight: 'var(--table-padding, 32px)',
        paddingBottom: 'var(--table-padding, 32px)',
        paddingLeft: 'var(--table-padding, 32px)',
      }}
    >
      {/* Top-left: blinds / next + rotate seats */}
      <div
        className="absolute left-0 top-0 z-10 flex items-start gap-1.5"
        style={{ marginLeft: "8px", marginTop: "8px" }}
      >
        {(topLeftBlinds != null || topLeftTimer != null) && (
          <div className="bux-hud-strip flex-col !items-start !rounded-2xl !px-3 !py-2">
            {topLeftBlinds != null && (
              <div className="bux-hud-item">
                <span className="bux-hud-label">Blinds</span>
                <span className="bux-hud-value">{topLeftBlinds}</span>
              </div>
            )}
            {topLeftTimer != null && (
              <div className="bux-hud-item mt-1">
                <span className="bux-hud-label">Next</span>
                <span className="bux-hud-value">{topLeftTimer}</span>
              </div>
            )}
          </div>
        )}
        <div className="bux-hud-strip !gap-1 !rounded-2xl !px-1.5 !py-1.5">
          <button
            type="button"
            onClick={() => rotateSeats(1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            title="Rotate seats anti-clockwise"
            aria-label="Rotate seats anti-clockwise"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4v8h8" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => rotateSeats(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            title="Rotate seats clockwise"
            aria-label="Rotate seats clockwise"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-9-9" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 4v8h-8" />
            </svg>
          </button>
          {onTournamentLobbyClick != null && (
            <button
              type="button"
              onClick={onTournamentLobbyClick}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Tournament info"
              title="Tournament info"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Top-right: players / rank */}
      {(topRightPlayers != null || topRightPosition != null) && (
        <div
          className="absolute right-0 top-0 z-10"
          style={{ marginRight: "8px", marginTop: "8px" }}
        >
          <div className="bux-hud-strip flex-col !items-end !rounded-2xl !px-3 !py-2">
            {topRightPlayers != null && (
              <div className="bux-hud-item text-right">
                <span className="bux-hud-label">Players</span>
                <span className="bux-hud-value">{topRightPlayers}</span>
              </div>
            )}
            {topRightPosition != null && (
              <div className="bux-hud-item mt-1 text-right">
                <span className="bux-hud-label">Rank</span>
                <span className="bux-hud-value">{topRightPosition}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Oval table — textured felt + wood/brass rail */}
      <div 
        className="bux-felt bux-rail relative h-full w-full max-h-full max-w-full rounded-[50%]" 
        style={{ 
          aspectRatio: "3/2",
          maxHeight: "min(100%, calc(100dvh - var(--action-dock-height, 100px) - 1.5rem))",
          maxWidth: "min(100%, 96vw)",
        }}
      >
        


        {/* Tournament Starting Countdown - Center of table */}
        {tournamentCountdown && tournamentCountdown.seconds > 0 && (
          <div 
            className="absolute left-1/2 top-1/2 z-20 flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2"
          >
            <div 
              className="bg-slate-900/95 rounded-lg border-yellow-500 shadow-2xl text-center backdrop-blur-sm"
              style={{
                paddingLeft: 'var(--countdown-padding-x, 16px)',
                paddingRight: 'var(--countdown-padding-x, 16px)',
                paddingTop: 'var(--countdown-padding-y, 12px)',
                paddingBottom: 'var(--countdown-padding-y, 12px)',
                borderWidth: 'var(--countdown-border-width, 2px)'
              }}
            >
              <p 
                className="font-semibold text-yellow-400 mb-1"
                style={{ fontSize: 'var(--countdown-title-size, 15px)' }}
              >
                Game Starting Soon
              </p>
              <div 
                className="font-bold text-emerald-400"
                style={{ fontSize: 'var(--countdown-time-size, 30px)' }}
              >
                {Math.floor(tournamentCountdown.seconds / 60)}:{(tournamentCountdown.seconds % 60).toString().padStart(2, '0')}
              </div>
            </div>
          </div>
        )}

        {/* Center: when showdown with winners show who won + hand; else total pot + community cards */}
        <div 
          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ gap: 'var(--community-card-gap, 8px)' }}
        >
          {/* Winner message: show for both real showdown and fold wins (fold wins have no handCategory, no card reveal) */}
          {showdownResults?.winners?.length > 0 ? (
            <div className="bux-panel rounded-xl px-4 py-2 text-center shadow-xl">
              {showdownResults.winners.length === 1 ? (
                <span className="font-display font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>
                  {showdownResults.winners[0].handCategory
                    ? `${showdownResults.winners[0].name} wins with ${formatHandCategory(showdownResults.winners[0].handCategory)}`
                    : `${showdownResults.winners[0].name} wins ${(showdownResults.winners[0].potWon ?? 0).toLocaleString()}`}
                </span>
              ) : (
                <span className="font-display font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>
                  {showdownResults.winners[0]?.handCategory
                    ? `${showdownResults.winners.map((w: any) => w.name).join(" & ")} split with ${formatHandCategory(showdownResults.winners[0]?.handCategory)}`
                    : `${showdownResults.winners.map((w: any) => w.name).join(" & ")} split ${(showdownResults.winners[0]?.potWon ?? 0).toLocaleString()}`}
                </span>
              )}
            </div>
          ) : (
            <div className="bux-pot">
              <span className="bux-pot-label">Pot</span>
              <div className="flex items-center gap-2">
                <BetChip value={pot} hideLabel />
                <span className="bux-pot-value">{pot.toLocaleString()}</span>
              </div>
              {sidePots.length > 1 && (
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                  {sidePots.map((sp, idx) => (
                    <span key={`${sp.label || "pot"}-${idx}`}>
                      {(sp.label || (idx === 0 ? "Main" : `Side ${idx}`))}:{" "}
                      <span className="font-semibold text-amber-200/90">{sp.amount.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {communityCards.length > 0 && (
          <div 
            className="flex"
            style={{ gap: 'var(--community-card-gap, 8px)' }}
          >
            {communityCards.map((card, idx) => {
              // Read CSS variables for responsive sizing - recalculate when window size changes
              let cardWidth = typeof window !== 'undefined' 
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-width')) || 64
                : 64;
              let cardHeight = typeof window !== 'undefined'
                ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--community-card-height')) || 90
                : 90;
              
              // Collect all winning cards from all winners
              const allWinningCards: Card[] = [];
              if (showdownResults?.winners) {
                showdownResults.winners.forEach((w: any) => {
                  const winningCards = w.hand?.cards || [];
                  allWinningCards.push(...winningCards);
                });
              }
              
              // Check if this card is part of any winning hand
              const isWinningCard = allWinningCards.some((wc: Card) => wc.rank === card.rank && wc.suit === card.suit);
              
              // Only shrink/gray losing cards when we have winner highlight (not during reveal/flop/turn/river phases)
              const hasWinnerHighlight = showdownActive && showdownResults?.winners && showdownResults.winners.length > 0;
              const isLosingCard = hasWinnerHighlight && !isWinningCard;
              const showdownScale = isLosingCard ? 0.75 : 1; // Make losing cards 75% size
              
              // Use windowSize to trigger recalculation
              return (
                <div
                  key={`community-${idx}-${windowSize.width}`}
                  className="relative transition-all duration-500"
                  style={{
                    transform: `scale(${showdownScale})`,
                  }}
                >
                  <PokerCardImage
                    card={card}
                    width={cardWidth}
                    height={cardHeight}
                    className={`shadow-xl transition-all duration-500 ${
                      isWinningCard ? 'ring-2 ring-yellow-400' : ''
                    } ${
                      isLosingCard ? 'opacity-40 grayscale' : ''
                    }`}
                    useTextCard={false}
                  />
                </div>
              );
            })}
          </div>
          )}
        </div>

        {/* Player Positions — occupied seats only */}
        {allSeats.flatMap((player, seatIdx) => {
          if (!player) return [];
          // visualIdx = where this server seat appears on screen after user rotate
          const visualIdx = (seatIdx + seatRotate) % 10;
          const position = PLAYER_POSITIONS[visualIdx];
          // Keep seats slightly inward on short/narrow viewports so labels don't clip or hit the dock.
          const radiusPercent =
            windowSize.height > 0 && windowSize.height < 520
              ? 40
              : windowSize.width < 900
                ? 42
                : 45;
          const angleRad = (position.angle * Math.PI) / 180;
          
          const isMyPlayer = player && (String(myUserId ?? "") === String(player.id ?? "") || String(myUserId ?? "") === String(player.userId ?? ""));
          const isCurrentTurn = player && (String(currentPlayer ?? "") === String(player.id ?? "") || String(currentPlayer ?? "") === String(player.userId ?? ""));
          // Timer events can arrive out of order with game-state; only pulse when timer matches server's current turn.
          const timerMatchesServerTurn =
            turnTimer != null &&
            String(turnTimer.userId ?? "") === String(currentPlayer ?? "");
          const hasActiveTimer =
            timerMatchesServerTurn &&
            player &&
            !player.isAway &&
            (String(player.userId ?? "") === String(turnTimer.userId ?? "") ||
              String(player.id ?? "") === String(turnTimer.userId ?? ""));
          const rawTimerRemaining = hasActiveTimer
            ? Math.max(0, Math.ceil((turnTimer.expiresAt - currentTime) / 1000))
            : null;
          // Match server: humans get a full 20s action window (backend turnTimers.js); show entire countdown so 0s aligns with auto CHECK/FOLD.
          const timerRemaining = rawTimerRemaining;

          const isFolded = player?.status === "FOLDED";
          const revealStatus = player?.showdownRevealStatus;
          const optionalRevealPhase = !!(showdownActive && showdownResults);
          const showFoldedReveal =
            isFolded && optionalRevealPhase && revealStatus === "SHOW";
          // Hero always face-up at seat; forceSeatCardsFaceDown only affects opponents (table-test).
          const seatCardsFaceUp =
            !!player &&
            !!player.holeCards?.length &&
            !isFolded &&
            (isMyPlayer ||
              (!forceSeatCardsFaceDown &&
                (debugAllSeatCardsFaceUp || showdownActive || showFoldedReveal)));
          
          // Layout uses visual position index (after rotate), not server seat number
          const visualSeat = visualIdx + 1;
          const cardsOnRight = [1, 2, 3, 9, 10].includes(visualSeat);
          const baseCardOffset = 80;
          // Same offset for face-up and face-down so hole cards share one orbit.
          const offsetScale = windowSize.width < 1000 ? 0.62 : 1;
          const cardOffset = cardsOnRight ? baseCardOffset * offsetScale : -baseCardOffset * offsetScale;
          // Adjust vertical position for smaller screens: seats 1-5 down, 6-10 up
          let verticalOffset = 0;
          if (windowSize.width <= 900) {
            verticalOffset = visualSeat <= 5 ? 6 : -22;
          } else if (windowSize.width >= 901 && windowSize.width <= 1000) {
            if (visualSeat === 1 || visualSeat === 5) {
              verticalOffset = 13;
            } else if (visualSeat === 6 || visualSeat === 10) {
              verticalOffset = -28;
            } else if (visualSeat <= 5) {
              verticalOffset = 5;
            } else {
              verticalOffset = -20;
            }
          }
          // Pull hole cards slightly inward near top/bottom so they stay inside the table area.
          let cardRimNudge = 0;
          if (windowSize.width < 1100) {
            const rimY = Math.sin(angleRad);
            if (rimY < -0.7) cardRimNudge = 18;
            else if (rimY > 0.7) cardRimNudge = -10;
          }

          const baseHorizontalOffset = [1, 2, 3, 9, 10].includes(visualSeat) ? -20 : 20;
          // Additional horizontal tweak for smaller screens — keep side seats inside the frame.
          const smallScreenOffset = windowSize.width <= 900
            ? ((visualIdx === 0 || visualIdx === 9) ? -8 : ((visualIdx === 4 || visualIdx === 5) ? 8 : 0))
            : 0;
          // Capsules share space with hole cards — nudge seat only (not cards) away.
          const seatClearance = windowSize.width < 1000 ? 12 : 22;
          const seatFromCardsOffset = cardsOnRight ? -seatClearance : seatClearance;
          const layoutHorizontalOffset = baseHorizontalOffset + smallScreenOffset;
          const seatHorizontalOffset = layoutHorizontalOffset + seatFromCardsOffset;

          const elements = [
            <div
              key={`player-${player?.id || `seat-${seatIdx + 1}`}`}
              className="absolute z-[60]"
              style={{
                left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${seatHorizontalOffset}px)`,
                top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${verticalOffset}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div 
                className="flex flex-col items-center"
                style={{
                  flexDirection: visualSeat >= 6 && visualSeat <= 10 ? 'column-reverse' : 'column'
                }}
              >
                  {/* Occupied seats only — empty seats stay quiet */}
                  {player ? (
                    <>
                      <div
                        className={`relative rounded-full ${isCurrentTurn && !hasActiveTimer ? "bux-turn-ring" : ""}`}
                        ref={(el) => {
                          const key = playerKey(player);
                          if (key) seatRefs.current.set(key, el);
                          if (player.userId) seatRefs.current.set(String(player.userId), el);
                          if (player.id) seatRefs.current.set(String(player.id), el);
                        }}
                      >
                        {hasActiveTimer && turnTimer && (
                          <svg
                            className={`bux-timer-ring ${
                              timerRemaining != null && timerRemaining <= 5 ? "urgent" : ""
                            }`}
                            viewBox="0 0 40 40"
                            aria-hidden
                          >
                            <circle className="track" cx="20" cy="20" r="18" />
                            <circle
                              className="progress"
                              cx="20"
                              cy="20"
                              r="18"
                              strokeDasharray={`${2 * Math.PI * 18}`}
                              strokeDashoffset={`${
                                2 *
                                Math.PI *
                                18 *
                                (1 -
                                  Math.min(
                                    1,
                                    Math.max(
                                      0,
                                      (turnTimer.expiresAt - currentTime) /
                                        Math.max(1, turnTimer.duration || 20000)
                                    )
                                  ))
                              }`}
                            />
                          </svg>
                        )}
                        <button
                          type="button"
                          data-seat-avatar
                          disabled={!onSendReaction || !myUserId}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSeatAvatarClick(playerKey(player));
                          }}
                          className={`relative overflow-hidden rounded-full border-2 bg-slate-800 ${
                            isCurrentTurn
                              ? "border-[color:var(--bux-brass)]"
                              : "border-slate-700"
                          } ${
                            onSendReaction && myUserId
                              ? "cursor-pointer transition-transform hover:scale-105 active:scale-95"
                              : "cursor-default"
                          }`}
                          style={{
                            width: "var(--player-avatar-size, 64px)",
                            height: "var(--player-avatar-size, 64px)",
                          }}
                          title={
                            onSendReaction && myUserId
                              ? playerMatchesUser(player, myUserId)
                                ? "React"
                                : `React at ${player.name}`
                              : player.name
                          }
                          aria-label={
                            playerMatchesUser(player, myUserId)
                              ? "Open your emoji reactions"
                              : `Throw emoji at ${player.name}`
                          }
                        >
                          {(() => {
                            const isTestPlayer = player.name.toLowerCase().startsWith("test player");
                            if (!isTestPlayer && player.avatarUrl) {
                              return (
                                <img
                                  src={player.avatarUrl}
                                  alt={player.name}
                                  className="pointer-events-none h-full w-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = "/guest-avatar.png";
                                  }}
                                />
                              );
                            }
                            return (
                              <div className="pointer-events-none flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-700 to-teal-900 text-2xl font-bold text-white">
                                {player.name.charAt(0).toUpperCase()}
                              </div>
                            );
                          })()}

                          {player.isAway &&
                            player.status !== "FOLDED" &&
                            player.status !== "ELIMINATED" && (
                              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/75">
                                <span
                                  className="select-none font-extrabold uppercase tracking-wide text-amber-300"
                                  style={{ fontSize: "11px" }}
                                >
                                  Away
                                </span>
                              </div>
                            )}

                          {showdownActive && player.status === "ELIMINATED" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-900/60">
                              <span className="select-none text-3xl font-extrabold text-red-300">✕</span>
                            </div>
                          )}
                        </button>

                        {/* Action badge below face — never covers avatar */}
                        {(() => {
                          const playerId = player.id || player.userId || "";
                          const overlay = actionOverlays[playerId];
                          if (!overlay) return null;
                          const age = Date.now() - overlay.timestamp;
                          const permanent = isPermanentAction(overlay.action);
                          const actionOpacity = permanent
                            ? 1
                            : Math.max(0, 1 - age / ACTION_FADE_MS);
                          if (actionOpacity <= 0) return null;
                          const actionInfo = getActionInfo(overlay.action);
                          return (
                            <div
                              className="bux-seat-action-badge"
                              style={{ color: actionInfo.color, opacity: actionOpacity }}
                            >
                              {actionInfo.text}
                            </div>
                          );
                        })()}

                        {player.isDealer && (
                          <div
                            className="absolute -right-1 -top-1 z-[60] flex items-center justify-center rounded-full border-2 border-white bg-yellow-500 shadow-lg"
                            style={{
                              width: "var(--dealer-button-size, 28px)",
                              height: "var(--dealer-button-size, 28px)",
                            }}
                          >
                            <span
                              className="font-bold text-yellow-900"
                              style={{ fontSize: "calc(var(--dealer-button-size, 28px) * 0.4)" }}
                            >
                              D
                            </span>
                          </div>
                        )}
                      </div>

                      <div
                        className="bux-seat-capsule mt-0.5"
                        style={{
                          zIndex:
                            isMobile && seatCardsFaceUp ? 85 : isMyPlayer && isMobile ? 80 : 50,
                        }}
                      >
                        <div className="bux-seat-name">{player.name}</div>
                        <div className="bux-seat-stack">{player.chips.toLocaleString()}</div>
                      </div>
                    </>
                  ) : null}
              </div>
            </div>
          ];

          // Seat hole cards (hero face-up; others backs until showdown). Folded hide unless reveal.
          if (
            player &&
            player.holeCards &&
            player.holeCards.length > 0 &&
            (!isFolded || showFoldedReveal)
          ) {
            const showFaceUp = seatCardsFaceUp;
            
            // Get winner information for highlighting and pot won display
            const winnerInfo = showdownResults?.winners?.find((w: any) => w.playerId === player.id || w.userId === player.userId);
            const isWinner = !!winnerInfo;
            const potWon = winnerInfo?.potWon ?? 0;
            
            // Collect all winning cards from all winners (for highlighting)
            const allWinningCards: Card[] = [];
            if (showdownResults?.winners) {
              showdownResults.winners.forEach((w: any) => {
                const winningCards = w.hand?.cards || [];
                allWinningCards.push(...winningCards);
              });
            }
            
            // Check if a specific card is part of any winning hand
            const isWinningCard = (card: Card) => {
              return allWinningCards.some(wc => wc.rank === card.rank && wc.suit === card.suit);
            };
            
            // Base card dimensions from CSS variables
            const baseHoleWidth = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-width')) || 28
              : 28;
            const baseHoleHeight = typeof window !== 'undefined'
              ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hole-card-height')) || 39
              : 39;
            
            // Never 2× on mobile — keep face-up/face-down sizes close so layout stays stable.
            const enlargeFaceUp = showFaceUp && !isMobile;
            const holeWidth = Math.round(enlargeFaceUp ? baseHoleWidth * 2 : baseHoleWidth);
            const holeHeight = Math.round(enlargeFaceUp ? baseHoleHeight * 2 : baseHoleHeight);
            
            elements.push(
              <div
                key={`cards-${player.id}`}
                className={`absolute flex flex-col items-center gap-1 ${isFolded ? 'opacity-50' : ''}`}
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset + layoutHorizontalOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${verticalOffset + cardRimNudge}px)`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'transform 0.5s ease-in-out',
                  zIndex: isMobile && showFaceUp ? 40 : 70,
                }}
              >
                {/* Bet chip and winner +pot above cards for seats 1-5 */}
                {(visualSeat <= 5) && (
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {(player.contribution ?? 0) > 0 && <BetChip value={player.contribution!} />}
                    {isWinner && potWon > 0 && (
                      <div className="flex items-center gap-0.5 rounded-md border-2 border-amber-400/80 bg-amber-500/30 px-1.5 py-0.5 shadow-md">
                        <span className="font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>+{potWon.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex" style={{ gap: 'var(--hole-card-gap, 4px)' }}>
                  {player.holeCards.map((card, cardIdx) => {
                    // Only shrink/gray losing cards when we have winner highlight (not during reveal phases)
                    const hasWinnerHighlight = showdownActive && showdownResults?.winners && showdownResults.winners.length > 0;
                    const cardIsWinning = hasWinnerHighlight && !isFolded && isWinningCard(card);
                    const cardIsLosing = hasWinnerHighlight && !isFolded && !isWinningCard(card);
                    const cardScale = cardIsLosing ? 0.75 : 1; // Losing cards at 75% size
                    
                    return (
                      <div 
                        key={`${player.id}-${cardIdx}-${windowSize.width}`} 
                        className="relative transition-all duration-500"
                        style={{
                          transform: `scale(${cardScale})`,
                        }}
                      >
                        <PokerCardImage
                          card={card}
                          width={holeWidth}
                          height={holeHeight}
                          className={`shadow-md transition-all duration-500 ${
                            cardIsWinning ? 'ring-2 ring-yellow-400' : ''
                          } ${
                            cardIsLosing ? 'opacity-40 grayscale' : ''
                          }`}
                          faceDown={!showFaceUp}
                          useTextCard={isMobile}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Bet chip and winner +pot below cards for seats 6-10 */}
                {(visualSeat > 5) && (
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {(player.contribution ?? 0) > 0 && <BetChip value={player.contribution!} />}
                    {isWinner && potWon > 0 && (
                      <div className="flex items-center gap-0.5 rounded-md border-2 border-amber-400/80 bg-amber-500/30 px-1.5 py-0.5 shadow-md">
                        <span className="font-bold text-amber-200" style={{ fontSize: 'var(--bet-chip-text-size, 13px)' }}>+{potWon.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          } else if (player && (player.contribution ?? 0) > 0) {
            // Bet chip for players without cards but with bets (including own player)
            elements.push(
              <div
                key={`bet-${player.id}`}
                className="absolute z-20"
                style={{
                  left: `calc(50% + ${Math.cos(angleRad) * radiusPercent}% + ${cardOffset + layoutHorizontalOffset}px)`,
                  top: `calc(50% + ${Math.sin(angleRad) * radiusPercent}% + ${visualSeat <= 5 ? -60 : 60}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <BetChip value={player.contribution ?? 0} />
              </div>
            );
          }

          return elements;
        })}
      </div>

      {onSendReaction && (
        <EmojiReactionLayer
          reactions={reactions}
          players={players}
          myUserId={myUserId}
          pickerTargetUserId={pickerTargetUserId}
          onPick={handlePickEmoji}
          onClosePicker={() => setPickerTargetUserId(null)}
          seatRefs={seatRefs}
          tableRef={tableRootRef}
          cooldownRemainingMs={reactionCooldownMs}
        />
      )}
    </div>
  );
}
