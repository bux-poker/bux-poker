export const TABLE_REACTION_EMOJIS = [
  { id: "sad", emoji: "😢", label: "Sad" },
  { id: "angry", emoji: "😠", label: "Angry" },
  { id: "celebrate", emoji: "🎉", label: "Celebrate" },
  { id: "snore", emoji: "😴", label: "Snore" },
  { id: "shit", emoji: "💩", label: "Shit" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "cool", emoji: "😎", label: "Cool" },
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
