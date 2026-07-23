// Field Log — app logic
// Waits for firebase-config.js to have set window.firebaseReady before touching auth/db.

const MEAL_TYPES = [
  { id: "breakfast", label: "Breakfast", icon: "☕" },
  { id: "lunch", label: "Lunch", icon: "🥪" },
  { id: "dinner", label: "Dinner", icon: "🍽" },
  { id: "snack", label: "Snack", icon: "🍪" },
  { id: "drink", label: "Drink", icon: "🍹" },
];

let currentUser = null;
let entries = [];
let dailyTarget = null;
let query = "";
let mealFilter = null;
let selectedMeal = "breakfast";
let unsubEntries = null;
let unsubTarget = null;

const $ = (id) => document.getElementById(id);

function mealMeta(id) {
  return MEAL_TYPES.find((m) => m.id === id) || MEAL_TYPES[3];
}

function guessMeal() {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

function dateKey(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLabel(key) {
  const today = dateKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = dateKey(y);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toLocalDateValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Auth ----------

function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();
    const iv = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(iv);
        resolve();
      }
    }, 100);
  });
}

async function initAuth() {
  await waitForFirebase();

  window.auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      $("login-screen").classList.add("hidden");
      $("app-screen").classList.remove("hidden");
      attachListeners(user.uid);
    } else {
      $("app-screen").classList.add("hidden");
      $("login-screen").classList.remove("hidden");
      if (unsubEntries) unsubEntries();
      if (unsubTarget) unsubTarget();
      entries = [];
    }
  });

  let signupMode = false;
  $("signup-toggle").addEventListener("click", () => {
    signupMode = !signupMode;
    $("signup-toggle").textContent = signupMode
      ? "Already have an account? Sign in"
      : "First time? Create an account";
    $("login-form").querySelector("button[type=submit]").textContent = signupMode ? "Create account" : "Sign in";
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    $("login-error").textContent = "";
    try {
      if (signupMode) {
        await window.auth.createUserWithEmailAndPassword(email, password);
      } else {
        await window.auth.signInWithEmailAndPassword(email, password);
      }
    } catch (err) {
      $("login-error").textContent = err.message;
    }
  });

  $("logout-btn").addEventListener("click", () => window.auth.signOut());
}

// ---------- Firestore ----------

function attachListeners(uid) {
  const entriesRef = window.db.collection("users").doc(uid).collection("entries").orderBy("timestamp", "desc");
  unsubEntries = entriesRef.onSnapshot((snap) => {
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => console.error("entries listener error:", err));

  const targetRef = window.db.collection("users").doc(uid).collection("meta").doc("target");
  unsubTarget = targetRef.onSnapshot((doc) => {
    dailyTarget = doc.exists ? doc.data().value : null;
    render();
  }, (err) => console.error("target listener error:", err));
}

async function addEntry(entry) {
  const ref = window.db.collection("users").doc(currentUser.uid).collection("entries");
  await ref.add(entry);
}

async function updateEntry(id, entry) {
  const ref = window.db.collection("users").doc(currentUser.uid).collection("entries").doc(id);
  await ref.update(entry);
}

async function deleteEntry(id) {
  await window.db.collection("users").doc(currentUser.uid).collection("entries").doc(id).delete();
}

async function saveTarget(value) {
  const ref = window.db.collection("users").doc(currentUser.uid).collection("meta").doc("target");
  if (value === null) {
    await ref.delete();
  } else {
    await ref.set({ value });
  }
}

// ---------- Rendering ----------

function renderMealFilters() {
  const wrap = $("meal-filters");
  wrap.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "chip" + (mealFilter === null ? " active" : "");
  allChip.textContent = "All";
  allChip.onclick = () => { mealFilter = null; render(); };
  wrap.appendChild(allChip);

  MEAL_TYPES.forEach((m) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (mealFilter === m.id ? " active" : "");
    chip.textContent = `${m.icon} ${m.label}`;
    chip.onclick = () => { mealFilter = mealFilter === m.id ? null : m.id; render(); };
    wrap.appendChild(chip);
  });
}

function renderMealSelect() {
  const wrap = $("meal-select");
  wrap.innerHTML = "";
  MEAL_TYPES.forEach((m) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selectedMeal === m.id ? " active" : "");
    chip.textContent = `${m.icon} ${m.label}`;
    chip.onclick = () => { selectedMeal = m.id; renderMealSelect(); };
    wrap.appendChild(chip);
  });
}

function renderTarget() {
  const wrap = $("target-display");
  wrap.innerHTML = "";
  if (dailyTarget) {
    const span = document.createElement("span");
    span.textContent = `Daily target: ${dailyTarget.toLocaleString()} cal · `;
    const editBtn = document.createElement("button");
    editBtn.textContent = "edit";
    editBtn.onclick = () => openTargetEditor();
    wrap.appendChild(span);
    wrap.appendChild(editBtn);
  } else {
    const btn = document.createElement("button");
    btn.textContent = "Set a daily calorie target";
    btn.onclick = () => openTargetEditor();
    wrap.appendChild(btn);
  }
}

function openTargetEditor() {
  const wrap = $("target-display");
  wrap.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = "e.g. 2000";
  input.value = dailyTarget || "";
  const save = document.createElement("button");
  save.textContent = "Save";
  save.className = "save-btn";
  save.onclick = async () => {
    const v = input.value.trim() ? Number(input.value.trim().replace(/[^0-9]/g, "")) : null;
    await saveTarget(v);
  };
  wrap.appendChild(document.createTextNode("Daily target "));
  wrap.appendChild(input);
  wrap.appendChild(save);
  input.focus();
}

function filteredEntries() {
  return entries.filter((en) => {
    if (mealFilter && en.meal !== mealFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (en.name || "").toLowerCase().includes(q) ||
      (en.location || "").toLowerCase().includes(q) ||
      (en.notes || "").toLowerCase().includes(q)
    );
  });
}

function groupByDay(list) {
  const map = new Map();
  list.forEach((en) => {
    const key = dateKey(new Date(en.timestamp));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(en);
  });
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function render() {
  $("entry-count").textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  renderMealFilters();
  renderTarget();

  const list = $("entry-list");
  list.innerHTML = "";
  const filtered = filteredEntries();

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-state"><p class="font-display">No stamps in the log yet.</p><p class="font-mono">Tap + to log your first meal.</p></div>`;
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state font-mono">Nothing matches that search.</div>`;
    return;
  }

  groupByDay(filtered).forEach(([key, items]) => {
    const group = document.createElement("div");
    group.className = "day-group";

    const head = document.createElement("div");
    head.className = "day-head";
    const label = document.createElement("span");
    label.textContent = dateLabel(key);
    const rule = document.createElement("div");
    rule.className = "rule";
    head.appendChild(label);
    head.appendChild(rule);

    const withCals = items.filter((en) => typeof en.calories === "number");
    if (withCals.length) {
      const total = withCals.reduce((s, en) => s + en.calories, 0);
      const totalSpan = document.createElement("span");
      totalSpan.className = "day-total";
      if (dailyTarget) {
        const diff = dailyTarget - total;
        const under = diff >= 0;
        totalSpan.innerHTML = `${total.toLocaleString()} / ${dailyTarget.toLocaleString()} cal <span class="${under ? "diff-under" : "diff-over"}">(${under ? "−" : "+"}${Math.abs(diff).toLocaleString()})</span>`;
      } else {
        totalSpan.textContent = `${total.toLocaleString()} cal`;
      }
      head.appendChild(totalSpan);
    }

    group.appendChild(head);

    items.forEach((en) => {
      const meta = mealMeta(en.meal);
      const stub = document.createElement("div");
      stub.className = "stub";
      stub.innerHTML = `
        <div class="perf-edge"></div>
        <div class="stub-body">
          <div class="stub-top">
            <div><span class="stub-meal-icon">${meta.icon}</span><span class="stub-name font-display">${escapeHtml(en.name)}</span></div>
            <div class="stub-actions">
              <button class="edit-btn" title="Edit">✎</button>
              <button class="delete-btn" title="Delete">🗑</button>
            </div>
          </div>
          <div class="stub-meta font-mono">
            <span>${timeLabel(en.timestamp)}</span>
            ${en.location ? `<span>📍 ${escapeHtml(en.location)}</span>` : ""}
            ${typeof en.calories === "number" ? `<span>${en.calories} cal</span>` : ""}
            ${en.portion ? `<span>${escapeHtml(en.portion)}</span>` : ""}
          </div>
          ${en.notes ? `<div class="stub-notes">${escapeHtml(en.notes)}</div>` : ""}
        </div>
      `;
      stub.querySelector(".delete-btn").onclick = () => {
        if (confirm(`Delete "${en.name}"? This can't be undone.`)) {
          deleteEntry(en.id);
        }
      };
      stub.querySelector(".edit-btn").onclick = () => openForm(en);
      group.appendChild(stub);
    });

    list.appendChild(group);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- Export ----------

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv() {
  if (!entries.length) {
    alert("No entries to export yet.");
    return;
  }
  const sorted = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const headers = ["Date", "Time", "Meal", "Food", "Portion", "Calories", "Location", "Notes"];
  const rows = sorted.map((en) => {
    const d = new Date(en.timestamp);
    return [
      dateKey(d),
      timeLabel(en.timestamp),
      mealMeta(en.meal).label,
      en.name || "",
      en.portion || "",
      typeof en.calories === "number" ? en.calories : "",
      en.location || "",
      en.notes || "",
    ].map(csvEscape).join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `field-log-export-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function initExport() {
  $("export-btn").addEventListener("click", exportCsv);
}

// ---------- Form wiring ----------

let editingId = null;

function openForm(entryToEdit) {
  editingId = entryToEdit ? entryToEdit.id : null;
  const submitBtn = $("add-form").querySelector("button[type=submit]");
  const eyebrow = $("add-form").querySelector(".eyebrow");

  if (entryToEdit) {
    eyebrow.textContent = "Edit entry";
    submitBtn.textContent = "Save changes";
    selectedMeal = entryToEdit.meal;
    $("field-name").value = entryToEdit.name || "";
    const d = new Date(entryToEdit.timestamp);
    $("field-date").value = toLocalDateValue(d);
    $("field-time").value = toLocalTimeValue(d);
    $("field-location").value = entryToEdit.location || "";
    $("field-calories").value = typeof entryToEdit.calories === "number" ? entryToEdit.calories : "";
    $("field-portion").value = entryToEdit.portion || "";
    $("field-notes").value = entryToEdit.notes || "";
  } else {
    eyebrow.textContent = "New entry";
    submitBtn.textContent = "Log it";
    selectedMeal = guessMeal();
    $("add-form").reset();
    const now = new Date();
    $("field-date").value = toLocalDateValue(now);
    $("field-time").value = toLocalTimeValue(now);
  }

  renderMealSelect();
  $("add-form-wrap").classList.remove("hidden");
  $("add-btn").classList.add("hidden");
  $("field-name").focus();
}

function initForm() {
  $("add-btn").addEventListener("click", () => openForm(null));

  $("close-form").addEventListener("click", closeForm);

  $("gps-btn").addEventListener("click", useCurrentLocation);

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("field-name").value.trim();
    if (!name) return;
    const submitBtn = e.target.querySelector("button[type=submit]");
    const wasEditing = !!editingId;
    submitBtn.disabled = true;
    submitBtn.textContent = wasEditing ? "Saving…" : "Stamping…";

    const caloriesRaw = $("field-calories").value.trim();
    const dateRaw = $("field-date").value;
    const timeRaw = $("field-time").value.trim();

    if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeRaw)) {
      alert("Time must be in 24-hour HH:MM format, e.g. 06:46 or 18:46.");
      submitBtn.disabled = false;
      submitBtn.textContent = wasEditing ? "Save changes" : "Log it";
      return;
    }

    const [hh, mm] = timeRaw.split(":").map(Number);
    let timestamp;
    if (dateRaw) {
      const [y, mo, da] = dateRaw.split("-").map(Number);
      timestamp = new Date(y, mo - 1, da, hh, mm).toISOString();
    } else {
      const now = new Date();
      now.setHours(hh, mm, 0, 0);
      timestamp = now.toISOString();
    }

    const entry = {
      name,
      meal: selectedMeal,
      location: $("field-location").value.trim(),
      notes: $("field-notes").value.trim(),
      portion: $("field-portion").value.trim(),
      calories: caloriesRaw ? Number(caloriesRaw.replace(/[^0-9]/g, "")) : null,
      timestamp,
    };

    try {
      if (wasEditing) {
        await updateEntry(editingId, entry);
      } else {
        await addEntry(entry);
      }
      $("add-form").reset();
      closeForm();
    } catch (err) {
      alert("Couldn't save entry: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = wasEditing ? "Save changes" : "Log it";
    }
  });

  $("field-calories").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });

  $("field-time").addEventListener("input", (e) => {
    let digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
    if (digits.length >= 3) {
      digits = digits.slice(0, 2) + ":" + digits.slice(2);
    }
    e.target.value = digits;
  });
}

function closeForm() {
  editingId = null;
  $("add-form-wrap").classList.add("hidden");
  $("add-btn").classList.remove("hidden");
}

async function tryGooglePlaces(lat, lng) {
  if (typeof GOOGLE_PLACES_API_KEY === "undefined" || !GOOGLE_PLACES_API_KEY || GOOGLE_PLACES_API_KEY.startsWith("YOUR_")) {
    debugLog("Google Places: not configured, skipping", "err");
    return null;
  }
  try {
    debugLog("Google Places: sending request…");
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        maxResultCount: 1,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 75.0 },
        },
      }),
    });
    debugLog(`Google Places: HTTP ${res.status}`, res.ok ? "ok" : "err");
    if (!res.ok) {
      const errBody = await res.text();
      debugLog(`Google Places error body: ${errBody.slice(0, 300)}`, "err");
      return null;
    }
    const data = await res.json();
    const place = data.places && data.places[0];
    if (!place) {
      debugLog("Google Places: 0 results within 75m", "err");
      return null;
    }
    const name = place.displayName && place.displayName.text;
    if (!name) {
      debugLog("Google Places: result had no name", "err");
      return null;
    }
    debugLog(`Google Places: found "${name}"`, "ok");
    const addressParts = (place.formattedAddress || "").split(",").map((s) => s.trim());
    const cityGuess = addressParts.length >= 3 ? addressParts[addressParts.length - 3] : null;
    return cityGuess ? `${name}, ${cityGuess}` : name;
  } catch (err) {
    debugLog(`Google Places: threw error — ${err.message}`, "err");
    return null;
  }
}

function debugLog() {
  // Debugging complete — logging disabled.
}

function clearDebugLog() {
  // Debugging complete — logging disabled.
}

function useCurrentLocation() {
  const btn = $("gps-btn");
  clearDebugLog();
  debugLog("Tapped GPS button.");

  if (!navigator.geolocation) {
    debugLog("navigator.geolocation is not available in this browser.", "err");
    alert("This browser doesn't support location lookup.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "⏳";
  debugLog("Requesting position from device…");

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      debugLog(`Got position: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} — accuracy ±${Math.round(accuracy)}m`, accuracy > 100 ? "err" : "ok");

      const googleResult = await tryGooglePlaces(latitude, longitude);
      if (googleResult) {
        $("field-location").value = googleResult;
        debugLog(`Using Google Places result: "${googleResult}"`, "ok");
        btn.disabled = false;
        btn.textContent = "📍";
        return;
      }

      debugLog("Falling back to OpenStreetMap/Nominatim…");
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1&namedetails=1`
        );
        debugLog(`Nominatim: HTTP ${res.status}`);
        const data = await res.json();
        const a = data.address || {};
        const businessName = data.name || (data.namedetails && data.namedetails.name) || null;
        const place = a.neighbourhood || a.suburb || a.village || a.town || a.city || a.county || null;
        const region = a.state || a.country || null;

        let label;
        if (businessName) {
          label = place || region ? `${businessName}, ${place || region}` : businessName;
          debugLog(`Nominatim: found business name "${businessName}"`, "ok");
        } else if (place && region) {
          label = `${place}, ${region}`;
          debugLog(`Nominatim: no business name, using "${label}"`, "err");
        } else {
          label = place || region || data.display_name;
          debugLog(`Nominatim: minimal match, using "${label}"`, "err");
        }
        $("field-location").value = label || `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      } catch (err) {
        debugLog(`Nominatim: threw error — ${err.message}`, "err");
        $("field-location").value = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
      } finally {
        btn.disabled = false;
        btn.textContent = "📍";
      }
    },
    (err) => {
      debugLog(`Geolocation error: code ${err.code} — ${err.message}`, "err");
      btn.disabled = false;
      btn.textContent = "📍";
      if (err.code === err.PERMISSION_DENIED) {
        alert("Location permission was denied. You can enable it in your browser/phone settings, or just type a location manually.");
      } else {
        alert("Couldn't get your location: " + err.message);
      }
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function initSearch() {
  $("search-input").addEventListener("input", (e) => {
    query = e.target.value;
    render();
  });
}

// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initForm();
  initSearch();
  initExport();
});
