'use client';

/**
 * Session Context - Real-time Collaborative IDE State Management
 *
 * PERSISTENCE MODEL:
 * - ALL session data (files, messages, participants) is stored ONLY in Firestore
 * - NO local storage, session storage, or IndexedDB usage
 * - Real-time sync via Firestore onSnapshot listeners
 * - Socket.IO is used ONLY for: code execution streams, terminal I/O, and session join/leave events
 * - React state (files, messages, etc.) is an in-memory cache synced from Firestore
 *
 * SOURCE OF TRUTH: Firestore `/sessions/{sessionId}` documents
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { BACKEND_URL, getDynamicBackendUrl, auth, db } from '@/lib/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  query,
  where
} from 'firebase/firestore';
import { useAuth } from './auth-context';
import { User } from 'firebase/auth';

// Types
export type Role = 'host' | 'co-host' | 'editor' | 'viewer';

export interface Participant {
  uid: string;
  name: string;
  email: string;
  role: Role;
  color: string;
  isOnline: boolean;
  photoURL?: string;
  joinedAt: number;
}

export interface FileItem {
  id: string;
  name: string;
  content: string;
  language: string;
  isFolder?: boolean;
  parentId?: string | null;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  content: string;
  timestamp: number;
}

export interface OutputItem {
  type: 'output' | 'error' | 'info' | 'success';
  content: string;
  timestamp: number;
}

export interface DeployProgress {
  action: 'download' | 'dockerhub' | 'render';
  percent: number;
  message: string;
  active: boolean;
}

export interface SessionData {
  sessionId: string;
  name: string;
  hostId: string;
  hostName: string;
  createdAt: Timestamp | null;
  participants: Record<string, Participant>;
  files: FileItem[];
  messages: ChatMessage[];
  isActive: boolean;
}

export interface Session {
  sessionId: string;
  name: string;
  role: Role;
  hostId: string;
  hostName: string;
  participants: Record<string, Participant>;
}

// Summary for session list
export interface SessionSummary {
  sessionId: string;
  name: string;
  hostName: string;
  participantCount: number;
  createdAt: number;
  isHost: boolean;
}

interface SessionContextType {
  // User
  user: User | null;

  // Session state
  session: Session | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;

  // User's existing sessions
  mySessions: SessionSummary[];
  isLoadingSessions: boolean;
  refreshMySessions: () => Promise<void>;

  // File management
  files: FileItem[];
  currentFileId: string | null;
  setCurrentFileId: (id: string) => void;
  createFile: (name: string, language: string, parentId?: string | null) => Promise<void>;
  updateFileContent: (id: string, content: string) => void;
  renameFile: (id: string, newName: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;

  // Folder management
  createFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameFolder: (id: string, newName: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;

  // Chat
  messages: ChatMessage[];
  sendMessage: (content: string) => void;

  // Output
  output: OutputItem[];
  clearOutput: () => void;
  addOutput: (type: OutputItem['type'], content: string) => void;
  deployProgress: DeployProgress | null;

  // Code execution
  isExecuting: boolean;
  executeCode: (language: string, code: string) => void;
  sendExecutionInput: (input: string) => void;
  killExecution: () => void;

  // Session actions
  createSession: (name: string) => Promise<void>;
  joinSession: (sessionId: string) => Promise<void>;
  rejoinSession: (sessionId: string) => Promise<void>;
  leaveSession: () => Promise<void>;
  deleteSession: () => Promise<void>;

  // User management (host only)
  changeUserRole: (userId: string, role: Role) => Promise<void>;
  kickUser: (userId: string) => Promise<void>;

  // Terminal
  sendTerminalCommand: (command: string) => void;
  killTerminal: () => void;
  isTerminalRunning: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

// Helper to generate random ID
function generateId(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper to generate random color
function generateColor(): string {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNestedSessionData(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (
    'hostId' in value ||
    'hostName' in value ||
    'participants' in value ||
    'sessionId' in value ||
    'name' in value
  );
}

function isRole(value: unknown): value is Role {
  return value === 'host' || value === 'co-host' || value === 'editor' || value === 'viewer';
}

function normalizeParticipant(rawValue: unknown, fallbackUid: string): Participant {
  const raw = isRecord(rawValue) ? rawValue : {};
  const normalizedUid = typeof raw.uid === 'string' && raw.uid.trim() ? raw.uid : fallbackUid;
  const normalizedName = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : 'User';

  const joinedAtSource = raw.joinedAt ?? raw.joined_at;
  let joinedAt = Date.now();
  if (typeof joinedAtSource === 'number' && Number.isFinite(joinedAtSource)) {
    joinedAt = joinedAtSource;
  } else if (typeof joinedAtSource === 'string') {
    const parsed = Date.parse(joinedAtSource);
    if (!Number.isNaN(parsed)) {
      joinedAt = parsed;
    }
  }

  const photoURL = typeof raw.photoURL === 'string' && raw.photoURL.trim()
    ? raw.photoURL
    : undefined;

  return {
    uid: normalizedUid,
    name: normalizedName,
    email: typeof raw.email === 'string' ? raw.email : '',
    role: isRole(raw.role) ? raw.role : 'viewer',
    color: typeof raw.color === 'string' && raw.color.trim() ? raw.color : generateColor(),
    isOnline: typeof raw.isOnline === 'boolean' ? raw.isOnline : true,
    ...(photoURL ? { photoURL } : {}),
    joinedAt,
  };
}

function participantsNeedRepair(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).some((participant) => {
    const raw = isRecord(participant) ? participant : {};
    return (
      typeof raw.uid !== 'string' ||
      !raw.uid.trim() ||
      typeof raw.name !== 'string' ||
      !raw.name.trim() ||
      !isRole(raw.role) ||
      typeof raw.color !== 'string' ||
      !raw.color.trim() ||
      typeof raw.isOnline !== 'boolean'
    );
  });
}

function normalizeSessionData(raw: unknown, fallbackSessionId = ''): SessionData {
  const root = isRecord(raw) ? raw : {};
  const nested = hasNestedSessionData(root.files) ? root.files : null;
  const source = nested ?? root;

  const participantSource = isRecord(root.participants)
    ? root.participants
    : isRecord(source.participants)
      ? source.participants
      : {};

  const participants = Object.fromEntries(
    Object.entries(participantSource).map(([uid, value]) => [uid, normalizeParticipant(value, uid)])
  ) as Record<string, Participant>;

  const files = Array.isArray(root.files)
    ? root.files as FileItem[]
    : Array.isArray(source.files)
      ? source.files as FileItem[]
      : [];

  const messages = Array.isArray(root.messages)
    ? root.messages as ChatMessage[]
    : Array.isArray(source.messages)
      ? source.messages as ChatMessage[]
      : [];

  return {
    sessionId: String(root.sessionId ?? source.sessionId ?? fallbackSessionId),
    name: String(root.name ?? source.name ?? ''),
    hostId: String(root.hostId ?? source.hostId ?? ''),
    hostName: String(root.hostName ?? source.hostName ?? ''),
    createdAt: (root.createdAt ?? source.createdAt ?? null) as Timestamp | null,
    participants,
    files,
    messages,
    isActive: typeof root.isActive === 'boolean'
      ? root.isActive
      : typeof source.isActive === 'boolean'
        ? source.isActive
        : true,
  };
}

function sessionDocumentNeedsRepair(raw: unknown): boolean {
  const root = isRecord(raw) ? raw : {};
  const nested = hasNestedSessionData(root.files) ? root.files : null;
  const source = nested ?? root;
  return hasNestedSessionData(root.files) || participantsNeedRepair(root.participants) || participantsNeedRepair(source.participants);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [mySessions, setMySessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [output, setOutput] = useState<OutputItem[]>([]);
  const [deployProgress, setDeployProgress] = useState<DeployProgress | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isTerminalRunning, setIsTerminalRunning] = useState(false);
  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingFilesRef = React.useRef<FileItem[] | null>(null);

  // Refs to access current session/user inside socket event handlers without stale closures
  const sessionRef = React.useRef<Session | null>(null);
  const userRef = React.useRef<typeof user>(null);
  const joinedSocketSessionKeyRef = React.useRef<string | null>(null);
  const pendingSocketSessionKeyRef = React.useRef<string | null>(null);
  const previousUserIdRef = React.useRef<string | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { userRef.current = user; }, [user]);

  // Output - defined EARLY to avoid dependency issues in effects
  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  const addOutput = useCallback((type: OutputItem['type'], content: string) => {
    setOutput(prev => [...prev, { type, content, timestamp: Date.now() }]);
  }, []);

  useEffect(() => {
    const currentUserId = user?.uid ?? null;
    const previousUserId = previousUserIdRef.current;

    if (previousUserId !== null && previousUserId !== currentUserId) {
      setSession(null);
      setMessages([]);
      setOutput([]);
      setDeployProgress(null);
      setDeployProgress(null);
      setConnectionError(null);
      setFiles([]);
      setCurrentFileId(null);
      setIsConnecting(false);
      joinedSocketSessionKeyRef.current = null;
      pendingSocketSessionKeyRef.current = null;
    }

    previousUserIdRef.current = currentUserId;
  }, [user?.uid]);

  const applyPersistedFiles = useCallback((nextFiles: FileItem[] | undefined) => {
    const normalizedFiles = Array.isArray(nextFiles) ? nextFiles : [];
    setFiles(normalizedFiles);
    setCurrentFileId(prev => {
      if (prev && normalizedFiles.some(file => !file.isFolder && file.id === prev)) {
        return prev;
      }

      const firstFile = normalizedFiles.find(file => !file.isFolder);
      return firstFile?.id ?? null;
    });
  }, []);

  const applyPersistedMessages = useCallback((nextMessages: ChatMessage[] | undefined) => {
    setMessages(Array.isArray(nextMessages) ? nextMessages : []);
  }, []);

  const repairSessionDocument = useCallback(async (sessionId: string, rawData: unknown) => {
    if (!sessionDocumentNeedsRepair(rawData)) {
      return;
    }

    const normalized = normalizeSessionData(rawData, sessionId);

    try {
      await setDoc(doc(db, 'sessions', sessionId), {
        sessionId: normalized.sessionId,
        name: normalized.name,
        hostId: normalized.hostId,
        hostName: normalized.hostName,
        createdAt: normalized.createdAt,
        participants: normalized.participants,
        files: normalized.files,
        messages: normalized.messages,
        isActive: normalized.isActive,
      }, { merge: true });
      console.log('Repaired malformed Firestore session document:', sessionId);
    } catch (error) {
      console.error('Failed to repair malformed Firestore session document:', error);
    }
  }, []);

  /*
  const flushPendingFileUpdates = useCallback(async () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (pendingFilesRef.current && sessionRef.current?.sessionId) {
      `âœ… File created and persisted to Firestore: ${name}`,
        const sessionDocRef = doc(db, 'sessions', sessionRef.current.sessionId);
        await setDoc(sessionDocRef, { files: pendingFilesRef.current }, { merge: true });
        console.log('âœ… Pending file changes flushed to Firestore');
        pendingFilesRef.current = null;
        console.error('âŒ Failed to flush file changes:', error);
      }
    }
  }, []);
  */

  const flushPendingFileUpdates = useCallback(async () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (pendingFilesRef.current && sessionRef.current?.sessionId) {
      try {
        const sessionDocRef = doc(db, 'sessions', sessionRef.current.sessionId);
        await setDoc(sessionDocRef, { files: pendingFilesRef.current }, { merge: true });
        console.log('Pending file changes flushed to Firestore');
        pendingFilesRef.current = null;
      } catch (error) {
        console.error('Failed to flush file changes:', error);
      }
    }
  }, []);

  const persistFilesImmediately = useCallback(async (
    updated: FileItem[],
    successMessage: string,
    warningMessage: string
  ) => {
    pendingFilesRef.current = updated;

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (!sessionRef.current?.sessionId) {
      return;
    }

    try {
      const sessionDocRef = doc(db, 'sessions', sessionRef.current.sessionId);
      await setDoc(sessionDocRef, { files: updated }, { merge: true });
      console.log(successMessage);
      pendingFilesRef.current = null;
    } catch (error) {
      console.error(warningMessage, error);
      addOutput('error', warningMessage);
    }
  }, [addOutput]);

  const persistSessionSnapshot = useCallback(async (activeSession: Session) => {
    try {
      await setDoc(doc(db, 'sessions', activeSession.sessionId), {
        sessionId: activeSession.sessionId,
        name: activeSession.name,
        hostId: activeSession.hostId,
        hostName: activeSession.hostName,
        participants: activeSession.participants,
        files,
        messages,
        isActive: true,
      }, { merge: true });
      console.log('Session snapshot persisted to Firestore:', activeSession.sessionId);
    } catch (error) {
      console.error('Failed to persist session snapshot to Firestore:', error);
    }
  }, [files, messages]);

  // Fetch user's existing sessions from Firestore
  useEffect(() => {
    if (!user) {
      setMySessions([]);
      return;
    }

    setIsLoadingSessions(true);

    // Query for sessions where user is the host — no isActive filter so
    // sessions that were accidentally deactivated (backend crash, etc.) still appear
    const hostQuery = query(
      collection(db, 'sessions'),
      where('hostId', '==', user.uid)
    );

    const unsubscribeHost = onSnapshot(hostQuery, (snapshot) => {
      const hostSessions = snapshot.docs
        .map(doc => doc.data() as SessionData)
        .map(data => ({
          sessionId: data.sessionId,
          name: data.name,
          hostName: data.hostName,
          participantCount: Object.keys(data.participants || {}).length,
          createdAt: typeof data.createdAt === 'number'
            ? data.createdAt
            : (data.createdAt as any)?.toMillis?.() || Date.now(),
          isHost: true,
        }));

      setMySessions(prev => {
        const otherSessions = prev.filter(s => !s.isHost);
        const combined = [...hostSessions, ...otherSessions];
        return combined.sort((a, b) => b.createdAt - a.createdAt);
      });
      setIsLoadingSessions(false);
    }, (err) => {
      console.error("Error listening to host sessions:", err);
      setIsLoadingSessions(false);
    });

    // Query for sessions where user is a participant (but not host)
    // Note: no orderBy to avoid requiring composite index - we sort client-side
    const participantQuery = query(
      collection(db, 'sessions'),
      where('isActive', '==', true)
    );

    const unsubscribeParticipant = onSnapshot(participantQuery, (snapshot) => {
      const participantSessions = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as { id: string } & SessionData))
        .filter(data => {
          // Check if user is a participant (but not the host)
          const isParticipant = data.participants && data.participants[user.uid];
          const isNotHost = data.hostId !== user.uid;
          return isParticipant && isNotHost;
        })
        .map(data => ({
          sessionId: data.sessionId,
          name: data.name,
          hostName: data.hostName,
          participantCount: Object.keys(data.participants || {}).length,
          createdAt: typeof data.createdAt === 'number'
            ? data.createdAt
            : (data.createdAt as any)?.toMillis?.() || Date.now(),
          isHost: false,
        }));

      setMySessions(prev => {
        const hostSessions = prev.filter(s => s.isHost);
        const combined = [...hostSessions, ...participantSessions];
        return combined.sort((a, b) => b.createdAt - a.createdAt);
      });
      setIsLoadingSessions(false);
    }, (err) => {
      console.error("Error listening to participant sessions:", err);
      setIsLoadingSessions(false);
    });

    return () => {
      unsubscribeHost();
      unsubscribeParticipant();
    };
  }, [user]);

  // Keep refreshMySessions for compatibility
  const refreshMySessions = useCallback(async () => {
    // The useEffect listener above handles real-time updates now
  }, []);

  // Flush pending updates when session changes or component unmounts
  useEffect(() => {
    return () => {
      // Cleanup on unmount - flush any pending updates
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Sessions must be opened explicitly by the user.
  useEffect(() => {
    const restoreLastSession = async () => {
      return;
      /*
      if (!user || session || isConnecting) return;

      try {
        const lastSessionId = null;
        if (lastSessionId) {
          console.log('🔄 Restoring last session:', lastSessionId);
          addOutput('info', '🔄 Restoring your last session...');

          const normalizedId = lastSessionId.toUpperCase().trim();
          const sessionRef = doc(db, 'sessions', normalizedId);
          const sessionSnap = await getDoc(sessionRef);

          if (!sessionSnap.exists()) {
            console.warn('❌ Session no longer exists');
            return;
          }

          const rawData = sessionSnap.data();
          const data = normalizeSessionData(rawData, normalizedId);
          void repairSessionDocument(normalizedId, rawData);
          const isHost = data.hostId === user.uid;

          // Reactivate if needed
          if (!data.isActive) {
            if (isHost) {
              await updateDoc(sessionRef, { isActive: true });
            } else {
              console.warn('❌ Session has ended');
              return;
            }
          }

          // Update online status
          await updateDoc(sessionRef, {
            [`participants.${user.uid}.isOnline`]: true,
          });

          const myRole = isHost ? 'host' : (data.participants[user.uid]?.role || 'editor');

          setSession({
            sessionId: normalizedId,
            name: data.name,
            role: myRole,
            hostId: data.hostId,
            hostName: data.hostName,
            participants: data.participants,
          });

          applyPersistedFiles(data.files);
          applyPersistedMessages(data.messages);

          addOutput('success', `🎉 Restored session "${data.name}"!`);
        }
      } catch (error) {
        console.error('Failed to restore last session:', error);
      }
      */
    };

    // Small delay to ensure user is fully loaded
    const timer = setTimeout(restoreLastSession, 100);
    return () => clearTimeout(timer);
  }, [user, session, isConnecting, addOutput, applyPersistedFiles, applyPersistedMessages, repairSessionDocument]);

  // Listen to session changes in Firestore
  useEffect(() => {
    if (!session?.sessionId || !user) return;

    const sessionRef = doc(db, 'sessions', session.sessionId);
    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      if (snapshot.exists()) {
        const rawData = snapshot.data();
        const data = normalizeSessionData(rawData, session.sessionId);
        void repairSessionDocument(session.sessionId, rawData);

        // Update participants
        const myRole = data.participants[user.uid]?.role || 'viewer';
        setSession(prev => prev ? {
          ...prev,
          participants: data.participants,
          role: myRole,
        } : null);

        if (!pendingFilesRef.current) {
          applyPersistedFiles(data.files);
        }

        applyPersistedMessages(data.messages);

        // Check if we were kicked
        if (!data.participants[user.uid] && data.hostId !== user.uid) {
          setSession(null);
          setConnectionError('You have been removed from the session.');
        }
      } else {
        // Session was deleted
        setSession(null);
        setConnectionError('Session has ended.');
      }
    });

    return () => unsubscribe();
  }, [session?.sessionId, user, applyPersistedFiles, applyPersistedMessages, repairSessionDocument]);

  // Update online status and handle page unload
  useEffect(() => {
    if (!session?.sessionId || !user) return;

    const updateOnlineStatus = async (isOnline: boolean) => {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await updateDoc(sessionRef, {
          [`participants.${user.uid}.isOnline`]: isOnline,
        });
      } catch (e) {
        // Ignore errors on cleanup
      }
    };

    updateOnlineStatus(true);

    const flushAndMarkOffline = () => {
      flushPendingFileUpdates().catch(() => {});
      updateOnlineStatus(false).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAndMarkOffline();
      }
    };

    window.addEventListener('beforeunload', flushAndMarkOffline);
    window.addEventListener('pagehide', flushAndMarkOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushAndMarkOffline);
      window.removeEventListener('pagehide', flushAndMarkOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushAndMarkOffline();
    };
  }, [session?.sessionId, user, flushPendingFileUpdates]);

  // File management
  const createFile = useCallback(async (name: string, language: string, parentId: string | null = null) => {
    const newFile: FileItem = {
      id: generateId(12),
      name,
      content: '',
      language,
      isFolder: false,
      parentId,
    };

    const updated = [...files, newFile];
    setFiles(updated);
    setCurrentFileId(newFile.id);

    await persistFilesImmediately(
      updated,
      `File created and persisted to Firestore: ${name}`,
      `Warning: File "${name}" created but not saved to server. Changes may be lost.`
    );
    /*
        console.log('✅ File created and persisted to Firestore:', name);
      } catch (error) {
        console.error('❌ Failed to persist file to Firestore:', error);
        addOutput('error', `❌ Warning: File "${name}" created but not saved to server. Changes may be lost.`);
      }
    }
    */
  }, [files, persistFilesImmediately]);

  /*
  // Debounce ref for Firestore writes (free tier optimization)
  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingFilesRef = React.useRef<FileItem[] | null>(null);

  // Helper to flush pending debounced updates
  const flushPendingFileUpdates = useCallback(async () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (pendingFilesRef.current && session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await updateDoc(sessionRef, { files: pendingFilesRef.current });
        console.log('✅ Pending file changes flushed to Firestore');
        pendingFilesRef.current = null;
      } catch (error) {
        console.error('❌ Failed to flush file changes:', error);
      }
    }
  }, [session?.sessionId]);
  */

  const updateFileContent = useCallback((id: string, content: string) => {
    const updated = files.map(f => f.id === id ? { ...f, content } : f);
    setFiles(updated);

    // Debounce Firestore writes (150ms) to reduce the window where edits can be lost.
    if (session?.sessionId) {
      // Store for potential flush
      pendingFilesRef.current = updated;

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(async () => {
        try {
          const sessionRef = doc(db, 'sessions', session.sessionId);
          await setDoc(sessionRef, { files: updated }, { merge: true });
          console.log('✅ File content persisted to Firestore for file:', id);
          pendingFilesRef.current = null;
          debounceTimeoutRef.current = null;
        } catch (error) {
          console.error('❌ Failed to persist file content to Firestore:', error);
          addOutput('error', `❌ Warning: File changes not saved to server. Changes may be lost.`);
        }
      }, 150);
    }
  }, [session?.sessionId, files, addOutput]);

  const deleteFile = useCallback(async (id: string) => {
    const updated = files.filter(f => f.id !== id);

    // Update current file if deleted
    if (currentFileId === id && updated.length > 0) {
      setCurrentFileId(updated[0].id);
    }

    setFiles(updated);

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await setDoc(sessionRef, { files: updated }, { merge: true });
        console.log('✅ File deleted and persisted to Firestore:', id);
      } catch (error) {
        console.error('❌ Failed to persist file deletion to Firestore:', error);
        addOutput('error', `❌ Warning: File deleted locally but not on server. Changes may be lost.`);
      }
    }
  }, [files, currentFileId, session?.sessionId, addOutput]);

  const renameFile = useCallback(async (id: string, newName: string) => {
    const updated = files.map(f => f.id === id ? { ...f, name: newName } : f);
    setFiles(updated);

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await setDoc(sessionRef, { files: updated }, { merge: true });
        console.log('✅ File renamed and persisted to Firestore:', newName);
      } catch (error) {
        console.error('❌ Failed to persist file rename to Firestore:', error);
        addOutput('error', `❌ Warning: File renamed locally but not on server. Changes may be lost.`);
      }
    }
  }, [files, session?.sessionId, addOutput]);

  // Folder management
  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    const newFolder: FileItem = {
      id: generateId(12),
      name,
      content: '',
      language: '',
      isFolder: true,
      parentId,
    };

    const updated = [...files, newFolder];
    setFiles(updated);

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await setDoc(sessionRef, { files: updated }, { merge: true });
        console.log('✅ Folder created and persisted to Firestore:', name);
      } catch (error) {
        console.error('❌ Failed to persist folder to Firestore:', error);
        addOutput('error', `❌ Warning: Folder "${name}" created but not saved to server. Changes may be lost.`);
      }
    }
  }, [session?.sessionId, files, addOutput]);

  const renameFolder = useCallback(async (id: string, newName: string) => {
    const updated = files.map(f => f.id === id ? { ...f, name: newName } : f);
    setFiles(updated);

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await setDoc(sessionRef, { files: updated }, { merge: true });
        console.log('✅ Folder renamed and persisted to Firestore:', newName);
      } catch (error) {
        console.error('❌ Failed to persist folder rename to Firestore:', error);
        addOutput('error', `❌ Warning: Folder renamed locally but not on server. Changes may be lost.`);
      }
    }
  }, [files, session?.sessionId, addOutput]);

  const deleteFolder = useCallback(async (id: string) => {
    const getAllDescendantIds = (folderId: string, currentFiles: FileItem[]): string[] => {
      const children = currentFiles.filter(f => f.parentId === folderId);
      let ids = children.map(f => f.id);
      children.forEach(child => {
        if (child.isFolder) {
          ids = [...ids, ...getAllDescendantIds(child.id, currentFiles)];
        }
      });
      return ids;
    };

    const idsToDelete = new Set([id, ...getAllDescendantIds(id, files)]);
    const updated = files.filter(f => !idsToDelete.has(f.id));

    // Update current file if it's being deleted
    if (currentFileId && idsToDelete.has(currentFileId)) {
      const remaining = updated.filter(f => !f.isFolder);
      setCurrentFileId(remaining.length > 0 ? remaining[0].id : null);
    }

    setFiles(updated);

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await setDoc(sessionRef, { files: updated }, { merge: true });
        console.log('✅ Folder deleted and persisted to Firestore:', id);
      } catch (error) {
        console.error('❌ Failed to persist folder deletion to Firestore:', error);
        addOutput('error', `❌ Warning: Folder deleted locally but not on server. Changes may be lost.`);
      }
    }
  }, [files, currentFileId, session?.sessionId, addOutput]);

  // Chat
  const sendMessage = useCallback(async (content: string) => {
    if (!user || !session?.sessionId) return;

    const myParticipant = session.participants[user.uid];
    const newMessage: ChatMessage = {
      id: generateId(16),
      userId: user.uid,
      userName: myParticipant?.name || user.displayName || 'Anonymous',
      userColor: myParticipant?.color || '#3b82f6',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => {
      const updated = [...prev, newMessage];
      // Sync to Firestore
      const sessionRef = doc(db, 'sessions', session.sessionId);
      void setDoc(sessionRef, { messages: updated }, { merge: true }).catch((error) => {
        console.error('Failed to persist chat message:', error);
        addOutput('error', 'Warning: Chat message was sent locally but not saved to server.');
      });
      return updated;
    });
  }, [user, session, addOutput]);

  // Socket.IO connection management
  useEffect(() => {
    if (!user) return;

    const socketUrl = getDynamicBackendUrl();
    console.log('🔌 Connecting to backend:', socketUrl);

    const newSocket = io(socketUrl, {
      auth: {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email?.split('@')[0] || 'User'
      }
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      setConnectionError(null);
      joinedSocketSessionKeyRef.current = null;
      pendingSocketSessionKeyRef.current = null;
      console.log('Connected to backend');
      /*

        console.log('🔄 Rejoining session room after reconnect:', currentSession.sessionId);
      }
    });

      */

    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      joinedSocketSessionKeyRef.current = null;
      pendingSocketSessionKeyRef.current = null;
      console.log('Disconnected from backend');
    });

    newSocket.on('connect_error', (error) => {
      setIsConnected(false);
      setConnectionError(`Connection failed: ${error.message}`);
      console.log('Socket connection failed (this is normal if backend is not running)');
    });

    newSocket.on('error', (error) => {
      console.log('Socket error:', error);
    });

    // Handle streaming code output
    newSocket.on('execution_output', (data) => {
      if (data.isError) {
        addOutput('error', data.output);
      } else {
        addOutput('output', data.output);
      }
    });

    // Handle code execution completion
    newSocket.on('execution_exit', (data) => {
      setIsExecuting(false);
      if (data.error) {
        addOutput('error', `❌ ${data.error}`);
      } else if (data.killed) {
        addOutput('info', '[Execution killed]');
      } else if (data.code !== 0 && data.code !== null) {
        addOutput('error', `[Process exited with code ${data.code}]`);
      } else {
        const time = typeof data.execution_time === 'number' ? data.execution_time.toFixed(3) : null;
        addOutput('success', time ? `✓ Done (${time}s)` : '✓ Done');
      }
    });

    // Handle terminal output (streaming)
    newSocket.on('terminal_output', (data) => {
      if (data.isError) {
        addOutput('error', data.output);
      } else {
        addOutput('output', data.output);
      }
    });

    // Handle terminal process exit
    newSocket.on('terminal_exit', (data) => {
      setIsTerminalRunning(false);
      if (data.code !== null && data.code !== 0) {
        addOutput('error', `[Process exited with code ${data.code}]`);
      } else {
        addOutput('info', '[Process exited]');
      }
    });

    newSocket.on('deployment_progress', (data) => {
      if (!data || typeof data !== 'object') return;

      const action = data.action === 'dockerhub' || data.action === 'render' || data.action === 'download'
        ? data.action
        : 'download';
      const percent = typeof data.percent === 'number' ? Math.max(0, Math.min(100, data.percent)) : 0;
      const message = typeof data.message === 'string' ? data.message : 'Deploying...';
      const active = Boolean(data.active);

      setDeployProgress({ action, percent, message, active });
    });

    setSocket(newSocket);

    return () => {
      joinedSocketSessionKeyRef.current = null;
      pendingSocketSessionKeyRef.current = null;
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
      setDeployProgress(null);
    };
  }, [user, addOutput]);

  /*
  // Join session via Socket.IO when session changes
  useEffect(() => {
    if (!socket || !session?.sessionId || !user) return;

    const joinData = {
      session_id: session.sessionId,
      sessionId: session.sessionId,
      userId: user.uid,
      userName: user.displayName || user.email?.split('@')[0] || 'User',
      userEmail: user.email
    };

    socket.emit('join_session', joinData, (response: any) => {
      if (response?.error === 'Session not found') {
        console.log('Session not found on backend. Attempting resurrection...');
        if (session.hostId === user.uid) {
          void persistSessionSnapshot(session).finally(() => {
          socket.emit('create_session', {
            settings: { name: session.name },
            session_id: session.sessionId
          }, (createRes: any) => {
            if (createRes?.success) {
              addOutput('success', '🔄 Session restored on server.');
            } else {
              addOutput('error', `❌ Failed to restore session: ${createRes?.error}`);
            }
          });
          });
        } else {
          addOutput('error', '❌ Session has ended (Host disconnected).');
        }
      } else if (response?.error === 'Session is inactive') {
        if (session.hostId === user.uid) {
          addOutput('info', 'ðŸ”„ Reactivating your inactive session...');
          void persistSessionSnapshot(session).finally(() => {
            socket.emit('create_session', {
              settings: { name: session.name },
              session_id: session.sessionId
            }, (createRes: any) => {
              if (createRes?.success) {
                addOutput('success', 'ðŸŽ‰ Session reactivated.');
              } else {
                addOutput('error', `âŒ Failed to reactivate session: ${createRes?.error}`);
              }
            });
          });
        } else {
          addOutput('error', 'âŒ Session is inactive. Ask the host to reopen it.');
        }
      } else if (response?.error) {
        console.warn('Join failed:', response.error);
        addOutput('error', `âŒ ${response.error}`);
      }
    });

    return () => {
      if (socket && session?.sessionId) {
        socket.emit('leave_session', { sessionId: session.sessionId });
      }
    };
  }, [socket, session, user, addOutput, persistSessionSnapshot]);
  */

  // Join session via Socket.IO when the active connection/session pair changes
  useEffect(() => {
    if (!socket || !isConnected || !socket.id || !session?.sessionId || !user) return;

    const sessionId = session.sessionId;
    const joinKey = `${socket.id}:${sessionId}:${user.uid}`;
    if (
      joinedSocketSessionKeyRef.current === joinKey ||
      pendingSocketSessionKeyRef.current === joinKey
    ) {
      return;
    }

    pendingSocketSessionKeyRef.current = joinKey;

    const joinData = {
      session_id: sessionId,
      sessionId,
      userId: user.uid,
      userName: user.displayName || user.email?.split('@')[0] || 'User',
      userEmail: user.email
    };

    socket.emit('join_session', joinData, (response: any) => {
      if (pendingSocketSessionKeyRef.current === joinKey) {
        pendingSocketSessionKeyRef.current = null;
      }

      if (response?.success) {
        joinedSocketSessionKeyRef.current = joinKey;
        return;
      }

      if (joinedSocketSessionKeyRef.current === joinKey) {
        joinedSocketSessionKeyRef.current = null;
      }

      const currentSession = sessionRef.current;
      if (!currentSession || currentSession.sessionId !== sessionId) {
        return;
      }

      if (response?.error === 'Session not found') {
        console.log('Session not found on backend. Attempting resurrection...');
        if (currentSession.hostId === user.uid) {
          void persistSessionSnapshot(currentSession).finally(() => {
            socket.emit('create_session', {
              settings: { name: currentSession.name },
              session_id: currentSession.sessionId
            }, (createRes: any) => {
              if (createRes?.success) {
                joinedSocketSessionKeyRef.current = joinKey;
                addOutput('success', 'Session restored on server.');
              } else {
                addOutput('error', `Failed to restore session: ${createRes?.error}`);
              }
            });
          });
        } else {
          addOutput('error', 'Session has ended (host disconnected).');
        }
      } else if (response?.error === 'Session is inactive') {
        if (currentSession.hostId === user.uid) {
          addOutput('info', 'Reactivating your inactive session...');
          void persistSessionSnapshot(currentSession).finally(() => {
            socket.emit('create_session', {
              settings: { name: currentSession.name },
              session_id: currentSession.sessionId
            }, (createRes: any) => {
              if (createRes?.success) {
                joinedSocketSessionKeyRef.current = joinKey;
                addOutput('success', 'Session reactivated.');
              } else {
                addOutput('error', `Failed to reactivate session: ${createRes?.error}`);
              }
            });
          });
        } else {
          addOutput('error', 'Session is inactive. Ask the host to reopen it.');
        }
      } else if (response?.error) {
        console.warn('Join failed:', response.error);
        addOutput('error', response.error);
      }
    });
  }, [
    socket,
    isConnected,
    socket?.id,
    session?.sessionId,
    user?.uid,
    user?.displayName,
    user?.email,
    addOutput,
    persistSessionSnapshot,
  ]);

  // Code execution
  const executeCode = useCallback((language: string, code: string) => {
    if (!socket || !isConnected) {
      addOutput('error', '❌ Not connected to backend server');
      return;
    }

    setIsExecuting(true);
    addOutput('info', `⏳ Running ${language} code...`);

    const getFilePath = (file: { name: string; parentId?: string | null }): string => {
      const parts: string[] = [file.name];
      let current = file;
      while (current.parentId) {
        const parent = files.find(f => f.id === current.parentId);
        if (parent) { parts.unshift(parent.name); current = parent; } else break;
      }
      return parts.join('/');
    };
    const projectFiles: Record<string, string> = {};
    files.filter(f => !f.isFolder).forEach(f => {
      projectFiles[getFilePath(f)] = f.content;
    });

    socket.emit('run_code', {
      sessionId: session?.sessionId || 'standalone',
      language,
      code,
      projectFiles
    }, (response: any) => {
      // Callback fires immediately after compilation (or on compilation error)
      if (response?.error) {
        setIsExecuting(false);
        addOutput('error', `❌ ${response.error}`);
      }
      // If response.streaming === true: execution has started, output comes via execution_output events
    });
  }, [socket, isConnected, session?.sessionId, files, addOutput]);

  const sendExecutionInput = useCallback((input: string) => {
    if (socket && isConnected) {
      socket.emit('execution_input', { input });
      addOutput('output', `> ${input}`);
    }
  }, [socket, isConnected, addOutput]);

  const killExecution = useCallback(() => {
    if (socket && isConnected) {
      socket.emit('execution_kill');
    }
    setIsExecuting(false);
  }, [socket, isConnected]);

  // Create a new session
  const createSession = useCallback(async (name: string) => {
    if (!user) {
      setConnectionError('You must be logged in to create a session');
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const sessionId = generateId(8);
      const myColor = generateColor();

      const participant: Participant = {
        uid: user.uid,
        name: user.displayName || user.email?.split('@')[0] || 'Host',
        email: user.email || '',
        role: 'host',
        color: myColor,
        isOnline: true,
        ...(user.photoURL && { photoURL: user.photoURL }),
        joinedAt: Date.now(),
      };

      const sessionData: SessionData = {
        sessionId,
        name,
        hostId: user.uid,
        hostName: participant.name,
        createdAt: serverTimestamp() as Timestamp,
        participants: { [user.uid]: participant },
        files: files,
        messages: [],
        isActive: true,
      };

      // Create session in Firestore
      await setDoc(doc(db, 'sessions', sessionId), sessionData);

      setSession({
        sessionId,
        name,
        role: 'host',
        hostId: user.uid,
        hostName: participant.name,
        participants: { [user.uid]: participant },
      });

      // Save to localStorage for auto-restore on page refresh
      if (typeof window !== 'undefined') {
        localStorage.setItem('codeforge_session_id', sessionId);
      }

      addOutput('success', `🎉 Session "${name}" created! Share code: ${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      console.error("Error creating session:", error);
      setConnectionError(message);
      addOutput('error', `❌ ${message}`);
    } finally {
      setIsConnecting(false);
    }
  }, [user, addOutput]);

  // Join an existing session
  const joinSession = useCallback(async (sessionId: string) => {
    if (!user) {
      setConnectionError('You must be logged in to join a session');
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const normalizedId = sessionId.toUpperCase().trim();
      const sessionRef = doc(db, 'sessions', normalizedId);
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error('Session not found. Please check the session code.');
      }

      const rawData = sessionSnap.data();
      const data = normalizeSessionData(rawData, normalizedId);
      void repairSessionDocument(normalizedId, rawData);

      if (!data.isActive) {
        throw new Error('This session has ended.');
      }

      const myColor = generateColor();
      const participant: Participant = {
        uid: user.uid,
        name: user.displayName || user.email?.split('@')[0] || 'User',
        email: user.email || '',
        role: 'editor',
        color: myColor,
        isOnline: true,
        ...(user.photoURL && { photoURL: user.photoURL }),
        joinedAt: Date.now(),
      };

      // Add self to participants
      await updateDoc(sessionRef, {
        [`participants.${user.uid}`]: participant,
      });

      // Set local state
      const updatedParticipants = { ...data.participants, [user.uid]: participant };

      setSession({
        sessionId: normalizedId,
        name: data.name,
        role: 'editor',
        hostId: data.hostId,
        hostName: data.hostName,
        participants: updatedParticipants,
      });

      // Store session ID for auto-restore on page refresh
      if (typeof window !== 'undefined') {
        localStorage.setItem('codeforge_session_id', normalizedId);
      }

      applyPersistedFiles(data.files);
      applyPersistedMessages(data.messages);

      addOutput('success', `🎉 Joined session "${data.name}"!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join session';
      setConnectionError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [user, addOutput, applyPersistedFiles, applyPersistedMessages, repairSessionDocument]);

  // Rejoin an existing session
  const rejoinSession = useCallback(async (sessionId: string) => {
    if (!user) {
      setConnectionError('You must be logged in to rejoin a session');
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const normalizedId = sessionId.toUpperCase().trim();
      const sessionRef = doc(db, 'sessions', normalizedId);
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error('Session no longer exists.');
      }

      const rawData = sessionSnap.data();
      const data = normalizeSessionData(rawData, normalizedId);
      void repairSessionDocument(normalizedId, rawData);
      const isHost = data.hostId === user.uid;

      if (!data.isActive) {
        if (isHost) {
          // Host can reactivate their own session (e.g. after backend crash set it inactive)
          await updateDoc(sessionRef, { isActive: true });
        } else {
          throw new Error('This session has ended.');
        }
      }

      // Check if user is already a participant
      const existingParticipant = data.participants[user.uid];

      if (!existingParticipant && !isHost) {
        throw new Error('You are no longer a member of this session.');
      }

      // Update online status
      await updateDoc(sessionRef, {
        [`participants.${user.uid}.isOnline`]: true,
      });

      // Determine role
      const myRole = isHost ? 'host' : (existingParticipant?.role || 'editor');

      setSession({
        sessionId: normalizedId,
        name: data.name,
        role: myRole,
        hostId: data.hostId,
        hostName: data.hostName,
        participants: data.participants,
      });

      // Store session ID for auto-restore on page refresh
      if (typeof window !== 'undefined') {
        localStorage.setItem('codeforge_session_id', normalizedId);
      }

      applyPersistedFiles(data.files);
      applyPersistedMessages(data.messages);

      addOutput('success', `🎉 Rejoined session "${data.name}"!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rejoin session';
      setConnectionError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [user, addOutput, applyPersistedFiles, applyPersistedMessages, repairSessionDocument]);

  // Auto-restore session on page load/refresh
  useEffect(() => {
    // Only run once when user logs in
    if (!user || session) return;

    const restoreSession = async () => {
      if (typeof window === 'undefined') return;
      
      const savedSessionId = localStorage.getItem('codeforge_session_id');
      if (!savedSessionId) return;

      console.log('🔄 Auto-restoring session:', savedSessionId);
      
      try {
        // Use rejoinSession which handles both host and participant cases
        await rejoinSession(savedSessionId);
        console.log('✅ Session auto-restored successfully');
      } catch (error) {
        console.warn('Failed to auto-restore session:', error);
        // Clear invalid session from localStorage
        localStorage.removeItem('codeforge_session_id');
      }
    };

    // Small delay to ensure socket is connected
    const timer = setTimeout(restoreSession, 500);
    return () => clearTimeout(timer);
  }, [user, session, rejoinSession]);

  // Leave the current session
  const leaveSession = useCallback(async () => {
    if (!session?.sessionId || !user) return;

    await flushPendingFileUpdates();
    /*
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    if (pendingFilesRef.current && session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await updateDoc(sessionRef, { files: pendingFilesRef.current });
        console.log('✅ Last file changes saved before leaving session');
        pendingFilesRef.current = null;
      } catch (error) {
        console.error('❌ Failed to save final changes:', error);
      }
    }

    */
    const sessionId = session.sessionId;

    if (socket) {
      socket.emit('leave_session', { sessionId });
    }
    joinedSocketSessionKeyRef.current = null;
    pendingSocketSessionKeyRef.current = null;

    try {
      const sessionRef = doc(db, 'sessions', sessionId);

      if (session.role === 'host') {
        await updateDoc(sessionRef, {
          [`participants.${user.uid}.isOnline`]: false,
        });
      } else {
        // Remove self from participants
        const sessionSnap = await getDoc(sessionRef);
        if (sessionSnap.exists()) {
          const data = sessionSnap.data() as SessionData;
          const { [user.uid]: _, ...remainingParticipants } = data.participants;
          await updateDoc(sessionRef, { participants: remainingParticipants });
        }
      }
    } catch (error) {
      console.error('Error leaving session:', error);
    } finally {
      setSession(null);
      setMessages([]);
      setOutput([]);
      setConnectionError(null);
      setFiles([]);
      setCurrentFileId(null);

      // Clear stored session ID to prevent auto-restore
      if (typeof window !== 'undefined') {
        localStorage.removeItem('codeforge_session_id');
      }

      refreshMySessions();
    }
  }, [session, user, socket, refreshMySessions, flushPendingFileUpdates]);

  const deleteSession = useCallback(async () => {
    if (!session?.sessionId || !user || session.role !== 'host' || session.hostId !== user.uid) return;

    await flushPendingFileUpdates();

    const sessionId = session.sessionId;

    if (socket) {
      socket.emit('leave_session', { sessionId });
    }
    joinedSocketSessionKeyRef.current = null;
    pendingSocketSessionKeyRef.current = null;

    try {
      await deleteDoc(doc(db, 'sessions', sessionId));
    } catch (error) {
      console.error('Error deleting session:', error);
    } finally {
      setSession(null);
      setMessages([]);
      setOutput([]);
      setDeployProgress(null);
      setConnectionError(null);
      setFiles([]);
      setCurrentFileId(null);
      
      // Clear stored session ID when deleting session
      if (typeof window !== 'undefined') {
        localStorage.removeItem('codeforge_session_id');
      }
      
      refreshMySessions();
    }
  }, [session, user, socket, refreshMySessions, flushPendingFileUpdates]);

  // Change user role (host/co-host only)
  const changeUserRole = useCallback(async (userId: string, role: Role) => {
    if (!session?.sessionId || !user) return;

    const actorRole = session.participants[user.uid]?.role || session.role;
    const targetParticipant = session.participants[userId];

    if (!targetParticipant || userId === user.uid) return;

    if (actorRole === 'host') {
      if (targetParticipant.role === 'host' || role === 'host') return;
    } else if (actorRole === 'co-host') {
      const canManageTarget = targetParticipant.role === 'editor' || targetParticipant.role === 'viewer';
      const canAssignRole = role === 'editor' || role === 'viewer';
      if (!canManageTarget || !canAssignRole) return;
    } else {
      return;
    }

    try {
      const sessionRef = doc(db, 'sessions', session.sessionId);
      await updateDoc(sessionRef, {
        [`participants.${userId}.role`]: role,
      });
    } catch (error) {
      console.error('Error changing role:', error);
    }
  }, [session, user]);

  // Kick user (host only)
  const kickUser = useCallback(async (userId: string) => {
    if (!session?.sessionId || session.role !== 'host' || !user) return;

    const targetParticipant = session.participants[userId];
    if (!targetParticipant || userId === user.uid || targetParticipant.role === 'host') return;

    try {
      const sessionRef = doc(db, 'sessions', session.sessionId);
      const sessionSnap = await getDoc(sessionRef);

      if (sessionSnap.exists()) {
        const data = sessionSnap.data() as SessionData;
        const { [userId]: _, ...remainingParticipants } = data.participants;
        await updateDoc(sessionRef, { participants: remainingParticipants });
      }
    } catch (error) {
      console.error('Error kicking user:', error);
    }
  }, [session, user]);

  // Terminal command
  const sendTerminalCommand = useCallback((command: string) => {
    if (!socket || !isConnected || !command.trim()) {
      addOutput('error', '❌ Not connected to backend');
      return;
    }

    // Optimistic update
    addOutput('output', `> ${command}`);

    // Collect non-folder files with full paths (including parent folders)
    const fileContents: Record<string, string> = {};
    const getFilePath = (file: FileItem): string => {
      const parts: string[] = [file.name];
      let current = file;
      while (current.parentId) {
        const parent = files.find(f => f.id === current.parentId);
        if (parent) {
          parts.unshift(parent.name);
          current = parent as FileItem;
        } else {
          break;
        }
      }
      return parts.join('/');
    };
    files.filter(f => !f.isFolder).forEach(f => {
      fileContents[getFilePath(f)] = f.content;
    });

    setIsTerminalRunning(true);
    socket.emit('terminal_run', { command, files: fileContents });
  }, [socket, isConnected, files, addOutput]);

  const killTerminal = useCallback(() => {
    if (socket && isConnected) {
      socket.emit('terminal_kill');
    }
    setIsTerminalRunning(false);
  }, [socket, isConnected]);

  return (
    <SessionContext.Provider
      value={{
        user,
        session,
        isConnected,
        isConnecting,
        connectionError,
        mySessions,
        isLoadingSessions,
        refreshMySessions,
        files,
        currentFileId,
        setCurrentFileId,
        createFile,
        updateFileContent,
        renameFile,
        deleteFile,
        createFolder,
        renameFolder,
        deleteFolder,
        messages,
        sendMessage,
        output,
        clearOutput,
        addOutput,
        deployProgress,
        isExecuting,
        executeCode,
        sendExecutionInput,
        killExecution,
        createSession,
        joinSession,
        rejoinSession,
        leaveSession,
        deleteSession,
        changeUserRole,
        kickUser,
        sendTerminalCommand,
        killTerminal,
        isTerminalRunning,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
