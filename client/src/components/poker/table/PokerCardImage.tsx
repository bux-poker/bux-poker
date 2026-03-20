import React from "react";
import { motion } from "framer-motion";
import type { Card } from "@shared/types/poker";
import { RED_SUITS, SUIT_SYMBOLS } from "./pokerTableConstants";

function getCardImageFilename(card: Card): string {
  const suitMap: Record<string, string> = {
    SPADES: "S",
    HEARTS: "H",
    DIAMONDS: "D",
    CLUBS: "C",
  };
  const suit = suitMap[card.suit] || card.suit.charAt(0);
  const rank = card.rank === "10" ? "10" : card.rank;
  return rank + suit + ".png";
}

export function PokerCardImage({
  card,
  width,
  height,
  className = "",
  faceDown = false,
  useTextCard = false,
}: {
  card: Card;
  width: number;
  height: number;
  className?: string;
  faceDown?: boolean;
  useTextCard?: boolean;
}) {
  if (faceDown) {
    return (
      <div
        className={`${className} bg-blue-800 border-2 border-white rounded-lg relative overflow-hidden`}
        style={{ width, height }}
      >
        <div className="absolute inset-0 opacity-20">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent, transparent 6px, white 6px, white 7px), repeating-linear-gradient(-45deg, transparent, transparent 6px, white 6px, white 7px)",
            }}
          />
        </div>
      </div>
    );
  }

  if (useTextCard) {
    const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit.charAt(0);
    const isRed = RED_SUITS.has(card.suit);
    const rankSize = Math.max(10, Math.floor(height * 0.42));
    const suitSize = Math.max(10, Math.floor(height * 0.38));
    return (
      <div
        className={`${className} flex flex-col items-center justify-center rounded-lg border-2 border-slate-300 bg-white shadow-md`}
        style={{ width, height, minWidth: width, minHeight: height }}
      >
        <span className="font-bold leading-none" style={{ fontSize: rankSize, color: "#1a1a1a" }}>
          {card.rank}
        </span>
        <span
          className="leading-none"
          style={{ fontSize: suitSize, color: isRed ? "#b91c1c" : "#1a1a1a" }}
        >
          {suitSymbol}
        </span>
      </div>
    );
  }

  const filename = getCardImageFilename(card);
  const src = "/cards/" + filename;
  return (
    <motion.img
      src={src}
      alt={card.rank + card.suit}
      className={className}
      style={{
        width: width - 2,
        height,
        objectFit: "contain",
        padding: 0,
        margin: 0,
        borderRadius: "1px",
      }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        console.error("Card image failed to load:", filename);
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
