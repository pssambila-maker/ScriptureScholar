
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDSokSRQwbVCXu6KlPRyvg0POqeFcYMKHM",
  authDomain: "scripturescholarcslm.firebaseapp.com",
  projectId: "scripturescholarcslm",
  storageBucket: "scripturescholarcslm.firebasestorage.app",
  messagingSenderId: "609105140544",
  appId: "1:609105140544:web:4051c77f3333ac7a0b38a5"
};

// Check if config is actually set
export const isFirebaseConfigured = 
  firebaseConfig.apiKey !== "REPLACE_WITH_YOUR_FIREBASE_API_KEY" && 
  firebaseConfig.projectId !== "REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID";

let app;
if (isFirebaseConfigured) {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
}

export const auth = isFirebaseConfigured ? getAuth(app) : null;
export const db = isFirebaseConfigured ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
