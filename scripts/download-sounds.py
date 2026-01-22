#!/usr/bin/env python3
"""
Script to help download poker sound effects from free sources.
This script provides a semi-automated way to download sounds.
"""

import os
import sys
import requests
import json
from pathlib import Path

SOUNDS_DIR = Path("client/public/sounds")
SOUNDS_DIR.mkdir(parents=True, exist_ok=True)

# Required sound files
REQUIRED_SOUNDS = [
    # Player Actions
    "fold.mp3",
    "check.mp3", 
    "call.mp3",
    "bet.mp3",
    "raise.mp3",
    "allin.mp3",
    # Dealer Actions
    "deal-flop.mp3",
    "deal-turn.mp3",
    "deal-river.mp3",
    "showdown.mp3",
    # Game Events
    "your-turn.mp3",
    "pot-win.mp3",
    "hand-start.mp3",
    "card-flip.mp3",
    "card-deal.mp3",
    # Tournament Events
    "tournament-start.mp3",
    "blind-level-up.mp3",
    "player-eliminated.mp3",
]

def download_from_url(url, filename):
    """Download a file from a URL."""
    try:
        print(f"Downloading {filename}...")
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        filepath = SOUNDS_DIR / filename
        with open(filepath, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"✓ Downloaded {filename}")
        return True
    except Exception as e:
        print(f"✗ Failed to download {filename}: {e}")
        return False

def check_existing_sounds():
    """Check which sounds already exist."""
    existing = []
    missing = []
    
    for sound in REQUIRED_SOUNDS:
        if (SOUNDS_DIR / sound).exists():
            existing.append(sound)
        else:
            missing.append(sound)
    
    return existing, missing

def main():
    print("Poker Sound Effects Downloader")
    print("=" * 50)
    print()
    
    # Check existing sounds
    existing, missing = check_existing_sounds()
    
    if existing:
        print(f"Found {len(existing)} existing sounds:")
        for sound in existing:
            print(f"  ✓ {sound}")
        print()
    
    if missing:
        print(f"Missing {len(missing)} sounds:")
        for sound in missing:
            print(f"  ✗ {sound}")
        print()
    
    print("=" * 50)
    print()
    print("This script cannot automatically download from most free sound sites")
    print("because they require manual interaction or API keys.")
    print()
    print("RECOMMENDED APPROACH:")
    print("1. Visit https://mixkit.co/free-sound-effects/")
    print("2. Search for each sound type:")
    print("   - 'card flip' → card-flip.mp3, card-deal.mp3")
    print("   - 'poker chips' → bet.mp3, call.mp3, raise.mp3, allin.mp3")
    print("   - 'click' → check.mp3")
    print("   - 'whoosh' → fold.mp3")
    print("   - 'notification' → your-turn.mp3")
    print("   - 'victory' → pot-win.mp3")
    print("   - 'card shuffle' → hand-start.mp3, deal-flop.mp3")
    print("   - 'dramatic' → showdown.mp3, allin.mp3")
    print("   - 'announcement' → tournament-start.mp3")
    print("3. Download each file and save with the exact filename")
    print("4. Place all files in: client/public/sounds/")
    print()
    print("ALTERNATIVE: Use Freesound API")
    print("1. Get free API key from https://freesound.org/apikey/")
    print("2. Set FREESOUND_API_KEY environment variable")
    print("3. Run this script with --freesound flag")
    print()
    
    # If API key is provided, try Freesound
    api_key = os.getenv("FREESOUND_API_KEY")
    if api_key and "--freesound" in sys.argv:
        print("Attempting to download from Freesound API...")
        # This would require implementing Freesound API calls
        print("Freesound API integration not yet implemented.")
        print("You can use their web interface at https://freesound.org")
    
    print()
    print("For now, please download sounds manually from the sites above.")
    print("All sounds should be MP3 format, 128-192 kbps, under 2 seconds.")

if __name__ == "__main__":
    main()
