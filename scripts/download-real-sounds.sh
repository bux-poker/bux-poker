#!/bin/bash

# Script to download real poker sound effects from free sources
# Uses direct download links where available

SOUNDS_DIR="client/public/sounds"
mkdir -p "$SOUNDS_DIR"

echo "Downloading poker sound effects from free sources..."
echo ""

# Function to download with curl
download_file() {
    local url=$1
    local filename=$2
    
    echo "Downloading $filename..."
    if curl -L -f -o "$SOUNDS_DIR/$filename" "$url" 2>/dev/null; then
        # Check if file is valid (not empty, not HTML error page)
        if [ -s "$SOUNDS_DIR/$filename" ] && file "$SOUNDS_DIR/$filename" | grep -q -E "(MPEG|Audio|MP3)"; then
            echo "✓ Downloaded $filename"
            return 0
        else
            echo "✗ $filename appears to be invalid (might be HTML error page)"
            rm -f "$SOUNDS_DIR/$filename"
            return 1
        fi
    else
        echo "✗ Failed to download $filename"
        return 1
    fi
}

# Note: Most free sound sites don't provide direct download links
# These would need to be manually obtained or use their APIs

echo "Since most free sound sites require manual downloads,"
echo "here's a comprehensive guide with specific search terms:"
echo ""
echo "=== MIXKIT (Free, No Attribution) ==="
echo "1. Go to: https://mixkit.co/free-sound-effects/"
echo "2. Search for each:"
echo "   - 'card flip' → card-flip.mp3, card-deal.mp3"
echo "   - 'poker chips' or 'coins' → bet.mp3, call.mp3, raise.mp3, allin.mp3"
echo "   - 'click' or 'tap' → check.mp3"
echo "   - 'whoosh' or 'swish' → fold.mp3"
echo "   - 'notification' or 'alert' → your-turn.mp3"
echo "   - 'victory' or 'success' → pot-win.mp3"
echo "   - 'card shuffle' → hand-start.mp3, deal-flop.mp3"
echo "   - 'dramatic' or 'suspense' → showdown.mp3"
echo "   - 'announcement' → tournament-start.mp3"
echo ""
echo "=== FREESOUND.ORG (Free, CC0 License) ==="
echo "1. Create free account: https://freesound.org"
echo "2. Search and filter by: License=CC0, Duration<2s"
echo "3. Download and convert to MP3 if needed"
echo ""
echo "=== ZAPSPLAT (Free with Attribution) ==="
echo "1. Go to: https://www.zapsplat.com"
echo "2. Search: 'poker', 'casino', 'cards', 'chips'"
echo "3. Download and add attribution"
echo ""

# Try to download from a public CDN if we can find direct links
# For now, we'll create a Python script that can use APIs

echo "Creating Python script for automated downloads..."
cat > "$SOUNDS_DIR/auto-download.py" << 'PYTHON_SCRIPT'
#!/usr/bin/env python3
"""
Automated sound downloader using various free APIs
"""
import os
import sys

print("""
AUTOMATED SOUND DOWNLOADER
==========================

This script helps download sounds from free APIs.

OPTION 1: Mixkit (Manual - No API)
- Visit: https://mixkit.co/free-sound-effects/
- Search and download manually
- No API available, but free and no attribution needed

OPTION 2: Freesound API (Requires API Key)
1. Get free API key: https://freesound.org/apikey/
2. Set environment variable: export FREESOUND_API_KEY=your_key
3. Run: python3 auto-download.py --freesound

OPTION 3: Use this script to batch download from direct URLs
- Edit this script and add direct download URLs
- Run: python3 auto-download.py --direct
""")

if "--freesound" in sys.argv:
    api_key = os.getenv("FREESOUND_API_KEY")
    if not api_key:
        print("ERROR: FREESOUND_API_KEY not set")
        print("Get one from: https://freesound.org/apikey/")
        sys.exit(1)
    
    print("Freesound API integration would go here")
    print("For now, use their web interface: https://freesound.org")

PYTHON_SCRIPT

chmod +x "$SOUNDS_DIR/auto-download.py"

echo "✓ Created helper scripts"
echo ""
echo "RECOMMENDED: Manual download from Mixkit"
echo "It's the fastest way - just visit the site and download!"
echo ""
echo "All files should be saved as MP3 in: $SOUNDS_DIR"
