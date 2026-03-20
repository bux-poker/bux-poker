import { soundManager, SOUND_CONFIGS, type SoundName } from "../../utils/soundManager";

/**
 * Queued sound playback with legacy filename mapping.
 * Use from new code when you need playQueued + .mp3/.wav aliases; most of PokerGameView uses soundManager.play directly.
 */
export function playPokerGameSound(soundNameOrFile: string, volume: number = 0.7) {
  if (typeof window === "undefined") return;

  const legacyMap: Record<string, SoundName> = {
    "turn.mp3": "your-turn",
    "fold.wav": "fold",
    "bet.wav": "bet",
    "check.wav": "check",
  };

  let soundName: SoundName;
  if ((soundNameOrFile as SoundName) in SOUND_CONFIGS) {
    soundName = soundNameOrFile as SoundName;
  } else if (legacyMap[soundNameOrFile]) {
    soundName = legacyMap[soundNameOrFile];
  } else {
    soundName = soundNameOrFile.replace(/\.(mp3|wav)$/, "") as SoundName;
  }

  soundManager.playQueued(soundName, volume);
}
