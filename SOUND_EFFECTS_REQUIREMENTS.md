# Poker Game Sound Effects Requirements

## Recommended Audio Format

**Format: MP3 (MPEG-1 Audio Layer 3)**
- **Why MP3?**
  - Universal browser support (Chrome, Firefox, Safari, Edge)
  - Good compression (smaller file sizes = faster loading)
  - Acceptable quality at 128-192 kbps for game sounds
  - No licensing issues for game use
  - Works well with HTML5 Audio API

**Alternative: OGG Vorbis** (if you need better compression)
- Better compression than MP3
- Open source
- But requires fallback MP3 for Safari/iOS

**Recommendation: Use MP3 at 128-192 kbps, mono or stereo depending on sound**

---

## Complete Sound Effects List

### Player Actions (6 sounds)
1. **fold** - Player folds their hand
   - Short, soft "whoosh" or card slide sound
   - Duration: 0.3-0.5s
   - Tone: Subtle, not jarring

2. **check** - Player checks
   - Quick, light tap or click
   - Duration: 0.2-0.4s
   - Tone: Neutral, quick

3. **call** - Player calls a bet
   - Chips stacking or coin drop
   - Duration: 0.4-0.6s
   - Tone: Medium weight, satisfying

4. **bet** - Player places a bet
   - Chips being pushed forward
   - Duration: 0.4-0.6s
   - Tone: Confident, medium weight

5. **raise** - Player raises
   - Stronger chip push or stack sound
   - Duration: 0.5-0.7s
   - Tone: More assertive than bet

6. **allin** - Player goes all-in
   - Dramatic chip stack or "all chips in" sound
   - Duration: 0.6-1.0s
   - Tone: Dramatic, attention-grabbing

### Dealer Actions (4 sounds)
7. **deal-flop** - Dealer deals the flop (3 cards)
   - Card dealing sound (3 cards)
   - Duration: 0.8-1.2s
   - Tone: Smooth, rhythmic

8. **deal-turn** - Dealer deals the turn (1 card)
   - Single card deal
   - Duration: 0.3-0.5s
   - Tone: Quick, clean

9. **deal-river** - Dealer deals the river (1 card)
   - Single card deal
   - Duration: 0.3-0.5s
   - Tone: Quick, clean (can reuse turn sound)

10. **showdown** - Showdown begins (cards turn face up)
    - Cards flipping or revealing sound
    - Duration: 0.5-0.8s
    - Tone: Anticipatory, dramatic

### Game Events (5 sounds)
11. **your-turn** - It becomes your turn to act
    - Notification sound (not too loud)
    - Duration: 0.4-0.6s
    - Tone: Alerting but pleasant

12. **pot-win** - Player wins a pot
    - Victory/chips collecting sound
    - Duration: 0.8-1.2s
    - Tone: Celebratory, satisfying

13. **hand-start** - New hand begins
    - Shuffle or cards being dealt
    - Duration: 0.5-0.8s
    - Tone: Fresh start, energetic

14. **card-flip** - Individual card is flipped/revealed
    - Quick card flip sound
    - Duration: 0.2-0.3s
    - Tone: Quick, crisp

15. **card-deal** - Card is being dealt
    - Single card dealing sound
    - Duration: 0.2-0.4s
    - Tone: Smooth, quick

### Tournament Events (3 sounds)
16. **tournament-start** - Tournament begins
    - Announcement or starting sound
    - Duration: 1.0-2.0s
    - Tone: Exciting, attention-grabbing

17. **blind-level-up** - Blind levels increase
    - Notification or level-up sound
    - Duration: 0.6-1.0s
    - Tone: Alerting, significant

18. **player-eliminated** - Player is eliminated from tournament
    - Subtle elimination sound
    - Duration: 0.5-0.8s
    - Tone: Respectful, not too dramatic

---

## Sound Quality Guidelines

- **Sample Rate**: 44.1 kHz (standard)
- **Bitrate**: 128-192 kbps (good balance of quality and file size)
- **Channels**: Mono for most sounds (smaller files), Stereo for dramatic sounds (all-in, pot-win, tournament-start)
- **Duration**: Keep most sounds under 1 second for responsiveness
- **Volume Normalization**: Normalize all sounds to similar perceived loudness
- **File Size Target**: Keep individual sounds under 100KB when possible

---

## Where to Get Sound Effects

### Free Sources (CC0/Public Domain)
1. **Freesound.org** - https://freesound.org
   - Search for: "poker", "chips", "cards", "casino"
   - Filter by CC0 license
   - High quality, user-uploaded

2. **Zapsplat** - https://www.zapsplat.com
   - Free with attribution
   - Professional quality
   - Good casino/poker category

3. **Mixkit** - https://mixkit.co/free-sound-effects/
   - Free, no attribution needed
   - Curated selection

4. **OpenGameArt** - https://opengameart.org
   - Game-focused sounds
   - Various licenses

### Paid Sources (Higher Quality)
1. **AudioJungle** - https://audiojungle.net
   - $1-5 per sound
   - Professional quality
   - Royalty-free

2. **Pond5** - https://www.pond5.com
   - Similar to AudioJungle
   - Good poker/casino selection

3. **Epidemic Sound** - https://www.epidemicsound.com
   - Subscription service
   - High quality, unlimited use

### AI-Generated Sounds
1. **Mubert** - https://mubert.com
2. **AIVA** - https://www.aiva.ai
   - Can generate custom sounds

---

## Implementation Notes

1. **Preloading**: All sounds should be preloaded on game start
2. **Caching**: Use Audio object caching to avoid reload delays
3. **Volume Control**: Implement master volume control in settings
4. **Muting**: Allow users to mute sounds
5. **Overlap**: Allow sounds to overlap (don't stop previous sound when new one plays)
6. **Mobile**: Test on mobile devices - some browsers have autoplay restrictions

---

## File Naming Convention

All files should be named exactly as listed above:
- `fold.mp3`
- `check.mp3`
- `call.mp3`
- `bet.mp3`
- `raise.mp3`
- `allin.mp3`
- `deal-flop.mp3`
- `deal-turn.mp3`
- `deal-river.mp3`
- `showdown.mp3`
- `your-turn.mp3`
- `pot-win.mp3`
- `hand-start.mp3`
- `card-flip.mp3`
- `card-deal.mp3`
- `tournament-start.mp3`
- `blind-level-up.mp3`
- `player-eliminated.mp3`

Place all files in: `client/public/sounds/`
