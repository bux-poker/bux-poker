/**
 * Sound Manager for Poker Game
 * Preloads all sounds and manages playback to ensure smooth, consistent sound effects
 */

type SoundName =
  // Player Actions
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allin'
  // Dealer Actions
  | 'deal-flop'
  | 'deal-turn'
  | 'deal-river'
  | 'showdown'
  // Game Events
  | 'your-turn'
  | 'pot-win'
  | 'hand-start'
  | 'card-flip'
  | 'card-deal'
  // Tournament Events
  | 'tournament-start'
  | 'blind-level-up'
  | 'player-eliminated';

interface SoundConfig {
  file: string;
  volume: number;
  preload: boolean;
}

const SOUND_CONFIGS: Record<SoundName, SoundConfig> = {
  // Player Actions
  fold: { file: 'fold.mp3', volume: 0.5, preload: true },
  check: { file: 'check.mp3', volume: 0.5, preload: true },
  call: { file: 'call.mp3', volume: 0.5, preload: true },
  bet: { file: 'bet.mp3', volume: 0.5, preload: true },
  raise: { file: 'raise.mp3', volume: 0.6, preload: true },
  allin: { file: 'allin.mp3', volume: 0.7, preload: true },
  
  // Dealer Actions
  'deal-flop': { file: 'deal-flop.mp3', volume: 0.6, preload: true },
  'deal-turn': { file: 'deal-turn.mp3', volume: 0.6, preload: true },
  'deal-river': { file: 'deal-river.mp3', volume: 0.6, preload: true },
  showdown: { file: 'showdown.mp3', volume: 0.7, preload: true },
  
  // Game Events
  'your-turn': { file: 'your-turn.mp3', volume: 0.6, preload: true },
  'pot-win': { file: 'pot-win.mp3', volume: 0.7, preload: true },
  'hand-start': { file: 'hand-start.mp3', volume: 0.5, preload: true },
  'card-flip': { file: 'card-flip.mp3', volume: 0.4, preload: true },
  'card-deal': { file: 'card-deal.mp3', volume: 0.4, preload: true },
  
  // Tournament Events
  'tournament-start': { file: 'tournament-start.mp3', volume: 0.7, preload: true },
  'blind-level-up': { file: 'blind-level-up.mp3', volume: 0.6, preload: true },
  'player-eliminated': { file: 'player-eliminated.mp3', volume: 0.5, preload: true },
};

class SoundManager {
  private audioCache: Map<SoundName, HTMLAudioElement> = new Map();
  private isEnabled: boolean = true;
  private masterVolume: number = 1.0;
  private loadedCount: number = 0;
  private totalSounds: number = Object.keys(SOUND_CONFIGS).length;
  private queue: { name: SoundName; volume?: number }[] = [];
  private isQueuePlaying: boolean = false;
  /** Set to true after first user gesture so autoplay policy allows playback. */
  private unlocked: boolean = false;

  constructor() {
    this.preloadSounds();
  }

  /**
   * Call on first user interaction (e.g. click/touch) to unlock audio.
   * Browsers block sound until the user has interacted with the page.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    // Play and immediately pause the first preloaded sound to satisfy autoplay policy
    const first = Object.keys(SOUND_CONFIGS)[0] as SoundName;
    const audio = this.audioCache.get(first);
    if (audio) {
      const clone = audio.cloneNode() as HTMLAudioElement;
      clone.volume = 0;
      clone.play().then(() => clone.pause()).catch(() => {});
    }
  }

  /**
   * Preload all sounds for instant playback
   */
  private preloadSounds(): void {
    Object.entries(SOUND_CONFIGS).forEach(([name, config]) => {
      if (config.preload) {
        const audio = new Audio(`/sounds/${config.file}`);
        audio.preload = 'auto';
        audio.volume = config.volume * this.masterVolume;
        audio.load();
        
        // Track loading progress
        let counted = false;
        const onReady = () => {
          if (counted) return;
          counted = true;
          this.loadedCount++;
          if (this.loadedCount === this.totalSounds) {
            console.log('[SOUND] All sounds preloaded');
          }
        };
        audio.addEventListener('canplaythrough', onReady, { once: true });
        audio.addEventListener('loadeddata', onReady, { once: true });
        
        audio.addEventListener('error', (e) => {
          console.warn(`[SOUND] Failed to load ${name}:`, e);
        });
        
        this.audioCache.set(name as SoundName, audio);
      }
    });
  }

  /**
   * Play a sound effect immediately (no sequencing)
   */
  play(soundName: SoundName, volumeOverride?: number): void {
    if (!this.isEnabled) return;
    this.unlock();

    const audio = this.audioCache.get(soundName);
    if (!audio) {
      // Fallback: lazily create the sound if preload missed or failed.
      const config = SOUND_CONFIGS[soundName];
      if (!config) return;
      const lazyAudio = new Audio(`/sounds/${config.file}`);
      lazyAudio.preload = 'auto';
      lazyAudio.volume = config.volume * this.masterVolume;
      lazyAudio.load();
      this.audioCache.set(soundName, lazyAudio);
    }

    // Clone the audio element to allow overlapping sounds
    const sourceAudio = this.audioCache.get(soundName);
    if (!sourceAudio) return;
    const audioClone = sourceAudio.cloneNode() as HTMLAudioElement;
    audioClone.volume = volumeOverride !== undefined 
      ? volumeOverride * this.masterVolume 
      : audio.volume;
    
    // Reset to start in case it was already played
    audioClone.currentTime = 0;
    
    audioClone.play().catch((err) => {
      // Ignore errors from user interaction requirements or autoplay policies
      if (err.name !== 'NotAllowedError' && err.name !== 'NotSupportedError') {
        console.warn(`[SOUND] Failed to play ${soundName}:`, err);
      }
    });
  }

  /**
   * Enqueue a sound to be played after any currently playing queued sound finishes.
   * This guarantees sounds do not overlap and are heard clearly in sequence.
   */
  playQueued(soundName: SoundName, volumeOverride?: number): void {
    if (!this.isEnabled) return;
    this.queue.push({ name: soundName, volume: volumeOverride });
    if (!this.isQueuePlaying) {
      this.playNextInQueue();
    }
  }

  private playNextInQueue(): void {
    if (this.queue.length === 0) {
      this.isQueuePlaying = false;
      return;
    }

    const { name, volume } = this.queue.shift()!;
    const audio = this.audioCache.get(name);
    if (!audio) {
      console.warn(`[SOUND] Sound not found in queue: ${name}`);
      // Try next
      this.playNextInQueue();
      return;
    }

    this.isQueuePlaying = true;

    const audioClone = audio.cloneNode() as HTMLAudioElement;
    audioClone.volume = volume !== undefined
      ? volume * this.masterVolume
      : audio.volume;
    audioClone.currentTime = 0;

    audioClone.addEventListener('ended', () => {
      this.isQueuePlaying = false;
      this.playNextInQueue();
    }, { once: true });

    audioClone.play().catch((err) => {
      if (err.name !== 'NotAllowedError' && err.name !== 'NotSupportedError') {
        console.warn(`[SOUND] Failed to play queued ${name}:`, err);
      }
      // Even if play fails, move on to next
      this.isQueuePlaying = false;
      this.playNextInQueue();
    });
  }

  /**
   * Enable/disable all sounds
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Set master volume (0.0 to 1.0)
   */
  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    // Update cached audio volumes
    this.audioCache.forEach((audio, name) => {
      const config = SOUND_CONFIGS[name];
      audio.volume = config.volume * this.masterVolume;
    });
  }

  /**
   * Get loading progress (0.0 to 1.0)
   */
  getLoadingProgress(): number {
    return this.totalSounds > 0 ? this.loadedCount / this.totalSounds : 1;
  }

  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!this.audioCtx) this.audioCtx = new AC();
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /** Soft pop for self-reactions over avatar. */
  playEmojiPop(): void {
    if (!this.isEnabled) return;
    this.unlock();
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18 * this.masterVolume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  /** Whoosh for emoji throws across the table. */
  playEmojiThrow(): void {
    if (!this.isEnabled) return;
    this.unlock();
    const ctx = this.getAudioContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.22);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(900, t0);
    filter.frequency.exponentialRampToValueAtTime(1800, t0 + 0.18);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22 * this.masterVolume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + 0.24);

    // Soft landing chime
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t0 + 0.16);
    osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.32);
    og.gain.setValueAtTime(0.0001, t0 + 0.16);
    og.gain.exponentialRampToValueAtTime(0.12 * this.masterVolume, t0 + 0.18);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(t0 + 0.16);
    osc.stop(t0 + 0.36);
  }
}

// Export singleton instance
export const soundManager = new SoundManager();

// Export types and configs for use in components
export type { SoundName };
export { SOUND_CONFIGS };
