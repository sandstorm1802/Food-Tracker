// Firebase initialization.
// The apiKey below is safe to expose publicly — Firebase API keys identify
// your project, they don't grant access. Access is controlled by the
// Firestore security rules (see firestore.rules) and Firebase Auth.
//
// Get these values from: Firebase Console -> Project Settings -> General
// -> "Your apps" -> Web app -> SDK setup and configuration.

window.firebaseReady = false;

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

try {
  firebase.initializeApp(firebaseConfig);
  window.auth = firebase.auth();
  window.db = firebase.firestore();

  // Optional: offline persistence, handy for spotty wifi at the gym.
  window.db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn("Offline persistence not enabled:", err.code);
  });

  window.firebaseReady = true;
} catch (err) {
  console.error("Firebase failed to initialize:", err);
  window.firebaseReady = false;
}
