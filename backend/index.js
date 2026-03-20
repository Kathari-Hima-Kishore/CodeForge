const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');

dotenv.config();

// Helper: kill entire process tree (critical on Windows where child.kill doesn't kill child processes)
function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      // /F: Forcefully terminate /T: Terminate child processes
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
    } else {
      // Kill entire process group (pid is negative)
      // This requires the process to have been started with { detached: true }
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (e) {
    // Process may have already exited
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  host: "0.0.0.0",
  port: parseInt(process.env.PORT || "5001"),
  max_execution_time: 30, // seconds
  max_output_size: 50000,
  firebase_credentials_path: "firebase-service-account.json",
  frontend_url: process.env.FRONTEND_URL || "http://localhost:9002"
};

// =============================================================================
// Firebase Initialization
// =============================================================================

let FIREBASE_INITIALIZED = false;
let db = null;

function getDb() {
  ensureFirebaseInit();
  return db;
}

function initFirebase() {
  const rootDir = path.resolve(__dirname, '..');
  let creds_path = path.join(__dirname, CONFIG.firebase_credentials_path);

  if (!fs.existsSync(creds_path)) {
    creds_path = path.join(rootDir, CONFIG.firebase_credentials_path);
  }

  if (fs.existsSync(creds_path)) {
    try {
      const serviceAccount = require(creds_path);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      FIREBASE_INITIALIZED = true;
      db = admin.firestore();
      console.log("✅ Firebase Admin SDK initialized");
    } catch (e) {
      console.warn(`⚠️  Firebase initialization failed: ${e.message}`);
    }
  } else {
    console.warn(`⚠️  Firebase credentials not found at ${creds_path}. Auth disabled.`);
  }
}

// Lazy init — only called on first real Firebase access
let _firebaseInitDone = false;

function ensureFirebaseInit() {
  if (_firebaseInitDone) return;
  _firebaseInitDone = true;
  initFirebase();
}

// initFirebase() removed from here — now lazy via ensureFirebaseInit()

// =============================================================================
// Authentication Middleware
// =============================================================================

async function verifyFirebaseToken(req, res, next) {
  ensureFirebaseInit();
  if (!FIREBASE_INITIALIZED) return next();

  let idToken = null;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    idToken = req.headers.authorization.split(' ')[1];
  }

  if (!idToken) {
    return res.status(401).json({ error: "No authorization token provided" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: `Invalid token: ${error.message}` });
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateSessionId(length = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(crypto.randomInt(chars.length));
  }
  return result;
}

function generateColor() {
  const colors = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308",
    "#84cc16", "#22c55e", "#10b981", "#14b8a6",
    "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
    "#8b5cf6", "#a855f7", "#d946ef", "#ec4899"
  ];
  return colors[crypto.randomInt(colors.length)];
}

async function findFreePort(startPort = 5001, maxTries = 5) {
  // Try a few ports near the default to maintain predictability
  const net = require('net');
  const isPortAvailable = (port) => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, '0.0.0.0', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  };

  for (let port = startPort; port < startPort + maxTries; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    console.log(`Port ${port} in use, trying next...`);
  }

  throw new Error(`Could not find a free port between ${startPort} and ${startPort + maxTries - 1}`);
}

// =============================================================================
// Code Execution Logic
// =============================================================================

const langConfig = {
  "python": { ext: ".py", cmd: "python" },
  "javascript": { ext: ".js", cmd: "node" },
  "typescript": { ext: ".ts", cmd: "npx", args: ["ts-node"] },
  "java": { ext: ".java", compiler: "javac", out: "Main", cmd: "java" },
  "cpp": { ext: ".cpp", compiler: "g++", out: "out" },
  "c": { ext: ".c", compiler: "gcc", out: "out" },
  "html": { ext: ".html", type: "browser" },
  "css": { ext: ".css", type: "browser" },
};

async function executeCode(language, code, stdin = "", projectFiles = {}) {
  if (!code || !code.trim()) {
    return { error: "Empty code" };
  }

  const lang = language.toLowerCase();
  const config = langConfig[lang];
  if (!config) {
    return { error: `Language ${language} not supported` };
  }

  // HTML/CSS are browser-based, not executable via CLI
  if (config.type === "browser") {
    return {
      stdout: `📄 ${language.toUpperCase()} files cannot be executed directly.\n\n💡 To view your ${language.toUpperCase()} code:\n   • Open the file in a web browser\n   • Or save it locally and open in your browser\n\n📝 Tip: For HTML, create an index.html file and open it in any browser.`,
      info: "browser_only"
    };
  }

  // Create unique temp directory
  const tmpDir = path.join(os.tmpdir(), `codeforge-${uuidv4()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Write all project files to preserve folder structure (e.g. templates/index.html)
  if (projectFiles && typeof projectFiles === 'object' && Object.keys(projectFiles).length > 0) {
    console.log('📂 executeCode project files received:', Object.keys(projectFiles));
    for (const [pFile, content] of Object.entries(projectFiles)) {
      const fullPath = path.join(tmpDir, pFile);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content || '');
    }
    console.log('📂 Files on disk after writing:', fs.readdirSync(tmpDir, { recursive: true }));
  } else {
    console.log('⚠️ executeCode: No project files received');
  }

  // For Java: filename must match the public class name
  let javaClassName = 'Main';
  if (lang === 'java') {
    const classMatch = code.match(/public\s+class\s+(\w+)/);
    if (classMatch) javaClassName = classMatch[1];
  }

  const fileName = lang === "java" ? `${javaClassName}.java` : `main${config.ext}`;
  const filePath = path.join(tmpDir, fileName);

  try {
    fs.writeFileSync(filePath, code);
    const startTime = Date.now();

    // Handle compilation for C/C++/Java
    if (config.compiler) {
      let compileArgs;
      if (lang === 'java') {
        // Java: javac ClassName.java (no -o flag)
        compileArgs = [filePath];
      } else {
        // C/C++: gcc/g++ -o out main.c
        compileArgs = ["-o", config.out, filePath];
      }
      await new Promise((resolve, reject) => {
        const compilerProcess = spawn(config.compiler, compileArgs, { cwd: tmpDir });
        let errOut = "";
        compilerProcess.stderr.on('data', data => errOut += data);
        compilerProcess.on('close', code => {
          if (code !== 0) reject({ stdout: "", stderr: errOut, exit_code: code });
          else resolve();
        });
        compilerProcess.on('error', (err) => {
          reject({ stdout: "", stderr: `Failed to start compiler: ${err.message}`, exit_code: 1 });
        });
      });
    }

    // Prepare execution command
    let cmd, args;
    if (config.compiler) {
      // For C/C++: run compiled executable
      // For Java: run java command with extracted class name
      if (lang === 'java') {
        cmd = 'java';
        args = ['-cp', '.', javaClassName];
      } else {
        cmd = process.platform === 'win32' ? path.join(tmpDir, `${config.out}.exe`) : path.join(tmpDir, `./${config.out}`);
        args = [];
      }
    } else if (config.args) {
      cmd = config.cmd;
      args = [...config.args, filePath];
    } else {
      cmd = config.cmd;
      // Allow overriding python alias on windows
      if (cmd === 'python' && process.platform !== 'win32') {
        cmd = 'python3';
      }
      args = [filePath];
    }

    return await new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: tmpDir, detached: process.platform !== 'win32' });

      let stdoutData = "";
      let stderrData = "";
      const max_size = CONFIG.max_output_size;

      let isDone = false;

      // Timeout control
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          killProcessTree(child);
          resolve({
            error: "Execution timed out",
            stdout: stdoutData,
            stderr: stderrData,
            execution_time: CONFIG.max_execution_time
          });
        }
      }, CONFIG.max_execution_time * 1000);

      child.stdout.on('data', (data) => {
        stdoutData += data.toString();
        if (stdoutData.length > max_size) {
          stdoutData = stdoutData.slice(0, max_size) + "\n... [Output Truncated]";
          killProcessTree(child);
        }
      });

      child.stderr.on('data', (data) => {
        stderrData += data.toString();
        if (stderrData.length > max_size) {
          stderrData = stderrData.slice(0, max_size) + "\n... [Output Truncated]";
          killProcessTree(child);
        }
      });

      if (stdin) {
        child.stdin.write(stdin);
      }
      child.stdin.end();

      child.on('close', (code, signal) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);

        const executionTime = (Date.now() - startTime) / 1000;
        resolve({
          stdout: stdoutData,
          stderr: stderrData,
          exit_code: signal ? 1 : (code || 0),
          execution_time: executionTime
        });
      });

      child.on('error', (err) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        resolve({
          error: `Failed to start process: ${err.message}`,
          stdout: stdoutData,
          stderr: stderrData,
        });
      });
    });

  } catch (e) {
    if (e.exit_code !== undefined) {
      // Compilation error case
      return { stdout: e.stdout, stderr: e.stderr, exit_code: e.exit_code, execution_time: 0 };
    }
    return { error: e.message || "Execution failed" };
  } finally {
    // Retry cleanup with delay to handle EBUSY from recently killed processes
    const cleanupRetries = 3;
    for (let i = 0; i < cleanupRetries; i++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (err.code === 'EBUSY' && i < cleanupRetries - 1) {
          await new Promise(r => setTimeout(r, 500 * (i + 1)));
        } else if (i === cleanupRetries - 1) {
          // Last resort: schedule cleanup for later
          setTimeout(() => {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
          }, 5000);
        }
      }
    }
  }
}

async function notifyFrontend(event, data) {
  try {
    await fetch(`${CONFIG.frontend_url}/api/backend-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data })
    });
  } catch (e) {
    // Silently fail if frontend is not yet ready
  }
}

// =============================================================================
// Session Storage
// =============================================================================
// NOTE: In-memory sessions are ONLY for tracking active Socket.IO connections.
// ALL persistent data (files, messages, participants, etc.) is stored in Firestore.
// The in-memory cache is ephemeral and can be rebuilt from Firestore on reconnect.
// SOURCE OF TRUTH: Firestore (frontend writes directly, backend syncs on join/leave)

const sessions = {}; // Active session connections (ephemeral)
const connectedUsers = {}; // Socket ID → User mapping

class SessionData {
  constructor(sessionId, hostUid, hostName, settings) {
    this.id = sessionId;
    this.name = settings.name || `${hostName}'s Session`;
    this.host_uid = hostUid;
    this.host_sid = null;
    this.created_at = new Date().toISOString();
    this.created_at_ms = Date.now();
    this.participants = {}; // Only for tracking active socket connections
    this.is_active = true;
    // NOTE: files and messages are NOT stored here - they live ONLY in Firestore
    // Frontend writes directly to Firestore, backend only tracks connections
  }

  addParticipant(userUid, name, sid, role = "editor") {
    const participant = {
      uid: userUid,
      name: name,
      role: role,
      sid: sid, // Socket ID for routing messages
      color: generateColor(),
      joined_at: new Date().toISOString()
    };
    this.participants[userUid] = participant;
    return participant;
  }

  removeParticipant(userUid) {
    if (this.participants[userUid]) {
      const p = this.participants[userUid];
      delete this.participants[userUid];
      return p;
    }
    return null;
  }

  getParticipantBySid(sid) {
    for (const uid in this.participants) {
      if (this.participants[uid].sid === sid) {
        return [uid, this.participants[uid]];
      }
    }
    return [null, null];
  }

  toDict() {
    return {
      sessionId: this.id,
      name: this.name,
      hostId: this.host_uid,
      hostName: this.participants[this.host_uid]?.name || "Host",
      participants: this.participants,
      isActive: this.is_active
    };
  }
}

// =============================================================================
// Firestore Persistence
// =============================================================================
// NOTE: This function syncs the ephemeral in-memory session state to Firestore.
// Called on: session create, join, leave, and participant changes.
// Frontend writes files/messages directly to Firestore, so this mainly syncs participant state.

// Save session to Firestore
async function saveSessionToFirestore(session) {
  if (!getDb() || !session) return;

  try {
    const sessionRef = getDb().collection("sessions").doc(session.id);
    const sessionDoc = await sessionRef.get();

    const docExists = typeof sessionDoc?.exists === 'function' ? sessionDoc.exists() : false;
    
    if (docExists) {
      await sessionRef.update({
        participants: session.participants,
        isActive: session.is_active
      });
      console.log(`💾 Session ${session.id} participants synced to Firestore`);
    } else {
      const sessionData = {
        sessionId: session.id,
        name: session.name,
        hostId: session.host_uid,
        hostName: session.participants[session.host_uid]?.name || "Host",
        participants: session.participants,
        files: [],
        messages: [],
        isActive: session.is_active,
        createdAt: session.created_at_ms || new Date(session.created_at).getTime()
      };

      await sessionRef.set(sessionData);
      console.log(`💾 Session ${session.id} created in Firestore`);
    }
  } catch (error) {
    console.error(`❌ Failed to save session ${session.id} to Firestore:`, error);
  }
}

// =============================================================================
// Socket.IO Events
// =============================================================================

io.on('connection', (socket) => {
  const sid = socket.id;
  const auth = socket.handshake.auth || {};
  console.log(`🔌 Client connected: ${sid}`);

  const user_id = auth.userId || `anon_${sid.slice(0, 8)}`;
  const user_name = auth.userName || "Anonymous";
  const user_email = auth.userEmail || "";

  connectedUsers[sid] = {
    uid: user_id,
    name: user_name,
    email: user_email,
    session_id: null
  };

  socket.on('disconnect', () => {
    const userData = connectedUsers[sid];
    if (!userData) return;

    const sessionId = userData.session_id;
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      const [userUid, participant] = session.getParticipantBySid(sid);

      if (userUid) {
        session.removeParticipant(userUid);
        io.to(sessionId).emit("user_left", { user_uid: userUid, name: participant.name });

        if (userUid === session.host_uid) {
          // Host disconnected — keep session alive in Firestore so it can be rejoined.
          // Only delete from in-memory map; resurrection happens via join_session.
          delete sessions[sessionId];
        } else {
          saveSessionToFirestore(session).catch(e =>
            console.error(`Failed to sync session ${sessionId} on participant leave:`, e)
          );
        }
      }
    }
    delete connectedUsers[sid];
    console.log(`🔌 Client disconnected: ${sid}`);
  });

  socket.on('create_session', async (data, callback) => {
    const userData = connectedUsers[sid];
    if (!userData) return callback({ error: "Not authenticated" });

    let sessionId = data.session_id || generateSessionId();
    while (sessions[sessionId]) {
      sessionId = generateSessionId();
    }

    const session = new SessionData(
      sessionId,
      userData.uid,
      userData.name,
      data.settings || {}
    );

    session.host_sid = sid;
    session.addParticipant(userData.uid, userData.name, sid, "host");

    sessions[sessionId] = session;
    userData.session_id = sessionId;
    socket.join(sessionId);

    // Save session to Firestore
    console.log(`Creating session ${sessionId} for user ${userData.uid}`);
    await saveSessionToFirestore(session);

    // Bridge: Notify frontend of session creation
    notifyFrontend('session_created', { sessionId, hostId: userData.uid });

    if (callback) callback({ success: true, session: session.toDict() });
  });

  socket.on('join_session', async (data, callback) => {
    const userData = connectedUsers[sid];
    if (!userData) return callback ? callback({ error: "Not authenticated" }) : null;

    let sessionId = data.session_id || data.sessionId;
    if (!sessionId) return callback ? callback({ error: "Session ID required" }) : null;

    sessionId = sessionId.toUpperCase().trim();

    if (!sessions[sessionId]) {
      if (getDb()) {
        try {
          const doc = await getDb().collection("sessions").doc(sessionId).get();
          if (doc.exists) {
            const dataFs = doc.data();
            if (dataFs.isActive) {
              const session = new SessionData(
                sessionId,
                dataFs.hostId,
                dataFs.hostName,
                { name: dataFs.name }
              );

              // Restore participant connection state (but not socket IDs - those are rebuilt on reconnect)
              if (dataFs.participants) {
                for (const uid in dataFs.participants) {
                  const p = dataFs.participants[uid];
                  session.participants[uid] = {
                    uid: p.uid,
                    name: p.name,
                    role: p.role,
                    sid: null, // Socket ID will be set on reconnect
                    color: p.color || generateColor(),
                    joined_at: p.joinedAt || new Date().toISOString()
                  };
                }
              }

              sessions[sessionId] = session;
              console.log(`🔄 Session ${sessionId} resurrected from Firestore (connection tracking only)`);
            } else {
              return callback ? callback({ error: "Session is inactive" }) : null;
            }
          } else {
            return callback ? callback({ error: "Session not found" }) : null;
          }
        } catch (e) {
          console.error(`Error resurrecting session: ${e}`);
          return callback ? callback({ error: "Session not found" }) : null;
        }
      } else {
        return callback ? callback({ error: "Session not found" }) : null;
      }
    }

    const session = sessions[sessionId];
    // Preserve existing role; host always stays host; new joiners default to editor
    const existingRole = session.participants[userData.uid]?.role;
    const role = existingRole || (userData.uid === session.host_uid ? 'host' : 'editor');
    const participant = session.addParticipant(userData.uid, userData.name, sid, role);

    userData.session_id = sessionId;
    socket.join(sessionId);

    // Save session to Firestore (with updated socket id for participant)
    await saveSessionToFirestore(session);

    socket.to(sessionId).emit("user_joined", {
      user_uid: userData.uid,
      name: userData.name,
      role: role,
      color: participant.color
    });

    if (callback) callback({ success: true, session: session.toDict() });
  });

  socket.on('leave_session', (data) => {
    const userData = connectedUsers[sid];
    if (!userData) return;

    const sessionId = userData.session_id;
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      const [userUid, participant] = session.getParticipantBySid(sid);

      if (userUid) {
        session.removeParticipant(userUid);
        socket.leave(sessionId);
        userData.session_id = null;

        io.to(sessionId).emit("user_left", { user_uid: userUid, name: participant.name });

        if (userUid === session.host_uid) {
          io.to(sessionId).emit("session_ended", { reason: "Host left" });
          delete sessions[sessionId];
        }
      }
    }
  });

  // Per-socket state for streaming code execution
  let codeProcess = null;
  let codeTmpDir = null;

  socket.on('run_code', async (data, callback) => {
    const userData = connectedUsers[sid];
    const userName = userData ? userData.name : "Unknown";
    const sessionId = userData ? userData.session_id : data.sessionId;

    const language = (data.language || "").toLowerCase();
    const code = data.code || "";

    console.log(`▶️ run_code: ${language} for ${userName}`);

    // Kill any existing code execution for this socket
    if (codeProcess) {
      try { killProcessTree(codeProcess); } catch { }
      codeProcess = null;
    }
    if (codeTmpDir) {
      try { fs.rmSync(codeTmpDir, { recursive: true, force: true }); } catch { }
      codeTmpDir = null;
    }

    try {
      const config = langConfig[language];
      if (!config) {
        return callback ? callback({ error: `Unsupported language: ${language}` }) : null;
      }

      // HTML/CSS can't run on the server
      if (config.type === 'browser') {
        return callback
          ? callback({ error: `${language.toUpperCase()} runs in the browser — use the Preview tab instead.` })
          : null;
      }

      const tmpDir = path.join(os.tmpdir(), `codeforge-${Date.now()}-${sid.slice(0, 8)}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      codeTmpDir = tmpDir;

      // Write project files
      if (data.projectFiles && typeof data.projectFiles === 'object') {
        for (const [fileName, content] of Object.entries(data.projectFiles)) {
          const filePath = path.join(tmpDir, fileName);
          const fileDir = path.dirname(filePath);
          if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
          fs.writeFileSync(filePath, String(content || ''));
        }
      }

      // Java: filename must match the public class name
      let javaClassName = 'Main';
      if (language === 'java') {
        const classMatch = code.match(/public\s+class\s+(\w+)/);
        if (classMatch) javaClassName = classMatch[1];
      }

      const fileName = language === 'java' ? `${javaClassName}.java` : `main${config.ext}`;
      const filePath = path.join(tmpDir, fileName);
      fs.writeFileSync(filePath, code);

      // Compile if needed
      if (config.compiler) {
        const compileArgs = language === 'java'
          ? [filePath]
          : ['-o', config.out, filePath];

        await new Promise((resolve, reject) => {
          const compilerProcess = spawn(config.compiler, compileArgs, { cwd: tmpDir });
          let errOut = '';
          compilerProcess.stderr.on('data', d => errOut += d);
          compilerProcess.on('close', code => {
            if (code !== 0) reject({ stderr: errOut, exit_code: code });
            else resolve();
          });
          compilerProcess.on('error', err => {
            reject({ stderr: `Failed to start compiler: ${err.message}`, exit_code: 1 });
          });
        }).catch(compileErr => {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
          codeTmpDir = null;
          const msg = compileErr.stderr || 'Compilation failed';
          if (callback) callback({ error: msg });
          else socket.emit('execution_exit', { code: 1, error: msg });
          throw { handled: true }; // break out of outer try
        });
      }

      // Build run command
      let cmd, args;
      if (config.compiler) {
        if (language === 'java') {
          cmd = 'java'; args = ['-cp', '.', javaClassName];
        } else {
          cmd = process.platform === 'win32'
            ? path.join(tmpDir, `${config.out}.exe`)
            : path.join(tmpDir, `./${config.out}`);
          args = [];
        }
      } else if (config.args) {
        cmd = config.cmd; args = [...config.args, filePath];
      } else {
        cmd = config.cmd;
        if (cmd === 'python' && process.platform !== 'win32') cmd = 'python3';
        args = [filePath];
      }

      const startTime = Date.now();
      const child = spawn(cmd, args, { cwd: tmpDir, detached: process.platform !== 'win32' });
      codeProcess = child;

      // Acknowledge: compilation passed, streaming starting
      if (typeof callback === 'function') callback({ streaming: true });

      child.stdout.on('data', d => {
        socket.emit('execution_output', { output: d.toString() });
        if (sessionId && sessionId !== 'standalone') {
          socket.to(sessionId).emit('execution_output', { output: d.toString(), executed_by: userName });
        }
      });

      child.stderr.on('data', d => {
        socket.emit('execution_output', { output: d.toString(), isError: true });
      });

      child.on('close', exitCode => {
        codeProcess = null;
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(3);
        socket.emit('execution_exit', { code: exitCode, execution_time: parseFloat(executionTime) });
        setTimeout(() => {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
          if (codeTmpDir === tmpDir) codeTmpDir = null;
        }, 2000);
      });

      child.on('error', err => {
        codeProcess = null;
        socket.emit('execution_exit', { code: 1, error: err.message });
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        if (codeTmpDir === tmpDir) codeTmpDir = null;
      });

    } catch (err) {
      if (err && err.handled) return; // already reported via callback
      console.error('run_code error:', err);
      const msg = err instanceof Error ? err.message : 'Internal execution error';
      if (typeof callback === 'function') callback({ error: msg });
      else socket.emit('execution_exit', { code: 1, error: msg });
    }
  });

  // Send input to the running code process
  socket.on('execution_input', (data) => {
    if (codeProcess && data.input !== undefined) {
      codeProcess.stdin.write(data.input + '\n');
    }
  });

  // Kill the running code process
  socket.on('execution_kill', () => {
    if (codeProcess) {
      try { killProcessTree(codeProcess); } catch { }
      codeProcess = null;
      socket.emit('execution_exit', { code: null, killed: true });
    }
    if (codeTmpDir) {
      setTimeout(() => {
        try { fs.rmSync(codeTmpDir, { recursive: true, force: true }); } catch { }
        codeTmpDir = null;
      }, 1000);
    }
  });

  // NOTE: File updates, cursor positions, and messages are handled directly via Firestore
  // Frontend uses onSnapshot listeners for real-time sync - no Socket.IO needed for these

  // Terminal: run a command with streaming output (no timeout)
  let terminalProcess = null;
  let terminalProjectDir = null;

  socket.on('terminal_run', (data) => {
    const { command, files: userFiles } = data;

    // Kill any existing terminal process first
    if (terminalProcess) {
      try { killProcessTree(terminalProcess); } catch { }
      terminalProcess = null;
    }

    // Clean up previous project dir
    if (terminalProjectDir) {
      try { fs.rmSync(terminalProjectDir, { recursive: true, force: true }); } catch { }
    }

    // Create temp project directory and write session files
    const projectDir = path.join(os.tmpdir(), `codeforge-terminal-${Date.now()}`);
    fs.mkdirSync(projectDir, { recursive: true });
    terminalProjectDir = projectDir;

    if (userFiles && typeof userFiles === 'object') {
      console.log('📂 Terminal files received:', Object.keys(userFiles));
      for (const [fileName, content] of Object.entries(userFiles)) {
        const filePath = path.join(projectDir, fileName);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content || '');
      }
    }

    const child = spawn(command, { shell: true, cwd: projectDir, detached: process.platform !== 'win32' });
    terminalProcess = child;

    child.stdout.on('data', (d) => {
      socket.emit('terminal_output', { output: d.toString() });
    });

    child.stderr.on('data', (d) => {
      socket.emit('terminal_output', { output: d.toString(), isError: true });
    });

    child.on('close', (code) => {
      terminalProcess = null;
      socket.emit('terminal_exit', { code });
      // Clean up project dir after process exits
      setTimeout(() => {
        if (terminalProjectDir === projectDir) {
          try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { }
          terminalProjectDir = null;
        }
      }, 2000);
    });

    child.on('error', (err) => {
      terminalProcess = null;
      socket.emit('terminal_output', { output: `Error: ${err.message}`, isError: true });
    });
  });

  // Terminal: kill the running process
  socket.on('terminal_kill', () => {
    if (terminalProcess) {
      try { killProcessTree(terminalProcess); } catch { }
      terminalProcess = null;
      socket.emit('terminal_output', { output: '\n[Process killed]', isError: false });
    }
      if (terminalProjectDir) {
      setTimeout(() => {
        try { fs.rmSync(terminalProjectDir, { recursive: true, force: true }); } catch { }
        terminalProjectDir = null;
      }, 2000);
    }
  });

  // =============================================================================
  // Release all locks when user disconnects
  socket.on('disconnect', () => {
    if (codeProcess) {
      try { killProcessTree(codeProcess); } catch { }
      codeProcess = null;
    }
    if (codeTmpDir) {
      setTimeout(() => {
        try { fs.rmSync(codeTmpDir, { recursive: true, force: true }); } catch { }
        codeTmpDir = null;
      }, 2000);
    }
    if (terminalProcess) {
      try { killProcessTree(terminalProcess); } catch { }
      terminalProcess = null;
    }
    if (terminalProjectDir) {
      setTimeout(() => {
        try { fs.rmSync(terminalProjectDir, { recursive: true, force: true }); } catch { }
        terminalProjectDir = null;
      }, 2000);
    }
  });
});

// =============================================================================
// API Routes
// =============================================================================

app.get('/', (req, res) => {
  res.json({
    status: "online",
    service: "CodeForge Backend (Node.js)",
    timestamp: new Date().toISOString()
  });
});

// Test Firestore connectivity
app.get('/api/test-firestore', async (req, res) => {
  if (!db) {
    return res.json({ status: "error", message: "Firebase Admin SDK not initialized" });
  }
  
  try {
    // Try to read a non-existent document to test connectivity
    const doc = await getDb().collection("sessions").doc("test-connection").get();
    return res.json({ 
      status: "ok", 
      message: "Firestore is accessible",
      exists: doc.exists 
    });
  } catch (error) {
    return res.json({ 
      status: "error", 
      message: error.message 
    });
  }
});

// Check Docker status
app.get('/api/check-docker', (req, res) => {
  const dockerCmd = process.platform === 'win32' ? 'docker.exe' : 'docker';
  
  try {
    execSync(`${dockerCmd} info`, { stdio: 'pipe' });
    
    // Docker is running - get version info
    let version = '';
    let status = 'running';
    try {
      version = execSync(`${dockerCmd} version --format '{{.Server.Version}}'`, { encoding: 'utf8' }).trim();
    } catch (e) {
      // Ignore version fetch errors
    }
    
    res.json({ 
      installed: true, 
      running: true, 
      version: version,
      status: status,
      message: version ? `Docker ${version} is running` : 'Docker is running'
    });
  } catch (err) {
    const errorMsg = err.message || '';
    let message = 'Docker is not running';
    let hint = 'Please start Docker Desktop';
    
    if (errorMsg.includes('npipe') || errorMsg.includes('pipe')) {
      message = 'Docker daemon is not accessible';
      hint = 'Make sure Docker Desktop is running. Try restarting Docker Desktop.';
    } else if (errorMsg.includes('not found') || errorMsg.includes('no such file')) {
      message = 'Docker is not installed';
      hint = 'Install Docker Desktop from https://docker.com/products/docker-desktop';
    } else if (errorMsg.includes('permission denied')) {
      message = 'Docker permission denied';
      hint = 'Run Docker Desktop as administrator or check permissions.';
    }
    
    res.json({ 
      installed: false, 
      running: false, 
      status: 'error',
      error: message,
      hint: hint,
      details: errorMsg.substring(0, 200)
    });
  }
});

app.post('/api/execute', verifyFirebaseToken, async (req, res) => {
  const { language, code, stdin } = req.body;
  const result = await executeCode(language, code, stdin);
  res.json(result);
});

app.post('/api/terminal', verifyFirebaseToken, async (req, res) => {
  const { command, files } = req.body;

  // Create a temp project directory and write session files into it
  const projectDir = path.join(os.tmpdir(), `codeforge-terminal-${Date.now()}`);
  fs.mkdirSync(projectDir, { recursive: true });

  try {
    // Write user's session files to the temp project directory
    if (files && typeof files === 'object') {
      for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(projectDir, fileName);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content || '');
      }
    }

    const child = spawn(command, { shell: true, cwd: projectDir, detached: process.platform !== 'win32' });

    let stdoutData = "";
    let stderrData = "";
    let isDone = false;

    // Kill after 30 seconds
    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        killProcessTree(child);
        res.json({
          stdout: stdoutData,
          stderr: stderrData + '\n[Process timed out after 30s]',
          exit_code: 1
        });
      }
    }, 30000);

    child.stdout.on('data', d => stdoutData += d.toString());
    child.stderr.on('data', d => stderrData += d.toString());

    child.on('close', code => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      res.json({
        stdout: stdoutData,
        stderr: stderrData,
        exit_code: code
      });
    });

    child.on('error', err => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      res.json({ error: err.message });
    });
  } catch (err) {
    res.json({ error: err.message || 'Terminal command failed' });
  } finally {
    // Clean up after a delay to allow process to fully exit
    setTimeout(() => {
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { }
    }, 5000);
  }
});

app.get('/api/languages', (req, res) => {
  res.json({
    languages: [
      { id: "html", name: "HTML" },
      { id: "css", name: "CSS" },
      { id: "javascript", name: "JavaScript" },
      { id: "typescript", name: "TypeScript" },
      { id: "python", name: "Python" },
      { id: "java", name: "Java" },
      { id: "c", name: "C" },
      { id: "cpp", name: "C++" }
    ]
  });
});

app.get('/api/dockerhub/repos', async (req, res) => {
  let { identifier, password } = req.query;
  
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username and password/PAT required', repos: [] });
  }

  const https = require('https');

  try {
    const authData = JSON.stringify({ identifier, secret: password });
    console.log(`[Docker Hub] Attempting auth with identifier: ${identifier}`);
    
    const authRes = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'hub.docker.com',
        path: '/v2/auth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(authData)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      });
      req.on('error', (err) => {
        console.error('[Docker Hub] Network error during auth:', err.message);
        resolve({ statusCode: 500, data: '' });
      });
      req.write(authData);
      req.end();
    });

    console.log(`[Docker Hub] Auth response status: ${authRes.statusCode}, data: ${(authRes.data || '').substring(0, 500)}`);

    if (authRes.statusCode !== 200) {
      let errorMsg = 'Authentication failed. Docker Hub now requires a Personal Access Token (PAT) instead of password. Create one at: https://hub.docker.com/settings/security';
      try {
        const errData = JSON.parse(authRes.data || '{}');
        errorMsg = errData.detail || errData.message || errorMsg;
      } catch {}
      console.log(`[Docker Hub] Auth failed: ${errorMsg}`);
      return res.json({ error: errorMsg, repos: [] });
    }

    const authJson = JSON.parse(authRes.data || '{}');
    console.log(`[Docker Hub] Auth JSON response:`, JSON.stringify(authJson));
    
    const token = authJson.token || authJson.access_token;
    
    if (!token) {
      console.log(`[Docker Hub] No token in response. Full response: ${authRes.data}`);
      return res.json({ error: 'Authentication failed - no token received. Try using a Personal Access Token (PAT) instead of password.', repos: [] });
    }

    console.log(`[Docker Hub] Got token, attempting to extract username...`);

    let actualUsername = null;

    try {
      const tokenParts = token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        if (payload.username) {
          actualUsername = payload.username;
          console.log(`[Docker Hub] Extracted username from JWT: ${actualUsername}`);
        }
        if (payload.email) {
          console.log(`[Docker Hub] JWT contains email: ${payload.email}`);
        }
      }
    } catch (e) {
      console.log(`[Docker Hub] Could not extract username from JWT: ${e.message}`);
    }

    if (!actualUsername) {
      if (!identifier.includes('@')) {
        actualUsername = identifier;
        console.log(`[Docker Hub] Using input as username: ${actualUsername}`);
      } else {
        return res.json({ error: 'Could not determine Docker Hub username. Please enter your Docker Hub username (not email).', repos: [] });
      }
    }

    const repos = [];
    let page = 1;
    const maxPages = 5;

    // Try the new Docker Hub API first (v2/repositories/{namespace}/)
    let listSuccess = false;
    
    // Try with /v2/repositories/{username}/ endpoint
    while (page <= maxPages && !listSuccess) {
      const listRes = await new Promise((resolve) => {
        const req = https.request({
          hostname: 'hub.docker.com',
          path: `/v2/repositories/${actualUsername}/?page=${page}&page_size=100`,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', () => resolve({ statusCode: 500, data: '[]' }));
        req.end();
      });

      if (listRes.statusCode === 200) {
        const listJson = JSON.parse(listRes.data || '{}');
        if (listJson.results && listJson.results.length > 0) {
          listSuccess = true;
          listJson.results.forEach(repo => {
            repos.push({
              name: repo.name,
              description: repo.description || '',
              isPrivate: repo.is_private,
              pulls: repo.pull_count
            });
          });
          if (!listJson.next) break;
          page++;
        } else {
          break;
        }
      } else {
        console.log(`[Docker Hub] Repository list status: ${listRes.statusCode}, response: ${listRes.data}`);
        break;
      }
    }

    // If no repos found with /v2/repositories/, try the namespace endpoint
    if (repos.length === 0) {
      console.log(`[Docker Hub] No repos from /v2/repositories/, trying namespace endpoint...`);
      page = 1;
      while (page <= maxPages) {
        const listRes = await new Promise((resolve) => {
          const req = https.request({
            hostname: 'hub.docker.com',
            path: `/v2/namespaces/${actualUsername}/repositories?page=${page}&page_size=100`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          });
          req.on('error', () => resolve({ statusCode: 500, data: '[]' }));
          req.end();
        });

        if (listRes.statusCode !== 200) {
          console.log(`[Docker Hub] Namespace endpoint status: ${listRes.statusCode}`);
          break;
        }
        
        const listJson = JSON.parse(listRes.data || '{}');
        if (listJson.results && listJson.results.length > 0) {
          listJson.results.forEach(repo => {
            repos.push({
              name: repo.name,
              description: repo.description || '',
              isPrivate: repo.is_private,
              pulls: repo.pull_count
            });
          });
          if (!listJson.next) break;
          page++;
        } else {
          break;
        }
      }
    }

    console.log(`[Docker Hub] Found ${repos.length} repositories`);

    res.json({ repos, error: null, username: actualUsername });
  } catch (e) {
    console.error('[Docker Hub] Error fetching repos:', e.message);
    res.json({ error: 'Failed to fetch repositories: ' + e.message, repos: [] });
  }
});

app.get('/api/check-docker', (req, res) => {
  const dockerCommands = [
    'docker',
    'docker.exe',
    '"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"',
    '"C:\\Program Files (x86)\\Docker\\Docker\\resources\\bin\\docker.exe"',
    '/usr/bin/docker',
    '/usr/local/bin/docker',
    '/snap/bin/docker'
  ];

  let checked = 0;
  let found = false;

  for (const cmd of dockerCommands) {
    exec(`${cmd} --version`, (error, stdout, stderr) => {
      checked++;
      if (!error && (stdout.includes('Docker') || stderr.includes('Docker'))) {
        found = true;
      }

      if (checked === dockerCommands.length) {
        res.json({ installed: found });
      }
    });
  }
});

// ====== Check Language Support ======
app.get('/api/check-language-support', (req, res) => {
  const checks = {
    python: { cmd: 'python --version', altCmd: 'python3 --version', name: 'Python 3' },
    javascript: { cmd: 'node --version', name: 'Node.js' },
    typescript: { cmd: 'npx --version', name: 'npm/npx' },
    java: { cmd: 'java -version', name: 'Java Runtime' },
    'java-compiler': { cmd: 'javac -version', name: 'Java Compiler (JDK)' },
    cpp: { cmd: process.platform === 'win32' ? 'g++ --version' : 'which g++', name: 'G++ (C++ Compiler)' },
    c: { cmd: process.platform === 'win32' ? 'gcc --version' : 'which gcc', name: 'GCC (C Compiler)' },
  };

  const results = {};
  let completed = 0;
  const total = Object.keys(checks).length;

  Object.entries(checks).forEach(([lang, config]) => {
    exec(config.cmd, { stdio: 'ignore' }, (error) => {
      results[lang] = { name: config.name, installed: !error };
      if (config.altCmd && error) {
        exec(config.altCmd, { stdio: 'ignore' }, (altError) => {
          results[lang].installed = !altError;
          completed++;
          if (completed === total) {
            res.json({ platform: process.platform, languages: results });
          }
        });
      } else {
        completed++;
        if (completed === total) {
          res.json({ platform: process.platform, languages: results });
        }
      }
    });
  });
});

app.post('/api/build-container', async (req, res) => {
  const { files, sessionName, action, dockerHubUsername, dockerHubPassword, dockerHubRepo, cloudProvider, cloudConfig } = req.body;

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Invalid files data' });
  }

  const dockerCmd = process.platform === 'win32' ? 'docker.exe' : 'docker';
  const sanitizedName = (sessionName || 'project').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const hubRepoName = dockerHubRepo || sanitizedName;
  const timestamp = Date.now();
  // Ensure random suffix is always 6 characters
  const randomSuffix = Math.random().toString(36).substring(2, 8).padEnd(6, '0');
  
  // Add small delay to ensure different timestamps in Docker
  const imageName = `codeforge/${sanitizedName}:${timestamp}-${randomSuffix}`;
  const buildDir = path.join(os.tmpdir(), `codeforge-build-${timestamp}`);
  const tarFileName = `${sanitizedName}-${timestamp}.tar`;  // Windows-safe filename (no colons)
  const tarFileNameSafe = `${imageName.replace(/[\/\\:]/g, '-')}.tar`;  // Full safe name with suffix

  const isAutoImport = action === 'autoimport';

  console.log(`[Docker Build] ============================================`);
  console.log(`[Docker Build] timestamp: ${timestamp}`);
  console.log(`[Docker Build] randomSuffix: ${randomSuffix}`);
  console.log(`[Docker Build] imageName: ${imageName}`);
  console.log(`[Docker Build] tarFileNameSafe: ${tarFileNameSafe}`);
  console.log(`[Docker Build] action: ${action}`);
  console.log(`[Docker Build] ============================================`);

  // Remove any existing image with same tag to ensure fresh build
  try {
    execSync(`${dockerCmd} rmi ${imageName}`, { stdio: 'ignore' });
    console.log(`[Docker Build] Removed existing image (if any)`);
  } catch(e) {
    // Ignore - image might not exist
  }

  console.log(`[Docker Build] Starting build for ${imageName} with action ${action}`);
  console.log(`[Docker Build] Files: ${Object.keys(files).join(', ')}`);
  console.log(`[Docker Build] Build dir: ${buildDir}`);
  console.log(`[Docker Build] Docker cmd: ${dockerCmd}`);

  try {
    execSync(`${dockerCmd} info`, { stdio: 'pipe' });
    console.log(`[Docker Build] Docker is accessible`);
  } catch (err) {
    console.log(`[Docker Build] Docker info error: ${err.message}`);
    return res.status(500).json({ error: 'Docker is not accessible. Please ensure Docker Desktop is running.', details: err.message });
  }

  try {
    fs.mkdirSync(buildDir, { recursive: true });

    const fileEntries = Object.entries(files);
    for (const [fileName, content] of fileEntries) {
      const filePath = path.join(buildDir, fileName);
      const fileDir = path.dirname(filePath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
      fs.writeFileSync(filePath, content || '');
    }

    // ============================================================
    // DOCKERFILE GENERATION - Dynamic based on file types
    // ============================================================
    
    const fileKeys = Object.keys(files);
    console.log(`[Docker Build] =============================================`);
    console.log(`[Docker Build] FILES RECEIVED: ${fileKeys.join(', ')}`);
    console.log(`[Docker Build] =============================================`);
    
    let dockerfileContent = '';
    let detectedPort = 3000;
    let framework = 'unknown';
    let entryFile = 'index.js';
    
    // Check for Python files
    const pythonFiles = fileKeys.filter(f => f.endsWith('.py'));
    const hasPython = pythonFiles.length > 0;
    
    // Check for Node.js files  
    const jsFiles = fileKeys.filter(f => f.endsWith('.js') || f.endsWith('.ts'));
    const hasJs = jsFiles.length > 0;
    
    // Check for package.json and requirements.txt
    const hasPackageJson = fileKeys.includes('package.json');
    let hasRequirements = fileKeys.includes('requirements.txt');
    const hasTemplates = fileKeys.some(f => f.startsWith('templates/'));
    
    // Get main Python file
    const mainPyFile = pythonFiles.find(f => f.includes('main')) || pythonFiles[0] || 'app.py';
    const mainJsFile = jsFiles.find(f => f.includes('main')) || jsFiles[0] || 'index.js';
    
    // Auto-generate requirements.txt by scanning ALL Python files for imports
    if (pythonFiles.length > 0 && !hasRequirements) {
      console.log(`[Docker Build] Auto-detecting Python dependencies...`);
      const allPythonContent = Object.entries(files)
        .filter(([name]) => name.endsWith('.py'))
        .map(([, content]) => content)
        .join(' ');

      const detectedDeps = new Set();

      // Common frameworks - detect from imports
      if (allPythonContent.includes('from flask import') || allPythonContent.includes('Flask(')) {
        detectedDeps.add('Flask==2.3.2');
        console.log(`[Docker Build] Found: Flask`);
      }
      if (allPythonContent.includes('from fastapi import') || allPythonContent.includes('FastAPI(')) {
        detectedDeps.add('fastapi==0.104.1');
        detectedDeps.add('uvicorn==0.24.0');
        console.log(`[Docker Build] Found: FastAPI`);
      }
      if (allPythonContent.includes('from django import')) {
        detectedDeps.add('django==4.2.7');
        console.log(`[Docker Build] Found: Django`);
      }
      if (allPythonContent.includes('import requests') || allPythonContent.includes('from requests')) {
        detectedDeps.add('requests');
        console.log(`[Docker Build] Found: requests`);
      }
      if (allPythonContent.includes('import numpy')) {
        detectedDeps.add('numpy');
        console.log(`[Docker Build] Found: numpy`);
      }
      if (allPythonContent.includes('import pandas')) {
        detectedDeps.add('pandas');
        console.log(`[Docker Build] Found: pandas`);
      }
      if (allPythonContent.includes('import cv2') || allPythonContent.includes('from cv2')) {
        detectedDeps.add('opencv-python');
        console.log(`[Docker Build] Found: opencv`);
      }
      if (allPythonContent.includes('import sklearn')) {
        detectedDeps.add('scikit-learn');
        console.log(`[Docker Build] Found: scikit-learn`);
      }

      if (detectedDeps.size > 0) {
        const requirementsContent = Array.from(detectedDeps).join('\n');
        fs.writeFileSync(path.join(buildDir, 'requirements.txt'), requirementsContent);
        hasRequirements = true;
        console.log(`[Docker Build] Auto-generated requirements.txt: ${requirementsContent}`);
      } else {
        console.log(`[Docker Build] No Python dependencies detected`);
      }
    }
    
    // Determine framework and generate Dockerfile
    if (hasPackageJson) {
      // Node.js project
      console.log(`[Docker Build] DETECTED: Node.js (has package.json)`);
      framework = 'node';
      try {
        const pkg = JSON.parse(files['package.json']);
        entryFile = pkg.main || 'index.js';
        detectedPort = pkg.port || 3000;
      } catch(e) {
        entryFile = 'index.js';
        detectedPort = 3000;
      }
      console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
      
      dockerfileContent = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE ${detectedPort}
CMD ["node", "${entryFile}"]`;
      
    } else if (hasRequirements || hasPython) {
      // Python project - check which type
      const reqContent = (files['requirements.txt'] || '').toLowerCase();
      
      if (reqContent.includes('flask') || hasTemplates) {
        // Flask
        console.log(`[Docker Build] DETECTED: Flask`);
        framework = 'flask';
        entryFile = pythonFiles.includes('app.py') ? 'app.py' : mainPyFile;
        detectedPort = 5000;
        console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
        
        let dockerfileBody = '';
        if (hasRequirements) {
          dockerfileBody = `COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
`;
        }
        dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
${dockerfileBody}COPY . .
EXPOSE ${detectedPort}
CMD ["python", "-u", "${entryFile}"]`;
        
      } else if (reqContent.includes('fastapi') || reqContent.includes('uvicorn')) {
        // FastAPI
        console.log(`[Docker Build] DETECTED: FastAPI`);
        framework = 'fastapi';
        entryFile = mainPyFile;
        detectedPort = 8000;
        console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
        
        const fastApiEntry = entryFile.replace('.py', '') + ':app';
        let dockerfileBody = '';
        if (hasRequirements) {
          dockerfileBody = `COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
`;
        }
        dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
${dockerfileBody}COPY . .
EXPOSE ${detectedPort}
CMD ["uvicorn", "${fastApiEntry}", "--host", "0.0.0.0", "--port", "${detectedPort}"]`;
        
      } else if (hasPython) {
        // Generic Python
        console.log(`[Docker Build] DETECTED: Python`);
        framework = 'python';
        entryFile = mainPyFile;
        detectedPort = 8000;
        console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
        
        let dockerfileBody = '';
        if (hasRequirements) {
          dockerfileBody = `COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
`;
        }
        dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
${dockerfileBody}COPY . .
EXPOSE ${detectedPort}
CMD ["python", "-u", "${entryFile}"]`;
      } else {
        // Fallback - has requirements.txt but no Python files
        console.log(`[Docker Build] DETECTED: Python (from requirements.txt)`);
        framework = 'python';
        entryFile = 'main.py';
        detectedPort = 8000;
        
        dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${detectedPort}
CMD ["python", "-u", "${entryFile}"]`;
      }
      
    } else if (hasJs) {
      // Node.js without package.json - create one
      console.log(`[Docker Build] DETECTED: Node.js (plain JS)`);
      framework = 'node';
      entryFile = mainJsFile;
      detectedPort = 3000;
      console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
      
      dockerfileContent = `FROM node:20-alpine
WORKDIR /app
COPY ${entryFile} .
EXPOSE ${detectedPort}
CMD ["node", "${entryFile}"]`;
      
    } else if (pythonFiles.length > 0) {
      // Python without requirements.txt
      console.log(`[Docker Build] DETECTED: Python (no requirements.txt)`);
      framework = 'python';
      entryFile = mainPyFile;
      detectedPort = 8000;
      console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);
      
      dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
COPY . .
EXPOSE ${detectedPort}
CMD ["python", "-u", "${entryFile}"]`;
      
    } else {
      // Generic fallback
      console.log(`[Docker Build] DETECTED: Unknown (generic)`);
      framework = 'generic';
      detectedPort = 3000;
      
      dockerfileContent = `FROM alpine:latest
WORKDIR /app
COPY . .
CMD ["tail", "-f", "/dev/null"]`;
    }
    
    console.log(`[Docker Build] =============================================`);
    console.log(`[Docker Build] FRAMEWORK: ${framework}`);
    console.log(`[Docker Build] ENTRY FILE: ${entryFile}`);
    console.log(`[Docker Build] PORT: ${detectedPort}`);
    console.log(`[Docker Build] =============================================`);
    console.log(`[Docker Build] DOCKERFILE:\n${dockerfileContent}`);
    console.log(`[Docker Build] =============================================`);
    
    fs.writeFileSync(path.join(buildDir, 'Dockerfile'), dockerfileContent);
    
    if (action === 'dockerhub' && dockerHubUsername && dockerHubPassword) {
      console.log(`[Docker] Logging into Docker Hub before build...`);
      const loginResult = await new Promise((resolve) => {
        const loginProc = spawn(dockerCmd, ['login', '--username', dockerHubUsername, '--password-stdin'], { 
          shell: true,
          stdin: 'pipe'
        });

        let loginOutput = '';
        loginProc.stdout.on('data', (d) => loginOutput += d.toString());
        loginProc.stderr.on('data', (d) => loginOutput += d.toString());

        loginProc.stdin.write(dockerHubPassword);
        loginProc.stdin.end();

        loginProc.on('close', (code) => {
          console.log(`[Docker] Login output: ${loginOutput}`);
          resolve(code === 0);
        });
      });

      if (!loginResult) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(500).json({ error: 'Failed to login to Docker Hub. Make sure you\'re using a PAT.' });
      }
      console.log(`[Docker] Logged into Docker Hub successfully`);
    }

    console.log(`[Docker Build] Running docker build...`);
    console.log(`[Docker Build] Image name: ${imageName}`);

    let buildOutput = '';
    try {
      await new Promise((resolve, reject) => {
        const buildProcess = exec(`${dockerCmd} build -t ${imageName} "${buildDir}" --progress=plain`, {
          encoding: 'utf8',
          shell: true,
          maxBuffer: 100 * 1024 * 1024
        });
        
        buildProcess.stdout.on('data', (data) => {
          buildOutput += data;
          console.log(`[Docker Build] ${data.trim()}`);
        });
        
        buildProcess.stderr.on('data', (data) => {
          buildOutput += data;
          console.log(`[Docker Build] ERR: ${data.trim()}`);
        });
        
        buildProcess.on('error', (error) => {
          console.log(`[Docker Build] Process error: ${error.message}`);
          reject(error);
        });
        
        buildProcess.on('close', (code) => {
          if (code !== 0) {
            console.log(`[Docker Build] Build exited with code ${code}`);
            reject(new Error(`Docker build failed with exit code ${code}`));
          } else {
            console.log(`[Docker Build] Build succeeded`);
            console.log(`[Docker Build] Verifying image ${imageName} exists...`);
            // Image ID is retrieved after build completes (see below)
            resolve();
          }
        });
      });
    } catch (err) {
      console.log(`[Docker Build] ❌ ERROR: ${err.message}`);
      console.log(`[Docker Build] Full output:\n${buildOutput}`);
      fs.rmSync(buildDir, { recursive: true, force: true });
      return res.status(500).json({ 
        error: 'Docker build failed: ' + err.message, 
        details: buildOutput || err.message,
        buildLog: buildOutput 
      });
    }

    // Get image ID after build
    // Add delay to ensure different timestamps in Docker Desktop
    await new Promise(r => setTimeout(r, 1500));
    
    let imageId = null;
    try {
      imageId = execSync(`${dockerCmd} images -q ${imageName}`, { encoding: 'utf8' }).trim();
      console.log(`[Docker Build] Image ID: ${imageId}`);
    } catch(e) {
      console.log(`[Docker Build] WARNING: Could not get image ID: ${e.message}`);
    }

    // Auto-import is satisfied by 'docker build' itself (local engine)
    if (action === 'autoimport') {
      fs.rmSync(buildDir, { recursive: true, force: true });
      return res.json({ 
        success: true, 
        message: 'Container image built and imported to Docker Desktop!', 
        imageName: imageName,
        imageId: imageId,
        port: detectedPort,
        accessUrl: `http://localhost:${detectedPort}`
      });
    }

// =============================================================================
// Docker Hub Helper Functions
// =============================================================================

async function checkDockerHubRepository(username, password, repoName) {
  const https = require('https');
  
  return new Promise((resolve) => {
    const authData = JSON.stringify({ identifier: username, secret: password });
    const authReq = https.request({
      hostname: 'hub.docker.com',
      path: '/v2/auth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(authData)
      }
    }, (authRes) => {
      let authBody = '';
      authRes.on('data', chunk => authBody += chunk);
      authRes.on('end', () => {
        try {
          const authJson = JSON.parse(authBody);
          const token = authJson.token || authJson.access_token;
          if (token) {
            const repoReq = https.request({
              hostname: 'hub.docker.com',
              path: `/v2/repositories/${username}/${repoName}/`,
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            }, (repoRes) => {
              let repoBody = '';
              repoRes.on('data', chunk => repoBody += chunk);
              repoRes.on('end', () => {
                if (repoRes.statusCode === 200) {
                  resolve({ exists: true, message: 'Repository exists' });
                } else if (repoRes.statusCode === 404) {
                  resolve({ exists: false, message: 'Repository not found', token });
                } else {
                  resolve({ exists: null, message: `Unexpected response: ${repoRes.statusCode}`, token });
                }
              });
            });
            repoReq.on('error', () => resolve({ exists: null, message: 'Network error checking repository', token }));
            repoReq.end();
          } else {
            resolve({ exists: null, message: authJson.detail || 'Authentication failed' });
          }
        } catch (e) {
          resolve({ exists: null, message: 'Failed to parse auth response' });
        }
      });
    });
    authReq.on('error', () => resolve({ exists: null, message: 'Network error during authentication' }));
    authReq.write(authData);
    authReq.end();
  });
}

async function createDockerHubRepository(username, password, repoName, token) {
  const https = require('https');
  
  return new Promise((resolve) => {
    const createData = JSON.stringify({ name: repoName, namespace: username });
    const createReq = https.request({
      hostname: 'hub.docker.com',
      path: `/v2/repositories/${username}/`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(createData)
      }
    }, (createRes) => {
      let createBody = '';
      createRes.on('data', chunk => createBody += chunk);
      createRes.on('end', () => {
        if (createRes.statusCode === 201 || createRes.statusCode === 200) {
          resolve({ created: true, message: 'Repository created successfully' });
        } else {
          try {
            const errJson = JSON.parse(createBody);
            resolve({ created: false, message: errJson.detail || `Failed to create repository (${createRes.statusCode})` });
          } catch {
            resolve({ created: false, message: `Failed to create repository (${createRes.statusCode})` });
          }
        }
      });
    });
    createReq.on('error', () => resolve({ created: false, message: 'Network error creating repository' }));
    createReq.write(createData);
    createReq.end();
  });
}

// =============================================================================
// Build Container Image Endpoint
// =============================================================================

    if (action === 'dockerhub') {
      if (!dockerHubUsername || !dockerHubPassword) {
        exec(`${dockerCmd} rmi ${imageName}`, () => { });
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(400).json({ error: 'Docker Hub credentials required' });
      }

      const hubImageName = `${dockerHubUsername}/${hubRepoName.toLowerCase()}:latest`;

      // Check/create repository before pushing
      console.log(`[Docker Hub] Checking repository ${dockerHubUsername}/${hubRepoName}...`);
      const repoCheck = await checkDockerHubRepository(dockerHubUsername, dockerHubPassword, hubRepoName);
      
      if (repoCheck.exists === null) {
        console.log(`[Docker Hub] Repo check failed: ${repoCheck.message}, proceeding anyway...`);
      } else if (repoCheck.exists === false) {
        console.log(`[Docker Hub] Repository does not exist, attempting to create...`);
        const repoCreate = await createDockerHubRepository(dockerHubUsername, dockerHubPassword, hubRepoName, repoCheck.token);
        if (!repoCreate.created) {
          console.log(`[Docker Hub] Create failed: ${repoCreate.message}`);
          // Continue anyway - push might still work if it's a valid namespace
        } else {
          console.log(`[Docker Hub] Repository created successfully`);
        }
      } else {
        console.log(`[Docker Hub] Repository exists`);
      }

      exec(`${dockerCmd} tag ${imageName} ${hubImageName}`, (err) => {
        if (err) {
          console.log(`[Docker Tag] Failed: ${err.message}`);
          exec(`${dockerCmd} rmi ${imageName}`, () => { });
          fs.rmSync(buildDir, { recursive: true, force: true });
          return res.status(500).json({ error: 'Failed to tag image for Docker Hub', details: err.message });
        }

        const loginProc = spawn(dockerCmd, ['login', '-u', dockerHubUsername, '-p', dockerHubPassword], { shell: true });

        loginProc.on('close', (loginCode) => {
          if (loginCode !== 0) {
            exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
            fs.rmSync(buildDir, { recursive: true, force: true });
            return res.status(500).json({ error: 'Failed to login to Docker Hub' });
          }

          const pushProc = spawn(dockerCmd, ['push', hubImageName], { shell: true });
          let pushOutput = '';

          pushProc.stdout.on('data', (d) => pushOutput += d.toString());
          pushProc.stderr.on('data', (d) => pushOutput += d.toString());

          pushProc.on('close', (pushCode) => {
            exec(`${dockerCmd} logout`, () => { });
            exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
            fs.rmSync(buildDir, { recursive: true, force: true });

            if (pushCode !== 0) {
              return res.status(500).json({ error: 'Failed to push to Docker Hub', details: pushOutput });
            }

            res.json({ success: true, message: `Image pushed to Docker Hub: ${hubImageName}`, imageName: hubImageName, imageId: imageId });
          });
        });
      });
      return;
    }

    if (action === 'cloud') {
      exec(`${dockerCmd} rmi ${imageName}`, () => { });
      fs.rmSync(buildDir, { recursive: true, force: true });

      const cloudScripts = {
        'aws': `aws ecr get-login-password --region ${cloudConfig?.region || 'us-east-1'} | docker login --username AWS --password-stdin ${cloudConfig?.registry || 'my-registry'}`,
        'gcp': `gcloud auth configure-docker`,
        'azure': `az acr login --name ${cloudConfig?.registry || 'myregistry'}`,
        'kubernetes': `kubectl apply -f deployment.yaml`
      };

      res.json({
        success: true,
        message: `Cloud deployment configured for ${cloudProvider || 'generic'}`,
        imageName: imageName,
        instructions: cloudScripts[cloudProvider] || 'Build complete. Use "docker images" to view and manually deploy.'
      });
      return;
    }

    const saveProcess = spawn(dockerCmd, ["save", "-o", tarFileNameSafe, imageName]);

    let saveError = '';
    saveProcess.stderr.on('data', (data) => {
      saveError += data;
    });

    saveProcess.on('close', async (saveCode) => {
      const tarPath = path.join(process.cwd(), tarFileNameSafe);

      console.log(`[Docker Save] tarPath: ${tarPath}`);
      console.log(`[Docker Save] exists: ${fs.existsSync(tarPath)}`);
      console.log(`[Docker Save] exit code: ${saveCode}`);

      if (saveCode !== 0 || !fs.existsSync(tarPath)) {
        console.log(`[Docker Save] Failed with code ${saveCode}, error: ${saveError}`);
        exec(`${dockerCmd} rmi ${imageName}`, () => { });
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(500).json({ error: 'Failed to save Docker image', details: saveError || `Exit code: ${saveCode}` });
      }

      console.log(`[Docker Save] Success!`);

      if (isAutoImport) {
        exec(`${dockerCmd} load -i "${tarPath}"`, (loadErr, loadStdout, loadStderr) => {
          exec(`${dockerCmd} rmi ${imageName}`, () => { });
          fs.unlinkSync(tarPath);
          fs.rmSync(buildDir, { recursive: true, force: true });

          if (loadErr) {
            return res.status(500).json({ error: 'Failed to import Docker image', details: loadStderr });
          }

          res.json({ success: true, message: 'Container image built and imported to Docker Desktop!', output: loadStdout });
        });
        return;
      }

      const tempDir = path.join(os.tmpdir(), 'codeforge-downloads');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempTarPath = path.join(tempDir, tarFileName);

      fs.copyFileSync(tarPath, tempTarPath);
      exec(`${dockerCmd} rmi ${imageName}`, () => { });
      fs.unlinkSync(tarPath);
      fs.rmSync(buildDir, { recursive: true, force: true });

      // Use the full imageName (includes timestamp + randomSuffix for uniqueness)
      res.json({
        success: true,
        downloadUrl: `/api/download-temp/${tarFileName}`,
        fileName: tarFileName,
        imageName: imageName,  // Full unique name with timestamp + suffix
        imageId: imageId,      // Docker image ID
        port: detectedPort,
        accessUrl: `http://localhost:${detectedPort}`,
        instructions: `To run: docker run -p ${detectedPort}:${detectedPort} ${imageName}`
      });
    });
  } catch (error) {
    if (fs.existsSync(buildDir)) {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deploy/render', async (req, res) => {
  const { renderApiKey, renderServiceName, renderRegion, renderBuildCmd, renderStartCmd, renderEnvVars, files, socketId, dockerHubUsername, dockerHubPassword, dockerHubRepo } = req.body;

  if (!renderApiKey) {
    return res.status(400).json({ error: 'Render API key is required' });
  }

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Project files are required' });
  }

  if (!dockerHubUsername || !dockerHubPassword || !dockerHubRepo) {
    return res.status(400).json({ error: 'Docker Hub credentials and repo name are required' });
  }

  const https = require('https');

  // Helper to make Render API requests
  const renderApiRequest = (method, path, body = null) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.render.com',
        path: path,
        method: method,
        headers: {
          'Authorization': `Bearer ${renderApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve({ status: apiRes.statusCode, data: jsonData });
          } catch (e) {
            resolve({ status: apiRes.statusCode, data: data });
          }
        });
      });

      apiReq.on('error', (err) => reject(err));

      if (body) {
        apiReq.write(JSON.stringify(body));
      }
      apiReq.end();
    });
  };

  try {
    const https = require('https');
    const { exec: execSync2 } = require('child_process');
    const { promisify } = require('util');
    const exec = promisify(execSync2);

    const dockerCmd = process.platform === 'win32' ? 'docker.exe' : 'docker';
    const hubImageName = `${dockerHubUsername}/${dockerHubRepo}:latest`;
    const tmpDir = path.join(os.tmpdir(), `render-deploy-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Helper to make Render API requests
    const renderApiRequest = (method, apiPath, body = null) => {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.render.com',
          path: apiPath,
          method: method,
          headers: {
            'Authorization': `Bearer ${renderApiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        };

        const apiReq = https.request(options, (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => {
            try {
              const jsonData = JSON.parse(data);
              resolve({ status: apiRes.statusCode, data: jsonData });
            } catch (e) {
              resolve({ status: apiRes.statusCode, data: data });
            }
          });
        });

        apiReq.on('error', (err) => reject(err));
        if (body) apiReq.write(JSON.stringify(body));
        apiReq.end();
      });
    };

    // Helper to emit output
    const emitOutput = (output, isError = false) => {
      if (socketId) {
        io.to(socketId).emit('execution_output', { output, isError });
      }
    };

    // Helper to run shell commands (sync with timeout)
    const runCmd = (cmd) => {
      return new Promise((resolve) => {
        const child = spawn(cmd, [], { cwd: tmpDir, shell: true });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => stdout += d.toString());
        child.stderr.on('data', d => stderr += d.toString());
        const timer = setTimeout(() => {
          child.kill();
          resolve({ err: new Error('timeout'), stdout, stderr });
        }, 120000);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ err: code !== 0 ? new Error(`exit ${code}`) : null, stdout, stderr });
        });
      });
    };

    // Helper to spawn async process
    const spawnCmd = (cmd, args, cwd) => {
      return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd: cwd || tmpDir, shell: true });
        let output = '';
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());
        child.on('close', code => resolve({ code, output }));
      });
    };

    emitOutput(`🚀 Deploying to Render.com via Docker Hub...\n`);

    // Step 1: Write project files
    emitOutput('📝 Writing project files...\n');
    const fileNames = Object.keys(files);
    for (const [pFile, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, pFile);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content || '');
    }
    emitOutput(`✅ ${fileNames.length} files written\n`);

    // Step 2: Build Docker image
    emitOutput('🐳 Building Docker image...\n');
    const imageName = `codeforge-${Date.now()}`;
    const dockerfileContent = files['Dockerfile'] || files['Dockerfile.dockerfile'] || null;

    if (!dockerfileContent) {
      // Auto-generate Dockerfile
      emitOutput('📄 No Dockerfile found, generating...\n');
      const hasPy = fileNames.some(f => f.endsWith('.py'));
      const hasNode = fileNames.some(f => f.endsWith('.json') && f.includes('package'));
      const hasJava = fileNames.some(f => f.endsWith('.java'));
      const hasGo = fileNames.some(f => f.endsWith('.go'));
      const hasCpp = fileNames.some(f => f.endsWith('.cpp') || f.endsWith('.cc'));
      const hasC = fileNames.some(f => f.endsWith('.c')) && !hasCpp;
      const hasRuby = fileNames.some(f => f.includes('Gemfile'));

      let dockerfile;
      if (hasPy) {
        const pythonVersion = files['requirements.txt'] ? 'python:3.11-slim' : 'python:3.11-alpine';
        dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nEXPOSE 10000\nCMD ["python", "app.py"]`;
      } else if (hasNode) {
        dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 10000\nCMD ["node", "index.js"]`;
      } else if (hasJava) {
        dockerfile = `FROM eclipse-temurin:17-jdk-alpine\nWORKDIR /app\nCOPY . .\nRUN javac *.java\nEXPOSE 10000\nCMD ["java", "Main"]`;
      } else if (hasGo) {
        dockerfile = `FROM golang:1.21-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 10000\nCMD ["go", "run", "."]`;
      } else if (hasCpp || hasC) {
        dockerfile = `FROM gcc:latest\nWORKDIR /app\nCOPY . .\nRUN gcc -o app ${hasCpp ? '*.cpp' : '*.c'}\nEXPOSE 10000\nCMD ["./app"]`;
      } else if (hasRuby) {
        dockerfile = `FROM ruby:3.2-alpine\nWORKDIR /app\nCOPY . .\nRUN bundle install\nEXPOSE 10000\nCMD ["bundle", "exec", "ruby", "app.rb"]`;
      } else {
        dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 10000\nCMD ["node", "index.js"]`;
      }

      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), dockerfile);
      const langName = hasPy ? 'Python' : (hasNode ? 'Node.js' : (hasJava ? 'Java' : (hasGo ? 'Go' : (hasCpp ? 'C++' : (hasRuby ? 'Ruby' : 'Node.js')))));
      emitOutput(`✅ Generated ${langName} Dockerfile\n`);
    } else {
      emitOutput('📄 Using provided Dockerfile\n');
    }

    // Build the image
    const buildResult = await spawnCmd(dockerCmd, ['build', '-t', imageName, '.']);
    if (buildResult.code !== 0) {
      emitOutput(`❌ Docker build failed:\n${buildResult.output}\n`, true);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Docker build failed' });
    }
    emitOutput('✅ Docker image built\n');

    // Step 3: Tag for Docker Hub
    emitOutput('🏷️ Tagging for Docker Hub...\n');
    const tagResult = await runCmd(`${dockerCmd} tag ${imageName} ${hubImageName}`);
    if (tagResult.err) {
      exec(`${dockerCmd} rmi ${imageName}`, () => { });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to tag image' });
    }
    emitOutput(`✅ Tagged as ${hubImageName}\n`);

    // Step 4: Push to Docker Hub
    emitOutput('⬆️ Pushing to Docker Hub...\n');
    const loginResult = await runCmd(`${dockerCmd} login -u ${dockerHubUsername} -p ${dockerHubPassword}`);
    if (loginResult.err) {
      exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      emitOutput(`❌ Docker Hub login failed: ${loginResult.stderr}\n`, true);
      return res.status(500).json({ error: 'Docker Hub login failed' });
    }
    emitOutput('✅ Logged in to Docker Hub\n');

    const pushResult = await spawnCmd(dockerCmd, ['push', hubImageName]);
    exec(`${dockerCmd} logout`, () => { });
    exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (pushResult.code !== 0) {
      emitOutput(`❌ Docker Hub push failed:\n${pushResult.output}\n`, true);
      return res.status(500).json({ error: 'Docker Hub push failed' });
    }
    emitOutput(`✅ Pushed to Docker Hub: ${hubImageName}\n`);

    // Step 5: Deploy to Render using Docker image
    emitOutput('🚀 Deploying to Render.com...\n');

    // Get owner ID
    const ownerResponse = await renderApiRequest('GET', '/v1/owners');
    if (ownerResponse.status !== 200) {
      emitOutput(`❌ Failed to get Render account: ${ownerResponse.data?.message || ownerResponse.data}\n`, true);
      return res.status(400).json({ error: `Failed to get Render account: ${ownerResponse.data?.message}` });
    }
    const owners = Array.isArray(ownerResponse.data) ? ownerResponse.data : [];
    const ownerId = owners[0]?.id || owners[0]?.owner?.id;
    if (!ownerId) {
      emitOutput(`❌ Could not determine Render account ID\n`, true);
      return res.status(400).json({ error: 'Could not determine Render account ID' });
    }
    emitOutput(`✅ Account: ${owners[0]?.name || owners[0]?.email || ownerId}\n`);

    // Check for existing service
    emitOutput('📋 Checking for existing services...\n');
    const listResponse = await renderApiRequest('GET', '/v1/services?limit=100');
    if (listResponse.status !== 200) {
      emitOutput(`❌ ${listResponse.data?.message || 'Failed to list services'}\n`, true);
      return res.status(400).json({ error: listResponse.data?.message || 'Failed to list Render services' });
    }

    const services = Array.isArray(listResponse.data) ? listResponse.data : [];
    const existingService = services.find(s => {
      const service = s.service || s;
      return service.name === renderServiceName;
    });

    const envVars = (renderEnvVars || []).map(ev => ({ key: ev.key, value: ev.value }));
    const plan = 'free';
    const region = renderRegion || 'oregon';
    const buildCommand = renderBuildCmd || '';
    const startCommand = renderStartCmd || '';

    let serviceId;
    let serviceUrl;

    if (existingService) {
      // Update existing service with Docker image
      const service = existingService.service || existingService;
      serviceId = service.id;
      serviceUrl = service.serviceDetails?.url || `https://${renderServiceName}.onrender.com`;
      emitOutput(`📝 Found existing service: ${renderServiceName}\n`);
      emitOutput('🔄 Updating service...\n');

      const updateBody = {
        image: {
          ownerId: '',
          imagePath: hubImageName,
        },
        serviceDetails: {
          envVars: envVars,
          plan: plan,
          region: region
        }
      };

      const updateResponse = await renderApiRequest('PATCH', `/v1/services/${serviceId}`, updateBody);
      if (updateResponse.status !== 200 && updateResponse.status !== 201) {
        const errorMsg = typeof updateResponse.data === 'object' ? (updateResponse.data?.message || JSON.stringify(updateResponse.data)) : updateResponse.data;
        emitOutput(`❌ ${errorMsg}\n`, true);
        return res.status(400).json({ error: errorMsg });
      }
      emitOutput('✅ Service updated\n');
    } else {
      // Create new Docker-backed service
      emitOutput('🆕 Creating new Docker web service...\n');

      const createBody = {
        type: 'web_service',
        name: renderServiceName,
        ownerId: ownerId,
        image: {
          ownerId: '',
          imagePath: hubImageName,
        },
        serviceDetails: {
          plan: plan,
          region: region,
          envVars: envVars
        }
      };

      const createResponse = await renderApiRequest('POST', '/v1/services', createBody);
      if (createResponse.status !== 200 && createResponse.status !== 201) {
        const errorMsg = typeof createResponse.data === 'object' ? (createResponse.data?.message || JSON.stringify(createResponse.data)) : createResponse.data;
        emitOutput(`❌ ${errorMsg}\n`, true);
        return res.status(400).json({ error: errorMsg });
      }

      const created = createResponse.data;
      serviceId = created?.id || created?.service?.id;
      serviceUrl = created?.serviceDetails?.url || created?.url || `https://${renderServiceName}.onrender.com`;
      emitOutput('✅ Service created\n');
    }

    // Step 6: Trigger deploy
    emitOutput('🚀 Triggering deployment...\n');
    const deployResponse = await renderApiRequest('POST', `/v1/services/${serviceId}/deploys`, {
      clearCache: false
    });

    if (deployResponse.status !== 200 && deployResponse.status !== 201) {
      emitOutput('⚠️ Warning: Failed to trigger deploy\n', true);
    } else {
      const deployId = deployResponse.data?.id;
      emitOutput('📦 Deployment started, waiting for service to go live...\n');

      // Poll for status
      const maxPolls = 200;
      let pollCount = 0;
      const startTime = Date.now();

      while (pollCount < maxPolls) {
        await new Promise(r => setTimeout(r, 3000));
        pollCount++;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

        try {
          const statusResponse = await renderApiRequest('GET', `/v1/services/${serviceId}`);
          if (statusResponse.status === 200 && deployId) {
            const deployStatusResponse = await renderApiRequest('GET', `/v1/services/${serviceId}/deploys/${deployId}`);
            if (deployStatusResponse.status === 200) {
              const deployStatus = deployStatusResponse.data?.status;
              emitOutput(`⏳ Status: ${deployStatus} (${timeStr} elapsed)\n`);

              if (deployStatus === 'live') {
                const url = statusResponse.data?.serviceDetails?.url || serviceUrl;
                emitOutput(`\n🎉 Deployment successful!\n`);
                emitOutput(`🌐 Live at: ${url}\n`);
                return res.json({ success: true, message: `Deployed to Render: ${renderServiceName}`, url, serviceId });
              }

              if (deployStatus === 'build_failed' || deployStatus === 'update_failed' || deployStatus === 'deactivated') {
                emitOutput(`\n❌ Deployment failed: ${deployStatus}\n`, true);
                emitOutput(`📊 Check: https://dashboard.render.com/web/${serviceId}\n`);
                return res.status(400).json({ error: `Deployment failed: ${deployStatus}`, dashboardUrl: `https://dashboard.render.com/web/${serviceId}` });
              }
            }
          }
        } catch (pollErr) {
          emitOutput(`⏳ Waiting... (${timeStr} elapsed)\n`);
        }
      }

      emitOutput(`\n⏱️ Deployment taking longer than expected\n`, true);
      emitOutput(`📊 Check: https://dashboard.render.com/web/${serviceId}\n`);
      return res.json({
        success: true,
        message: 'Deployment initiated - check Render dashboard',
        dashboardUrl: `https://dashboard.render.com/web/${serviceId}`,
        serviceId,
        timeout: true
      });
    }

    const url = serviceUrl || `https://${renderServiceName}.onrender.com`;
    return res.json({ success: true, message: `Deployed to Render: ${renderServiceName}`, url, serviceId });

  } catch (error) {
    emitOutput(`❌ Render deployment error: ${error.message}\n`, true);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/download-temp/:filename', (req, res) => {
  const { filename } = req.params;
  const tempDir = path.join(os.tmpdir(), 'codeforge-downloads');
  const filePath = path.join(tempDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename, (err) => {
    if (!err) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) { }
    }
  });
});

app.post('/api/import-docker', async (req, res) => {
  const { tarData, imageName } = req.body;

  if (!tarData) {
    return res.status(400).json({ error: 'No tar data provided' });
  }

  const dockerCmd = process.platform === 'win32' ? 'docker.exe' : 'docker';
  const tempTar = path.join(os.tmpdir(), `codeforge-import-${Date.now()}.tar`);

  try {
    const buffer = Buffer.from(tarData, 'base64');
    fs.writeFileSync(tempTar, buffer);

    exec(`${dockerCmd} load -i "${tempTar}"`, (err, stdout, stderr) => {
      fs.unlinkSync(tempTar);

      if (err) {
        return res.status(500).json({ error: 'Failed to import Docker image', details: stderr });
      }

      res.json({ success: true, message: 'Docker image imported successfully!', output: stdout });
    });
  } catch (error) {
    if (fs.existsSync(tempTar)) fs.unlinkSync(tempTar);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/export-zip', async (req, res) => {
  const { files, sessionName } = req.body;

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Invalid files data' });
  }

  const archive = archiver('zip', { zlib: { level: 9 } });

  res.attachment(`${sessionName || 'codeforge'}-source.zip`);

  archive.pipe(res);

  for (const [fileName, content] of Object.entries(files)) {
    archive.append(content || '', { name: fileName });
  }

  await archive.finalize();
});

app.post('/api/check-email', async (req, res) => {
  if (!FIREBASE_INITIALIZED) return res.json({ exists: true });

  const { email } = req.body;
  try {
    await admin.auth().getUserByEmail(email);
    res.json({ exists: true });
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      res.json({ exists: false });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// =============================================================================
// Main
// =============================================================================

async function main() {
  try {
    const port = await findFreePort(CONFIG.port);
    CONFIG.port = port;

    const rootDir = path.resolve(__dirname, '..');
    fs.writeFileSync(path.join(rootDir, '.backend_port'), port.toString());

    const frontendEnv = path.join(rootDir, 'frontend', '.env');
    if (fs.existsSync(frontendEnv)) {
      try {
        let content = fs.readFileSync(frontendEnv, 'utf8');
        const newLine = `NEXT_PUBLIC_BACKEND_URL=http://localhost:${port}`;
        if (content.includes('NEXT_PUBLIC_BACKEND_URL=')) {
          content = content.replace(/NEXT_PUBLIC_BACKEND_URL=.*/, newLine);
        } else {
          content += `\n${newLine}\n`;
        }
        fs.writeFileSync(frontendEnv, content);
        console.log(`📝 Updated ${frontendEnv} with port ${port}`);
      } catch (e) {
        console.warn(`⚠️  Could not update frontend/.env: ${e.message}`);
      }
    }

    server.listen(port, CONFIG.host, () => {
      console.log(`🚀 CodeForge Backend (Node.js) starting on port ${port}...`);
    });
  } catch (e) {
    console.error(`❌ Failed to start backend: ${e.message}`);
    process.exit(1);
  }
}

main();
