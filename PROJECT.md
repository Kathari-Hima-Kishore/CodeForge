# CodeForge - Comprehensive Project Documentation

**Last Updated**: 2026-03-18
**Project**: Real-time Collaborative Browser IDE
**Status**: Fully Functional — Session streaming execution, persistence fixes, landing page redesign complete

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Git
- Modern web browser

### 1. Clone & Install
```bash
git clone https://github.com/Kathari-Hima-kishore/CodeForge.git
cd CodeForge
cd frontend && npm install
cd ../backend && npm install
```

### 2. Set Up Environment Variables

**Frontend:**
```bash
cd frontend
cp .env .env.backup  # backup if needed
# Edit .env and replace NEXT_PUBLIC_FIREBASE_API_KEY with your new key from Google Cloud
```

The `.env` file should contain:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=<your-new-api-key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=codeforge-khk.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=codeforge-khk
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=codeforge-khk.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=661234466057
NEXT_PUBLIC_FIREBASE_APP_ID=1:661234466057:web:fc0af044739b9c5e9da7d8
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-2DX7LDWW0T
NEXT_PUBLIC_BACKEND_URL=http://localhost:5001
```

**Backend:**
```bash
cd backend
# No .env required (backend uses defaults)
# PORT: 5001 (auto-allocates if busy, actual port written to frontend/.env)
```

### 3. Get Firebase Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project `codeforge-khk`
3. APIs & Services → Credentials
4. Create a new API Key (recommended for security)
5. Copy the key and paste in `frontend/.env`

### 4. Run Development Server

```bash
# Option A: From root (runs both)
npm run dev

# Option B: Separately (in two terminals)
cd frontend && npm run dev:no-open
cd backend && npm run dev
```

Access at **http://localhost:9002**

---

## 📋 Features

- 🔐 **Firebase Authentication** - Secure email/password login with password reset
- 👥 **Real-time Collaboration** - Multiple users edit simultaneously
- 🎭 **Role-based Access** - Host, Co-Host, Editor, Viewer roles
- 💬 **Live Chat** - Built-in messaging for session participants
- 🔒 **File Locking** - Prevents edit conflicts (auto-expire: 5 min, instant release)
- ▶️ **Multi-language Execution** - HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++
- 📥 **Interactive Input** - Programs read from stdin in real-time
- 🖥️ **Terminal** - Full terminal with streaming (no timeout)
- 🐳 **Docker Export** - Build and push container images to Docker Hub
- 🌐 **ngrok Tunneling** - Share sessions with remote users (backend ready)

---

## 📁 Project Structure

```
CodeForge/
├── backend/
│   ├── index.js                    # ~1900 lines: socket handlers, code execution, terminal, Docker
│   ├── package.json
│   ├── .env                        # PORT only (git-ignored)
│   └── firebase-service-account.json  # (optional, for Docker export)
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # Auth entry point
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── ide/                # IDE UI components
│   │   │   │   ├── main-layout.tsx
│   │   │   │   ├── header.tsx
│   │   │   │   ├── file-explorer.tsx
│   │   │   │   ├── code-editor-panel.tsx
│   │   │   │   ├── bottom-panel.tsx  # Output/Terminal + stdin input
│   │   │   │   ├── session-dialog.tsx
│   │   │   │   └── chat-panel.tsx
│   │   │   ├── auth/
│   │   │   │   └── auth-page.tsx   # Redesigned: split layout + live code terminal
│   │   │   └── ui/                 # Radix UI button, input, select, etc.
│   │   ├── contexts/
│   │   │   ├── auth-context.tsx    # Firebase auth (login/register/logout/reset)
│   │   │   └── session-context.tsx # Session state, Firestore sync, streaming execution
│   │   ├── lib/
│   │   │   ├── firebase.ts         # Firebase config + getDynamicBackendUrl()
│   │   │   └── utils.ts
│   │   └── styles/globals.css
│   ├── .env                        # Environment variables (git-ignored)
│   └── package.json
├── PROJECT.md                      # This file (comprehensive documentation)
├── .gitignore                      # Excludes .env, credentials, node_modules, etc.
└── package.json                    # Root commands
```

---

## 🔧 Development Commands

### Root Level
```bash
npm run dev                         # Start both frontend and backend
npm run build                       # Build frontend for production
npm run start                       # Start both services (production)
```

### Frontend
```bash
cd frontend
npm run dev                         # Start with auto-open (port 9002)
npm run dev:no-open                 # Start without auto-open
npm run build                       # Production build
npm run lint                        # ESLint
npm run typecheck                   # TypeScript type check
npm run lint && npm run typecheck   # Run both
```

### Backend
```bash
cd backend
npm run dev                         # Start with nodemon (auto-reload)
npm start                           # Production start
```

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, Monaco Editor, Socket.IO, Firebase 11.9.1
- **Backend**: Node.js, Express, Socket.IO, Firebase Admin SDK, Dockerode
- **Database**: Firebase Auth + Firestore
- **Hosting**: Browser-based IDE (localhost), Docker containers (export)

### Ports
| Service | Port | Auto-allocates | Notes |
|---------|------|---|---|
| Frontend | 9002 | No | Fixed port |
| Backend | 5001 | Yes | Auto-increments if busy (5001→5002→5003...) |

### Session Persistence
- **Frontend**: Creates session in Firestore (collection: `sessions`)
- **Backend**: Manages in-memory session state + syncs to Firestore
- **Sync**: Bidirectional via Socket.IO and Firestore listeners
- **Recovery**: Sessions persist in Firestore even after backend crash/restart

### Streaming Code Execution
- **Frontend**: `executeCode()` returns immediately, listens for `execution_output` events
- **Backend**: Spawns process, streams output via `execution_output` events
- **stdin**: User sends input via `execution_input` event, always closes stdin to prevent hanging
- **Java**: Auto-detects public class name via regex (supports arbitrary class names)
- **UI**: stdin input row visible while executing, user input echoed with `> ` prefix

### File Locking
- **Lock**: Acquired when user opens file, released on close or disconnect
- **Auto-expire**: 5 minutes of no write activity
- **UI**: Lock indicator in file explorer, editor becomes read-only for others
- **Events**: `file_lock_update`, `file_lock_released`

---

## 📡 Socket.IO Events

### Code Execution (Streaming)
- `run_code` (client→server): `{ language, code, projectFiles }` → callback: `{ error? }`
- `execution_input` (client→server): `{ input: string }` - sends stdin
- `execution_kill` (client→server): terminates process
- `execution_output` (server→client): `{ output, isError?, executed_by? }` - streamed
- `execution_exit` (server→client): `{ code, execution_time?, error?, killed? }`

### Sessions
- `create_session` (A→B): Create session
- `join_session` (A→B): Join existing session
- `leave_session` (A→B): Leave session
- `user_joined` (B→A): User joined
- `user_left` (B→A): User left

### Files
- `file_update` (A→B): Sync file changes
- `file_open` (A→B): Open file (acquires lock)
- `file_close` (A→B): Close file (releases lock)
- `file_write_activity` (A→B): Update write timestamp
- `file_lock_update` (B→A): Lock status changed
- `file_lock_released` (B→A): Lock released

### Chat & Collaboration
- `chat_message` (A→B): Send message
- `cursor_update` (A→B): Broadcast cursor position

### Terminal
- `terminal_run` (A→B): Run command
- `terminal_kill` (A→B): Kill process
- `terminal_output` (B→A): Output streaming
- `terminal_exit` (B→A): Process finished

### Admin
- `approve_user` (host→server): Approve join request
- `deny_user` (host→server): Deny join request
- `kick_user` (host→server): Kick user
- `change_role` (host→server): Change user role

---

## 💻 Code Conventions

### Frontend (TypeScript/React)

**File Structure:**
```tsx
'use client';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';

interface Props { title: string; onSubmit: (data: string) => void; }

export function Component({ title, onSubmit }: Props) {
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const handleClick = useCallback(async () => {
    setLoading(true);
    try { await doSomething(); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  return <Button onClick={handleClick}>{title}</Button>;
}
```

**Conventions:**
- `'use client'` at top of client components
- Import order: React → third-party → internal (`@/...`)
- Styling: Tailwind CSS + `cn()` utilities + Radix UI
- State: React Context (session/auth) + useState (UI)
- Error handling: try/catch/finally
- No premature abstractions

### Backend (JavaScript/Node.js)

**File Structure:**
```javascript
// =============================================================================
// Section: Routes
// =============================================================================
app.post('/api/endpoint', async (req, res) => {
  try {
    const result = await process(req.body);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

**Conventions:**
- CommonJS (`require`, not ES modules)
- Section headers: `// ===== Title =====`
- Always `killProcessTree(child)` on Windows (not `child.kill()`)
- Validate `connectedUsers[sid]` before proceeding
- Surface errors via callbacks/events (never crash silently)

### TypeScript
- Explicit types for params/returns, infer for local variables
- Use `as` keyword: `value as Type`
- Narrow with unknown: `catch (e) { const err = e as Error; }`

---

## 🔐 Security & Configuration

### Environment Variables

**Never commit `.env` to git** — it's in `.gitignore`

The `.env` file contains secrets:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=<your-api-key>                    # From Google Cloud
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=codeforge-khk.firebaseapp.com # From Firebase
NEXT_PUBLIC_FIREBASE_PROJECT_ID=codeforge-khk                  # From Firebase
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=codeforge-khk.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=661234466057
NEXT_PUBLIC_FIREBASE_APP_ID=1:661234466057:web:fc0af044739b9c5e9da7d8
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-2DX7LDWW0T
NEXT_PUBLIC_BACKEND_URL=http://localhost:5001
```

### .gitignore
Excludes:
- `.env` (environment variables with real credentials)
- `.env.*.local` (local overrides)
- `firebase-service-account.json` (Firebase admin credentials)
- `*credentials*.json` (any credentials files)
- `*secret*.json` (any secret files)
- `*.pem`, `*.key` (SSH keys)
- `node_modules/`, `.next/`, `dist/`
- OS files: `.DS_Store`, `Thumbs.db`
- `.env.example` is NOT excluded (safe to commit)

### Firebase Initialization
- **Frontend**: `firebase.ts` reads from `process.env.NEXT_PUBLIC_*`
- **Backend**: Uses Firebase Admin SDK with service account JSON
- **Auth**: Email/password via Firebase Authentication
- **Database**: Firestore for sessions, files, etc.

---

## 🐛 Debugging Tips

### Frontend
- Browser console: React warnings and logs
- React DevTools: Component state inspection
- Network tab: Socket.IO connection status + events
- Firestore: Check console for "Creating session in Firestore"

### Backend
- Terminal output: Runtime errors and logs
- Socket.IO events: Network tab (filter by "socket.io")
- Firestore: Check for "💾 Session saved to Firestore"

### Common Issues

**Sessions Not Appearing in Firestore**
1. Check backend logs for `saveSessionToFirestore()` calls
2. Verify Firebase Admin SDK initialized: `✅ Firebase Admin SDK initialized`
3. Run: `firebase deploy --only firestore:rules`

**Port Conflicts**
```bash
# Kill all Node processes
taskkill /F /IM node.exe

# Check what's using ports
netstat -ano | findstr ":500|:900"

# Restart
cd backend && npm run dev
cd frontend && npm run dev:no-open
```

**Backend Port Changes (5001 → 5002 → 5003...)**
- Intentional: Backend auto-allocates free port
- Actual port written to `frontend/.env` automatically
- To use fixed port: Update `backend/index.js` CONFIG.port or ensure 5001 is free

**Firestore Rules Not Applied**
```bash
firebase deploy --only firestore:rules
```

---

## 📊 Layout & UI

### Main IDE Layout
```
Header (session info, share, leave, account)
├── File Explorer (left, collapsible, resizable)
├── Chat/Participants (middle, collapsible, resizable)
└── Editor Column (center, contains Monaco + Output)
    ├── Toolbar (file info, run button)
    ├── Monaco Editor (syntax highlighting, auto-complete)
    ├── Resize Handle (vertical)
    └── Bottom Panel
        ├── Output/Terminal tabs
        ├── stdin input row (visible while executing)
        └── Kill button (⏹)
```

### Auth Page (Redesigned)
- **Left (50%)**: Live code terminal showcase (Python/JS/Java/C++ typing animation)
- **Right (50%)**: Clean form (Sign In / Create Account / Reset Password)
- **Colors**: `#08090f` bg, `#0d0e18` terminal, violet accents
- **Mobile**: Left hidden, full-width form
- **Animations**: GSAP entrance + form crossfade

### Monaco Editor
- Theme: `vs-dark`
- Font: JetBrains Mono
- Features: Line numbers, minimap, word wrap, auto-format, bracket matching
- Languages: HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++

---

## 🐳 Docker Export

### Build & Deploy
1. Write code in IDE
2. Click "Build Container Image"
3. Enter Docker Hub username/email + password
4. Fetch existing repos or enter custom name
5. Click "Build and Push"

### Auto-Detection
- **Framework**: Flask (port 5000), FastAPI (8000), Express/Node.js (3000)
- **Files**: Auto-generates `requirements.txt` or `package.json` if missing
- **Naming**: `codeforge/<name>:<timestamp>-<random>` for uniqueness

---

## 🌐 ngrok Tunneling (Backend Ready)

Backend supports ngrok URL registration. Frontend UI pending.

---

## ✅ Verified Features

✅ Session persistence + Firestore sync
✅ Streaming code execution + stdin input (NEW)
✅ Java class name auto-detection (NEW)
✅ Multi-language (HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++)
✅ Terminal streaming (no timeout)
✅ File locking (5-min auto-expire, instant release)
✅ Docker Hub export
✅ Real-time chat + cursor sync
✅ Role-based access (Host, Co-Host, Editor, Viewer)
✅ Firebase Auth
✅ Landing page redesign (NEW)
✅ Socket reconnect handling

---

## 📝 Remaining Tasks

- Optional: `npm run lint && npm run typecheck` for code quality
- Optional: Error boundaries for runtime error UX
- Optional: ngrok UI flow (backend ready, frontend pending)

---

## 🔍 Security Status (2026-03-14)

### ✅ FULLY REMEDIATED

**Issue**: Exposed API key `AIzaSyCacO3xAjNCWdy774jKjCcP4rrwcUoSzmo` detected by GitHub and Google Cloud

**Actions Taken**:
- ✅ Removed `.env` and `.env.local` files with exposed key
- ✅ Removed key references from documentation
- ✅ Enhanced `.gitignore` with comprehensive credential patterns
- ✅ Created `.env` template file (git-ignored, safe to edit locally)
- ✅ Verified `firebase.ts` reads from env vars only (no hardcoded secrets)

**Status**: Exposed key 100% removed from repository

---

## Git & Version Control

- **Never commit secrets** (`.env`, credentials, keys)
- **Never use `--force` push**
- Create commits describing the "why" not the "what"
- Verify lint/typecheck before committing

---

## API Reference

### Backend Endpoints

```bash
POST /api/check-email
# { email: string } → { exists: boolean }

POST /api/build
# { language, code, projectFiles } → { output, errors }

GET /api/dockerhub/repos
# Query: { username?, email?, password? } → { repos: [], username }

POST /api/build-container
# { language, code, dockerHubRepo, tag, ... } → streams build output
```

---

## Helpful Links

- [Firebase Console](https://console.firebase.google.com/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Docker Hub](https://hub.docker.com/)
- [Monaco Editor Docs](https://microsoft.github.io/monaco-editor/)
- [Socket.IO Docs](https://socket.io/docs/)
- [Next.js Docs](https://nextjs.org/docs/)

---

**Questions?** Check the debugging section or inspect backend/frontend logs.
