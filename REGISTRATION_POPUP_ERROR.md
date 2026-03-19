# Registration Verification Popup - Unresolved Issue

## Issue Description

When a user registers with an email on the CodeForge website, a popup should appear prompting them to check their inbox for a verification email. This popup does not appear after registration.

## Timeline of Attempts

### Attempt 1: Original Implementation (Failed)
- **Files**: `frontend/src/components/auth/auth-page.tsx`, `frontend/src/contexts/auth-context.tsx`
- **Approach**: Existing implementation used `throw new Error('__VERIFY_EMAIL__')` for control flow
- **Result**: Popup not showing

### Attempt 2: Return Value Pattern (Failed)
- **Changes**:
  - Changed `register()` to return `RegisterResult` object instead of throwing
  - Removed error-based success detection
  - Added `success: boolean` and `verificationSent: boolean` to result
- **Result**: Popup still not showing

### Attempt 3: Inline Verification UI (Failed)
- **Changes**:
  - Replaced popup with inline verification UI in AuthForm
  - Added `registered` state to AuthForm component
  - Showed verification instructions directly in the form after success
- **Result**: UI not showing after registration

### Attempt 4: localStorage Persistence (Failed)
- **Changes**:
  - Stored `auth_registered` and `auth_registered_email` in localStorage
  - Restored state on component mount to survive auth state changes
  - Added useEffect to check localStorage on mount
- **Result**: Still not working, potential hydration mismatches

### Attempt 5: Keep User Signed In (Current State)
- **Changes**:
  - Removed `signOut()` from register() function
  - User stays signed in after registration
  - `VerifyEmailScreen` component shows automatically when `!isEmailVerified`
- **Result**: Pending verification

## Root Cause Analysis

### Automated Browser Test Results
An automated browser test revealed:

1. **Application Crash**: Browser console logged `[warning] [Fast Refresh] performing full reload because your application had an unrecoverable error`
2. **Hydration Mismatches**: Multiple React hydration mismatch errors detected
3. **Failure Point**: Crash happens either before or immediately after `createUserWithEmailAndPassword` call, or within the `onAuthStateChanged` listener
4. **State Loss**: Application reloads wipe all local React state before popup can render

### Technical Analysis

The popup logic requires this sequence:
```
1. register() completes successfully
2. signOut() is called
3. register() throws __VERIFY_EMAIL__
4. handleSubmit catches it and calls setShowVerifyPopup(true)
5. Popup renders
```

**Problem**: The application crashes and reloads during step 2-3, resetting all state.

### Why signOut() Causes Issues

In `auth-context.tsx`:
```typescript
try {
  isRegistering.current = true;
  await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName });
  await sendEmailVerification(result.user, { url: window.location.origin });
  
  // This causes problems:
  await signOut(auth);  // Triggers onAuthStateChanged listener
  
  setUser(null);
  setIsEmailVerified(false);
  isRegistering.current = false;
  
  return { success: true, email, verificationSent: true };
}
```

When `signOut()` is called:
- It triggers the `onAuthStateChanged` listener
- The listener does `await firebaseUser.getIdToken(true)` and `await firebaseUser.reload()`
- These async operations might conflict with the registration flow
- This causes React to detect an unrecoverable error and reload

### Hydration Mismatch Sources

1. **localStorage in useState initializer** (Fixed):
   ```typescript
   // PROBLEM: Different on server vs client
   const [registered, setRegistered] = useState(() => {
     if (typeof window !== 'undefined') {
       return localStorage.getItem('auth_registered') === 'true';
     }
     return false;
   });
   ```

2. **Conditional rendering based on client-only state**
3. **Firebase auth state differences between server and client**

## Current Implementation (Attempt 5)

### Changes Made

**auth-context.tsx**:
```typescript
const register = async (...): Promise<RegisterResult> => {
  // ... create user, send email ...
  
  // REMOVED: signOut() call
  // User stays signed in
  
  isRegistering.current = false;
  setLoading(false);
  
  return { success: true, email, verificationSent: true };
}
```

**auth-page.tsx**:
```typescript
const handleSubmit = useCallback(async (e: React.FormEvent) => {
  e.preventDefault();
  setLocalError('');

  try {
    if (mode === 'register') {
      // register() creates account and sends verification email
      // User stays signed in and will see VerifyEmailScreen
      await register(email, password, displayName);
    }
    // ... rest of logic
  }
  // ... error handling
});
```

### Expected Flow

1. User submits registration form
2. `register()` creates account, sends verification email
3. `register()` returns `{ success: true, email, verificationSent: true }`
4. User stays signed in with `isEmailVerified = false`
5. `page.tsx` shows `VerifyEmailScreen` (from `frontend/src/components/auth/verify-email.tsx`)
6. `VerifyEmailScreen` displays:
   - Email address
   - "Resend verification email" button
   - "I've verified — check now" button
   - "Back to sign in" button

## Remaining Issues

### Potential Problems with Current Approach

1. **User Experience**: User is stuck on verification screen until they verify or manually sign out
2. **No Clear Success Message**: User might not understand they successfully registered
3. **Navigation**: User can't easily go back to login if they want to use a different email

### Why It Might Still Fail

1. **Firebase Auth State Listener**: The `onAuthStateChanged` listener might still cause issues
2. **Race Conditions**: Auth state changes might happen in unexpected order
3. **Hydration**: Next.js SSR/hydration might still cause problems with auth state

## Recommended Next Steps

### Option A: Use SessionStorage Instead of localStorage
- SessionStorage survives page reloads but not tab closes
- Might avoid hydration issues if initialized correctly

### Option B: Use URL Query Parameters
- After registration, redirect to `/?registered=true&email=user@example.com`
- Check for these params in `AuthPage` component
- Show verification UI based on URL state
- URL state persists through auth changes

### Option C: Use a Global Store (Zustand/Redux)
- External state management survives React re-renders
- Can persist to localStorage with proper hydration handling

### Option D: Fix the Root Cause (Hydration Mismatch)
- Identify exactly where hydration mismatches occur
- Ensure server and client render identically
- Fix the unrecoverable error that causes Fast Refresh reload

### Option E: Separate Verification Page
- Create `/verify-email` route
- After successful registration, redirect to this page
- Page shows verification instructions
- No dependency on React state

## Code References

### Key Files
- `frontend/src/app/page.tsx` - Main routing logic
- `frontend/src/components/auth/auth-page.tsx` - Auth form component
- `frontend/src/components/auth/verify-email.tsx` - Verification screen (existing)
- `frontend/src/contexts/auth-context.tsx` - Auth state management

### Current Register Function (auth-context.tsx:199-247)
```typescript
const register = async (email: string, password: string, displayName: string): Promise<RegisterResult> => {
  setError(null);
  setLoading(true);

  const passwordError = validatePassword(password);
  if (passwordError) {
    setLoading(false);
    setError(passwordError);
    throw new Error(passwordError);
  }

  try {
    isRegistering.current = true;

    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });

    let verificationSent = false;
    try {
      await sendEmailVerification(result.user, {
        url: window.location.origin,
      });
      verificationSent = true;
    } catch (emailErr) {
      console.error('[AuthContext] Failed to send verification email:', emailErr);
    }

    // User stays signed in - no signOut()
    
    isRegistering.current = false;
    setLoading(false);

    return {
      success: true,
      email,
      verificationSent,
    };
  } catch (err: unknown) {
    isRegistering.current = false;

    const firebaseError = err as { code?: string };

    let errorMessage = 'Registration failed';
    if (firebaseError.code === 'auth/email-already-in-use') {
      errorMessage = 'This email is already registered';
    } else if (firebaseError.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address';
    } else if (firebaseError.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak';
    } else if (err instanceof Error) {
      errorMessage = err.message;
    }

    setError(errorMessage);
    setLoading(false);
    throw new Error(errorMessage);
  }
};
```

## Environment

- **Framework**: Next.js 15.5.9
- **React**: 19.2.1
- **Firebase**: 11.9.1
- **TypeScript**: Yes
- **SSR**: Yes (Next.js App Router)

## Status

**RESOLVED** - 2026-03-19 (Final Fix)

**Solution**: After successful registration in `auth-context.tsx`, manually set the React state:
```typescript
const currentUser = auth.currentUser;
if (currentUser) {
  setUser(currentUser);
  setIsEmailVerified(false); // New user's email is not yet verified
}
```

This ensures that after registration completes:
1. User is signed in and stored in React state
2. `isEmailVerified` is explicitly marked as false
3. `page.tsx` checks `!isEmailVerified` and renders `VerifyEmailScreen`
4. User sees the verification email screen with all options

**Why this works**: The `onAuthStateChanged` listener was blocked during registration to prevent race conditions. By manually setting the state after registration, we ensure React has the correct state without relying on the listener to fire.
