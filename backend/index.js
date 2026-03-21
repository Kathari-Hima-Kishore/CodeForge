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

// =============================================================================
// Docker Hub Helper Functions (used by multiple endpoints)
// =============================================================================

// Helper function to find a user's socket ID by their user ID (O(1) lookup)
function getUserSocketId(userId) {
  return userIdToSocketId.get(userId) || null;
}

// Helper function to parse Docker Hub login errors
function parseDockerHubLoginError(output, rawOutput = '') {
  const lowerOutput = output.toLowerCase();

  if (lowerOutput.includes('unauthorized') || lowerOutput.includes('invalid username or password') ||
      lowerOutput.includes('incorrect username or password') || lowerOutput.includes('authentication failed')) {
    return 'Docker Hub login failed: Incorrect username or password. Please check your credentials.';
  } else if (lowerOutput.includes('access token')) {
    return 'Docker Hub login failed: Invalid access token. Make sure you\'re using a Personal Access Token (PAT).';
  } else if (lowerOutput.includes('network') || lowerOutput.includes('timeout')) {
    return 'Docker Hub login failed: Network error. Please check your internet connection.';
  } else {
    return `Docker Hub login failed: ${(rawOutput || output).trim() || 'Unknown error'}`;
  }
}

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

console.log('✅ Docker Hub helper functions loaded');

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

function listenOnConfiguredPort(port, host) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, host);
  });
}

function formatServerStartupError(error, port) {
  if (!error || typeof error !== 'object') {
    return `Unknown server startup error on port ${port}`;
  }

  if (error.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Stop the other process or change PORT in backend/.env before restarting.`;
  }

  if (error.code === 'EACCES') {
    return `Port ${port} requires elevated privileges. Use a higher port or update backend/.env.`;
  }

  return error.message || `Unknown server startup error on port ${port}`;
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
const userIdToSocketId = new Map(); // User ID → Socket ID reverse index (for performance)

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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNestedSessionData(value) {
  return isPlainObject(value) && (
    Object.prototype.hasOwnProperty.call(value, 'hostId') ||
    Object.prototype.hasOwnProperty.call(value, 'hostName') ||
    Object.prototype.hasOwnProperty.call(value, 'participants') ||
    Object.prototype.hasOwnProperty.call(value, 'sessionId') ||
    Object.prototype.hasOwnProperty.call(value, 'name')
  );
}

function normalizePersistedSessionData(raw, fallbackSessionId = '') {
  const root = isPlainObject(raw) ? raw : {};
  const nested = hasNestedSessionData(root.files) ? root.files : null;
  const source = nested || root;

  return {
    sessionId: String(root.sessionId || source.sessionId || fallbackSessionId),
    name: String(root.name || source.name || ''),
    hostId: String(root.hostId || source.hostId || ''),
    hostName: String(root.hostName || source.hostName || ''),
    participants: isPlainObject(root.participants)
      ? root.participants
      : (isPlainObject(source.participants) ? source.participants : {}),
    files: Array.isArray(root.files)
      ? root.files
      : (Array.isArray(source.files) ? source.files : []),
    messages: Array.isArray(root.messages)
      ? root.messages
      : (Array.isArray(source.messages) ? source.messages : []),
    isActive: typeof root.isActive === 'boolean'
      ? root.isActive
      : (typeof source.isActive === 'boolean' ? source.isActive : true),
    createdAt: root.createdAt || source.createdAt || Date.now(),
  };
}

function persistedSessionNeedsRepair(raw) {
  const root = isPlainObject(raw) ? raw : {};
  return hasNestedSessionData(root.files);
}

const PYTHON_STANDARD_LIBS = new Set([
  'abc', 'argparse', 'asyncio', 'base64', 'collections', 'csv', 'datetime', 'functools',
  'glob', 'hashlib', 'html', 'http', 'io', 'itertools', 'json', 'logging', 'math',
  'os', 'pathlib', 'queue', 'random', 're', 'shutil', 'sqlite3', 'statistics',
  'string', 'subprocess', 'sys', 'tempfile', 'threading', 'time', 'typing', 'unittest',
  'urllib', 'uuid', 'xml', 'zipfile',
]);

const PYTHON_IMPORT_PACKAGE_MAP = {
  bs4: 'beautifulsoup4',
  cv2: 'opencv-python',
  dotenv: 'python-dotenv',
  flask: 'flask',
  PIL: 'pillow',
  sklearn: 'scikit-learn',
  yaml: 'pyyaml',
};

function detectPythonPackages(files) {
  const dependencies = new Set();
  const pythonFiles = Object.entries(files).filter(([filePath]) => filePath.toLowerCase().endsWith('.py'));

  for (const [, content] of pythonFiles) {
    const importMatches = content.matchAll(/^\s*import\s+([A-Za-z0-9_.,\s]+)/gm);
    for (const match of importMatches) {
      const modules = match[1]
        .split(',')
        .map(part => part.trim().split(/\s+as\s+/i)[0].trim())
        .filter(Boolean);

      for (const moduleName of modules) {
        const baseModule = moduleName.split('.')[0];
        if (!PYTHON_STANDARD_LIBS.has(baseModule)) {
          dependencies.add(PYTHON_IMPORT_PACKAGE_MAP[baseModule] || baseModule);
        }
      }
    }

    const fromMatches = content.matchAll(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm);
    for (const match of fromMatches) {
      const baseModule = match[1].split('.')[0];
      if (!PYTHON_STANDARD_LIBS.has(baseModule)) {
        dependencies.add(PYTHON_IMPORT_PACKAGE_MAP[baseModule] || baseModule);
      }
    }
  }

  return Array.from(dependencies).sort();
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

    const docExists = Boolean(sessionDoc?.exists);
    
    if (docExists) {
      await sessionRef.set({
        sessionId: session.id,
        name: session.name,
        hostId: session.host_uid,
        hostName: session.participants[session.host_uid]?.name || "Host",
        participants: session.participants,
        isActive: session.is_active,
        createdAt: session.created_at_ms || new Date(session.created_at).getTime()
      }, { merge: true });
      console.log(`💾 Session ${session.id} participants synced to Firestore`);
    } else {
      const sessionData = {
        sessionId: session.id,
        name: session.name,
        hostId: session.host_uid,
        hostName: session.participants[session.host_uid]?.name || "Host",
        participants: session.participants,
        isActive: session.is_active,
        createdAt: session.created_at_ms || new Date(session.created_at).getTime()
      };

      // Files/messages are written directly by the frontend and must never be reset here.
      await sessionRef.set(sessionData, { merge: true });
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
  connectedUsers[sid] = {
    uid: user_id,
    name: user_name,
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
            const rawDataFs = doc.data();
            const dataFs = normalizePersistedSessionData(rawDataFs, sessionId);

            if (persistedSessionNeedsRepair(rawDataFs)) {
              await doc.ref.set({
                sessionId: dataFs.sessionId,
                name: dataFs.name,
                hostId: dataFs.hostId,
                hostName: dataFs.hostName,
                participants: dataFs.participants,
                files: dataFs.files,
                messages: dataFs.messages,
                isActive: dataFs.isActive,
                createdAt: dataFs.createdAt,
              }, { merge: true });
              console.log(`🔧 Session ${sessionId} repaired from malformed Firestore shape`);
            }

            if (!dataFs.isActive && userData.uid === dataFs.hostId) {
              dataFs.isActive = true;
              await doc.ref.set({ isActive: true }, { merge: true });
              console.log(`🔄 Host ${userData.uid} reactivated session ${sessionId}`);
            }

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
  // On Windows, try multiple docker executables and PATH locations
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? ['docker.exe', 'docker', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe', 'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']
    : ['docker'];

  let dockerCmd = isWin ? 'docker.exe' : 'docker';
  let foundCmd = null;
  let cmdSearchErr = null;

  // Try to find docker executable via shell (inherits full PATH)
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} version --format '{{.Server.Version}}'`, { stdio: 'pipe', timeout: 8000, shell: true });
      foundCmd = cmd;
      break;
    } catch (e) {
      cmdSearchErr = e.message;
    }
  }

  if (!foundCmd) {
    return res.json({
      installed: false,
      running: false,
      status: 'error',
      error: 'Docker is not accessible',
      hint: 'Make sure Docker Desktop is installed and running. Restart Docker Desktop if needed.',
      details: cmdSearchErr ? cmdSearchErr.substring(0, 200) : 'docker command not found in PATH'
    });
  }

  dockerCmd = foundCmd;

  try {
    // Test if docker daemon is responsive via shell
    execSync(`${dockerCmd} info`, { stdio: 'pipe', timeout: 10000, shell: true });

    // Docker is running - get version info
    let version = '';
    try {
      version = execSync(`${dockerCmd} version --format '{{.Server.Version}}'`, { encoding: 'utf8', timeout: 8000, shell: true }).trim();
    } catch (e) {
      // Ignore version fetch errors
    }

    res.json({
      installed: true,
      running: true,
      version: version,
      status: 'running',
      message: version ? `Docker ${version} is running` : 'Docker is running',
      command: dockerCmd
    });
  } catch (err) {
    const errorMsg = (err.message || '') + (err.stderr || '');
    let message = 'Docker daemon is not running';
    let hint = 'Please start Docker Desktop';

    if (errorMsg.includes('npipe') || errorMsg.includes('pipe') || errorMsg.includes('named pipe')) {
      message = 'Docker daemon is not accessible';
      hint = 'Docker Desktop may still be starting. Try again in a few seconds.';
    } else if (errorMsg.includes('not found') || errorMsg.includes('no such file') || errorMsg.includes('ENOENT')) {
      message = 'Docker is not installed';
      hint = 'Install Docker Desktop from https://docker.com/products/docker-desktop';
    } else if (errorMsg.includes('permission denied') || errorMsg.includes('EPERM')) {
      message = 'Docker permission denied';
      hint = 'Run Docker Desktop as administrator.';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      message = 'Docker is slow to respond';
      hint = 'Docker Desktop may be busy. Try again in a moment.';
    }

    res.json({
      installed: true,
      running: false,
      status: 'error',
      error: message,
      hint: hint,
      details: errorMsg.substring(0, 300),
      command: dockerCmd
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
      /*
    console.log(`ðŸš€ CodeForge Backend (Node.js) starting on port ${CONFIG.port}...`);
        const errData = JSON.parse(authRes.data || '{}');
        errorMsg = errData.detail || errData.message || errorMsg;
      } catch {}
      */
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
  const { files, sessionName, action, dockerHubUsername, dockerHubPassword, dockerHubRepo, cloudProvider, cloudConfig, userId } = req.body;

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Invalid files data' });
  }

  // Setup for real-time updates
  const userSocketId = userId ? getUserSocketId(userId) : null;
  const emitBuildUpdate = (output, isError = false) => {
    if (userSocketId) {
      io.to(userSocketId).emit('execution_output', { output, isError });
    }
  };
  let lastBuildPercent = 0;
  const emitBuildProgress = (percent, message, active = true) => {
    if (!userSocketId) return;
    lastBuildPercent = Math.max(lastBuildPercent, Math.max(0, Math.min(100, percent)));
    io.to(userSocketId).emit('deployment_progress', {
      action,
      percent: lastBuildPercent,
      message,
      active,
    });
  };

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
    emitBuildProgress(3, 'Checking Docker...');
    execSync(`${dockerCmd} info`, { stdio: 'pipe' });
    console.log(`[Docker Build] Docker is accessible`);
  } catch (err) {
    console.log(`[Docker Build] Docker info error: ${err.message}`);
    return res.status(500).json({ error: 'Docker is not accessible. Please ensure Docker Desktop is running.', details: err.message });
  }

  try {
    emitBuildProgress(8, 'Preparing build files...');
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
      if (allPythonContent.includes('from dotenv import') || allPythonContent.includes('import dotenv')) {
        detectedDeps.add('python-dotenv');
        console.log(`[Docker Build] Found: python-dotenv`);
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
        detectedPort = 10000;  // ✅ Changed from 5000 to 10000 (Render standard)
        console.log(`[Docker Build] ENTRY: ${entryFile} | PORT: ${detectedPort}`);

        // Add gunicorn to dependencies if using requirements.txt
        if (!hasRequirements) {
          fs.writeFileSync(path.join(buildDir, 'requirements.txt'), 'Flask\ngunicorn');
          hasRequirements = true;
        } else if (!files['requirements.txt']?.includes('gunicorn')) {
          const reqs = files['requirements.txt'] || '';
          fs.writeFileSync(path.join(buildDir, 'requirements.txt'), reqs + (reqs.endsWith('\n') ? '' : '\n') + 'gunicorn');
        }

        let dockerfileBody = '';
        if (hasRequirements) {
          dockerfileBody = `COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
`;
        }

        // ✅ Extract app module name instead of hardcoding "app"
        const appModule = entryFile.replace('.py', '');

        dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
${dockerfileBody}COPY . .
EXPOSE ${detectedPort}
CMD ["gunicorn", "${appModule}:app", "--bind", "0.0.0.0:${detectedPort}"]`;
        
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
    
    emitBuildProgress(22, 'Generating Docker build plan...');
    if (action === 'dockerhub' && dockerHubUsername && dockerHubPassword) {
      console.log(`[Docker] Logging into Docker Hub before build...`);
      emitBuildUpdate('🔑 Logging into Docker Hub...\n');

      emitBuildProgress(28, 'Authenticating with Docker Hub...');
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
          if (code === 0) {
            resolve({ success: true });
          } else {
            const errorMessage = parseDockerHubLoginError(loginOutput);
            resolve({ success: false, error: errorMessage });
          }
        });
      });

      if (!loginResult.success) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        emitBuildUpdate(`❌ ${loginResult.error}\n`, true);
        return res.status(500).json({ error: loginResult.error });
      }
      console.log(`[Docker] Logged into Docker Hub successfully`);
      emitBuildUpdate('✅ Logged into Docker Hub\n');
    }

    console.log(`[Docker Build] Running docker build...`);
    console.log(`[Docker Build] Image name: ${imageName}`);
    emitBuildUpdate('🔨 Building Docker image...\n');

    emitBuildProgress(38, 'Building Docker image...');
    let buildOutput = '';
    let dockerBuildPulse = 38;
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
          dockerBuildPulse = Math.min(62, dockerBuildPulse + 1);
          emitBuildProgress(dockerBuildPulse, 'Building Docker image...');
        });
        
        buildProcess.stderr.on('data', (data) => {
          buildOutput += data;
          console.log(`[Docker Build] ERR: ${data.trim()}`);
          dockerBuildPulse = Math.min(62, dockerBuildPulse + 1);
          emitBuildProgress(dockerBuildPulse, 'Building Docker image...');
        });
        
        buildProcess.on('error', (error) => {
          console.log(`[Docker Build] Process error: ${error.message}`);
          reject(error);
        });
        
        buildProcess.on('close', (code) => {
          if (code !== 0) {
            console.log(`[Docker Build] Build exited with code ${code}`);
            emitBuildUpdate(`❌ Docker build failed (exit code ${code})\n`, true);
            reject(new Error(`Docker build failed with exit code ${code}`));
          } else {
            console.log(`[Docker Build] Build succeeded`);
            console.log(`[Docker Build] Verifying image ${imageName} exists...`);
            emitBuildUpdate('✅ Docker image built successfully\n');
            emitBuildProgress(action === 'dockerhub' ? 68 : 100, action === 'dockerhub' ? 'Docker image built' : 'Build complete', action === 'dockerhub');
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
    // Removed unnecessary delay - Docker timestamps are already unique
    let imageId = null;
    try {
      imageId = execSync(`${dockerCmd} images -q ${imageName}`, { encoding: 'utf8' }).trim();
      console.log(`[Docker Build] Image ID: ${imageId}`);
    } catch(e) {
      console.log(`[Docker Build] WARNING: Could not get image ID: ${e.message}`);
    }

    // Auto-import is satisfied by 'docker build' itself (local engine)
    if (action === 'autoimport') {
      emitBuildProgress(100, 'Image imported to Docker Desktop', false);
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

    if (action === 'dockerhub') {
      if (!dockerHubUsername || !dockerHubPassword) {
        exec(`${dockerCmd} rmi ${imageName}`, () => { });
        fs.rmSync(buildDir, { recursive: true, force: true });
        return res.status(400).json({ error: 'Docker Hub credentials required' });
      }

      const hubImageName = `${dockerHubUsername}/${hubRepoName.toLowerCase()}:latest`;

      // Check/create repository before pushing
      console.log(`[Docker Hub] Checking repository ${dockerHubUsername}/${hubRepoName}...`);
      emitBuildUpdate(`🔍 Checking Docker Hub repository ${dockerHubUsername}/${hubRepoName}...\n`);
      emitBuildProgress(74, 'Checking Docker Hub repository...');
      const repoCheck = await checkDockerHubRepository(dockerHubUsername, dockerHubPassword, hubRepoName);

      if (repoCheck.exists === null) {
        console.log(`[Docker Hub] Repo check failed: ${repoCheck.message}, proceeding anyway...`);
        emitBuildUpdate(`⚠️ Repository check failed, proceeding anyway...\n`);
      } else if (repoCheck.exists === false) {
        console.log(`[Docker Hub] Repository does not exist, attempting to create...`);
        emitBuildUpdate(`📦 Creating Docker Hub repository...\n`);
        const repoCreate = await createDockerHubRepository(dockerHubUsername, dockerHubPassword, hubRepoName, repoCheck.token);
        if (!repoCreate.created) {
          console.log(`[Docker Hub] Create failed: ${repoCreate.message}`);
          emitBuildUpdate(`⚠️ Repository creation failed, continuing with push...\n`);
          // Continue anyway - push might still work if it's a valid namespace
        } else {
          console.log(`[Docker Hub] Repository created successfully`);
          emitBuildUpdate(`✅ Repository created successfully\n`);
        }
      } else {
        console.log(`[Docker Hub] Repository exists`);
        emitBuildUpdate(`✅ Repository exists\n`);
      }

      emitBuildUpdate(`🏷️ Tagging image for Docker Hub: ${hubImageName}...\n`);
      emitBuildProgress(80, 'Tagging image...');
      exec(`${dockerCmd} tag ${imageName} ${hubImageName}`, (err) => {
        if (err) {
          console.log(`[Docker Tag] Failed: ${err.message}`);
          emitBuildUpdate(`❌ Failed to tag image: ${err.message}\n`, true);
          exec(`${dockerCmd} rmi ${imageName}`, () => { });
          fs.rmSync(buildDir, { recursive: true, force: true });
          return res.status(500).json({ error: 'Failed to tag image for Docker Hub', details: err.message });
        }
        emitBuildUpdate(`✅ Image tagged successfully\n`);
        emitBuildUpdate(`🔑 Logging into Docker Hub for push...\n`);

        emitBuildProgress(84, 'Authenticating for push...');
        const loginProc = spawn(dockerCmd, ['login', '-u', dockerHubUsername, '-p', dockerHubPassword], { shell: true });

        let loginOutput = '';
        loginProc.stdout.on('data', (data) => loginOutput += data.toString());
        loginProc.stderr.on('data', (data) => loginOutput += data.toString());

        loginProc.on('close', (loginCode) => {
          if (loginCode !== 0) {
            exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
            fs.rmSync(buildDir, { recursive: true, force: true });

            const errorMessage = parseDockerHubLoginError(loginOutput);
            return res.status(500).json({ error: errorMessage });
          }

          emitBuildUpdate(`⬆️ Pushing image to Docker Hub: ${hubImageName}...\n`);
          emitBuildProgress(88, 'Pushing image to Docker Hub...');
          const pushProc = spawn(dockerCmd, ['push', hubImageName], { shell: true });
          let pushOutput = '';
          let pushPulse = 88;

          pushProc.stdout.on('data', (d) => {
            pushOutput += d.toString();
            // Send real-time push progress updates
            const output = d.toString();
            if (output.includes('Pushing') || output.includes('Pushed') ||
                output.includes('Layer already exists') || output.includes('digest:')) {
                emitBuildUpdate(output);
                pushPulse = Math.min(98, pushPulse + 1);
                emitBuildProgress(pushPulse, 'Pushing image to Docker Hub...');
            }
          });
          pushProc.stderr.on('data', (d) => pushOutput += d.toString());

          pushProc.on('close', (pushCode) => {
            exec(`${dockerCmd} logout`, () => { });
            exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
            fs.rmSync(buildDir, { recursive: true, force: true });

            if (pushCode !== 0) {
              emitBuildUpdate(`❌ Failed to push to Docker Hub\n`, true);
              return res.status(500).json({ error: 'Failed to push to Docker Hub', details: pushOutput });
            }

            emitBuildUpdate(`✅ Successfully pushed to Docker Hub: ${hubImageName}\n`);
            emitBuildProgress(100, 'Pushed to Docker Hub', false);
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

// =============================================================================
// Validate Render Service Name Endpoint
// =============================================================================

app.post('/api/validate-render-service', async (req, res) => {
  const { serviceName, renderApiKey } = req.body;

  if (!serviceName) {
    return res.status(400).json({ valid: false, reason: 'Service name is required' });
  }

  if (!renderApiKey) {
    return res.status(400).json({ valid: false, reason: 'Render API key is required' });
  }

  // Validate service name format
  const serviceNameRegex = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
  const sanitizedName = (serviceName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (!serviceNameRegex.test(sanitizedName) || sanitizedName.length < 3 || sanitizedName.length > 100) {
    return res.status(400).json({
      valid: false,
      reason: `Invalid service name: "${serviceName}". Must start with a letter, contain only lowercase letters/numbers/hyphens, be 3-100 chars, and not end with a hyphen.`
    });
  }

  // Check if service name is already taken on Render
  try {
    const https = require('https');

    const renderApiRequest = (method, path) => {
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
        apiReq.end();
      });
    };

    const listResponse = await renderApiRequest('GET', '/v1/services?limit=100');

    if (listResponse.status === 200) {
      const services = Array.isArray(listResponse.data) ? listResponse.data : [];
      const existingService = services.find(s => {
        const svc = s.service || s;
        return svc.name === sanitizedName;
      });

      if (existingService) {
        return res.status(409).json({
          valid: false,
          reason: `Service name "${sanitizedName}" already exists on Render. Choose a different name.`
        });
      }
    }

    return res.status(200).json({ valid: true });
  } catch (error) {
    console.error('[Validate Service] Error:', error.message);
    return res.status(500).json({
      valid: false,
      reason: `Failed to validate service name: ${error.message}`
    });
  }
});

app.post('/api/deploy/render', async (req, res) => {
  const { renderApiKey, renderServiceName, renderRegion, renderBuildCmd, renderStartCmd, renderEnvVars, files, socketId, userId, dockerHubUsername, dockerHubPassword, dockerHubRepo } = req.body;

  if (!renderApiKey) {
    return res.status(400).json({ error: 'Render API key is required' });
  }

  if (!files || typeof files !== 'object') {
    return res.status(400).json({ error: 'Project files are required' });
  }

  // Docker Hub credentials are required for Render deployment (image is pushed to Docker Hub)
  if (!dockerHubUsername || !dockerHubPassword) {
    return res.status(400).json({ error: 'Docker Hub username and password are required to deploy to Render. The image will be pushed to Docker Hub first.' });
  }

  // Use provided repo name or auto-generate one
  const rawRepoName = dockerHubRepo || '';
  const sanitizedRepo = rawRepoName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `codeforge-${Date.now()}`;

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

      // Add Content-Length if we have a body
      let bodyString = '';
      if (body) {
        bodyString = JSON.stringify(body);
        options.headers['Content-Length'] = Buffer.byteLength(bodyString);
        console.log('[Render API] Sending body:', bodyString);
      }

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
        apiReq.write(bodyString);
      }
      apiReq.end();
    });
  };

  const liveSocketId = socketId || (userId ? getUserSocketId(userId) : null);
  let lastRenderPercent = 0;
  const emitProgress = (percent, message, active = true) => {
    if (!liveSocketId) return;
    lastRenderPercent = Math.max(lastRenderPercent, Math.max(0, Math.min(100, percent)));
    io.to(liveSocketId).emit('deployment_progress', {
      action: 'render',
      percent: lastRenderPercent,
      message,
      active,
    });
  };

  // Helper: emit output to socket (defined at function scope so catch block can use it)
  const emitOutput = (output, isError = false) => {
    if (liveSocketId) {
      io.to(liveSocketId).emit('execution_output', { output, isError });
    }
  };

  console.log('[Render Deploy] ====== START ======');
  console.log('[Render Deploy] Service:', renderServiceName);
  console.log('[Render Deploy] DockerHub:', dockerHubUsername, '/', sanitizedRepo);
  console.log('[Render Deploy] Files received:', Object.keys(files || {}).length);
  if (liveSocketId) {
    io.to(liveSocketId).emit('execution_output', { output: `📦 Docker Hub repo: ${dockerHubUsername}/${sanitizedRepo}\n` });
  }

  try {
    emitProgress(4, 'Preparing Render deployment...');
    const { exec: execSync2 } = require('child_process');
    const { promisify } = require('util');
    const exec = promisify(execSync2);

    // Find working docker executable via shell (inherits full system PATH)
    console.log('[Render Deploy] Step 1: Detecting Docker...');
    const isWin = process.platform === 'win32';
    const dockerCandidates = isWin
      ? ['docker.exe', 'docker', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe', 'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe']
      : ['docker'];
    let dockerCmd = dockerCandidates[0];
    for (const cmd of dockerCandidates) {
      try {
        execSync(`${cmd} info`, { stdio: 'pipe', timeout: 8000, shell: true });
        dockerCmd = cmd;
        console.log('[Render Deploy] Docker found:', cmd);
        break;
      } catch (e) {
        console.log('[Render Deploy] Docker not accessible with:', cmd, '-', e.message.substring(0, 100));
      }
    }

    // Verify docker is actually accessible
    try {
      execSync(`${dockerCmd} info`, { stdio: 'pipe', timeout: 10000, shell: true });
      console.log('[Render Deploy] Docker daemon verified OK');
    } catch (dockerErr) {
      const dockerErrMsg = dockerErr.message || '';
      console.log('[Render Deploy] FATAL: Docker daemon not accessible:', dockerErrMsg.substring(0, 200));
      return res.status(500).json({
        error: 'Docker is not running or not accessible',
        hint: 'Make sure Docker Desktop is running. Restart it if needed.',
        details: dockerErrMsg.substring(0, 300)
      });
    }

    // Validate and check service name
    const serviceNameRegex = /^[a-z]([a-z]([a-z0-9-]*[a-z0-9])?)?$/;
    const sanitizedName = (renderServiceName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    console.log('[Render Deploy] Step 2: Validating service name - raw:', renderServiceName, '-> sanitized:', sanitizedName);

    if (!renderServiceName || !renderServiceName.trim()) {
      return res.status(400).json({ error: 'Service name is required' });
    }

    if (!serviceNameRegex.test(sanitizedName)) {
      return res.status(400).json({
        error: `Invalid service name: "${renderServiceName}"`,
        details: 'Service name must: start with a letter, contain only lowercase letters/numbers/hyphens, be 3-100 chars, and not end with a hyphen. Suggested: ' + sanitizedName
      });
    }

    if (sanitizedName.length < 3) {
      return res.status(400).json({ error: 'Service name must be at least 3 characters' });
    }

    // Check if service name is already taken by listing existing services
    emitOutput(`🔎 Checking if "${sanitizedName}" is available...\n`);
    emitProgress(10, 'Checking service name...');
    try {
      const listResponse = await renderApiRequest('GET', '/v1/services?limit=100');
      if (listResponse.status === 200) {
        const services = Array.isArray(listResponse.data) ? listResponse.data : [];
        const existingService = services.find(s => {
          const svc = s.service || s;
          return svc.name === sanitizedName;
        });

        if (existingService) {
          const svc = existingService.service || existingService;
          emitOutput(`⚠️ Service "${sanitizedName}" already exists\n`);
          return res.status(409).json({
            error: `Service name "${sanitizedName}" is already taken`,
            existingService: true,
            dashboardUrl: `https://dashboard.render.com/web/${svc.id}`,
            hint: 'Choose a different service name, or update the existing service instead.'
          });
        }
        emitOutput(`✅ Service name "${sanitizedName}" is available\n`);
      }
    } catch (checkErr) {
      // Non-fatal: continue anyway, Render will reject duplicate on create
      emitOutput(`⚠️ Could not check service name availability\n`);
    }

    const hubImageName = `${dockerHubUsername}/${sanitizedRepo}:latest`;
    const tmpDir = path.join(os.tmpdir(), `render-deploy-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    console.log('[Render Deploy] Step 3: Writing files to temp dir:', tmpDir);
    emitOutput(`📝 Writing project files to ${tmpDir}...\n`);
    emitProgress(16, 'Writing project files...');
    const fileNames = Object.keys(files);
    for (const [pFile, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, pFile);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content || '');
    }
    emitOutput(`✅ ${fileNames.length} files written\n`);
    console.log('[Render Deploy] Files written:', fileNames.join(', '));

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
    emitProgress(24, 'Preparing Docker image...');

    // Step 1: Write project files (done above at Step 3)

    // Create .dockerignore to exclude problematic files
    const dockerignore = `# Git
.git
.gitignore

# IDE
.vscode
.idea
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Dependencies (will be reinstalled in container)
node_modules
__pycache__
*.pyc
.env
*.log

# Docker
Dockerfile*
docker-compose*
.dockerignore

# Misc
README.md
*.tar
*.zip
*~
`;
    fs.writeFileSync(path.join(tmpDir, '.dockerignore'), dockerignore);
    emitOutput(`📄 Added .dockerignore\n`);

    // Debug: list files in build dir
    const tmpFiles = fs.readdirSync(tmpDir);
    emitOutput(`📂 Build dir contents: ${tmpFiles.join(', ')}\n`);
    console.log('[Render Deploy] Build dir contents:', tmpFiles);

    // Step 4: Build Docker image
    console.log('[Render Deploy] Step 4: Building Docker image...');
    emitOutput('🐳 Building Docker image (this may take a minute)...\n');
    emitProgress(32, 'Building Docker image...');
    const imageName = `codeforge-${Date.now()}`;
    console.log('[Render Deploy] Image name:', imageName);
    const dockerfileContent = files['Dockerfile'] || files['Dockerfile.dockerfile'] || null;
    console.log('[Render Deploy] Dockerfile:', dockerfileContent ? 'provided' : 'auto-generate');

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

        // Scan Python file contents to detect framework
        const pyContent = fileNames
          .filter(f => f.endsWith('.py'))
          .map(f => files[f] || '')
          .join('\n');

        // Check for Flask
        const isFlask = pyContent.includes('from flask import') || pyContent.includes('Flask(');
        // Check for FastAPI
        const isFastAPI = pyContent.includes('from fastapi import') || pyContent.includes('FastAPI(');
        // Check for Django
        const isDjango = pyContent.includes('from django import') || pyContent.includes('django.setup()');
        // Check for Streamlit
        const isStreamlit = pyContent.includes('import streamlit') || pyContent.includes('st.set_page_config');
        // Check for HTML templates (Flask template rendering)
        const hasTemplates = fileNames.some(f => f.endsWith('.html') || f.includes('templates/'));

        // Find main entry file
        const mainPy = fileNames.find(f => {
          const name = f.split('/').pop();
          return name === 'app.py' || name === 'main.py';
        }) || fileNames.find(f => f.endsWith('.py')) || 'app.py';

        // Check if user has a start.sh or run.sh
        const hasStartScript = fileNames.some(f => f === 'start.sh' || f === 'run.sh' || f === 'start.bat');

        if (isFlask) {
          // Flask: create a startup wrapper that forces 0.0.0.0 and reads PORT env
          const startupScript = `#!/bin/sh
PORT=${"$"}{PORT:-10000}
HOST="0.0.0.0"

# Patch the app to use 0.0.0.0 if it hardcodes 127.0.0.1 or localhost
# by running it with gunicorn for production-grade deployment
if [ -f requirements.txt ] && grep -qi gunicorn requirements.txt 2>/dev/null; then
  echo "Starting Flask with Gunicorn on $HOST:$PORT..."
  exec gunicorn --bind $HOST:$PORT app:app
else
  echo "Starting Flask on $HOST:$PORT..."
  # Use Flask's built-in server with host=0.0.0.0
  # We inject 'host=os.environ.get("HOST", "0.0.0.0")' into the app.run call
  exec python -c "
import os, sys
sys.path.insert(0, '.')
port = int(os.environ.get('PORT', 10000))
host = '0.0.0.0'

# Import and patch
import app
original_run = getattr(app.app, 'run', None)
if original_run:
    def patched_run(**kwargs):
        kwargs.setdefault('host', host)
        kwargs.setdefault('port', port)
        return original_run(**kwargs)
    app.app.run = patched_run
else:
    # fallback: run via flask CLI
    os.environ['FLASK_RUN_HOST'] = host
    os.environ['FLASK_RUN_PORT'] = str(port)

if hasattr(app, 'app'):
    app.app.run(host=host, port=port, debug=False)
else:
    import os; os.environ['HOST']=host; os.environ['PORT']=str(port)
    exec(open('${mainPy}').read())
"
fi
`;
          fs.writeFileSync(path.join(tmpDir, 'start.sh'), startupScript);
          if (process.platform !== 'win32') {
            fs.chmodSync(path.join(tmpDir, 'start.sh'), 0o755);
          }

          // Regenerate requirements.txt with proper packages
          const detectedPythonPackages = detectPythonPackages(files);
          let reqLines = ['Flask>=2.3.0', 'gunicorn>=20.0.0'];
          detectedPythonPackages.forEach((pkg) => {
            if (pkg.toLowerCase() !== 'flask' && pkg.toLowerCase() !== 'gunicorn' && !reqLines.some(line => line.toLowerCase().startsWith(pkg.toLowerCase()))) {
              reqLines.push(pkg);
            }
          });
          const reqContent = reqLines.join('\n') + '\n';
          fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), reqContent);

          // Extract app module from entry file (e.g., app.py -> app)
          const appModule = mainPy.replace('.py', '');

          // ✅ Always use gunicorn with dynamic app module name
          dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD ["gunicorn", "--bind", "0.0.0.0:10000", "${appModule}:app"]`;
        } else if (isFastAPI) {
          // FastAPI: use uvicorn with 0.0.0.0
          const fastApiModule = mainPy.replace('.py', '') + ':app';
          const detectedPythonPackages = detectPythonPackages(files);
          let reqLines = ['fastapi>=0.100.0', 'uvicorn[standard]>=0.23.0'];
          detectedPythonPackages.forEach((pkg) => {
            if (pkg.toLowerCase() !== 'fastapi' && pkg.toLowerCase() !== 'uvicorn' && !reqLines.some(line => line.toLowerCase().startsWith(pkg.toLowerCase()))) {
              reqLines.push(pkg);
            }
          });
          const fastApiReqs = reqLines.join('\n') + '\n';
          fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), fastApiReqs);
          dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD ["uvicorn", "${fastApiModule}", "--host", "0.0.0.0", "--port", "10000"]`;
        } else if (isDjango) {
          const detectedPythonPackages = detectPythonPackages(files);
          let reqLines = ['Django>=4.2.0', 'gunicorn>=21.0.0'];
          detectedPythonPackages.forEach((pkg) => {
            if (pkg.toLowerCase() !== 'django' && pkg.toLowerCase() !== 'gunicorn' && !reqLines.some(line => line.toLowerCase().startsWith(pkg.toLowerCase()))) {
              reqLines.push(pkg);
            }
          });
          const djangoReqs = reqLines.join('\n') + '\n';
          fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), djangoReqs);
          dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nENV PYTHONUNBUFFERED=1\nEXPOSE 10000\nCMD ["gunicorn", "--bind", "0.0.0.0:10000", "codeforge.wsgi:application"]`;
        } else if (isStreamlit) {
          const detectedPythonPackages = detectPythonPackages(files);
          let reqLines = ['streamlit>=1.28.0'];
          detectedPythonPackages.forEach((pkg) => {
            if (pkg.toLowerCase() !== 'streamlit' && !reqLines.some(line => line.toLowerCase().startsWith(pkg.toLowerCase()))) {
              reqLines.push(pkg);
            }
          });
          const streamlitReqs = reqLines.join('\n') + '\n';
          fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), streamlitReqs);
          dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD ["streamlit", "run", "${mainPy}", "--server.port=10000", "--server.address=0.0.0.0"]`;
        } else {
          // Generic Python: try to detect if it reads PORT env or use start script
          // Always regenerate requirements.txt with detected packages
          let hasRequirements = !!files['requirements.txt'];
          if (hasRequirements) {
            const detectedPythonPackages = detectPythonPackages(files);
            const reqLines = detectedPythonPackages.length > 0 ? detectedPythonPackages : [];
            const reqContent = reqLines.join('\n') + (reqLines.length > 0 ? '\n' : '');
            fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), reqContent);
          }

          if (hasStartScript) {
            if (hasRequirements) {
              dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD sh start.sh`;
            } else {
              dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD sh start.sh`;
            }
          } else {
            // Try to run the main file; if it reads PORT env, great
            if (hasRequirements) {
              dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD python ${mainPy}`;
            } else {
              dockerfile = `FROM ${pythonVersion}\nWORKDIR /app\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD python ${mainPy}`;
            }
          }
        }
      } else if (hasNode) {
        // Check if package.json has a start script
        const pkgJson = files['package.json'] ? JSON.parse(files['package.json']) : null;
        const hasStartScript = pkgJson?.scripts?.start;
        const mainFile = fileNames.find(f => {
          const name = f.split('/').pop();
          return name === 'index.js';
        }) || fileNames.find(f => f.endsWith('.js')) || 'index.js';
        if (hasStartScript) {
          dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD ["sh", "-c", "npm start"]`;
        } else {
          dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nENV PORT=10000\nEXPOSE 10000\nCMD ["sh", "-c", "node ${mainFile}"]`;
        }
      } else if (hasJava) {
        dockerfile = `FROM eclipse-temurin:17-jdk-alpine\nWORKDIR /app\nCOPY . .\nRUN javac *.java\nEXPOSE 10000\nCMD ["java", "Main"]`;
      } else if (hasGo) {
        dockerfile = `FROM golang:1.21-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 10000\nCMD ["go", "run", "."]`;
      } else if (hasCpp || hasC) {
        dockerfile = `FROM gcc:latest\nWORKDIR /app\nCOPY . .\nRUN gcc -o app ${hasCpp ? '*.cpp' : '*.c'}\nEXPOSE 10000\nCMD ["./app"]`;
      } else if (hasRuby) {
        dockerfile = `FROM ruby:3.2-alpine\nWORKDIR /app\nCOPY . .\nRUN bundle install\nEXPOSE 10000\nCMD ["bundle", "exec", "ruby", "app.rb"]`;
      } else {
        const mainFile = fileNames.find(f => f.endsWith('.js')) || 'index.js';
        dockerfile = `FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 10000\nCMD ["node", "${mainFile}"]`;
      }

      emitOutput(`📝 Dockerfile:\n${dockerfile.split('\n').map(l => '   ' + l).join('\n')}\n`);
      console.log('[Render Deploy] Generated Dockerfile:\n', dockerfile);
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), dockerfile);
      const langName = hasPy ? 'Python' : (hasNode ? 'Node.js' : (hasJava ? 'Java' : (hasGo ? 'Go' : (hasCpp ? 'C++' : (hasRuby ? 'Ruby' : 'Node.js')))));
      emitOutput(`✅ Generated ${langName} Dockerfile\n`);
    } else {
      emitOutput('📄 Using provided Dockerfile\n');
    }

    // Build the image
    console.log('[Render Deploy] Step 5: Running docker build...');
    emitOutput(`🔨 Running: docker build -t ${imageName} .\n`);
    const buildResult = await spawnCmd(dockerCmd, ['build', '-t', imageName, '.'], tmpDir);
    if (buildResult.code !== 0) {
      const buildOutput = buildResult.output.substring(0, 5000);
      console.log('[Render Deploy] FATAL: Docker build failed. Exit code:', buildResult.code);
      console.log('[Render Deploy] FULL Build output:\n', buildOutput);
      emitOutput(`❌ Docker build failed:\n${buildOutput}\n`, true);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Docker build failed', details: buildOutput });
    }
    console.log('[Render Deploy] Docker image built successfully');
    emitOutput('✅ Docker image built\n');
    emitProgress(48, 'Docker image built');

    // Step 5: Tag for Docker Hub
    console.log('[Render Deploy] Step 6: Tagging image for Docker Hub:', hubImageName);
    emitOutput('🏷️ Tagging for Docker Hub...\n');
    emitProgress(54, 'Tagging image...');
    const tagResult = await runCmd(`${dockerCmd} tag ${imageName} ${hubImageName}`);
    if (tagResult.err) {
      const tagErr = (tagResult.stderr || tagResult.stdout || tagResult.err.message || '').substring(0, 500);
      console.log('[Render Deploy] FATAL: Docker tag failed:', tagErr);
      exec(`${dockerCmd} rmi ${imageName}`, () => { });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.status(500).json({ error: 'Failed to tag image', details: tagErr });
    }
    emitOutput(`✅ Tagged as ${hubImageName}\n`);

    // Step 4: Check/create Docker Hub repository
    console.log('[Render Deploy] Step 7: Checking Docker Hub repository:', sanitizedRepo);
    emitOutput('📦 Checking Docker Hub repository...\n');
    emitProgress(60, 'Checking Docker Hub repository...');
    const repoCheck = await checkDockerHubRepository(dockerHubUsername, dockerHubPassword, sanitizedRepo);
    
    if (repoCheck.exists === null) {
      console.log('[Render Deploy] Docker Hub repo check inconclusive:', repoCheck.message);
      emitOutput(`⚠️ Could not verify repo (${repoCheck.message}), trying anyway...\n`);
    } else if (repoCheck.exists === false) {
      console.log('[Render Deploy] Docker Hub repo does not exist, creating...');
      emitOutput('📦 Repository does not exist, creating...\n');
      const repoCreate = await createDockerHubRepository(dockerHubUsername, dockerHubPassword, sanitizedRepo, repoCheck.token);
      if (!repoCreate.created) {
        console.log('[Render Deploy] Docker Hub repo create failed:', repoCreate.message);
        emitOutput(`⚠️ Repo create failed: ${repoCreate.message}, trying push anyway...\n`);
      } else {
        emitOutput(`✅ Repository created on Docker Hub\n`);
      }
    } else {
      console.log('[Render Deploy] Docker Hub repo exists');
      emitOutput(`✅ Repository exists on Docker Hub\n`);
    }

    // Step 5: Push to Docker Hub
    console.log('[Render Deploy] Step 8: Logging into Docker Hub and pushing...');
    emitOutput('⬆️ Pushing to Docker Hub...\n');
    emitProgress(68, 'Pushing image to Docker Hub...');
    const loginResult = await runCmd(`${dockerCmd} login -u ${dockerHubUsername} -p ${dockerHubPassword}`);
    if (loginResult.err) {
      const loginErr = (loginResult.stderr || loginResult.stdout || '').substring(0, 300);
      console.log('[Render Deploy] FATAL: Docker Hub login failed:', loginErr);
      exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
      fs.rmSync(tmpDir, { recursive: true, force: true });

      const errorMessage = parseDockerHubLoginError(loginErr);
      emitOutput(`❌ ${errorMessage}\n`, true);
      return res.status(500).json({ error: errorMessage });
    }
    emitOutput('✅ Logged in to Docker Hub\n');

    const pushResult = await spawnCmd(dockerCmd, ['push', hubImageName]);
    exec(`${dockerCmd} logout`, () => { });
    exec(`${dockerCmd} rmi ${imageName} ${hubImageName}`, () => { });
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (pushResult.code !== 0) {
      const pushErr = (pushResult.output || '').substring(0, 500);
      console.log('[Render Deploy] FATAL: Docker Hub push failed:', pushErr);
      emitOutput(`❌ Docker Hub push failed:\n${pushErr}\n`, true);
      return res.status(500).json({ error: 'Docker Hub push failed', details: pushErr });
    }
    console.log('[Render Deploy] Pushed to Docker Hub:', hubImageName);
    emitOutput(`✅ Pushed to Docker Hub: ${hubImageName}\n`);
    emitProgress(76, 'Image pushed to Docker Hub');

    // Step 9: Deploy to Render using Docker image
    console.log('[Render Deploy] Step 9: Deploying to Render...');
    emitOutput('🚀 Deploying to Render.com...\n');
    emitProgress(82, 'Connecting to Render...');

    // Get owner ID
    console.log('[Render Deploy] Fetching Render owner ID...');
    const ownerResponse = await renderApiRequest('GET', '/v1/owners');
    console.log('[Render Deploy] Owner response status:', ownerResponse.status);
    if (ownerResponse.status !== 200) {
      const ownerErr = typeof ownerResponse.data === 'string' ? ownerResponse.data.substring(0, 200) : JSON.stringify(ownerResponse.data).substring(0, 200);
      console.log('[Render Deploy] FATAL: Failed to get Render account:', ownerErr);
      emitOutput(`❌ Failed to get Render account: ${ownerResponse.data?.message || ownerErr}\n`, true);
      return res.status(400).json({ error: `Failed to get Render account: ${ownerResponse.data?.message || ownerErr}` });
    }
    const owners = Array.isArray(ownerResponse.data) ? ownerResponse.data : [];
    const ownerId = owners[0]?.id || owners[0]?.owner?.id;
    console.log('[Render Deploy] Owner ID:', ownerId);
    if (!ownerId) {
      console.log('[Render Deploy] FATAL: No owner ID found in response');
      emitOutput(`❌ Could not determine Render account ID\n`, true);
      return res.status(400).json({ error: 'Could not determine Render account ID' });
    }
    emitOutput(`✅ Account: ${owners[0]?.name || owners[0]?.email || ownerId}\n`);

    // Check for existing service
    console.log('[Render Deploy] Step 10: Listing existing services...');
    emitOutput('📋 Checking for existing services...\n');
    emitProgress(86, 'Checking existing services...');
    const listResponse = await renderApiRequest('GET', '/v1/services?limit=100');
    console.log('[Render Deploy] List services status:', listResponse.status);
    if (listResponse.status !== 200) {
      const listErr = typeof listResponse.data === 'string' ? listResponse.data.substring(0, 200) : JSON.stringify(listResponse.data).substring(0, 200);
      console.log('[Render Deploy] FATAL: Failed to list services:', listErr);
      emitOutput(`❌ ${listResponse.data?.message || 'Failed to list services'}\n`, true);
      return res.status(400).json({ error: listResponse.data?.message || 'Failed to list Render services', details: listErr });
    }

    const services = Array.isArray(listResponse.data) ? listResponse.data : [];
    const existingService = services.find(s => {
      const service = s.service || s;
      return service.name === sanitizedName;
    });
    console.log('[Render Deploy] Existing service:', existingService ? 'found (will update)' : 'none (will create)');

    const envVars = (renderEnvVars || []).map(ev => ({ key: ev.key, value: ev.value }));
    const plan = 'free';
    const region = renderRegion || 'oregon';

    // Auto-detect framework and generate start command if not provided
    let buildCommand = renderBuildCmd || '';
    let startCommand = renderStartCmd || '';

    if (!startCommand) {
      const fileKeys = Object.keys(files);
      const lowerFileKeys = fileKeys.map(f => f.toLowerCase());
      const packageJsonPath = fileKeys.find(f => f.toLowerCase() === 'package.json');
      const pomXmlPath = fileKeys.find(f => f.toLowerCase().endsWith('pom.xml'));
      const gradlePath = fileKeys.find(f => f.toLowerCase().endsWith('build.gradle') || f.toLowerCase().endsWith('build.gradle.kts'));
      const pythonFiles = fileKeys.filter(f => f.toLowerCase().endsWith('.py'));
      const javaFiles = fileKeys.filter(f => f.toLowerCase().endsWith('.java'));
      const hasRequirements = lowerFileKeys.includes('requirements.txt');
      const fileContent = Object.values(files).join('\n').toLowerCase();
      const detectedPythonPackages = detectPythonPackages(files);
      const detectedPythonInstallCommand = detectedPythonPackages.length > 0
        ? `pip install ${detectedPythonPackages.join(' ')} gunicorn`
        : '';

      console.log('[Render Deploy] Auto-detecting framework for start command...');

      if (packageJsonPath) {
        let packageJson = null;
        try {
          packageJson = JSON.parse(files[packageJsonPath]);
        } catch (error) {
          console.warn('[Render Deploy] Failed to parse package.json during auto-detect');
        }

        const scripts = packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts
          ? packageJson.scripts
          : {};
        const hasBuildScript = typeof scripts.build === 'string' && scripts.build.trim().length > 0;
        const hasStartScript = typeof scripts.start === 'string' && scripts.start.trim().length > 0;
        const serverEntry = fileKeys.find(f => {
          const lower = f.toLowerCase();
          return lower === 'server.js' || lower === 'index.js' || lower.endsWith('/server.js');
        });

        console.log('[Render Deploy] Detected: Node.js');
        startCommand = hasStartScript ? 'npm start' : (serverEntry ? `node ${serverEntry}` : 'node index.js');
        if (!buildCommand) buildCommand = hasBuildScript ? 'npm install && npm run build' : 'npm install';
      } else if (pomXmlPath) {
        console.log('[Render Deploy] Detected: Java (Maven)');
        startCommand = 'java -jar target/*.jar';
        if (!buildCommand) buildCommand = lowerFileKeys.includes('mvnw') ? './mvnw package -DskipTests' : 'mvn package -DskipTests';
      } else if (gradlePath) {
        console.log('[Render Deploy] Detected: Java (Gradle)');
        startCommand = 'java -jar build/libs/*.jar';
        if (!buildCommand) buildCommand = lowerFileKeys.includes('gradlew') ? './gradlew build -x test' : 'gradle build -x test';
      } else if (javaFiles.length > 0) {
        console.log('[Render Deploy] Detected: Java');
        const mainJava = fileKeys.find(f => {
          const lower = f.toLowerCase();
          return lower.endsWith('/main.java') || lower === 'main.java' || lower.endsWith('/app.java') || lower === 'app.java';
        }) || javaFiles[0];
        const mainClass = path.basename(mainJava, '.java');
        startCommand = `java ${mainClass}`;
        if (!buildCommand) buildCommand = `javac ${mainJava}`;
      } else if (fileContent.includes('flask') || fileContent.includes('from flask import')) {
        console.log('[Render Deploy] Detected: Flask');
        const appPy = fileKeys.find(f => /(^|\/)(app|main)\.py$/i.test(f)) || pythonFiles[0] || 'app.py';
        const moduleEntry = appPy.replace(/\.py$/i, '').replace(/\//g, '.');
        startCommand = `gunicorn ${moduleEntry}:app`;
        if (!buildCommand) buildCommand = hasRequirements ? 'pip install -r requirements.txt' : (detectedPythonInstallCommand || 'pip install flask gunicorn');
      } else if (fileContent.includes('fastapi') || fileContent.includes('uvicorn')) {
        console.log('[Render Deploy] Detected: FastAPI');
        const mainPy = fileKeys.find(f => /(^|\/)(main|app)\.py$/i.test(f)) || pythonFiles[0] || 'main.py';
        const moduleEntry = mainPy.replace(/\.py$/i, '').replace(/\//g, '.') + ':app';
        startCommand = `uvicorn ${moduleEntry} --host 0.0.0.0 --port 10000`;
        if (!buildCommand) buildCommand = hasRequirements ? 'pip install -r requirements.txt' : (detectedPythonInstallCommand || 'pip install fastapi uvicorn');
      } else if (pythonFiles.length > 0) {
        console.log('[Render Deploy] Detected: Python');
        const mainPy = fileKeys.find(f => /(^|\/)(main|app)\.py$/i.test(f)) || pythonFiles[0] || 'app.py';
        startCommand = `python ${mainPy}`;
        if (!buildCommand) buildCommand = hasRequirements ? 'pip install -r requirements.txt' : detectedPythonInstallCommand;
      }

      console.log('[Render Deploy] Auto-detected start command:', startCommand);
      if (buildCommand) console.log('[Render Deploy] Auto-detected build command:', buildCommand);
      emitOutput(`⚙️ Start command: ${startCommand}\n`);
      if (buildCommand) emitOutput(`⚙️ Build command: ${buildCommand}\n`);
    }

    let serviceId;
    let serviceUrl;

    if (existingService) {
      // Update existing service with Docker image
      const service = existingService.service || existingService;
      serviceId = service.id;
      serviceUrl = service.serviceDetails?.url || `https://${sanitizedName}.onrender.com`;
      console.log('[Render Deploy] Updating existing service:', serviceId, 'with image:', hubImageName);
      emitOutput(`📝 Found existing service: ${sanitizedName}\n`);
      emitOutput('🔄 Updating service...\n');
      emitProgress(90, 'Updating Render service...');

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
      emitProgress(93, 'Render service updated');
    } else {
      // Create new Docker-backed service
      console.log('[Render Deploy] Step 11: Creating new service:', sanitizedName, 'image:', hubImageName);
      emitOutput('🆕 Creating new Docker web service...\n');
      emitProgress(90, 'Creating Render service...');

      const createBody = {
        type: 'web_service',
        name: sanitizedName,
        ownerId: ownerId,
        image: {
          imagePath: hubImageName
        },
        serviceDetails: {
          plan: plan,
          region: region,
          runtime: 'image',
          envVars: envVars
        }
      };
      console.log('[Render Deploy] Create body:', JSON.stringify(createBody, null, 2));

      const createResponse = await renderApiRequest('POST', '/v1/services', createBody);
      console.log('[Render Deploy] Create response status:', createResponse.status);
      console.log('[Render Deploy] Create response data:', JSON.stringify(createResponse.data, null, 2));
      if (createResponse.status !== 200 && createResponse.status !== 201) {
        const errorMsg = typeof createResponse.data === 'object' ? (createResponse.data?.message || JSON.stringify(createResponse.data)) : createResponse.data;
        console.log('[Render Deploy] FATAL: Service creation failed:', errorMsg);
        emitOutput(`❌ ${errorMsg}\n`, true);
        return res.status(400).json({ error: errorMsg });
      }

      const created = createResponse.data;
      serviceId = created?.id || created?.service?.id;
      serviceUrl = created?.serviceDetails?.url || created?.url || `https://${sanitizedName}.onrender.com`;
      console.log('[Render Deploy] Service created:', serviceId, 'URL:', serviceUrl);
      emitOutput('✅ Service created\n');
      emitProgress(93, 'Render service created');
    }

    // Step 12: Hand off to Render and stop progress tracking here
    const dashboardUrl = `https://dashboard.render.com/web/${serviceId}`;
    const handoffUrl = serviceUrl || `https://${sanitizedName}.onrender.com`;
    emitOutput('🚀 Docker service is auto-deploying...\n');
    emitOutput('Render deployment submitted\n');
    emitOutput(`Track deployment in Render: ${dashboardUrl}\n`);
    emitProgress(100, 'Handed off to Render', false);
    return res.json({
      success: true,
      message: 'Deployment handed off to Render',
      url: handoffUrl,
      serviceId,
      dashboardUrl,
      handedOff: true
    });

    // Skip manual deploy trigger for Docker images - they deploy automatically
    // Docker image services auto-deploy when created, manual trigger causes 400 error
    const deployResponse = { status: 200, data: { id: 'auto-deploy' } }; // Mock successful response

    if (deployResponse.status !== 200 && deployResponse.status !== 201) {
      emitOutput('⚠️ Warning: Failed to trigger deploy\n', true);
    } else {
      const deployId = deployResponse.data?.id;
    emitOutput('📦 Deployment started, waiting for service to go live...\n');
    emitProgress(95, 'Waiting for Render deployment...');

      // Poll for status - optimized for faster deployment feedback
      const maxPolls = 60; // Reduced from 200 (60 * 2s = 2 minutes max)
      let pollCount = 0;
      const startTime = Date.now();

      while (pollCount < maxPolls) {
        await new Promise(r => setTimeout(r, 2000)); // Reduced from 3000ms
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
              const statusProgressMap = {
                created: 96,
                build_in_progress: 97,
                update_in_progress: 97,
                deploying: 98,
                live: 100,
              };
              emitProgress(statusProgressMap[String(deployStatus).toLowerCase()] || 96, `Render status: ${deployStatus}`, deployStatus !== 'live');
              emitOutput(`⏳ Status: ${deployStatus} (${timeStr} elapsed)\n`);

              if (deployStatus === 'live') {
                const url = statusResponse.data?.serviceDetails?.url || serviceUrl;
                emitOutput(`\n🎉 Deployment successful!\n`);
                emitOutput(`🌐 Live at: ${url}\n`);
                emitProgress(100, 'Deployment live', false);
                return res.json({ success: true, message: `Deployed to Render: ${sanitizedName}`, url, serviceId });
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

    const url = serviceUrl || `https://${sanitizedName}.onrender.com`;
    return res.json({ success: true, message: `Deployed to Render: ${sanitizedName}`, url, serviceId });

  } catch (error) {
    console.error('[Render Deploy] ====== FATAL ERROR ======');
    console.error('[Render Deploy] Error:', error.message);
    console.error('[Render Deploy] Stack:', error.stack);
    try { emitOutput(`❌ Render deployment error: ${error.message}\n`, true); } catch (e) { /* socket may have disconnected */ }
    return res.status(500).json({ error: error.message, stack: error.stack?.split('\n').slice(0, 3).join('\n') });
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

/*
async function main() {
  try {
    await listenOnConfiguredPort(CONFIG.port, CONFIG.host);
    console.log(`CodeForge Backend (Node.js) listening on port ${CONFIG.port}`);
        console.log(`📝 Updated ${frontendEnv} with port ${port}`);
      } catch (e) {
        console.warn(`⚠️  Could not update frontend/.env: ${e.message}`);
      }
    }

      console.log(`🚀 CodeForge Backend (Node.js) starting on port ${port}...`);
    });
  } catch (e) {
    console.error(`❌ Failed to start backend: ${e.message}`);
    process.exit(1);
  }
}

main();
*/

async function main() {
  try {
    await listenOnConfiguredPort(CONFIG.port, CONFIG.host);
    console.log(`CodeForge Backend (Node.js) listening on port ${CONFIG.port}`);
  } catch (e) {
    console.error(`Failed to start backend: ${formatServerStartupError(e, CONFIG.port)}`);
    process.exit(1);
  }
}

main();
