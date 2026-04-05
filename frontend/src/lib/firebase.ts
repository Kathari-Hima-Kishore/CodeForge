import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, initializeAuth, browserLocalPersistence } from 'firebase/auth';
import {
  getFirestore,
  Firestore,
} from 'firebase/firestore';

// Firebase configuration - set these in .env.local
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

// Backend URL - dynamically use current hostname for network access
function getBackendUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5001';
  
  const envUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  const backendPort = envUrl ? new URL(envUrl).port || '5001' : '5001';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  
  const portMatch = hostname.match(/-\d+\./);
  let finalHostname = hostname;
  
  if (portMatch) {
    finalHostname = hostname.replace(portMatch[0], `-${backendPort}.`);
    return `${protocol}//${finalHostname}`;
  }
  
  return `${protocol}//${hostname}:${backendPort}`;
}

export const BACKEND_URL = getBackendUrl();
export const getDynamicBackendUrl = getBackendUrl;

// Initialize Firebase only once
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (getApps().length === 0) {
  console.log("🔥 Initializing Firebase app");
  console.log("   Project ID:", firebaseConfig.projectId);
  console.log("   Auth Domain:", firebaseConfig.authDomain);
  console.log("   API Key:", firebaseConfig.apiKey ? "***" : "MISSING");
  
  app = initializeApp(firebaseConfig);
  
  // Persist auth state in browser localStorage so users stay logged in across refreshes
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });

  // Use default Firestore with persistent cache
  db = getFirestore(app);
  
  console.log("✅ Firebase app initialized (persistent auth + persistent Firestore cache)");
} else {
  console.log("🔥 Firebase app already initialized");
  app = getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };
