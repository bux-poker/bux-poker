# Component Extraction Plan

## Components to Extract from Spades

### 1. Card Components
**Source:** `client/src/components/game/components/CardRenderer.tsx`
- Visual card rendering
- Card suit/rank display
- Face up/down states
- **Destination:** `bux-poker/shared/components/Card/`

### 2. Chat System
**Source:** 
- `client/src/features/chat/` (entire directory)
- `client/src/features/lobby/components/lobby/ChatSection.tsx`
- **Destination:** `bux-poker/shared/components/Chat/`

### 3. Socket Infrastructure
**Source:**
- `client/src/features/game/services/lib/socket*.ts`
- `client/src/features/game/services/lib/socket-manager/`
- **Destination:** `bux-poker/shared/utils/socket/`

### 4. Auth System
**Source:**
- `client/src/features/auth/` (entire directory)
- **Destination:** `bux-poker/shared/features/auth/` (or extract to client)

### 5. UI Styling/Theme
**Source:**
- `client/src/index.css`
- `client/src/mobile.css`
- Tailwind config
- **Destination:** `bux-poker/shared/styles/`

### 6. Admin Panel Structure
**Source:**
- `client/src/components/admin/AdminPanel.tsx` (structure only, not spades-specific logic)
- **Destination:** Reference for `bux-poker/client/src/components/admin/`

### 7. Server Socket Infrastructure
**Source:**
- `server/src/modules/socket-handlers/` (structure)
- Socket event handling patterns
- **Destination:** Reference for `bux-poker/server/src/modules/`

## Extraction Order

1. **Card Components** - Most straightforward, pure UI
2. **Socket Infrastructure** - Core real-time functionality
3. **Chat System** - Depends on socket
4. **Auth System** - Needed for user management
5. **Styling** - Visual consistency
6. **Admin Panel** - Reference structure only

## Notes

- Adapt card components for poker (52-card deck, suits/ranks)
- Socket events will be poker-specific (betting, actions, etc.)
- Chat can be mostly reused as-is
- Auth can be reused with minimal changes
- Admin panel structure is reference only - poker will have different forms
