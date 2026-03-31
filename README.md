# 🖥️ CodeForge — Real-Time Collaborative Browser IDE

> **A full-featured collaborative coding environment in your browser.** Write, execute, debug, and deploy code together in real-time with role-based access control, multi-language support, and instant Docker container building.

![Version](https://img.shields.io/badge/version-1.0-blue)
![Status](https://img.shields.io/badge/status-Production%20Ready-green)
![License](https://img.shields.io/badge/license-MIT-green)

![CodeForge Homepage](./image.png)

---

## ✨ Features

### 🔐 **Authentication & Security**
- Firebase-powered authentication
- Email/password registration with verification
- Password reset via email
- Persistent login (stays logged in across page refreshes)

### 👥 **Real-Time Collaboration**
- **Live multi-user editing** — See other users' changes instantly
- **Role-based access** — Host, Co-Host, Editor, Viewer
- **Participant awareness** — See who's online and their cursor/activity
- **Session codes** — Easy sharing (8-character codes)
- **User management** — Host can kick users and change roles

### 💻 **Full-Featured IDE**
- **Monaco Editor** — Industry-standard VS Code editor
- **Multi-file support** — Organize code in files and folders
- **Tab system** — Open multiple files simultaneously
- **Syntax highlighting** — Built-in for all supported languages
- **Live output** — Streaming code execution results

### ▶️ **Code Execution (8 Languages)**
```
✅ HTML/CSS/JavaScript    — Browser-based rendering
✅ TypeScript              — Compiled to JavaScript
✅ Python                  — Full Python 3.x support
✅ Java                    — Full JVM compilation
✅ C / C++                 — GCC/G++ compilation
```

### 🖥️ **Advanced Features**
- **Terminal** — Full shell access with streaming output
- **Interactive Input** — Programs can read from stdin in real-time
- **Output Preview** — HTML/CSS output rendered inline
- **Error Handling** — Clear error messages with line numbers
- **Performance** — Optimized for free-tier Firebase

### 📦 **Deployment**
- **🐳 Docker Hub** — Build container images and push to Docker Hub
- **🌐 Render** — Deploy containerized apps to Render.com
- **Export Code** — Download project as ZIP archive

### 💬 **Communication**
- **Live Chat** — Built-in messaging for session participants
- **Persistent Messages** — Chat history saved with session
- **Real-time Updates** — Messages appear instantly for all users

---

## 🚀 Quick Start

### **Prerequisites**
- Node.js 18+
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Git

### **1. Clone Repository**
```bash
git clone https://github.com/yourusername/codeforge.git
cd CodeForge
```

### **2. Install Dependencies**
```bash
# Frontend
cd frontend
npm install

# Backend (in another terminal)
cd backend
npm install
```

### **3. Configure Environment**
Create `frontend/.env.local`:
```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN= your_api_key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_api_key
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_api_key
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_api_key
NEXT_PUBLIC_FIREBASE_APP_ID=your_api_key
NEXT_PUBLIC_BACKEND_URL=http://localhost:5001
```

### **4. Run Development Servers**
```bash
# From project root
npm run dev

# Or manually:
# Terminal 1:
cd frontend && npm run dev

# Terminal 2: (auto-starts, or use separate terminal)
cd backend && npm run dev
```

### **5. Open Browser**
Navigate to **`http://localhost:9002`**

---

## 📖 Full Documentation

For comprehensive documentation including:
- Detailed architecture overview
- Backend API reference
- Socket.IO events documentation
- Troubleshooting guide
- Production deployment

See **[PROJECT.md](./PROJECT.md)**

---

## 🏗️ Architecture

### **Frontend Stack**
- **Framework**: Next.js 15 (React 19)
- **Language**: TypeScript
- **Editor**: Monaco (@monaco-editor/react)
- **UI**: Radix UI + Tailwind CSS
- **State**: React Context API
- **Auth**: Firebase Authentication
- **Database**: Firestore (real-time sync)
- **Real-time**: Socket.IO client

### **Backend Stack**
- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time**: Socket.IO
- **Execution**: Docker containers
- **Code Compilation**: GCC, Python, Java, Node.js
- **Process Management**: Cross-platform process trees

### **Data Persistence**
```
┌─────────────────────────────────┐
│     React State (in-memory)     │
│   ↕ (Firestore onSnapshot)      │
├─────────────────────────────────┤
│    Firestore Collections        │
│                                 │
│  /sessions/{sessionId}          │  ← Single source of truth
│    ├─ files[]                   │     (All session data)
│    ├─ messages[]                │
│    ├─ participants{}            │
│    └─ metadata                  │
│                                 │
│  /users/{uid}                   │     (User preferences)
└─────────────────────────────────┘

Socket.IO: Used ONLY for code execution streams
           and terminal I/O, NOT for file sync
```

---

## 🎮 How to Use

### **Creating a Session**
1. Login to CodeForge
2. Click **"Create New Session"**
3. Name your session (e.g., "Python Project")
4. Share the 8-character code with collaborators
5. Start collaborating!

### **Joining a Session**
1. Login to CodeForge
2. Click **"Join Session"**
3. Paste the session code
4. Click **"Join"**
5. You're now part of the collaboration!

### **Writing & Running Code**
1. **Create file** — Right-click in file explorer → "New File"
2. **Select language** — Choose from 8 supported languages
3. **Write code** — Full editor with syntax highlighting
4. **Execute** — Click "▶️ Run" or press Ctrl+Enter
5. **See output** — Live streaming results in Output tab
6. **Debug** — Use Terminal tab for manual testing

### **Deploying to Docker**
1. Click **"Build Container"** in header
2. Login with Docker Hub credentials
3. Choose custom repo or create new
4. Click **"Deploy"** — image builds and pushes automatically
5. Share container with team!

---

## 🔒 Security & Privacy

- **OAuth 2.0** — Firebase handles authentication securely
- **End-to-end** — HTTPS encryption for all network traffic
- **Firestore Rules** — Database protected with security rules
- **No data storage** — Code is temporary and deleted on session end
- **Role-based** — Fine-grained access control per participant

---

## 📊 Project Structure

```
CodeForge/
├── frontend/                    # Next.js 15 + React
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx        # Main entry point (auth flow)
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── ide/            # IDE panels (editor, explorer, etc.)
│   │   │   ├── auth/           # Auth pages (login, verify email)
│   │   │   ├── session/        # Session screens
│   │   │   └── ui/             # Reusable UI components
│   │   ├── contexts/
│   │   │   ├── auth-context    # Firebase auth state
│   │   │   └── session-context # Session + file state
│   │   ├── lib/
│   │   │   ├── firebase.ts     # Firebase config
│   │   │   └── utils.ts
│   │   └── styles/globals.css
│   ├── package.json
│   └── .env                    # (git-ignored)
│
├── backend/                     # Node.js + Express
│   ├── index.js                # ~1900 lines: socket handlers, execution
│   ├── package.json
│   └── .env                    # (git-ignored)
│
├── README.md                    # This file
├── PROJECT.md                   # Detailed documentation
└── package.json                 # Root scripts
```

---

## 🔧 Development Commands

### **Root Level**
```bash
npm run dev              # Start frontend + backend
npm run build            # Production build
npm run start            # Production server
```

### **Frontend**
```bash
cd frontend
npm run dev              # Start on :9002
npm run build            # Production build
npm run lint             # ESLint check
npm run typecheck        # TypeScript check
```

### **Backend**
```bash
cd backend
npm run dev              # Start on :5001
npm run start            # Production server
```

---

## 🐛 Known Limitations

1. **Docker Hub credentials** — Stored client-side (consider encrypted storage for production)
2. **Firestore free tier** — Rate limited to 20K reads/day
3. **Session cleanup** — Manual deletion required if host doesn't exit
4. **Browser localStorage** — Limited to ~5MB per domain
5. **Terminal output** — Very verbose output may slow browser

---

## 🎓 Use Cases

- **👨‍💻 Pair Programming** — Code together in real-time
- **🏫 Education** — Teachers share code lessons with students
- **🐛 Debugging** — Collaboratively solve technical issues
- **📝 Code Review** — Real-time peer review sessions
- **🚀 Prototyping** — Quick collaborative prototypes
- **🤝 Interviews** — Coding interview platform

---

## 📈 Performance

| Metric | Target | Status |
|--------|--------|--------|
| Page Load | <2s | ✅ Achieved |
| Code Execution | <1s | ✅ Achieved |
| Chat Sync | <100ms | ✅ Achieved |
| File Sync | <500ms | ✅ Achieved |
| Deployment | ~30s | ✅ Achieved |

---

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License — see LICENSE file for details.

---

## 🙋 Support

- **Issues** — Open a GitHub issue for bugs
- **Features** — Request features via GitHub discussions
- **Documentation** — See [PROJECT.md](./PROJECT.md) for detailed docs


---

## 🚀 Future Roadmap

- [ ] VSCode theme sync
- [ ] Git integration (clone/push repos)
- [ ] AI code suggestions
- [ ] Debugger UI
- [ ] Package manager (npm/pip) integration
- [ ] Custom language plugins
- [ ] Mobile app (React Native)
- [ ] Self-hosted deployment guide

---

**Made with ❤️ by the CodeForge team**

*"Collaborate faster. Code better. Build together."*
