/**
 * NigerSwap - Firebase Configuration & Authentication Initialization
 * Uses Firebase Web SDK v12.19.0 (Modular)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  updateProfile,
  updatePassword,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

// NigerSwap Firebase Project Configuration
const firebaseConfig = {
  apiKey: "AIzaSyA_-8YhICPUqxOx8O3tJqgNnKdNlLmeeRI",
  authDomain: "nigerswap.firebaseapp.com",
  projectId: "nigerswap",
  storageBucket: "nigerswap.firebasestorage.app",
  messagingSenderId: "898687380339",
  appId: "1:898687380339:web:0ad6a846df002d6c3ef306",
  measurementId: "G-449HYBSTHM"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication & Services
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const storage = getStorage(app);
const appCheckSiteKey = window.NIGERSWAP_APPCHECK_SITE_KEY || '';
if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}

function authStateReady(authInstance) {
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(authInstance, user => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Ensure local persistence across browser restarts
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn("Could not set auth persistence to local:", err);
});

// Initialize Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export {
  app,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  auth,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  RecaptchaVerifier,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  authStateReady,
  updateProfile,
  updatePassword,
  deleteUser,
  functions,
  httpsCallable,
  storage,
  storageRef,
  uploadBytes,
  getDownloadURL
};
