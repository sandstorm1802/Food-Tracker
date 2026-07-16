// Minimal service worker — required by Android/Chrome for "Add to Home Screen"
// to install as a standalone app rather than a plain bookmark.
// Deliberately does no caching: this app's data comes live from Firestore,
// and caching HTML/JS here would risk serving stale versions after updates.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", () => {
  // Intentionally no-op: let every request go straight to the network.
});
