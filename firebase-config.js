// Firebase initialization.
// The apiKey below is safe to expose publicly — Firebase API keys identify
// your project, they don't grant access. Access is controlled by the
// Firestore security rules (see firestore.rules) and Firebase Auth.
//
// Get these values from: Firebase Console -> Project Settings -> General
// -> "Your apps" -> Web app -> SDK setup and configuration.

window.firebaseReady = false;

const firebaseConfig = {
  apiKey: "AIzaSyASRcYbHon6f6-n4WkMuNi9ylyn_gXpmUU",
  authDomain: "food-tracker-59707.firebaseapp.com",
  projectId: "food-tracker-59707",
  storageBucket: "food-tracker-59707.firebasestorage.app",
  messagingSenderId: "185020737561",
  appId: "1:185020737561:web:1ef0e750b7fe36421aa288",
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
