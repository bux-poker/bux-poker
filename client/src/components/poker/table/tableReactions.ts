export const TABLE_REACTION_EMOJIS = [
  { id: "sad", emoji: "😢", label: "Sad", src: "/images/reactions/sad.svg" },
  { id: "angry", emoji: "😠", label: "Angry", src: "/images/reactions/angry.svg" },
  {
    id: "celebrate",
    emoji: "🎉",
    label: "Celebrate",
    src: "/images/reactions/celebrate.svg",
  },
  { id: "snore", emoji: "😴", label: "Snore", src: "/images/reactions/snore.svg" },
  { id: "shit", emoji: "💩", label: "Shit", src: "/images/reactions/shit.svg" },
  { id: "love", emoji: "❤️", label: "Love", src: "/images/reactions/love.svg" },
  { id: "cool", emoji: "😎", label: "Cool", src: "/images/reactions/cool.svg" },
] as const;

export type TableReactionEmojiId = (typeof TABLE_REACTION_EMOJIS)[number]["id"];

export type TableReactionKind = "self" | "throw";

export type TableReactionEvent = {
  id: string;
  gameId: string;
  emoji: string;
  emojiId: TableReactionEmojiId;
  kind: TableReactionKind;
  fromUserId: string;
  toUserId: string;
  createdAt: number;
};

export const REACTION_COOLDOWN_MS = 10_000;

export function reactionEmojiSrc(emojiId: string): string | undefined {
  return TABLE_REACTION_EMOJIS.find((e) => e.id === emojiId)?.src;
}

export function createReactionId() {
  return `rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function playerMatchesUser(
  player: { id?: string; userId?: string } | null | undefined,
  userId: string | undefined
): boolean {
  if (!player || !userId) return false;
  return (
    String(player.userId ?? "") === String(userId) ||
    String(player.id ?? "") === String(userId)
  );
}

export function playerKey(player: { id?: string; userId?: string }) {
  return String(player.userId || player.id || "");
}
