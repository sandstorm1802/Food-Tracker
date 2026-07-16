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
  return d.toISOString().slice(0, 10);
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

function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
          </div>
          ${en.notes ? `<div class="stub-notes">${escapeHtml(en.notes)}</div>` : ""}
        </div>
      `;
      stub.querySelector(".delete-btn").onclick = () => deleteEntry(en.id);
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
  const headers = ["Date", "Time", "Meal", "Food", "Calories", "Location", "Notes"];
  const rows = sorted.map((en) => {
    const d = new Date(en.timestamp);
    return [
      dateKey(d),
      timeLabel(en.timestamp),
      mealMeta(en.meal).label,
      en.name || "",
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
    $("field-datetime").value = toLocalDatetimeValue(new Date(entryToEdit.timestamp));
    $("field-location").value = entryToEdit.location || "";
    $("field-calories").value = typeof entryToEdit.calories === "number" ? entryToEdit.calories : "";
    $("field-notes").value = entryToEdit.notes || "";
  } else {
    eyebrow.textContent = "New entry";
    submitBtn.textContent = "Log it";
    selectedMeal = guessMeal();
    $("add-form").reset();
    $("field-datetime").value = toLocalDatetimeValue(new Date());
  }

  renderMealSelect();
  $("add-form-wrap").classList.remove("hidden");
  $("add-btn").classList.add("hidden");
  $("field-name").focus();
}

function initForm() {
  $("add-btn").addEventListener("click", () => openForm(null));

  $("close-form").addEventListener("click", closeForm);

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("field-name").value.trim();
    if (!name) return;
    const submitBtn = e.target.querySelector("button[type=submit]");
    const wasEditing = !!editingId;
    submitBtn.disabled = true;
    submitBtn.textContent = wasEditing ? "Saving…" : "Stamping…";

    const caloriesRaw = $("field-calories").value.trim();
    const dtRaw = $("field-datetime").value;
    const timestamp = dtRaw ? new Date(dtRaw).toISOString() : new Date().toISOString();
    const entry = {
      name,
      meal: selectedMeal,
      location: $("field-location").value.trim(),
      notes: $("field-notes").value.trim(),
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
}

function closeForm() {
  editingId = null;
  $("add-form-wrap").classList.add("hidden");
  $("add-btn").classList.remove("hidden");
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
