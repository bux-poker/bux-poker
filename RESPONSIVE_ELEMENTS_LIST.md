# Responsive Sizing - Game Table Elements

## Screen Width Breakpoints
- 351-400px
- 401-450px
- 451-500px
- 501-550px
- 551-600px
- 601-650px
- 651-700px
- 701-750px
- 751-800px
- 801-850px
- 851-900px

---

## 1. TOP BAR (PokerGameView.tsx lines 420-448)

### Labels (currently `text-[10px] sm:text-xs`)
- "BLINDS"
- "NEXT BLIND"
- "TOTAL POT"
- "PLAYERS"
- "POSITION"

### Values (currently `text-base sm:text-lg`)
- Blind values (e.g., "10/20")
- Timer value (e.g., "5:30")
- Pot amount (e.g., "3,700")
- Player count (e.g., "7/7")
- Position number (e.g., "7")

### Container
- Padding: `px-3 sm:px-6 py-2 sm:py-3`
- Gap between elements: `gap-6`, `gap-3 sm:gap-6`

---

## 2. POKER TABLE (PokerTable.tsx)

### Table Border
- Border width: `border-8` (32px)

### Community Cards (center of table)
- Width: `80px`
- Height: `112px`
- Gap between cards: `gap-2` (8px)

### Player Elements

#### Player Avatars
- Size: `h-16 w-16` (64x64px)
- Border: `border-2` (8px)

#### Player Names
- Text size: `text-sm` (14px)
- Container: `px-2 py-1` with `max-w-[120px]`

#### Player Chip Counts
- Text size: `text-xs` (12px)
- Color: `text-emerald-300`
- Container: `px-2 py-1`

#### Dealer Button
- Size: `h-8 w-8` (32x32px)
- Text size: `text-xs` (12px)

#### Turn Timer Overlay
- Text size: `text-xl` (20px)
- Ring: `ring-4` with `ring-offset-2`

#### Hole Cards (face down/up at player positions)
- Width: `28px`
- Height: `39px`
- Gap: `gap-1` (4px)

#### Bet Chips (BetChip component)
- Chip size: `w-6 h-6` (24x24px)
- Value text: `text-xs` (12px)
- Gap: `gap-1` (4px)

#### Empty Seat Indicators
- Size: `h-16 w-16` (64x64px)
- Text size: `text-xs` (12px)

---

## 3. BETTING CONTROLS (BettingControls.tsx lines 92-214)

### Main Action Buttons (FOLD, CHECK, CALL, RAISE/BET)
- Width: `140px`
- Height: `48px`
- Text size: `text-base` (16px)
- Padding: `px-6 py-3`
- Gap between buttons: `gap-3` (12px)

### Preset Buttons (1/2, POT, 2/3, ALL IN)
- Text size: `text-sm` (14px)
- Padding: `px-3 py-2`
- Gap: `gap-2` (8px)

### Amount Input Field
- Width: `w-32` (128px)
- Height: `h-[68px]` (68px)
- Text size: `text-lg` (18px)
- Border: `border-2`

### +/- Buttons
- Width: `w-12` (48px)
- Height: `h-[68px]` (68px)
- Text size: `text-xl` (20px)

---

## 4. PLAYER'S HOLE CARDS (PokerGameView.tsx lines 486-513)

### Card Images (bottom left, player's own cards)
- Height: `h-full` (inherited from container)
- Width: `w-auto`
- Gap: `gap-2` (8px)
- Border: `border-2`

---

## 5. CHAT SIDEBAR (Chat components)

### Chat Container Width
- Width: `w-64 lg:w-80` (256px / 320px)

### Chat Header
- Button size: `w-48 h-40` (mobile) / `w-80 h-40` (desktop)
- Font size: `14px * scale`
- Padding: `8px * scale`

### Chat Messages
- Avatar size: `w-6 h-6 mr-1.5` (mobile) / `w-8 h-8 mr-2` (desktop)
- Message text: `14px * scaleFactor`
- Timestamp: `12px * scaleFactor`
- Username: `13px * scaleFactor`
- Message padding: `px-2 py-1.5` (mobile) / `px-3 py-2` (desktop)

### Chat Input
- Base font size: `12px` (mobile) / `14px` (desktop)
- Base height: `36px` (mobile) / `44px` (desktop)
- Base padding: `8px` (mobile) / `12px` (desktop)

---

## 6. LAYOUT & SPACING

### Main Container
- Table area padding: `p-8` (32px)
- Betting controls padding: `p-2 sm:p-4`

### Player Position Calculations
- Radius percent: `45%` from center
- Card offset: `80px` (left/right of avatar)

---

## SUMMARY BY ELEMENT TYPE

### Text Sizes
1. Top bar labels: 10px → 12px (xs)
2. Top bar values: 16px → 18px (base → lg)
3. Player names: 14px (sm)
4. Player chips: 12px (xs)
5. Dealer button text: 12px (xs)
6. Timer text: 20px (xl)
7. Bet chip values: 12px (xs)
8. Empty seat numbers: 12px (xs)
9. Main action buttons: 16px (base)
10. Preset buttons: 14px (sm)
11. Amount input: 18px (lg)
12. +/- buttons: 20px (xl)
13. Chat messages: 14px (base)
14. Chat timestamps: 12px (xs)
15. Chat usernames: 13px (sm)
16. Chat input: 12-14px

### Icon/Image Sizes
1. Player avatars: 64x64px (h-16 w-16)
2. Dealer button: 32x32px (h-8 w-8)
3. Community cards: 80x112px
4. Hole cards: 28x39px
5. Bet chips: 24x24px (w-6 h-6)
6. Empty seats: 64x64px (h-16 w-16)
7. Chat avatars: 24x24px (mobile) / 32x32px (desktop)

### Button Sizes
1. Main action buttons: 140px × 48px
2. Preset buttons: auto width, py-2
3. +/- buttons: 48px × 68px

### Container Sizes
1. Chat sidebar: 256px (w-64) / 320px (lg:w-80)
2. Amount input: 128px × 68px (w-32 h-[68px])
