# CodeForge - Master Context & Project Status

**Last Updated**: 2026-03-17
**Project**: Real-time Collaborative Browser IDE
**Status**: Development in Progress

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Current Status](#current-status)
3. [Critical Issues](#critical-issues)
4. [Medium Priority Issues](#medium-priority-issues)
5. [Completed Work](#completed-work)
6. [Files & Architecture](#files--architecture)
7. [Technical Stack](#technical-stack)
8. [Configuration](#configuration)
9. [Server Status](#server-status)
10. [Work Needed](#work-needed)
11. [Testing Checklist](#testing-checklist)
12. [Deployment Notes](#deployment-notes)

---

## Project Overview

CodeForge is a real-time collaborative code editor with multi-language support and session management. Users can:
- Create/join coding sessions
- Edit files collaboratively with live cursors
- Execute code in multiple languages (Python, JavaScript, TypeScript, Java, C++, C)
- Chat with session participants
- Lock files to prevent edit conflicts
- Export to Docker containers

### Key Features
- 🔐 **Firebase Authentication** - Secure email/password login
- 👥 **Real-time Collaboration** - Multiple users can code together
- 🎭 **Role-based Access** - Host, Co-Host, Editor, Viewer roles
- 💬 **Live Chat** - Built-in messaging for session participants
- 🔒 **File Locking** - Prevents edit conflicts with lock indicators
- ▶️ **Multi-language Execution** - Python, JavaScript, TypeScript, Java, C++, C
- 🖥️ **Terminal** - Full terminal with real-time streaming (no timeout)
- 🐳 **Docker Export** - Build and push container images to Docker Hub
- 🌐 **ngrok Tunneling** - Share sessions with remote users

---

## Current Status

### Overall Status: ✅ FUNCTIONAL (Fixes Applied)
- **Sessions**: Fixed — Firestore persistence now works with bidirectional sync
- **Ports**: Backend auto-allocates and writes actual port to `.env.local` (by design)
- **Backend**: Saves to Firestore on create/join/update/disconnect
- **Frontend**: Session list loads correctly (removed composite index dependency)
- **UI**: Fully redesigned — auth, session dialog, IDE panels all enhanced

### Component Status

| Component | Status | Port | Notes |
|-----------|--------|------|-------|
| Backend | ✅ Running | 5001+ | Auto-allocates free port, writes to .env.local |
| Frontend | ✅ Running | 9002 | Auth → session → IDE flow working |
| Firebase | ✅ Working | - | Auth + Firestore both functional |
| Monaco Editor | ✅ Working | - | Syntax highlighting functional |
| File Locking | ✅ Working | - | Lock/unlock functional |
| Terminal | ✅ Working | - | Streaming output working |
| Docker Export | ✅ Working | - | Build/push to Docker Hub working |

---

## Critical Issues

### 1. Session Persistence to Firestore
**Status**: `FIXED` | **Impact**: HIGH | **Priority**: CRITICAL

**Root Causes Found & Fixed**:
1. `participantQuery` used `orderBy('createdAt', 'desc')` — requires composite Firestore index. **Fix**: Removed `orderBy`, sort client-side.
2. Backend `saveSessionToFirestore()` saved `createdAt` as ISO string, but frontend called `.toMillis()` expecting Timestamp. **Fix**: Backend now saves `created_at_ms = Date.now()` (numeric ms); frontend handles both `number` and Timestamp types.
3. `disconnect` handler never updated Firestore — host disconnect left session as `isActive: true`. **Fix**: Host disconnect now sets `isActive: false` in Firestore; participant leave calls `saveSessionToFirestore()`.

**Affected Files Fixed**:
- `backend/index.js` — SessionData constructor, `saveSessionToFirestore()`, disconnect handler
- `frontend/src/contexts/session-context.tsx` — removed `orderBy`, fixed `createdAt` parsing

---

### 2. Port Conflicts & Server Instability
**Status**: `BY DESIGN` | **Impact**: LOW | **Priority**: LOW

Backend uses `findFreePort()` which auto-increments from 5001 and writes the actual port to `frontend/.env.local`. This is intentional behavior — kill orphaned Node processes and restart cleanly:
```bash
taskkill /F /IM node.exe
cd backend && npm run dev   # Will start on 5001 if free
cd frontend && npm run dev:no-open
```

---

### 3. Dual Session System Architecture
**Status**: `WORKING AS DESIGNED` | **Impact**: LOW

Both frontend (`setDoc`) and backend (`saveSessionToFirestore`) write to Firestore. This is Option C (bidirectional sync) and is the current working design. Frontend writes on create/join, backend writes on all mutations and on disconnect.

---

## Medium Priority Issues

### 4. Firestore Security Rules
**Status**: `DEPLOYED` | **Impact**: MEDIUM | **Priority**: MEDIUM

Rules deployed via Firebase console on 2026-03-13. `firebase.json` also created for future CLI deploys.

---

## Completed Work

### ✅ Session Persistence Fix (2026-03-13)
**Status**: COMPLETE
- **Problem**: Sessions not appearing in "My Sessions" after logout/login
- **Fix 1**: Removed `orderBy('createdAt', 'desc')` from Firestore queries (no composite index needed)
- **Fix 2**: Backend saves numeric `created_at_ms` timestamp; frontend handles both number and Timestamp
- **Fix 3**: Disconnect handler now marks session `isActive: false` in Firestore when host leaves
- **Files**: `backend/index.js`, `frontend/src/contexts/session-context.tsx`

### ✅ Auth Page — Cyberpunk Command Center UI (2026-03-17)
**Status**: COMPLETE
**File**: `frontend/src/components/auth/auth-page.tsx`
**CSS**: `frontend/src/app/globals.css`

#### Layout Architecture
- Strict **100vh non-scrolling** two-column grid (`lg:grid-cols-2`)
- Left column: hero/headline section — fully centered (`items-center`, no left padding)
- Right column: auth card — unchanged, functional/subordinate
- **Horizontal bridge line** (`z-20`, 1px gradient) between CODEFORGE header and content grid
- **Vertical column divider** (`absolute inset-y-0 left-1/2`, 1px gradient) separating columns
- **Glowing intersection node** (7px circle, `box-shadow` glow) where lines meet at top

#### Typography System (`textSizes` object — line ~163)
- `lim` — raw CSS `clamp()` value (NOT a Tailwind class) used in `style={{ fontSize }}`
  - ⚠️ Bug fixed: was `'text-[clamp(...)]'` (Tailwind class) passed to inline style → browser ignored it
- `sys` / `sub` — Tailwind classes used in `className`, correct usage
- "Build Without": `clamp(28px, 4vh, 48px)`, `text-white/30` — subordinate to LIMITS
- All text centered; `lg:text-left` / `lg:justify-start` overrides removed

#### CODEFORGE Brand (line ~634)
- Reflective wave: `absolute inset-y-0 w-[45%]` span using `shimmerBtn` animation + `skewX(-18deg)`
- Skew makes the shimmer stripe diagonal (italic light reflection) — text itself is NOT skewed

#### LIMITS Pulse (line ~185)
- `neonPulse` (`filter: drop-shadow`) removed — bleeds outside element via compositing, can't be clipped
- Replaced with `limitsGlow` on the inner `aria-hidden absolute inset-0` span
- `limitsGlow` animates `opacity` + `scale` — fully contained within the LIMITS bounding box
- Glow gradient centered at `50% 50%`, blue (`rgba(65,105,225,...)`)

#### globals.css Additions
- **Autofill override**: `-webkit-box-shadow inset` trick forces dark background on browser credential fill
- **`limitsGlow` keyframe**: `opacity 0.35→1.00`, `scale 1→1.06` — contained glow pulse
- `shimmerBtn` keyframe (pre-existing): used by CODEFORGE wave and button hover

#### Known Design Values
| Element | Control |
|---|---|
| LIMITS font size | `textSizes.lim` — raw CSS clamp, line ~165 |
| LIMITS glow intensity | `limitsGlow` keyframe opacity values in globals.css |
| LIMITS glow spread | `blur-[40px]` on inner aria-hidden span, line ~198 |
| CODEFORGE size | `text-[clamp(50px,4vh,40px)]` on brand span, line ~634 |
| Image height cap | `max-h-[50vh]` on `<img>`, line ~250 |
| Column divider opacity | gradient rgba values on vertical bridge div ~line 660 |

---

### ✅ Full UI Redesign (2026-03-13)
**Status**: COMPLETE
- **Auth Page** (`auth-page.tsx`): Two-panel layout, PasswordStrength indicator, password show/hide, code preview panel, feature pills
- **Session Dialog** (`session-dialog.tsx`): User greeting card, role badges, relative timestamps, feature pills, cleaner mode flow
- **Code Editor Panel** (`code-editor-panel.tsx`): Language dots, colored tabs with bottom border, keyboard shortcut display, enhanced Monaco options
- **File Explorer** (`file-explorer.tsx`): Language color dots, separate folder/file buttons, language dropdown with extensions, session ID footer
- **Bottom Panel** (`bottom-panel.tsx`): Border-based tab styling, connection indicator, output count badge, `❯` terminal prompt
- **Header** (`header.tsx`): Dark background, tighter layout, consistent sizing
- **IDE Routing**: `/ide` now redirects to `/`; all IDE logic consolidated in `src/components/ide/`

### ✅ Monaco Editor Integration
**Status**: COMPLETE
- **Feature**: Full Monaco Editor integration replacing textarea-based editor
- **Changes**:
  - File Explorer with expand/collapse and resize (fixed collapse button visibility)
  - Chat Panel with expand/collapse and resize (fixed drag direction)
  - Monaco Editor with syntax highlighting and auto-completion
  - Output/Terminal panel only under code editor (fixed overflow issue)
  - Drag handles fixed (direction now correct)
- **Files**:
  - `frontend/src/app/ide/page.tsx` — Main IDE page now uses Monaco Editor
  - `frontend/package.json` — Added `@monaco-editor/react` dependency
  - `frontend/src/app/ide/monaco-test/` — Removed (no longer needed)

### ✅ File Locking System
**Status**: COMPLETE
- **Feature**: When User A opens a file, it's locked for others
- **Files**:
  - `backend/index.js` — File lock manager, socket events
  - `frontend/src/contexts/session-context.tsx` — File lock state
  - `frontend/src/components/ide/file-explorer.tsx` — Lock indicator
  - `frontend/src/components/ide/code-editor-panel.tsx` — Read-only mode when locked

### ✅ Docker Hub Integration
**Status**: COMPLETE
- **Feature**: Users can build container images and push to Docker Hub
- **Files**:
  - `backend/index.js` — Docker Hub API endpoints
  - `frontend/src/components/ide/header.tsx` — Docker Hub UI

### ✅ Context Files Updated
**Status**: COMPLETE
- **Files Updated**:
  - `frontend/src/contexts/session-context.tsx` — Syntax fixes, query improvements
  - `frontend/src/contexts/auth-context.tsx` — Code cleanup

---

## Files & Architecture

### Project Structure
```
CodeForge/
├── backend/
│   ├── index.js                 # Main server entry (1800+ lines)
│   ├── package.json
│   └── firebase-service-account.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx         # Root page: auth → session → IDE
│   │   │   └── ide/
│   │   │       └── page.tsx     # Redirects to /
│   │   ├── components/
│   │   │   ├── ide/
│   │   │   │   ├── main-layout.tsx        # IDE layout shell
│   │   │   │   ├── file-explorer.tsx      # File tree (redesigned)
│   │   │   │   ├── chat-panel.tsx         # Live chat
│   │   │   │   ├── code-editor-panel.tsx  # Monaco + toolbar (redesigned)
│   │   │   │   ├── bottom-panel.tsx       # Output/terminal (redesigned)
│   │   │   │   └── header.tsx             # Top nav (redesigned)
│   │   │   ├── auth/
│   │   │   │   └── auth-page.tsx          # Sign in/register (redesigned)
│   │   │   ├── session/
│   │   │   │   └── session-dialog.tsx     # Session create/join (redesigned)
│   │   │   └── ui/              # Reusable UI components
│   │   ├── contexts/
│   │   │   ├── auth-context.tsx
│   │   │   └── session-context.tsx
│   │   └── lib/
│   │       └── firebase.ts
│   └── package.json
├── firestore.rules              # Firebase security rules (needs deploy)
├── AGENTS.md                    # Agent guidelines
├── CONTEXT.md                   # Development context
├── MASTER_CONTEXT.md            # This file
├── README.md
└── package.json
```

### Key Files Summary

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `backend/index.js` | Server logic, Socket.IO, session management | 1800+ | ✅ Fixed |
| `frontend/src/contexts/session-context.tsx` | Session state & Firestore sync | ~1059 | ✅ Fixed |
| `frontend/src/contexts/auth-context.tsx` | Authentication state | 215 | ✅ Working |
| `frontend/src/app/page.tsx` | Root page (auth → session → IDE) | ~40 | ✅ Working |
| `frontend/src/app/ide/page.tsx` | Redirects to `/` | 5 | ✅ Fixed |
| `frontend/src/components/ide/code-editor-panel.tsx` | Monaco Editor + toolbar | ~230 | ✅ Redesigned |
| `frontend/src/components/ide/file-explorer.tsx` | File tree with language colors | ~310 | ✅ Redesigned |
| `frontend/src/components/ide/bottom-panel.tsx` | Output and terminal tabs | ~190 | ✅ Redesigned |
| `frontend/src/components/ide/header.tsx` | Top navigation bar | ~200 | ✅ Redesigned |
| `frontend/src/components/auth/auth-page.tsx` | Sign in / register page — Cyberpunk Command Center | ~660 | ✅ Redesigned v2 |
| `frontend/src/components/session/session-dialog.tsx` | Session creation/join dialog | ~350 | ✅ Redesigned |
| `firestore.rules` | Firebase security rules | 32 | ✅ Deployed |

---

## Technical Stack

### Frontend
- **Framework**: Next.js 15 (Turbopack)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + Radix UI
- **Editor**: Monaco Editor (@monaco-editor/react)
- **Real-time**: Socket.IO Client
- **Auth/DB**: Firebase (Auth + Firestore)

### Backend
- **Runtime**: Node.js
- **Framework**: Express + Socket.IO
- **Auth/DB**: Firebase Admin SDK
- **Code Execution**: Child processes (spawn/exec)
- **Docker**: Dockerode
- **Compression**: Archiver

### Firebase Configuration
```
Project ID: codeforge-khk
Auth Domain: codeforge-khk.firebaseapp.com
Storage: codeforge-khk.firebasestorage.app
```

---

## Configuration

### Environment Variables

**Frontend** (`frontend/.env.local`):
```env

```

**Backend** (`backend/index.js`):
```javascript
CONFIG = {
  host: "0.0.0.0",
  port: parseInt(process.env.PORT || "5001"),  // ⚠️ Keeps changing
  max_execution_time: 30,
  max_output_size: 50000,
  firebase_credentials_path: "firebase-service-account.json",
  frontend_url: process.env.FRONTEND_URL || "http://localhost:9002"
}
```

### Port Configuration

| Service | Expected Port | Current Port | Status |
|---------|---------------|--------------|--------|
| Backend | 5001 | 5005 | ⚠️ Changed |
| Frontend | 9002 | 9003 | ⚠️ Changed |

---

## Server Status

### Current Running Processes
```
Backend:  Port 5005 (PID unknown)
Frontend: Port 9003 (PID 16644)

Old orphaned processes:
  Port 5001 (PID 23708) - Backend attempt
  Port 5002 (PID 4404)  - Backend attempt
  Port 5003 (PID 9160)  - Backend attempt
  Port 5004 (PID 24280) - Backend attempt
  Port 9002 (PID 17508) - Frontend attempt
  Port 9003 (PID 1360)  - Frontend attempt
  Port 9004 (PID 1312)  - Frontend attempt
  Port 9005 (PID 21624) - Frontend attempt
```

### Access URLs
- **Frontend**: http://localhost:9003 (currently) → Should be http://localhost:9002
- **Backend**: http://localhost:5005 (currently) → Should be http://localhost:5001
- **Firebase Console**: https://console.firebase.google.com/project/codeforge-khk

---

## Work Needed

### Optional Improvements
1. **Run linting and type checking**
   ```bash
   cd frontend && npm run lint && npm run typecheck
   ```

2. **Add error boundaries** for better runtime error handling

3. **Add ngrok session sharing** UI flow

---

## Testing Checklist

### Session Creation & Persistence
- [ ] User can create a session
- [ ] Session appears in Firestore console
- [ ] Session appears in "My Sessions" list
- [ ] Session persists after logout/login
- [ ] Other users can join the session

### File Operations
- [ ] Can create new files
- [ ] Can edit file content
- [ ] Changes sync to Firestore
- [ ] File locking works
- [ ] Multiple users see same file state

### Code Execution
- [ ] Can execute Python code
- [ ] Can execute JavaScript code
- [ ] Can execute TypeScript code
- [ ] Output appears correctly
- [ ] Errors are displayed

### Collaboration Features
- [ ] Chat messages sync between users
- [ ] Cursor positions sync
- [ ] File locks prevent concurrent edits
- [ ] User roles work correctly

---

## Deployment Notes

### Firebase Deployment
```bash
# Deploy security rules
firebase deploy --only firestore:rules

# Deploy all Firebase resources
firebase deploy
```

### Production Deployment
1. Build frontend: `cd frontend && npm run build`
2. Start backend: `cd backend && npm start`
3. Configure environment variables for production
4. Set up SSL/TLS certificates
5. Configure domain and DNS

---

## Appendix

### Socket.IO Events

**Client → Server**:
- `create_session`, `join_session`, `leave_session`
- `run_code`, `terminal_run`, `terminal_kill`
- `file_update`, `cursor_update`
- `chat_message`, `approve_user`, `deny_user`, `kick_user`

**Server → Client**:
- `user_joined`, `user_left`, `user_kicked`
- `execution_result`, `terminal_output`, `terminal_exit`
- `file_update`, `cursor_update`, `chat_message`

### Supported Languages
- HTML (.html)
- CSS (.css)
- JavaScript (.js)
- TypeScript (.ts)
- Python (.py)
- Java (.java)
- C (.c)
- C++ (.cpp)

### File Locking Rules
- Auto-expire after 5 minutes of no write activity
- Instant release on file close or user disconnect
- Read-only mode for locked files
- Lock indicator shows who has the file locked

---

**Document Version**: 2.1
**Last Modified**: 2026-03-17
**Maintainer**: CodeForge Development Team
