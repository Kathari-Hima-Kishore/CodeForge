'use client';

import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { auth, getDynamicBackendUrl } from '@/lib/firebase';

// Result type for registration
export interface RegisterResult {
  success: boolean;
  email: string;
  verificationSent: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  message: string | null;
  isEmailVerified: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  clearError: () => void;
  clearMessage: () => void;
  resendVerification: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Password requirement checks — exported for UI indicators
export interface PasswordChecks {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
}

export function getPasswordChecks(password: string): PasswordChecks {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

function validatePassword(password: string): string | null {
  const checks = getPasswordChecks(password);
  if (!checks.minLength) return 'Password must be at least 8 characters';
  if (!checks.hasUppercase) return 'Password must contain at least one uppercase letter';
  if (!checks.hasLowercase) return 'Password must contain at least one lowercase letter';
  if (!checks.hasNumber) return 'Password must contain at least one number';
  return null;
}

async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const response = await fetch(`${getDynamicBackendUrl()}/api/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to verify email');
    }

    const data = await response.json();
    return data.exists === true;
  } catch (err) {
    if (err instanceof Error && err.message !== 'Failed to verify email') {
      throw err;
    }
    throw new Error('Connection to authentication server failed');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  // Track if we're in register flow to completely block onAuthStateChanged
  const isRegistering = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Completely block all auth state changes during register flow
      if (isRegistering.current) {
        return;
      }

      if (firebaseUser) {
        try {
          await firebaseUser.getIdToken(true);
          await firebaseUser.reload();
        } catch {}
        const freshUser = auth.currentUser;
        if (freshUser) {
          setUser(freshUser);
          setIsEmailVerified(freshUser.emailVerified);
        } else {
          setUser(null);
          setIsEmailVerified(false);
        }
      } else {
        setUser(null);
        setIsEmailVerified(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);

    try {
      const emailExists = await checkEmailExists(email);

      if (!emailExists) {
        const errorMsg = 'Email is not registered';
        setError(errorMsg);
        setLoading(false);
        throw new Error(errorMsg);
      }

      await signInWithEmailAndPassword(auth, email, password);

      // Force token refresh + reload to get latest emailVerified from Firebase servers
      const currentUser = auth.currentUser;
      if (currentUser) {
        await currentUser.getIdToken(true);
        await currentUser.reload();

        if (!currentUser.emailVerified) {
          // Set context-level error BEFORE signOut (persists across remounts)
          const errorMsg = 'Email not verified. Check your inbox and click the verification link.';
          setError(errorMsg);

          // Force sign out — don't just block UI, end the session
          await signOut(auth);
          throw new Error('__NOT_VERIFIED__');
        }
      }
    } catch (err: unknown) {
      const firebaseError = err as { code?: string };

      if (firebaseError.code === 'auth/invalid-credential' ||
          firebaseError.code === 'auth/wrong-password') {
        const errorMsg = 'Incorrect password';
        setError(errorMsg);
        setLoading(false);
        throw new Error(errorMsg);
      }

      if (firebaseError.code === 'auth/invalid-email') {
        const errorMsg = 'Invalid email address';
        setError(errorMsg);
        setLoading(false);
        throw new Error(errorMsg);
      }

      if (err instanceof Error && err.message === '__NOT_VERIFIED__') {
        setLoading(false);
        throw err;
      }

      if (err instanceof Error &&
          (err.message === 'Email is not registered' || err.message === 'Incorrect password')) {
        setLoading(false);
        throw err;
      }

      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      setLoading(false);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string, displayName: string): Promise<RegisterResult> => {
    setError(null);
    setLoading(true);

    // Validate password first
    const passwordError = validatePassword(password);
    if (passwordError) {
      setLoading(false);
      setError(passwordError);
      throw new Error(passwordError);
    }

    try {
      // Block ALL auth state changes during register flow
      isRegistering.current = true;

      // Create user account
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName });

      // Send verification email
      let verificationSent = false;
      try {
        await sendEmailVerification(result.user, {
          url: window.location.origin,
        });
        verificationSent = true;
      } catch (emailErr) {
        // Log but don't fail - account is still created
        console.error('[AuthContext] Failed to send verification email:', emailErr);
      }

      // Keep user signed in - they'll see verification required screen
      // No signOut, no state resets

      // Manually update React state with newly created user
      const currentUser = auth.currentUser;
      if (currentUser) {
        setUser(currentUser);
        setIsEmailVerified(false); // New user's email is not yet verified
      }

      // Unblock auth state changes
      isRegistering.current = false;
      setLoading(false);

      // Return success result - NO error throwing for success
      return {
        success: true,
        email,
        verificationSent,
      };
    } catch (err: unknown) {
      // Always unblock auth state changes on error
      isRegistering.current = false;

      const firebaseError = err as { code?: string };

      // Map Firebase errors to user-friendly messages
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

  const logout = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
      throw err;
    }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    setMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage(`Password reset email sent to ${email}. Check your inbox and spam folder.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Password reset failed';
      setError(message);
      throw err;
    }
  };

  const resendVerification = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No user signed in');

    try {
      await sendEmailVerification(currentUser, {
        url: window.location.origin,
      });
    } catch (err: unknown) {
      const firebaseError = err as { code?: string };

      if (firebaseError.code === 'auth/too-many-requests') {
        throw new Error('Too many requests. Please wait a few minutes before trying again.');
      }

      const message = err instanceof Error ? err.message : 'Failed to send verification email';
      throw new Error(message);
    }
  };

  const reloadUser = async (): Promise<boolean> => {
    const currentUser = auth.currentUser;
    if (!currentUser) return false;

    try {
      // Force token refresh to get latest emailVerified from Firebase servers
      await currentUser.getIdToken(true);
      await currentUser.reload();
      const freshUser = auth.currentUser;
      if (freshUser) {
        setUser(freshUser);
        setIsEmailVerified(freshUser.emailVerified);
        return freshUser.emailVerified;
      }
      return false;
    } catch {
      return false;
    }
  };

  const clearError = () => setError(null);
  const clearMessage = () => {
    setMessage(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        message,
        isEmailVerified,
        login,
        register,
        logout,
        resetPassword,
        clearError,
        clearMessage,
        resendVerification,
        reloadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
