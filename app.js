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
let unsubWeights = null;
let unsubWeightGoal = null;
let weights = []; // [{ id, date: "YYYY-MM-DD", lbs }]
let weightGoal = { low: 225, high: 230 }; // default from the MOVE goal; editable

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
      if (unsubWeights) unsubWeights();
      if (unsubWeightGoal) unsubWeightGoal();
      entries = [];
      weights = [];
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
    const raw = doc.exists ? doc.data().value : null;
    if (raw && typeof raw === "object") {
      dailyTarget = raw;
    } else if (typeof raw === "number") {
      // Legacy format: a bare calorie number. Migrate in memory only;
      // saveTarget() will persist the new shape next time targets are edited.
      dailyTarget = { calories: raw, protein: null, fiber: null };
    } else {
      dailyTarget = null;
    }
    render();
  }, (err) => console.error("target listener error:", err));

  const userDoc = window.db.collection("users").doc(uid);
  unsubWeights = userDoc.collection("weights").orderBy("date", "asc").onSnapshot((snap) => {
    weights = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderWeight();
  }, (err) => console.error("weights listener error:", err));

  unsubWeightGoal = userDoc.collection("meta").doc("weightGoal").onSnapshot((doc) => {
    if (doc.exists && doc.data().low) weightGoal = { low: doc.data().low, high: doc.data().high || doc.data().low };
    renderWeight();
  }, (err) => console.error("weight goal listener error:", err));
}

async function saveWeight(date, lbs) {
  // One weigh-in per day: the date is the doc id, so re-entering a day overwrites it.
  await window.db.collection("users").doc(currentUser.uid).collection("weights").doc(date)
    .set({ date, lbs, timestamp: new Date().toISOString() });
}

async function deleteWeight(id) {
  await window.db.collection("users").doc(currentUser.uid).collection("weights").doc(id).delete();
}

async function saveWeightGoal(low, high) {
  await window.db.collection("users").doc(currentUser.uid).collection("meta").doc("weightGoal").set({ low, high });
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
  // value is now { calories, protein, fiber } (any of which may be null),
  // or null to clear all targets entirely.
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

let targetEditorOpen = false;

function renderTarget() {
  if (targetEditorOpen) return; // don't wipe inputs mid-edit when a snapshot arrives
  const wrap = $("target-display");
  wrap.innerHTML = "";
  const hasAny = dailyTarget && (dailyTarget.calories || dailyTarget.protein || dailyTarget.fiber);
  if (hasAny) {
    const editBtn = document.createElement("button");
    editBtn.textContent = "edit targets";
    editBtn.onclick = () => openTargetEditor();
    wrap.appendChild(editBtn);
  } else {
    const btn = document.createElement("button");
    btn.textContent = "Set daily targets";
    btn.onclick = () => openTargetEditor();
    wrap.appendChild(btn);
  }
}

function openTargetEditor() {
  targetEditorOpen = true;
  const wrap = $("target-display");
  wrap.innerHTML = "";

  const calInput = document.createElement("input");
  calInput.type = "text";
  calInput.inputMode = "numeric";
  calInput.placeholder = "Calories, e.g. 2000";
  calInput.value = (dailyTarget && dailyTarget.calories) || "";

  const proteinInput = document.createElement("input");
  proteinInput.type = "text";
  proteinInput.inputMode = "numeric";
  proteinInput.placeholder = "Protein (g)";
  proteinInput.value = (dailyTarget && dailyTarget.protein) || 90;

  const fiberInput = document.createElement("input");
  fiberInput.type = "text";
  fiberInput.inputMode = "numeric";
  fiberInput.placeholder = "Fiber (g)";
  fiberInput.value = (dailyTarget && dailyTarget.fiber) || 30;

  [calInput, proteinInput, fiberInput].forEach((inp) => {
    inp.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, "");
    });
  });

  const save = document.createElement("button");
  save.textContent = "Save";
  save.className = "save-btn";
  save.onclick = async () => {
    const toNum = (inp) => (inp.value.trim() ? Number(inp.value.trim().replace(/[^0-9]/g, "")) : null);
    const calories = toNum(calInput);
    const protein = toNum(proteinInput);
    const fiber = toNum(fiberInput);
    const v = (calories || protein || fiber) ? { calories, protein, fiber } : null;
    targetEditorOpen = false;
    await saveTarget(v);
    render();
  };

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "cancel";
  cancel.onclick = () => { targetEditorOpen = false; render(); };

  const label = (text, inp) => {
    const l = document.createElement("label");
    l.className = "target-field";
    const s = document.createElement("span");
    s.textContent = text;
    l.appendChild(s);
    l.appendChild(inp);
    return l;
  };

  const fields = document.createElement("div");
  fields.className = "target-fields";
  fields.appendChild(label("Calories", calInput));
  fields.appendChild(label("Protein g", proteinInput));
  fields.appendChild(label("Fiber g", fiberInput));
  wrap.appendChild(fields);
  const actions = document.createElement("div");
  actions.className = "target-actions";
  actions.appendChild(save);
  actions.appendChild(cancel);
  wrap.appendChild(actions);
  calInput.focus();
}

// ---------- Today summary ----------

function sumField(items, field) {
  const withField = items.filter((en) => typeof en[field] === "number");
  if (!withField.length) return null;
  return withField.reduce((s, en) => s + en[field], 0);
}

function todaysEntries() {
  const today = dateKey(new Date());
  return entries.filter((en) => dateKey(new Date(en.timestamp)) === today);
}

function renderToday() {
  const items = todaysEntries();
  const s = streakInfo();
  let streakText = "";
  if (s.current > 0) {
    streakText = s.loggedToday
      ? `🔥 ${s.current}-day streak`
      : `🔥 ${s.current} days · log today to keep it`;
    if (s.best > s.current) streakText += ` · best ${s.best}`;
  } else if (s.best > 0) {
    streakText = `best streak ${s.best} days`;
  }
  $("today-count").textContent = streakText || (items.length ? `${items.length} logged` : "nothing logged yet");

  const wrap = $("today-bars");
  wrap.innerHTML = "";
  const rows = [
    { key: "calories", label: "Calories", unit: "", lowerIsBetter: true },
    { key: "protein", label: "Protein", unit: "g", lowerIsBetter: false },
    { key: "fiber", label: "Fiber", unit: "g", lowerIsBetter: false },
  ];
  rows.forEach((r) => {
    const total = sumField(items, r.key) || 0;
    const target = dailyTarget && dailyTarget[r.key] ? dailyTarget[r.key] : null;
    const row = document.createElement("div");
    row.className = "bar-row font-mono";
    let pct = target ? Math.min(100, Math.round((total / target) * 100)) : 0;
    let state = "";
    if (target) {
      if (r.lowerIsBetter && total > target) state = "over";
      else if (!r.lowerIsBetter && total >= target) state = "hit";
    }
    let detail;
    if (target) {
      const left = target - total;
      if (r.lowerIsBetter) {
        detail = left >= 0 ? `${left.toLocaleString()} left` : `${Math.abs(left).toLocaleString()} over`;
      } else {
        detail = left > 0 ? `${left.toLocaleString()}${r.unit} to go` : "goal hit ✓";
      }
    } else {
      detail = "";
    }
    row.innerHTML = `
      <div class="bar-top">
        <span class="bar-label">${r.label}</span>
        <span class="bar-num">${total.toLocaleString()}${r.unit}${target ? ` / ${target.toLocaleString()}${r.unit}` : ""}</span>
      </div>
      ${target ? `<div class="bar"><div class="bar-fill ${state}" style="width:${pct}%"></div></div>` : ""}
      ${detail ? `<div class="bar-detail ${state}">${detail}</div>` : ""}
    `;
    wrap.appendChild(row);
  });
}

// ---------- Streak ----------

function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

// Current streak = consecutive days with at least one entry, ending today
// (or yesterday, if today hasn't been logged yet — it's still alive until midnight).
function streakInfo() {
  const days = new Set(entries.map((en) => dateKey(new Date(en.timestamp))));
  const today = dateKey(new Date());
  const loggedToday = days.has(today);
  let cursor = loggedToday ? today : shiftKey(today, -1);
  let current = 0;
  while (days.has(cursor)) { current++; cursor = shiftKey(cursor, -1); }

  let best = 0;
  days.forEach((k) => {
    if (days.has(shiftKey(k, -1))) return; // only start counting at the beginning of a run
    let len = 0, c = k;
    while (days.has(c)) { len++; c = shiftKey(c, 1); }
    best = Math.max(best, len);
  });
  return { current, best, loggedToday };
}

// ---------- Weight ----------

function daysBetween(a, b) {
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

// Smoothed trend so one salty dinner or water-weight swing doesn't look like a setback.
// Exponential moving average, weighted by the gap between weigh-ins (~10% per day).
function weightTrend(list) {
  let t = null, prev = null;
  return list.map((w) => {
    if (t === null) t = w.lbs;
    else {
      const gap = Math.max(1, daysBetween(prev, w.date));
      const alpha = 1 - Math.pow(0.9, gap);
      t = t + alpha * (w.lbs - t);
    }
    prev = w.date;
    return { ...w, trend: Math.round(t * 10) / 10 };
  });
}

function fmtLbs(n) {
  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

function shortDate(key) {
  return new Date(key + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderWeight() {
  if (!$("weight-card")) return;
  const summary = $("weight-summary");
  const chart = $("weight-chart");
  const data = weightTrend(weights);

  // Goal line
  const goalWrap = $("weight-goal");
  if (!weightGoalEditorOpen) {
    goalWrap.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = `Goal ${weightGoal.low}${weightGoal.high !== weightGoal.low ? "–" + weightGoal.high : ""} lb · `;
    const btn = document.createElement("button");
    btn.textContent = "edit";
    btn.onclick = openWeightGoalEditor;
    goalWrap.appendChild(span);
    goalWrap.appendChild(btn);
  }

  // History list
  const hist = $("weight-history-list");
  hist.innerHTML = "";
  [...weights].reverse().slice(0, 30).forEach((w) => {
    const row = document.createElement("div");
    row.className = "hist-row font-mono";
    row.innerHTML = `<span>${shortDate(w.date)}</span><span>${fmtLbs(w.lbs)} lb</span><button class="delete-btn" title="Delete">🗑</button>`;
    row.querySelector("button").onclick = () => {
      if (confirm(`Delete weigh-in from ${shortDate(w.date)}?`)) deleteWeight(w.id);
    };
    hist.appendChild(row);
  });
  $("weight-history").classList.toggle("hidden", weights.length === 0);

  if (!data.length) {
    summary.innerHTML = `<div class="weight-empty font-mono">Log a weigh-in to start your trend line. Once or twice a week, same time of day, works best.</div>`;
    chart.innerHTML = "";
    return;
  }

  const first = data[0];
  const last = data[data.length - 1];
  const change = last.trend - first.lbs;
  const toGoal = last.trend - weightGoal.high;
  const changeTxt = data.length > 1
    ? `${change <= 0 ? "−" : "+"}${fmtLbs(Math.abs(change))} since ${shortDate(first.date)}`
    : `first weigh-in ${shortDate(first.date)}`;
  const goalTxt = toGoal > 0 ? `${fmtLbs(toGoal)} to goal` : "in goal range ✓";
  summary.innerHTML = `
    <div class="weight-big font-display">${fmtLbs(last.trend)}<span class="weight-unit"> lb</span></div>
    <div class="weight-sub font-mono">
      <span class="${data.length > 1 && change <= 0 ? "good" : ""}">${changeTxt}</span> · <span>${goalTxt}</span>
    </div>
    <div class="weight-note font-mono">Trend weight · last weigh-in ${fmtLbs(last.lbs)} lb on ${shortDate(last.date)}</div>
  `;

  chart.innerHTML = data.length > 1 ? weightChartSvg(data) : "";
  if (data.length > 1) wireWeightChart(data);
}

// Single-series line chart: raw weigh-ins as small muted dots, smoothed trend as the line,
// goal range as a faint band. No legend needed for one series; the band is labeled directly.
function weightChartSvg(data) {
  const W = 340, H = 140, padL = 30, padR = 10, padT = 10, padB = 20;
  const start = data[0].date, end = data[data.length - 1].date;
  const span = Math.max(1, daysBetween(start, end));
  const vals = data.flatMap((d) => [d.lbs, d.trend]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Pull the goal band into view only if it's reasonably close; otherwise the chart flattens.
  if (weightGoal.high >= lo - 15) lo = Math.min(lo, weightGoal.low);
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const x = (k) => padL + (daysBetween(start, k) / span) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  // ~4 gridlines at round numbers
  const step = [1, 2, 5, 10, 20].find((s) => (hi - lo) / s <= 4) || 25;
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="wc-grid"/>
             <text x="${padL - 6}" y="${y(v) + 3}" class="wc-axis" text-anchor="end">${v}</text>`;
  }

  let band = "";
  const bTop = Math.max(padT, y(weightGoal.high)), bBot = Math.min(H - padB, y(weightGoal.low));
  if (bBot > padT && bTop < H - padB) {
    band = `<rect x="${padL}" y="${bTop}" width="${W - padL - padR}" height="${Math.max(2, bBot - bTop)}" class="wc-band"/>
            <text x="${W - padR - 4}" y="${bTop - 3 < padT + 8 ? bBot + 10 : bTop - 3}" class="wc-band-label" text-anchor="end">goal</text>`;
  }

  const path = data.map((d, i) => `${i ? "L" : "M"}${x(d.date).toFixed(1)},${y(d.trend).toFixed(1)}`).join(" ");
  const dots = data.map((d) => `<circle cx="${x(d.date)}" cy="${y(d.lbs)}" r="3.5" class="wc-dot"/>`).join("");

  const xLabels = `<text x="${padL}" y="${H - 4}" class="wc-axis">${shortDate(start)}</text>
                   <text x="${W - padR}" y="${H - 4}" class="wc-axis" text-anchor="end">${shortDate(end)}</text>`;

  return `
    <svg viewBox="0 0 ${W} ${H}" class="wc-svg" role="img" aria-label="Weight trend from ${fmtLbs(data[0].trend)} to ${fmtLbs(data[data.length - 1].trend)} pounds">
      ${grid}${band}
      <path d="${path}" class="wc-line"/>
      ${dots}
      ${xLabels}
      <line class="wc-cross hidden" y1="${padT}" y2="${H - padB}"/>
      <circle class="wc-hover hidden" r="5"/>
      <rect class="wc-hit" x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>
    </svg>
    <div class="wc-tip font-mono hidden"></div>
  `;
}

function wireWeightChart(data) {
  const wrap = $("weight-chart");
  const svg = wrap.querySelector("svg");
  const tip = wrap.querySelector(".wc-tip");
  const cross = svg.querySelector(".wc-cross");
  const dot = svg.querySelector(".wc-hover");
  const circles = svg.querySelectorAll(".wc-dot");
  const pts = Array.from(circles).map((c) => ({ x: +c.getAttribute("cx") }));
  const pathPts = svg.querySelector(".wc-line").getAttribute("d").split(/[ML ]+/).filter(Boolean).map((p) => p.split(",").map(Number));

  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(p.x - vx) < Math.abs(pts[best].x - vx)) best = i; });
    const d = data[best];
    const [px, py] = pathPts[best];
    cross.setAttribute("x1", px); cross.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    cross.classList.remove("hidden"); dot.classList.remove("hidden");
    tip.innerHTML = `<b>${shortDate(d.date)}</b><br>Weighed ${fmtLbs(d.lbs)} lb<br>Trend ${fmtLbs(d.trend)} lb`;
    tip.classList.remove("hidden");
    const left = (px / svg.viewBox.baseVal.width) * r.width;
    tip.style.left = Math.min(Math.max(left, 60), r.width - 60) + "px";
  };
  const hide = () => { cross.classList.add("hidden"); dot.classList.add("hidden"); tip.classList.add("hidden"); };
  const hit = svg.querySelector(".wc-hit");
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerdown", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);
}

let weightGoalEditorOpen = false;

function openWeightGoalEditor() {
  weightGoalEditorOpen = true;
  const wrap = $("weight-goal");
  wrap.innerHTML = "";
  const mk = (val, ph) => {
    const i = document.createElement("input");
    i.type = "text"; i.inputMode = "decimal"; i.placeholder = ph; i.value = val;
    return i;
  };
  const low = mk(weightGoal.low, "low"), high = mk(weightGoal.high, "high");
  const save = document.createElement("button");
  save.className = "save-btn"; save.textContent = "Save";
  save.onclick = async () => {
    const l = parseFloat(low.value), h = parseFloat(high.value) || l;
    if (!l) return;
    weightGoalEditorOpen = false;
    await saveWeightGoal(Math.min(l, h), Math.max(l, h));
    renderWeight();
  };
  const cancel = document.createElement("button");
  cancel.textContent = "cancel";
  cancel.onclick = () => { weightGoalEditorOpen = false; renderWeight(); };
  wrap.append("Goal ", low, " – ", high, " lb ", save, " ", cancel);
  low.focus();
}

function initWeight() {
  $("weighin-btn").addEventListener("click", () => {
    const form = $("weighin-form");
    const opening = form.classList.contains("hidden");
    form.classList.toggle("hidden", !opening);
    if (opening) {
      $("weighin-date").value = toLocalDateValue(new Date());
      $("weighin-lbs").value = "";
      $("weighin-lbs").focus();
    }
  });
  $("weighin-lbs").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9.]/g, "");
  });
  $("weighin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lbs = parseFloat($("weighin-lbs").value);
    const date = $("weighin-date").value || toLocalDateValue(new Date());
    if (!lbs || lbs < 50 || lbs > 700) {
      alert("Enter your weight in pounds, e.g. 263.4");
      return;
    }
    try {
      await saveWeight(date, Math.round(lbs * 10) / 10);
      $("weighin-form").classList.add("hidden");
      toast(`Weigh-in saved: ${fmtLbs(lbs)} lb`);
    } catch (err) {
      alert("Couldn't save weigh-in: " + err.message);
    }
  });
}

// ---------- Food history (for quick-add + autocomplete) ----------

// One record per distinct food name: the most recent entry plus how often it's been logged.
function foodIndex() {
  const map = new Map();
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000; // frequency over the last 60 days
  // entries arrive newest-first from Firestore
  entries.forEach((en) => {
    const name = (en.name || "").trim();
    if (!name) return;
    const k = name.toLowerCase();
    const t = new Date(en.timestamp).getTime();
    if (!map.has(k)) map.set(k, { latest: en, count: 0, recentCount: 0, lastTime: t });
    const rec = map.get(k);
    rec.count += 1;
    if (t >= cutoff) rec.recentCount += 1;
  });
  return Array.from(map.values());
}

function quickPicks(limit = 10) {
  const now = Date.now();
  return foodIndex()
    .map((r) => {
      const daysAgo = (now - r.lastTime) / 86400000;
      // frequent + recent float to the top
      const score = r.recentCount * 2 + Math.max(0, 14 - daysAgo) / 2;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function nutritionSummary(en) {
  const bits = [];
  if (typeof en.calories === "number") bits.push(`${en.calories} cal`);
  if (typeof en.protein === "number") bits.push(`${en.protein}g P`);
  if (typeof en.fiber === "number") bits.push(`${en.fiber}g F`);
  if (en.portion) bits.push(en.portion);
  return bits.join(" · ");
}

function renderQuick() {
  const picks = quickPicks();
  const wrap = $("quick-wrap");
  const list = $("quick-list");
  list.innerHTML = "";
  if (!picks.length) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  picks.forEach((p) => {
    const en = p.latest;
    const btn = document.createElement("button");
    btn.className = "quick-chip";
    btn.innerHTML = `
      <span class="quick-name">${mealMeta(en.meal).icon} ${escapeHtml(en.name)}</span>
      <span class="quick-sub font-mono">${escapeHtml(nutritionSummary(en)) || "&nbsp;"}</span>
    `;
    btn.onclick = () => openForm(null, en);
    list.appendChild(btn);
  });
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
  renderToday();
  renderQuick();

  const list = $("entry-list");
  list.innerHTML = "";
  const filtered = filteredEntries();

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-state"><p class="font-display">No stamps in the log yet.</p><p class="font-mono">Tap “Log something” to add your first meal.</p></div>`;
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

    const totalCals = sumField(items, "calories");
    const totalProtein = sumField(items, "protein");
    const totalFiber = sumField(items, "fiber");

    const targetFor = (key) => dailyTarget && dailyTarget[key] ? dailyTarget[key] : null;

    const totalPart = (total, target, unit, moreIsBetter = false) => {
      if (total === null) return null;
      if (target) {
        const diff = target - total;
        const under = diff >= 0;
        const cls = moreIsBetter
          ? (diff <= 0 ? "diff-under" : "diff-neutral")
          : (under ? "diff-under" : "diff-over");
        return `${total.toLocaleString()} / ${target.toLocaleString()}${unit} <span class="${cls}">(${under ? "−" : "+"}${Math.abs(diff).toLocaleString()})</span>`;
      }
      return `${total.toLocaleString()}${unit}`;
    };

    const parts = [
      totalPart(totalCals, targetFor("calories"), " cal"),
      totalPart(totalProtein, targetFor("protein"), "g protein", true),
      totalPart(totalFiber, targetFor("fiber"), "g fiber", true),
    ].filter(Boolean);

    if (parts.length) {
      const totalSpan = document.createElement("span");
      totalSpan.className = "day-total";
      totalSpan.innerHTML = parts.join(" · ");
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
              <button class="again-btn" title="Log again">↻</button>
              <button class="edit-btn" title="Edit">✎</button>
              <button class="delete-btn" title="Delete">🗑</button>
            </div>
          </div>
          <div class="stub-meta font-mono">
            <span>${timeLabel(en.timestamp)}</span>
            ${en.location ? `<span>📍 ${escapeHtml(en.location)}</span>` : ""}
            ${typeof en.calories === "number" ? `<span>${en.calories} cal</span>` : ""}
            ${typeof en.protein === "number" ? `<span>${en.protein}g protein</span>` : ""}
            ${typeof en.fiber === "number" ? `<span>${en.fiber}g fiber</span>` : ""}
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
      stub.querySelector(".again-btn").onclick = () => openForm(null, en);
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
  const headers = ["Date", "Time", "Meal", "Food", "Portion", "Calories", "Protein (g)", "Fiber (g)", "Location", "Notes"];
  const rows = sorted.map((en) => {
    const d = new Date(en.timestamp);
    return [
      dateKey(d),
      timeLabel(en.timestamp),
      mealMeta(en.meal).label,
      en.name || "",
      en.portion || "",
      typeof en.calories === "number" ? en.calories : "",
      typeof en.protein === "number" ? en.protein : "",
      typeof en.fiber === "number" ? en.fiber : "",
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

// Copy food details (not time/date) from a past entry into the form.
function fillFoodFields(src, { includeContext = false } = {}) {
  const num = (v) => (typeof v === "number" ? v : "");
  $("field-name").value = src.name || "";
  $("field-calories").value = num(src.calories);
  $("field-protein").value = num(src.protein);
  $("field-fiber").value = num(src.fiber);
  $("field-portion").value = src.portion || "";
  if (includeContext) {
    $("field-location").value = src.location || "";
    $("field-notes").value = src.notes || "";
  }
}

function updateWhenLabel() {
  const dateRaw = $("field-date").value;
  const timeRaw = $("field-time").value;
  const now = new Date();
  const isToday = dateRaw === toLocalDateValue(now);
  const nowTime = toLocalTimeValue(now);
  let label;
  if (isToday && timeRaw === nowTime) label = "Now";
  else if (dateRaw) label = `${dateLabel(dateRaw)} · ${timeRaw || "--:--"}`;
  else label = timeRaw || "Now";
  $("when-label").textContent = label;
}

let whenTouched = false;

function setWhenOpen(open) {
  $("when-fields").classList.toggle("hidden", !open);
}

// openForm(entryToEdit)        → edit an existing entry
// openForm(null, template)     → new entry pre-filled from a past one ("log again")
// openForm(null)               → blank new entry
function openForm(entryToEdit, template) {
  editingId = entryToEdit ? entryToEdit.id : null;
  const submitBtn = $("add-form").querySelector("button[type=submit]");
  const eyebrow = $("add-form").querySelector(".eyebrow");
  $("add-form").reset();
  hideSuggestions();

  if (entryToEdit) {
    eyebrow.textContent = "Edit entry";
    submitBtn.textContent = "Save changes";
    selectedMeal = entryToEdit.meal;
    fillFoodFields(entryToEdit, { includeContext: true });
    const d = new Date(entryToEdit.timestamp);
    $("field-date").value = toLocalDateValue(d);
    $("field-time").value = toLocalTimeValue(d);
  } else {
    eyebrow.textContent = template ? "Log again" : "New entry";
    submitBtn.textContent = "Log it";
    selectedMeal = guessMeal();
    const now = new Date();
    $("field-date").value = toLocalDateValue(now);
    $("field-time").value = toLocalTimeValue(now);
    if (template) {
      fillFoodFields(template);
      // Drinks stay drinks and snacks stay snacks; meals follow the clock.
      if (template.meal === "drink" || template.meal === "snack") selectedMeal = template.meal;
    }
  }

  whenTouched = !!entryToEdit;
  const hasContext = $("field-location").value || $("field-notes").value;
  $("more-details").open = !!hasContext;
  setWhenOpen(false);
  updateWhenLabel();
  renderMealSelect();
  $("add-form-wrap").classList.remove("hidden");
  document.body.classList.add("sheet-open");
  $("add-btn").classList.add("hidden");
  // Don't pop the keyboard when the form is already filled — one tap on "Log it" is all that's needed.
  if (!entryToEdit && !template) $("field-name").focus();
}

// ---------- Autocomplete ----------

let suggestionItems = [];

function hideSuggestions() {
  $("suggest-list").classList.add("hidden");
  $("suggest-list").innerHTML = "";
  suggestionItems = [];
}

function showSuggestions() {
  const q = $("field-name").value.trim().toLowerCase();
  if (!q || editingId) return hideSuggestions();
  const index = foodIndex();
  const matches = index
    .filter((r) => r.latest.name.toLowerCase().includes(q) && r.latest.name.toLowerCase() !== q)
    .sort((a, b) => {
      const aStarts = a.latest.name.toLowerCase().startsWith(q) ? 1 : 0;
      const bStarts = b.latest.name.toLowerCase().startsWith(q) ? 1 : 0;
      return bStarts - aStarts || b.count - a.count;
    })
    .slice(0, 5);
  const wrap = $("suggest-list");
  wrap.innerHTML = "";
  suggestionItems = matches;
  if (!matches.length) return hideSuggestions();
  matches.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggest-item";
    btn.innerHTML = `<span class="suggest-name">${escapeHtml(m.latest.name)}</span><span class="suggest-sub font-mono">${escapeHtml(nutritionSummary(m.latest))}</span>`;
    // mousedown fires before the input's blur, so the tap registers
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.onclick = () => {
      fillFoodFields(m.latest);
      if (m.latest.meal === "drink" || m.latest.meal === "snack") {
        selectedMeal = m.latest.meal;
        renderMealSelect();
      }
      hideSuggestions();
      $("field-name").blur();
    };
    wrap.appendChild(btn);
  });
  wrap.classList.remove("hidden");
}

// ---------- Toast ----------

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

function initForm() {
  $("add-btn").addEventListener("click", () => openForm(null));
  $("add-btn-main").addEventListener("click", () => openForm(null));

  $("close-form").addEventListener("click", closeForm);
  $("sheet-backdrop").addEventListener("click", closeForm);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("add-form-wrap").classList.contains("hidden")) closeForm();
  });

  $("when-toggle").addEventListener("click", () => {
    const open = $("when-fields").classList.contains("hidden");
    setWhenOpen(open);
    if (open) $("field-time").focus();
  });
  $("field-date").addEventListener("change", () => { whenTouched = true; updateWhenLabel(); });
  $("field-time").addEventListener("input", () => { whenTouched = true; updateWhenLabel(); });

  $("field-name").addEventListener("input", showSuggestions);
  $("field-name").addEventListener("focus", showSuggestions);
  $("field-name").addEventListener("blur", () => setTimeout(hideSuggestions, 150));

  // Show the floating + only once the big "Log something" button has scrolled out of view.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => {
      document.body.classList.toggle("main-add-visible", e.isIntersecting);
    });
    io.observe($("add-btn-main"));
  }

  $("gps-btn").addEventListener("click", useCurrentLocation);

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("field-name").value.trim();
    if (!name) return;
    const submitBtn = e.target.querySelector("button[type=submit]");
    const wasEditing = !!editingId;
    submitBtn.disabled = true;
    submitBtn.textContent = wasEditing ? "Saving…" : "Stamping…";

    // If the time was never changed, stamp it at the moment of saving, not when the form opened.
    if (!wasEditing && !whenTouched) {
      const now = new Date();
      $("field-date").value = toLocalDateValue(now);
      $("field-time").value = toLocalTimeValue(now);
    }

    const caloriesRaw = $("field-calories").value.trim();
    const proteinRaw = $("field-protein").value.trim();
    const fiberRaw = $("field-fiber").value.trim();
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
      protein: proteinRaw ? Number(proteinRaw.replace(/[^0-9]/g, "")) : null,
      fiber: fiberRaw ? Number(fiberRaw.replace(/[^0-9]/g, "")) : null,
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
      toast(wasEditing ? "Saved" : `Logged: ${name}`);
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

  $("field-protein").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });

  $("field-fiber").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "");
  });

  $("field-time").addEventListener("input", (e) => {
    let digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
    if (digits.length >= 3) {
      digits = digits.slice(0, 2) + ":" + digits.slice(2);
    }
    e.target.value = digits;
    updateWhenLabel();
  });
}

function closeForm() {
  editingId = null;
  hideSuggestions();
  $("add-form-wrap").classList.add("hidden");
  document.body.classList.remove("sheet-open");
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
  $("search-toggle").addEventListener("click", () => {
    const wrap = $("search-wrap");
    const opening = wrap.classList.contains("hidden");
    wrap.classList.toggle("hidden", !opening);
    if (opening) {
      $("search-input").focus();
    } else {
      // closing search clears it so the log isn't silently filtered
      query = "";
      mealFilter = null;
      $("search-input").value = "";
      render();
    }
  });
  $("menu-toggle").addEventListener("click", () => {
    $("menu").classList.toggle("hidden");
  });
}

// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initForm();
  initSearch();
  initExport();
  initWeight();
});
