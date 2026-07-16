# Field Log — setup

Same pattern as your recipe app: GitHub Pages hosts the static site, Firebase Auth + Firestore handle login and sync.

## 1. Create the Firebase project (skip if reusing the recipe app's project)

You *can* reuse the same Firebase project as the recipe app — just add a new top-level
collection path (`users/{uid}/entries`, `users/{uid}/meta`) so the data doesn't collide
with the recipe app's data. Simpler to manage than a second project, unless you'd rather
keep them fully separate.

1. [Firebase Console](https://console.firebase.google.com/) → Add project (or reuse existing)
2. Build → Authentication → Get started → enable **Email/Password**
3. Build → Firestore Database → Create database → start in **production mode**
4. Project settings → General → "Your apps" → add a **Web app** → copy the config object

## 2. Fill in `firebase-config.js`

Paste the config values from step 1 into `firebaseConfig` in `firebase-config.js`. The
`apiKey` is fine to commit — it's public by design, not a secret. Security comes from the
Firestore rules below, not from hiding this file.

## 3. Deploy the Firestore rules

Firebase Console → Firestore Database → Rules → paste in the contents of `firestore.rules`
→ Publish.

This restricts all reads/writes to `users/{uid}/...` where `{uid}` matches the signed-in
user's ID — same "if logged in as me, allow read/write" shape as the recipe app.

## 4. Create your account

Once deployed (or running locally), open the site, tap "First time? Create an account",
and sign up with an email/password. That's the only account you'll ever use — there's no
multi-user logic in here.

## 5. Push to GitHub Pages

```
git init
git add .
git commit -m "Field Log"
git branch -M main
git remote add origin https://github.com/YOURNAME/field-log.git
git push -u origin main
```

Then: repo → Settings → Pages → Deploy from branch → `main` / `root`.

Your app will be live at `https://yourname.github.io/field-log/`.

## Cache busting

Every time you edit `styles.css` or `app.js`, bump the `?v=1` query string in
`index.html` to `?v=2`, etc. — otherwise GitHub Pages/Safari may keep serving the old
cached version.

## What's different from the recipe app

- No roles/permissions — every document lives under your own UID, full stop
- Offline persistence is enabled in `firebase-config.js` (`enablePersistence`), so
  logging a meal with spotty wifi still saves locally and syncs once you're back online
- Data model: `users/{uid}/entries/{entryId}` for each logged meal, and a single
  `users/{uid}/meta/target` document for your daily calorie target
