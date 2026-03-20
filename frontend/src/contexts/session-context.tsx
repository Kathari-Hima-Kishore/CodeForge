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
  const [isExecuting, setIsExecuting] = useState(false);
  const [isTerminalRunning, setIsTerminalRunning] = useState(false);

  // Refs to access current session/user inside socket event handlers without stale closures
  const sessionRef = React.useRef<Session | null>(null);
  const userRef = React.useRef<typeof user>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { userRef.current = user; }, [user]);

  // Output - defined EARLY to avoid dependency issues in effects
  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  const addOutput = useCallback((type: OutputItem['type'], content: string) => {
    setOutput(prev => [...prev, { type, content, timestamp: Date.now() }]);
  }, []);

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

  // Auto-restore last session on page load
  useEffect(() => {
    const restoreLastSession = async () => {
      if (!user || session || isConnecting) return;

      try {
        const lastSessionId = localStorage.getItem('codeforge-last-session');
        if (lastSessionId) {
          console.log('🔄 Restoring last session:', lastSessionId);
          addOutput('info', '🔄 Restoring your last session...');

          const normalizedId = lastSessionId.toUpperCase().trim();
          const sessionRef = doc(db, 'sessions', normalizedId);
          const sessionSnap = await getDoc(sessionRef);

          if (!sessionSnap.exists()) {
            console.warn('❌ Session no longer exists');
            localStorage.removeItem('codeforge-last-session');
            return;
          }

          const data = sessionSnap.data() as SessionData;
          const isHost = data.hostId === user.uid;

          // Reactivate if needed
          if (!data.isActive) {
            if (isHost) {
              await updateDoc(sessionRef, { isActive: true });
            } else {
              console.warn('❌ Session has ended');
              localStorage.removeItem('codeforge-last-session');
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

          // Load files
          if (data.files?.length > 0) {
            setFiles(data.files);
            setCurrentFileId(data.files[0].id);
          }

          // Load messages
          if (data.messages) {
            setMessages(data.messages);
          }

          addOutput('success', `🎉 Restored session "${data.name}"!`);
        }
      } catch (error) {
        console.error('Failed to restore last session:', error);
        localStorage.removeItem('codeforge-last-session');
      }
    };

    // Small delay to ensure user is fully loaded
    const timer = setTimeout(restoreLastSession, 100);
    return () => clearTimeout(timer);
  }, [user, session, isConnecting]);

  // Listen to session changes in Firestore
  useEffect(() => {
    if (!session?.sessionId || !user) return;

    const sessionRef = doc(db, 'sessions', session.sessionId);
    const unsubscribe = onSnapshot(sessionRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SessionData;

        // Update participants
        const myRole = data.participants[user.uid]?.role || 'viewer';
        setSession(prev => prev ? {
          ...prev,
          participants: data.participants,
          role: myRole,
        } : null);

        // Update files
        if (data.files?.length > 0) {
          setFiles(data.files);
        }

        // Update messages
        if (data.messages) {
          setMessages(data.messages);
        }

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
  }, [session?.sessionId, user]);

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

    const handleBeforeUnload = () => {
      // On page unload, just mark online as false
      // Note: Can't reliably do async in beforeunload, so we don't await
      updateOnlineStatus(false).catch(() => {});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // When component unmounts, update online status
      updateOnlineStatus(false).catch(() => {});
    };
  }, [session?.sessionId, user]);

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

    // Persist to Firestore with error handling
    if (session?.sessionId) {
      try {
        const sessionRef = doc(db, 'sessions', session.sessionId);
        await updateDoc(sessionRef, { files: updated });
        console.log('✅ File created and persisted to Firestore:', name);
      } catch (error) {
        console.error('❌ Failed to persist file to Firestore:', error);
        addOutput('error', `❌ Warning: File "${name}" created but not saved to server. Changes may be lost.`);
      }
    }
  }, [session?.sessionId, files, addOutput]);

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

  const updateFileContent = useCallback((id: string, content: string) => {
    const updated = files.map(f => f.id === id ? { ...f, content } : f);
    setFiles(updated);

    // Debounce Firestore writes (500ms) - critical for free tier
    if (session?.sessionId) {
      // Store for potential flush
      pendingFilesRef.current = updated;

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = setTimeout(async () => {
        try {
          const sessionRef = doc(db, 'sessions', session.sessionId);
          await updateDoc(sessionRef, { files: updated });
          console.log('✅ File content persisted to Firestore for file:', id);
          pendingFilesRef.current = null;
          debounceTimeoutRef.current = null;
        } catch (error) {
          console.error('❌ Failed to persist file content to Firestore:', error);
          addOutput('error', `❌ Warning: File changes not saved to server. Changes may be lost.`);
        }
      }, 500);
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
        await updateDoc(sessionRef, { files: updated });
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
        await updateDoc(sessionRef, { files: updated });
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
        await updateDoc(sessionRef, { files: updated });
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
        await updateDoc(sessionRef, { files: updated });
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
        await updateDoc(sessionRef, { files: updated });
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
      updateDoc(sessionRef, { messages: updated });
      return updated;
    });
  }, [user, session]);

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
      console.log('Connected to backend');

      // Re-join session room if we already have an active session (handles backend restart/reconnect)
      const currentSession = sessionRef.current;
      const currentUser = userRef.current;
      if (currentSession?.sessionId && currentUser) {
        console.log('🔄 Rejoining session room after reconnect:', currentSession.sessionId);
        newSocket.emit('join_session', {
          session_id: currentSession.sessionId,
          sessionId: currentSession.sessionId,
          userId: currentUser.uid,
          userName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
          userEmail: currentUser.email,
        });
      }
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
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

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [user, addOutput]);

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
        } else {
          addOutput('error', '❌ Session has ended (Host disconnected).');
        }
      } else if (response?.error) {
        console.error('Join failed:', response.error);
      }
    });

    return () => {
      if (socket && session?.sessionId) {
        socket.emit('leave_session', { sessionId: session.sessionId });
      }
    };
  }, [socket, session?.sessionId, user]);

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

      // Store session ID for auto-restore on page refresh
      localStorage.setItem('codeforge-last-session', sessionId);

      addOutput('success', `🎉 Session "${name}" created! Share code: ${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      console.error("Error creating session:", error);
      setConnectionError(message);
      addOutput('error', `❌ ${message}`);
    } finally {
      setIsConnecting(false);
    }
  }, [user, files, addOutput]);

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

      const data = sessionSnap.data() as SessionData;

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
      localStorage.setItem('codeforge-last-session', normalizedId);

      // Load session files
      if (data.files?.length > 0) {
        setFiles(data.files);
        setCurrentFileId(data.files[0].id);
      }

      // Load messages
      if (data.messages) {
        setMessages(data.messages);
      }

      addOutput('success', `🎉 Joined session "${data.name}"!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to join session';
      setConnectionError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [user, addOutput]);

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

      const data = sessionSnap.data() as SessionData;
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
      localStorage.setItem('codeforge-last-session', normalizedId);

      // Load session files
      if (data.files?.length > 0) {
        setFiles(data.files);
        setCurrentFileId(data.files[0].id);
      }

      // Load messages
      if (data.messages) {
        setMessages(data.messages);
      }

      addOutput('success', `🎉 Rejoined session "${data.name}"!`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rejoin session';
      setConnectionError(message);
    } finally {
      setIsConnecting(false);
    }
  }, [user, addOutput]);

  // Leave the current session
  const leaveSession = useCallback(async () => {
    if (!session?.sessionId || !user) return;

    // CRITICAL: Flush any pending debounced file updates before leaving
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

    const sessionId = session.sessionId;

    try {
      const sessionRef = doc(db, 'sessions', sessionId);

      if (session.role === 'host') {
        await updateDoc(sessionRef, { isActive: false });
        await deleteDoc(sessionRef);
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
      localStorage.removeItem('codeforge-last-session');

      refreshMySessions();
    }
  }, [session, user, refreshMySessions]);

  // Change user role (host/co-host only)
  const changeUserRole = useCallback(async (userId: string, role: Role) => {
    if (!session?.sessionId) return;
    if (session.role !== 'host' && session.role !== 'co-host') return;

    try {
      const sessionRef = doc(db, 'sessions', session.sessionId);
      await updateDoc(sessionRef, {
        [`participants.${userId}.role`]: role,
      });
    } catch (error) {
      console.error('Error changing role:', error);
    }
  }, [session]);

  // Kick user (host only)
  const kickUser = useCallback(async (userId: string) => {
    if (!session?.sessionId || session.role !== 'host') return;

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
  }, [session]);

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
        isExecuting,
        executeCode,
        sendExecutionInput,
        killExecution,
        createSession,
        joinSession,
        rejoinSession,
        leaveSession,
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
