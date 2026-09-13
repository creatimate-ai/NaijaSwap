/**
 * NaijaSwap - Firebase Configuration & Authentication Initialization
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
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

// NaijaSwap Firebase Project Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAgzk3CibYYmfRd47b0BQphlzAfCixA_LA",
  authDomain: "naijaswap1.firebaseapp.com",
  projectId: "naijaswap1",
  storageBucket: "naijaswap1.firebasestorage.app",
  messagingSenderId: "881342460016",
  appId: "1:881342460016:web:23fe9c2ed350f3bacd04b5",
  measurementId: "G-Y80K70BTPR"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication & Services
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const appCheckSiteKey = window.NAIJASWAP_APPCHECK_SITE_KEY || '';
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
  httpsCallable
};
