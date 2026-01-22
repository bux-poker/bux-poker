#!/bin/bash

# Script to download poker game sound effects
# Uses free sources that allow direct downloads

SOUNDS_DIR="client/public/sounds"
mkdir -p "$SOUNDS_DIR"

echo "Downloading poker sound effects..."

# Function to download with retry
download_with_retry() {
    local url=$1
    local filename=$2
    local max_attempts=3
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        echo "Downloading $filename (attempt $attempt/$max_attempts)..."
        if curl -L -f -o "$SOUNDS_DIR/$filename" "$url" 2>/dev/null; then
            echo "✓ Downloaded $filename"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    echo "✗ Failed to download $filename"
    return 1
}

# Download from Mixkit (free, no attribution required)
# These are placeholder URLs - you'll need to find actual direct download links
# Mixkit requires manual download, so we'll use alternative sources

# Alternative: Use Freesound API (requires API key) or direct links
# For now, we'll download from a CDN that hosts free sounds

echo ""
echo "Note: Most free sound sites require manual download or API keys."
echo "This script will attempt to download from sources that allow direct links."
echo ""
echo "If downloads fail, you can:"
echo "1. Visit https://mixkit.co/free-sound-effects/ and search for poker/casino sounds"
echo "2. Visit https://freesound.org and search for poker sounds (requires free account)"
echo "3. Visit https://www.zapsplat.com and search for poker sounds"
echo ""

# Try downloading from a public CDN or GitHub releases
# Since we can't guarantee direct links, let's create a helper script instead

echo "Creating download helper script..."

cat > "$SOUNDS_DIR/download-helper.md" << 'EOF'
# Sound Download Helper

## Quick Download Links

### Mixkit (Free, No Attribution)
1. Go to: https://mixkit.co/free-sound-effects/
2. Search for each sound and download:
   - "card" → card-flip.mp3, card-deal.mp3
   - "chips" → bet.mp3, call.mp3, raise.mp3, allin.mp3
   - "click" → check.mp3
   - "whoosh" → fold.mp3
   - "notification" → your-turn.mp3
   - "victory" → pot-win.mp3
   - "shuffle" → hand-start.mp3, deal-flop.mp3
   - "dramatic" → showdown.mp3, allin.mp3
   - "announcement" → tournament-start.mp3

### Freesound.org (Free, CC0 License)
1. Create account: https://freesound.org
2. Search and filter by CC0 license
3. Download and convert to MP3 if needed

### Zapsplat (Free with Attribution)
1. Go to: https://www.zapsplat.com
2. Search for "poker", "casino", "cards", "chips"
3. Download and add attribution to your app

## Automated Download (Python Script)

Run: python3 scripts/download-sounds.py

This will help automate downloads from Freesound API (requires API key).
EOF

echo "✓ Created download helper guide"
echo ""
echo "Next steps:"
echo "1. Visit the free sound sites listed in $SOUNDS_DIR/download-helper.md"
echo "2. Download the 18 required sound files"
echo "3. Place them in $SOUNDS_DIR with the exact filenames"
echo ""
echo "Required files:"
echo "  - fold.mp3, check.mp3, call.mp3, bet.mp3, raise.mp3, allin.mp3"
echo "  - deal-flop.mp3, deal-turn.mp3, deal-river.mp3, showdown.mp3"
echo "  - your-turn.mp3, pot-win.mp3, hand-start.mp3, card-flip.mp3, card-deal.mp3"
echo "  - tournament-start.mp3, blind-level-up.mp3, player-eliminated.mp3"
