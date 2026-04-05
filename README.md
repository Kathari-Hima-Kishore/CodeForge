<div align="center">

# 🔥 CODEFORGE

<img src="readme-img/1.png" alt="CodeForge Homepage" width="100%">

### **REAL-TIME COLLABORATIVE IDE** • **ZERO SETUP** • **INSTANT DEPLOYMENT**

[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

---

</div>

## 🎯 **WHAT IS CODEFORGE?**

<table>
<tr>
<td width="50%">

**CodeForge** is a **browser-based collaborative IDE** that eliminates setup barriers. Code together in real-time, execute in 8+ languages, and deploy to Docker — all from your browser.

### ⚡ **CORE FEATURES**

- 🔄 **Real-time Collaboration** between users
- 💾 **Session Persistence** via Firestore
- 🚀 **Multi-language Execution** (Python, JS, Java, C++, etc.)
- 🐳 **Instant Docker Deployment**
- 💬 **Live Chat** integrated
- 📁 **File Management** with full CRUD
- 🔐 **Firebase Authentication**
- ⚙️ **Zero Configuration Required**

</td>
<td width="50%">

```javascript
// Start coding in seconds
const session = await createSession("My Project");

// Real-time collaboration
session.join("ABC123XYZ");

// Execute code instantly
await executeCode({
  language: "python",
  code: `print("Hello, World!")`
});

// Deploy to Docker Hub
await deployContainer({
  name: "my-app",
  platform: "docker"
});
```

</td>
</tr>
</table>

---

<div align="center">

## 🎨 **EXPERIENCE THE INTERFACE**

</div>

### 🏠 **SESSION MANAGEMENT**

<div align="center">
<img src="readme-img/2.png" alt="Session Page" width="90%">
</div>

<table>
<tr>
<td width="33%" align="center">

### 🆕 CREATE
Start a new session with<br/>
**one click**

</td>
<td width="33%" align="center">

### 🔗 JOIN
Enter session code<br/>
**ABC123XYZ**

</td>
<td width="33%" align="center">

### ♻️ REJOIN
Auto-restore your<br/>
**last session**

</td>
</tr>
</table>

---

<div align="center">

## 💙 **THE HEART OF THE PROJECT**

### **COLLABORATIVE IDE WORKSPACE**

<img src="readme-img/3.png" alt="IDE Interface" width="95%" style="border: 6px solid #1e40af; box-shadow: 0 20px 60px rgba(30, 64, 175, 0.4);">

</div>

<table>
<tr>
<td width="25%">

#### 📂 **FILE EXPLORER**
- Create files/folders
- Rename & delete
- Drag & drop support
- Language indicators
- File locking system

</td>
<td width="25%">

#### ✏️ **CODE EDITOR**
- Monaco Editor (VS Code)
- Syntax highlighting
- Auto-completion
- Multi-language support
- Real-time sync

</td>
<td width="25%">

#### 🖥️ **OUTPUT PANEL**
- Streaming execution
- Interactive stdin
- Terminal access
- Error highlighting
- Process control

</td>
<td width="25%">

#### 👥 **COLLABORATION**
- Live chat
- User presence
- Role management
- Activity feed

</td>
</tr>
</table>

---

<div align="center">

## 🐳 **EXPORT & DEPLOYMENT**

<img src="readme-img/4.png" alt="Export Window" width="85%">

</div>

### **ONE-CLICK CONTAINERIZATION**

```bash
# Your code → Docker container in seconds
✓ Build multi-file projects
✓ Push to Docker Hub
✓ Auto-generate Dockerfile
✓ Deploy to cloud platforms
```

<table>
<tr>
<td align="center">

### 📦 **DOWNLOAD**
Export as ZIP archive

</td>
<td align="center">

### 🐳 **DOCKER HUB**
Push to your repository

</td>
<td align="center">

### ☁️ **RENDER**
Deploy to cloud instantly

</td>
</tr>
</table>

---

<div align="center">

## 🌐 **LANGUAGE SUPPORT**

<img src="readme-img/5.png" alt="Language Support Detector" width="80%">

</div>

### **8 LANGUAGES, UNLIMITED POSSIBILITIES**

<table>
<tr>
<td width="50%">

#### 🌍 **WEB TECHNOLOGIES**
```html
<!-- HTML/CSS/JavaScript -->
<div class="awesome">
  <h1>Build web apps instantly</h1>
</div>
```

#### 🐍 **PYTHON**
```python
# Data science, ML, automation
import pandas as pd
df = pd.read_csv("data.csv")
```

#### ☕ **JAVA**
```java
// Enterprise applications
public class Main {
    public static void main(String[] args) {
        System.out.println("CodeForge!");
    }
}
```

</td>
<td width="50%">

#### ⚡ **TYPESCRIPT**
```typescript
// Type-safe development
interface Project {
  name: string;
  files: File[];
}
```

#### 🔧 **C/C++**
```cpp
// Systems programming
#include <iostream>
int main() {
    std::cout << "Low-level power!";
    return 0;
}
```

#### ✨ **AUTO-DETECTION**
- File extension recognition
- Syntax highlighting
- Runtime selection
- Dependency management

</td>
</tr>
</table>

---

<div align="center">

## 🚀 **QUICK START**

</div>

### **GET UP AND RUNNING IN 60 SECONDS**

```bash
# 1️⃣ Clone the repository
git clone https://github.com/yourusername/codeforge.git
cd codeforge

# 2️⃣ Install dependencies
cd frontend && npm install
cd ../backend && npm install

# 3️⃣ Configure Firebase (add your credentials)
# frontend/.env.local
NEXT_PUBLIC_FIREBASE_API_KEY=your_key_here
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id

# backend/firebase-service-account.json
# (Download from Firebase Console)

# 4️⃣ Start the servers
cd backend && npm start        # Backend on :5001
cd frontend && npm run dev     # Frontend on :9002

# 5️⃣ Open browser → http://localhost:9002
```

### **📦 DEPENDENCIES**

<table>
<tr>
<td>

#### Frontend Requirements
- Node.js 18+
- npm 9+

</td>
<td>

#### Backend Requirements
- Node.js 18+
- Python 3.x
- Java JDK 11+
- GCC/G++ compiler

</td>
<td>

#### Optional
- Docker (for deployment)
- Git (for version control)

</td>
</tr>
</table>

---

<div align="center">

## 🎮 **HOW TO USE**

</div>

### **STEP-BY-STEP GUIDE**

<table>
<tr>
<td width="20%" align="center">

### 1️⃣
**SIGN UP**

Create account with email verification

</td>
<td width="20%" align="center">

### 2️⃣
**CREATE SESSION**

Start new collaborative workspace

</td>
<td width="20%" align="center">

### 3️⃣
**CODE TOGETHER**

Real-time multi-user editing

</td>
<td width="20%" align="center">

### 4️⃣
**EXECUTE CODE**

Run in 8+ languages instantly

</td>
<td width="20%" align="center">

### 5️⃣
**DEPLOY**

Export to Docker/Render/ZIP

</td>
</tr>
</table>

---

<div align="center">

## 🎯 **KEY FEATURES BREAKDOWN**

</div>

### ⚡ **REAL-TIME COLLABORATION**

<table>
<tr>
<td width="50%">

#### What You Get:
- 🔄 **Instant Sync** - Changes appear in <100ms
- 💬 **Integrated Chat** - Discuss code without leaving IDE
- 👥 **Presence System** - Know who's online
- 🎨 **User Colors** - Unique identifier per person
- 🔐 **Role Management** - Host, Co-host, Editor, Viewer

</td>
<td width="50%">

#### Technical Details:
```javascript
// Socket.IO real-time events
socket.on('file_update', (data) => {
  updateEditorContent(data.fileId, data.content);
});

socket.on('chat_message', (msg) => {
  appendMessage(msg);
});
```

</td>
</tr>
</table>

### 💾 **SESSION PERSISTENCE**

<table>
<tr>
<td>

#### ✅ **What Persists:**
- All files and code content
- Chat message history
- Participant information
- Session settings
- File structure

</td>
<td>

#### 🔄 **How It Works:**
1. Edit file → 500ms debounce
2. Auto-save to Firestore
3. Hard refresh → Auto-restore
4. Resume exactly where you left
5. Zero data loss

</td>
<td>

#### 🛡️ **Security:**
- Firebase Auth required
- Session access control
- Encrypted WebSocket
- Secure file storage
- Role-based permissions

</td>
</tr>
</table>

### 🚀 **CODE EXECUTION ENGINE**

| Feature | Description | Status |
|---------|-------------|--------|
| **Streaming Output** | Real-time stdout/stderr | ✅ |
| **Interactive stdin** | User input during execution | ✅ |
| **Multi-language** | 8+ language support | ✅ |
| **Process Control** | Kill running processes | ✅ |
| **Error Handling** | Colored error messages | ✅ |
| **Timeout Protection** | No hanging processes | ✅ |
| **File Context** | Access all project files | ✅ |
| **Auto Java Detection** | Smart class name parsing | ✅ |

---

<div align="center">

## 🛠️ **DEVELOPMENT**

</div>

### **PROJECT STRUCTURE**

```
codeforge/
├── 📁 frontend/                # Next.js 15 application
│   ├── src/
│   │   ├── app/               # App Router pages
│   │   ├── components/        # React components
│   │   │   ├── auth/         # Authentication UI
│   │   │   ├── ide/          # IDE interface (9 components)
│   │   │   ├── session/      # Session management
│   │   │   └── ui/           # Reusable UI components
│   │   ├── contexts/         # React Context providers
│   │   │   ├── auth-context.tsx
│   │   │   └── session-context.tsx
│   │   └── lib/              # Utilities
│   ├── package.json
│   └── tailwind.config.ts
│
├── 📁 backend/                 # Node.js + Express server
│   ├── index.js              # Main server (~1900 lines)
│   ├── package.json
│   └── firebase-service-account.json
│
├── 📁 readme-img/             # Documentation images
├── firestore.rules           # Security rules
├── README.md                 # This file
└── package.json              # Root package
```

### **TECH STACK DEEP DIVE**

<table>
<tr>
<td>

#### 🎨 **Frontend Stack**
```json
{
  "next": "15.5.9",
  "react": "19.2.1",
  "typescript": "5.x",
  "@monaco-editor/react": "4.7.0",
  "socket.io-client": "4.7.5",
  "firebase": "11.9.1",
  "tailwindcss": "3.4.1",
  "@radix-ui/react-*": "1.x"
}
```

</td>
<td>

#### ⚙️ **Backend Stack**
```json
{
  "express": "4.21.0",
  "socket.io": "4.7.5",
  "firebase-admin": "12.5.0",
  "archiver": "7.0.1",
  "uuid": "latest",
  "cors": "latest",
  "dotenv": "latest"
}
```

</td>
</tr>
</table>

---

<div align="center">

## 🧪 **TESTING & QUALITY**

</div>

### **VERIFIED FEATURES**

| Category | Features | Status |
|----------|----------|--------|
| 🔐 **Authentication** | Email/password, verification, reset | ✅ Tested |
| 💾 **Persistence** | Auto-save, restore on refresh | ✅ Tested |
| 🔄 **Real-time** | File sync, chat, presence | ✅ Tested |
| 🚀 **Execution** | Python, JS, Java, C++, etc. | ✅ Tested |
| 🐳 **Deployment** | Docker build, Hub push | ✅ Tested |
| 📁 **File System** | CRUD operations, folders | ✅ Tested |
| 👥 **Collaboration** | Multi-user, roles, presence | ✅ Tested |
| 🔌 **Socket.IO** | Reconnection, error handling | ✅ Tested |

---

<div align="center">

## 📊 **PERFORMANCE**

</div>

<table>
<tr>
<td width="25%" align="center">

### ⚡ **FAST**
< 100ms latency for real-time sync

</td>
<td width="25%" align="center">

### 🎯 **EFFICIENT**
500ms debounce for auto-save

</td>
<td width="25%" align="center">

### 📦 **LIGHTWEIGHT**
Optimized bundle size

</td>
<td width="25%" align="center">

### 🔋 **SCALABLE**
Socket.IO rooms architecture

</td>
</tr>
</table>

### **OPTIMIZATION TECHNIQUES**

- ✅ Debounced Firestore writes (500ms)
- ✅ Lazy loading components
- ✅ WebSocket connection pooling
- ✅ In-memory caching with fallback
- ✅ Code splitting (Next.js automatic)
- ✅ Image optimization
- ✅ Server-side rendering where beneficial

---

<div align="center">

## 🤝 **CONTRIBUTING**

</div>

We welcome contributions! Here's how you can help:

<table>
<tr>
<td width="33%">

### 🐛 **REPORT BUGS**
1. Check existing issues
2. Create detailed report
3. Include screenshots
4. Provide steps to reproduce

</td>
<td width="33%">

### ✨ **SUGGEST FEATURES**
1. Open feature request
2. Describe use case
3. Explain benefits
4. Discuss implementation

</td>
<td width="33%">

### 💻 **SUBMIT CODE**
1. Fork the repository
2. Create feature branch
3. Make your changes
4. Submit pull request

</td>
</tr>
</table>

### **DEVELOPMENT WORKFLOW**

```bash
# 1. Fork and clone
git clone https://github.com/your-username/codeforge.git

# 2. Create branch
git checkout -b feature/amazing-feature

# 3. Make changes and commit
git commit -m "Add amazing feature"

# 4. Push to your fork
git push origin feature/amazing-feature

# 5. Open Pull Request
```

---

<div align="center">

## 📜 **LICENSE**

</div>

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2026 CodeForge

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
```

---

<div align="center">

## 🙏 **ACKNOWLEDGMENTS**

</div>

<table>
<tr>
<td align="center">

### 🎨 **DESIGN**
Inspired by modern IDEs and collaborative tools

</td>
<td align="center">

### 🛠️ **TECH**
Built on shoulders of giants (React, Next.js, Firebase)

</td>
<td align="center">

### 👥 **COMMUNITY**
Thanks to all contributors and testers

</td>
</tr>
</table>

### **POWERED BY**

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Monaco](https://img.shields.io/badge/Monaco-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://microsoft.github.io/monaco-editor/)

</div>

---

<div align="center">

## ⭐ **SHOW YOUR SUPPORT**

Give a ⭐️ if this project helped you!

### **STATS**

![GitHub stars](https://img.shields.io/github/stars/yourusername/codeforge?style=social)
![GitHub forks](https://img.shields.io/github/forks/yourusername/codeforge?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/yourusername/codeforge?style=social)

---

**[⬆ Back to Top](#-codeforge)**

</div>
