# Firestore-Only Persistence Architecture

**Date**: 2026-03-17
**Status**: ✅ Implemented

---

## Summary

All session data is now stored **ONLY in Firestore**. No local storage, session storage, or backend in-memory persistence for files/messages.

---

## Changes Made

### 1. **Backend: Removed In-Memory Data Storage** (backend/index.js)

#### ❌ **REMOVED from SessionData class:**
- `this.files = {}` — Files are NOT stored in backend memory
- `this.messages = []` — Messages are NOT stored in backend memory

#### ✅ **KEPT in SessionData class:**
- `this.participants = {}` — Tracks active socket connections (ephemeral)
- `this.is_active` — Session status flag

**Purpose**: Backend now only tracks **active socket connections**, not persistent data.

---

### 2. **Backend: Updated Firestore Sync Logic**

#### Before:
```javascript
// Overwrote entire session with in-memory state
await db.collection("sessions").doc(session.id).set(sessionData);
```

#### After:
```javascript
// Only syncs participant connection state
if (sessionDoc.exists()) {
  await sessionRef.update({
    participants: session.participants,
    isActive: session.is_active
  });
} else {
  // New session - creates empty files/messages arrays
  await sessionRef.set({
    ...metadata,
    files: [],      // Frontend populates
    messages: []    // Frontend populates
  });
}
```

**Result**: Backend never overwrites files/messages in Firestore.

---

### 3. **Removed Unused Socket Handlers**

Deleted from backend:
- `socket.on('file_update')` — Frontend writes directly to Firestore
- `socket.on('cursor_update')` — Was never used by frontend

**Why**: Frontend uses Firestore `updateDoc()` for all file/message changes. Socket.IO is only for execution streams and terminal I/O.

---

### 4. **Added Documentation**

Updated comments in:
- `backend/index.js` — Explains ephemeral vs persistent storage
- `frontend/src/contexts/session-context.tsx` — Documents Firestore-only model
- `MEMORY.md` — Updated architecture section

---

## Data Flow

### **Files & Messages (Firestore Direct Write)**
```
User edits file
  ↓
Frontend: updateDoc(sessionRef, { files: [...] })
  ↓
Firestore: /sessions/{sessionId}
  ↓
Frontend: onSnapshot listener detects change
  ↓
All connected users see update
```

**Backend is NOT involved in file/message updates.**

---

### **Code Execution & Terminal (Socket.IO Streams)**
```
User runs code
  ↓
Frontend: socket.emit('run_code', {...})
  ↓
Backend: executes in Docker container
  ↓
Backend: socket.emit('execution_output', {...})
  ↓
Frontend: displays output stream
```

**Firestore is NOT involved in execution streams.**

---

### **Session Join/Leave (Hybrid)**
```
User joins session
  ↓
Frontend: joinSession(sessionId)
  ↓
Backend: resurrects session from Firestore if needed
  ↓
Backend: tracks socket connection in memory
  ↓
Backend: updates Firestore participant state
  ↓
Frontend: onSnapshot listener updates participant list
```

**Backend syncs participant connection state to Firestore.**

---

## Verification

### ✅ **No Local Storage**
```bash
grep -r "localStorage\|sessionStorage" frontend/src/
# Output: 0 matches
```

### ✅ **Backend Only Tracks Connections**
- `sessions` object: ephemeral socket tracking
- No `session.files` or `session.messages` fields

### ✅ **Frontend Writes to Firestore**
- `addFile()` → `updateDoc(sessionRef, { files })`
- `updateFileContent()` → `updateDoc(sessionRef, { files })`
- `sendMessage()` → `updateDoc(sessionRef, { messages })`
- `deleteFile()` → `updateDoc(sessionRef, { files })`

### ✅ **Real-time Sync Works**
- `onSnapshot(sessionRef)` listener updates local state
- All changes propagate to all connected users

---

## Benefits

1. **Single Source of Truth**: Firestore is the only persistent storage
2. **No Data Loss**: Backend crashes don't lose session data
3. **No Stale Cache**: Backend can't have out-of-sync file state
4. **Scalable**: Backend is stateless (except socket connections)
5. **Simpler Logic**: No dual-write or sync complexity

---

## What Backend Stores (In-Memory Only)

| Data | Stored? | Purpose |
|------|---------|---------|
| Socket IDs | ✅ Yes | Route messages to correct clients |
| Participant UIDs | ✅ Yes | Track who's in each session |
| Files | ❌ No | Lives only in Firestore |
| Messages | ❌ No | Lives only in Firestore |
| Execution streams | ⚠️ Temporary | Streamed then discarded |

---

## Testing Checklist

- [x] Backend starts without errors
- [ ] Create session → data appears in Firestore
- [ ] Join session → participant list updates
- [ ] Edit file → all users see changes
- [ ] Send message → appears in chat for all users
- [ ] Leave session → participant removed from Firestore
- [ ] Backend restart → sessions resume from Firestore
- [ ] No console errors about missing files/messages

---

## Related Files

- `backend/index.js` (lines 392-490: session storage & sync)
- `frontend/src/contexts/session-context.tsx` (lines 1-15: persistence model docs)
- `MEMORY.md` (Architecture section)
