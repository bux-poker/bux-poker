# Sound Effects Directory

This directory contains all sound effects for the poker game.

## Required Sound Files

Place the following MP3 files in this directory:

### Player Actions
- `fold.mp3` - Player folds
- `check.mp3` - Player checks
- `call.mp3` - Player calls
- `bet.mp3` - Player bets
- `raise.mp3` - Player raises
- `allin.mp3` - Player goes all-in

### Dealer Actions
- `deal-flop.mp3` - Dealer deals the flop
- `deal-turn.mp3` - Dealer deals the turn
- `deal-river.mp3` - Dealer deals the river
- `showdown.mp3` - Showdown begins

### Game Events
- `your-turn.mp3` - It's your turn
- `pot-win.mp3` - You win a pot
- `hand-start.mp3` - New hand begins
- `card-flip.mp3` - Card is flipped
- `card-deal.mp3` - Card is dealt

### Tournament Events
- `tournament-start.mp3` - Tournament begins
- `blind-level-up.mp3` - Blind level increases
- `player-eliminated.mp3` - Player eliminated

## Quick Download Guide

### Option 1: Freesound.org (Free, CC0 License)

1. Go to https://freesound.org
2. Create a free account
3. Search for sounds using these terms:
   - "poker chips" → for bet, call, raise, allin
   - "card flip" → for card-flip, card-deal
   - "card shuffle" → for hand-start, deal-flop
   - "notification" → for your-turn
   - "victory" → for pot-win
   - "whoosh" → for fold
   - "click" → for check
   - "dramatic" → for showdown, allin
   - "announcement" → for tournament-start

4. Filter by:
   - License: CC0 (Public Domain)
   - Duration: < 2 seconds
   - Format: MP3 or WAV (convert WAV to MP3 if needed)

5. Download and rename files to match the list above

### Option 2: Zapsplat (Free with Attribution)

1. Go to https://www.zapsplat.com
2. Search for "poker", "casino", "cards", "chips"
3. Download and attribute in your app (add to credits/about page)

### Option 3: Mixkit (Free, No Attribution)

1. Go to https://mixkit.co/free-sound-effects/
2. Search for relevant sounds
3. Download and rename

### Option 4: Generate with AI

Use tools like:
- Mubert (https://mubert.com)
- AIVA (https://www.aiva.ai)

## File Format Requirements

- **Format**: MP3
- **Bitrate**: 128-192 kbps
- **Sample Rate**: 44.1 kHz
- **Channels**: Mono (for most sounds), Stereo (for dramatic sounds like allin, pot-win)
- **Duration**: Keep under 2 seconds for most sounds
- **File Size**: Aim for under 100KB per file

## Converting Audio Files

If you download WAV or other formats, convert to MP3:

### Using FFmpeg (Command Line)
```bash
ffmpeg -i input.wav -codec:a libmp3lame -b:a 128k output.mp3
```

### Using Online Converters
- https://cloudconvert.com/wav-to-mp3
- https://convertio.co/wav-mp3/

## Testing Sounds

After adding sounds, test them by:
1. Starting a poker game
2. Performing various actions (fold, bet, call, etc.)
3. Verifying each sound plays correctly
4. Checking volume levels are consistent

## Current Status

Currently using placeholder sounds:
- `turn.mp3` (old - will be replaced by `your-turn.mp3`)
- `fold.wav` (old - will be replaced by `fold.mp3`)
- `bet.wav` (old - will be replaced by `bet.mp3`)
- `check.wav` (old - will be replaced by `check.mp3`)

All other sounds need to be added.
