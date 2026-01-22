#!/bin/bash

# Create silent placeholder MP3 files so the sound system doesn't error
# These will be replaced with real sounds later

SOUNDS_DIR="client/public/sounds"
mkdir -p "$SOUNDS_DIR"

# Create a minimal silent MP3 (1 second of silence)
# Using ffmpeg if available, otherwise create empty files as placeholders

create_silent_mp3() {
    local filename=$1
    local duration=${2:-0.5}  # Default 0.5 seconds
    
    if command -v ffmpeg &> /dev/null; then
        ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t $duration -q:a 9 -acodec libmp3lame "$SOUNDS_DIR/$filename" -y 2>/dev/null
        if [ $? -eq 0 ]; then
            echo "✓ Created $filename (silent MP3)"
            return 0
        fi
    fi
    
    # Fallback: create empty file (will cause errors but won't crash)
    touch "$SOUNDS_DIR/$filename"
    echo "⚠ Created placeholder $filename (empty file - replace with real sound)"
    return 1
}

echo "Creating placeholder sound files..."
echo "These are silent/empty files - replace them with real sounds from free sources"
echo ""

# Player Actions
create_silent_mp3 "fold.mp3" 0.3
create_silent_mp3 "check.mp3" 0.2
create_silent_mp3 "call.mp3" 0.4
create_silent_mp3 "bet.mp3" 0.4
create_silent_mp3 "raise.mp3" 0.5
create_silent_mp3 "allin.mp3" 0.8

# Dealer Actions
create_silent_mp3 "deal-flop.mp3" 1.0
create_silent_mp3 "deal-turn.mp3" 0.3
create_silent_mp3 "deal-river.mp3" 0.3
create_silent_mp3 "showdown.mp3" 0.6

# Game Events
create_silent_mp3 "your-turn.mp3" 0.4
create_silent_mp3 "pot-win.mp3" 1.0
create_silent_mp3 "hand-start.mp3" 0.6
create_silent_mp3 "card-flip.mp3" 0.2
create_silent_mp3 "card-deal.mp3" 0.3

# Tournament Events
create_silent_mp3 "tournament-start.mp3" 1.5
create_silent_mp3 "blind-level-up.mp3" 0.8
create_silent_mp3 "player-eliminated.mp3" 0.6

echo ""
echo "Placeholder files created!"
echo ""
echo "NEXT STEPS:"
echo "1. Visit https://mixkit.co/free-sound-effects/"
echo "2. Search and download real sounds"
echo "3. Replace the placeholder files in $SOUNDS_DIR"
echo ""
echo "Or run: ./scripts/download-sounds.sh for more options"
