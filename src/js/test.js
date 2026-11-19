/* ============================================================
   CVOC – Testmodus (Oberfläche)
   Fragen, Bewertung und Notenrechnung stecken in test-gen.js.

   Ablauf: Einrichten -> alle Fragen beantworten (ohne Korrektur,
   vor- und zurückblättern erlaubt) -> abgeben -> Note, Statistik,
   Verlauf und Fehler.
   ============================================================ */

const SETTINGS_KEY = "cvoc.test.settings";
const HISTORY_KEY = "cvoc.test.history";
const QUIZ_KEY = "cvoc.test.quiz";
const HISTORY_LIMIT = 50;

const TYPE_LABELS = {
  write: "Schreiben",
  mc: "Multiple Choice",
  tf: "Richtig oder falsch",
};

const DEFAULTS = {
  types: { write: true, mc: true, tf: true },
  direction: "term",
  count: 20,
  check: { removeParentheses: true, checkCapitalized: false, bothAnswers: false },
  fullAt: 100,
  rounding: 0.5,
  timerHidden: false,
};

const $ = (id) => document.getElementById(id);

let settings = structuredCloneSafe(DEFAULTS);
let quiz = null; // { name, cards: [{question, answer}] }
let questions = [];
let responses = [];
let current = 0;
let startedAt = 0;
let timerHandle = null;
let advanceTimer = null;
let running = false;
let resultState = null; // { duration, date, before, overrides:Set, credit }
let creditQueue = Promise.resolve(); // Anrechnen nacheinander ausführen

// Werte aus den Lernmodus-Einstellungen (gleiche Standardwerte wie lernen.js)
const LEARN_SETTINGS_KEY = "cvoc.lernen.settings";
const LEARN_DEFAULTS = { minAmount: 2, maxAmount: 8, rightStep: 1, wrongStep: 1 };

// ----------------- Speicher -----------------
function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Speichern fehlgeschlagen:", e);
  }
}

function loadSettings() {
  const saved = readJson(localStorage, SETTINGS_KEY, {});
  settings = Object.assign(structuredCloneSafe(DEFAULTS), saved);
  settings.types = Object.assign({}, DEFAULTS.types, saved.types || {});
  settings.check = Object.assign({}, DEFAULTS.check, saved.check || {});
}

function saveSettings() {
  writeJson(localStorage, SETTINGS_KEY, settings);
}

function loadQuiz() {
  // Von der Startseite kommt das Set über "currentQuiz". Für Neu laden
  // und weitere Tests bleibt eine Kopie in der Sitzung.
  const fromHome = readJson(localStorage, "currentQuiz", null);
  if (fromHome && Array.isArray(fromHome.cards)) {
    localStorage.removeItem("currentQuiz");
    writeJson(sessionStorage, QUIZ_KEY, { name: fromHome.name, cards: fromHome.cards });
    return { name: fromHome.name, cards: fromHome.cards };
  }
  return readJson(sessionStorage, QUIZ_KEY, null);
}

function historyFor(name) {
  const all = readJson(localStorage, HISTORY_KEY, {});
  return Array.isArray(all[name]) ? all[name] : [];
}

// Ersetzt den Eintrag mit demselben Datum (nachträgliche Korrektur).
function replaceHistory(name, entry) {
  const all = readJson(localStorage, HISTORY_KEY, {});
  const list = Array.isArray(all[name]) ? all[name] : [];
  const i = list.findIndex((h) => h.date === entry.date);
  if (i === -1) list.push(entry);
  else list[i] = entry;
  all[name] = list;
  writeJson(localStorage, HISTORY_KEY, all);
}

function addHistory(name, entry) {
  const all = readJson(localStorage, HISTORY_KEY, {});
  const list = Array.isArray(all[name]) ? all[name] : [];
  list.push(entry);
  while (list.length > HISTORY_LIMIT) list.shift();
  all[name] = list;
  writeJson(localStorage, HISTORY_KEY, all);
}

function setName() {
  return (quiz && quiz.name) || "Ohne Namen";
}

// ----------------- Hilfen -----------------
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatGrade(g) {
  if (g == null || isNaN(g)) return "–";
  const rounded = Math.round(g * 100) / 100;
  return String(rounded);
}

function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function wordCount() {
  return CvocTest.maxQuestions(quiz.cards, ["write"]);
}

function formatPlusMinus(v) {
  return v > 0 && v < 0.1 ? v.toFixed(2) : v.toFixed(1);
}

function scale() {
  return { fullAt: settings.fullAt, rounding: settings.rounding };
}

function activeTypes() {
  return Object.keys(TYPE_LABELS).filter((t) => settings.types[t]);
}

function show(screen) {
  for (const id of ["setupScreen", "runScreen", "resultScreen"]) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

// ----------------- Einrichten -----------------
function renderSetup() {
  show("setupScreen");
  running = false;
  $("setupSetName").textContent = `${setName()} · ${quiz.cards.length} Karten`;

  document.querySelectorAll("[data-type]").forEach((t) => {
    t.classList.toggle("active", !!settings.types[t.dataset.type]);
  });
  document.querySelectorAll("[data-check]").forEach((t) => {
    t.classList.toggle("active", !!settings.check[t.dataset.check]);
  });
  document.querySelectorAll("#directionSeg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.dir === settings.direction);
  });
  $("fullAtRange").value = settings.fullAt;
  $("fullAtValue").textContent = `${settings.fullAt} %`;
  $("roundingSelect").value = String(settings.rounding);

  updateCountRange();
  renderHistory($("setupHistory"), historyFor(setName()), null);
  $("historyBlock").hidden = historyFor(setName()).length === 0;
}

function updateCountRange() {
  const max = Math.max(1, CvocTest.maxQuestions(quiz.cards, activeTypes()));
  const range = $("countRange");
  range.max = max;
  settings.count = Math.min(Math.max(1, settings.count), max);
  range.value = settings.count;
  updateCountLabel();
}

function updateCountLabel() {
  const n = settings.count;
  $("countValue").textContent = n === 1 ? "1 Punkt" : `${n} Punkte`;
  // Vorschau der Genauigkeit bei einem typischen Ergebnis von 75 %.
  // Der Test fragt zuerst jedes Wort einmal ab, bevor sich eines wiederholt.
  const words = wordCount();
  const r = CvocTest.gradeRange(Math.round(n * 0.75), n, scale(), {
    covered: Math.min(n, words),
    population: words,
  });
  const perCard = activeTypes().length > 1 ? " Jede Karte kommt pro Frageart höchstens einmal." : "";
  $("countHint").textContent =
    (r.complete
      ? `Bei ${n} Punkten kommen alle ${words} Wörter dran – die Note ist dann exakt (bei gleichem Aufbau und Notenspiegel).`
      : `Bei ${n} von ${words} Wörtern ist die Note etwa auf ± ${formatPlusMinus(r.plusMinus)} genau – je mehr Wörter, desto genauer.`) +
    perCard;
}

function wireSetup() {
  document.querySelectorAll("[data-type]").forEach((t) => {
    t.addEventListener("click", () => {
      const type = t.dataset.type;
      if (settings.types[type] && activeTypes().length === 1) return; // mindestens eine
      settings.types[type] = !settings.types[type];
      t.classList.toggle("active", settings.types[type]);
      updateCountRange();
      saveSettings();
    });
  });
  document.querySelectorAll("[data-check]").forEach((t) => {
    t.addEventListener("click", () => {
      const key = t.dataset.check;
      settings.check[key] = !settings.check[key];
      t.classList.toggle("active", settings.check[key]);
      saveSettings();
    });
  });
  document.querySelectorAll("#directionSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      settings.direction = b.dataset.dir;
      document.querySelectorAll("#directionSeg button").forEach((x) => x.classList.toggle("active", x === b));
      saveSettings();
    });
  });
  $("countRange").addEventListener("input", (e) => {
    settings.count = parseInt(e.target.value, 10);
    updateCountLabel();
    saveSettings();
  });
  $("fullAtRange").addEventListener("input", (e) => {
    settings.fullAt = parseInt(e.target.value, 10);
    $("fullAtValue").textContent = `${settings.fullAt} %`;
    updateCountLabel();
    saveSettings();
  });
  $("roundingSelect").addEventListener("change", (e) => {
    settings.rounding = parseFloat(e.target.value);
    saveSettings();
  });
  $("startBtn").addEventListener("click", startTest);
}

// ----------------- Test -----------------
function startTest() {
  questions = CvocTest.buildTest(quiz.cards, {
    types: activeTypes(),
    count: settings.count,
    direction: settings.direction,
  });
  if (!questions.length) {
    customAlertSimple({ title: "Keine Fragen", icon: "⚠️", message: "Aus diesem Set lassen sich keine Fragen bauen." });
    return;
  }
  responses = new Array(questions.length).fill(null);
  current = 0;
  running = true;
  startedAt = Date.now();
  show("runScreen");
  renderDots();
  renderQuestion();
  startTimer();
}

function startTimer() {
  clearInterval(timerHandle);
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const t = $("timer");
  if (settings.timerHidden) {
    t.textContent = "Zeit einblenden";
    t.classList.add("hidden-time");
    t.title = "Die Zeit läuft weiter – klicken zum Einblenden";
  } else {
    t.textContent = formatTime(Date.now() - startedAt);
    t.classList.remove("hidden-time");
    t.title = "Klicken zum Ausblenden";
  }
}

function renderQuestion() {
  clearTimeout(advanceTimer);
  const q = questions[current];
  const n = questions.length;

  $("runCounter").textContent = `Frage ${current + 1} / ${n}`;
  $("runProgress").style.width = `${(responses.filter((r) => r !== null && r !== "").length / n) * 100}%`;
  $("typeChip").textContent = TYPE_LABELS[q.type];

  $("writeArea").hidden = q.type !== "write";
  $("mcArea").hidden = q.type !== "mc";
  $("tfArea").hidden = q.type !== "tf";
  $("tfPair").hidden = q.type !== "tf";

  if (q.type === "tf") {
    $("promptText").textContent = q.shown.prompt;
    $("tfSolution").textContent = q.shown.solution;
    document.querySelectorAll("[data-tf]").forEach((b) => {
      b.classList.toggle("selected", responses[current] === (b.dataset.tf === "true"));
    });
  } else {
    $("promptText").textContent = q.prompt;
  }

  if (q.type === "write") {
    const input = $("writeInput");
    input.value = responses[current] || "";
    setTimeout(() => input.focus(), 0);
  }

  if (q.type === "mc") {
    const area = $("mcArea");
    area.innerHTML = "";
    q.options.forEach((opt, i) => {
      const b = el("button", "choice-btn" + (responses[current] === i ? " selected" : ""));
      b.append(el("span", "key", String(i + 1)), el("span", null, opt));
      b.addEventListener("click", () => choose(i));
      area.appendChild(b);
    });
  }

  $("prevBtn").disabled = current === 0;
  $("nextBtn").textContent = current === n - 1 ? "Abgeben" : "Weiter →";
  updateDots();
}

function choose(value) {
  responses[current] = value;
  renderQuestion();
  // Kurz zeigen, was gewählt wurde, dann weiter (nicht nach der letzten).
  if (current < questions.length - 1) {
    advanceTimer = setTimeout(() => go(1), 280);
  }
}

function go(step) {
  const next = current + step;
  if (next < 0) return;
  if (next >= questions.length) return submit();
  current = next;
  renderQuestion();
}

function jump(i) {
  current = i;
  renderQuestion();
}

function renderDots() {
  const box = $("dots");
  box.innerHTML = "";
  questions.forEach((_, i) => {
    const d = el("button", "dot", String(i + 1));
    d.addEventListener("click", () => jump(i));
    box.appendChild(d);
  });
}

function updateDots() {
  const dots = $("dots").children;
  for (let i = 0; i < dots.length; i++) {
    const r = responses[i];
    dots[i].classList.toggle("answered", r !== null && r !== "");
    dots[i].classList.toggle("current", i === current);
  }
}

async function submit() {
  const open = responses.filter((r) => r === null || (typeof r === "string" && !r.trim())).length;
  if (open) {
    const ok = await customAlert({
      title: "Test abgeben?",
      icon: "📝",
      message:
        open === 1
          ? "Eine Frage ist noch unbeantwortet und zählt 0 Punkte."
          : `${open} Fragen sind noch unbeantwortet und zählen 0 Punkte.`,
      confirmText: "Abgeben",
      cancelText: "Weiter ausfüllen",
    });
    if (!ok) return;
  }
  finish();
}

// ----------------- Ergebnis -----------------
function finish() {
  clearInterval(timerHandle);
  clearTimeout(advanceTimer);
  running = false;

  resultState = {
    duration: Date.now() - startedAt,
    date: new Date().toISOString(),
    before: historyFor(setName()),
    overrides: new Set(),
    saved: false,
    credit: { status: "checking", snapshot: null, stats: null },
  };
  show("resultScreen");
  renderResults();
  checkCreditable();
}

// Rechnet alles aus und zeigt es an. Wird nach jedem "Als richtig
// werten" erneut aufgerufen; der gespeicherte Eintrag wird ersetzt.
function renderResults() {
  const { duration, before, overrides } = resultState;
  const result = CvocTest.summarize(questions, responses, settings.check, [...overrides]);
  const g = CvocTest.grade(result.points, result.max, scale());
  const covered = new Set(questions.map((q) => q.cardIndex)).size;
  const range = CvocTest.gradeRange(result.points, result.max, scale(), {
    covered,
    population: wordCount(),
  });

  const entry = {
    date: resultState.date,
    points: result.points,
    max: result.max,
    grade: g,
    exact: range.exact,
    duration,
    types: activeTypes(),
    byType: result.byType,
    overridden: result.overridden,
  };
  if (resultState.saved) replaceHistory(setName(), entry);
  else addHistory(setName(), entry);
  resultState.saved = true;

  const gv = $("gradeValue");
  gv.textContent = formatGrade(g);
  gv.classList.toggle("good", g >= 5);
  gv.classList.toggle("bad", g < 4);
  const pct = Math.round((result.points / result.max) * 100);
  $("gradePoints").textContent =
    `${result.points} von ${result.max} Punkten · ${pct} %` +
    (result.overridden ? ` · davon ${result.overridden} selbst gewertet` : "");

  // Verbesserung gegenüber dem letzten Test
  const delta = $("gradeDelta");
  delta.className = "grade-delta";
  if (before.length) {
    const last = before[before.length - 1];
    const lastExact = last.exact != null ? last.exact : last.grade;
    const diff = Math.round((range.exact - lastExact) * 100) / 100;
    if (Math.abs(diff) < 0.05) {
      delta.classList.add("same");
      delta.textContent = `Gleich wie beim letzten Test (${formatGrade(last.grade)})`;
    } else if (diff > 0) {
      delta.classList.add("up");
      delta.textContent = `▲ ${diff.toFixed(2)} besser als beim letzten Test (${formatGrade(last.grade)})`;
    } else {
      delta.classList.add("down");
      delta.textContent = `▼ ${Math.abs(diff).toFixed(2)} schlechter als beim letzten Test (${formatGrade(last.grade)})`;
    }
  } else {
    delta.textContent = "";
  }

  // Genauigkeit
  if (range.complete) {
    $("accValue").textContent = "exakt";
    $("accSub").textContent =
      `Alle ${wordCount()} Wörter wurden abgefragt. Bei gleichem Aufbau und Notenspiegel ` +
      `wäre das genau deine Note (ungerundet ${range.exact.toFixed(2)}).`;
  } else {
    $("accValue").textContent = `± ${formatPlusMinus(range.plusMinus)}`;
    $("accSub").textContent =
      `${covered} von ${wordCount()} Wörtern abgefragt. Deine Note liegt mit 95 % Sicherheit ` +
      `zwischen ${range.low.toFixed(2)} und ${range.high.toFixed(2)} (ungerundet ${range.exact.toFixed(2)}). ` +
      `Je mehr Wörter, desto genauer.`;
  }

  // Zeit
  $("timeValue").textContent = formatTime(duration);
  $("timeSub").textContent = `Ø ${(duration / 1000 / result.max).toFixed(1)} s pro Frage`;

  renderTypeBars(result.byType);
  const all = historyFor(setName());
  $("resultHistoryBlock").hidden = all.length < 2;
  renderHistory($("resultHistory"), all, entry);
  renderMistakes(result.mistakes);

  // Schon angerechnet? Dann mit der neuen Wertung nachführen.
  if (resultState.credit.status === "applied") queueCredit(applyCredit);
}

function renderTypeBars(byType) {
  const box = $("typeBars");
  box.innerHTML = "";
  for (const type of Object.keys(TYPE_LABELS)) {
    const s = byType[type];
    if (!s) continue;
    const wrap = el("div");
    const head = el("div", "type-bar-head");
    head.append(el("span", null, TYPE_LABELS[type]), el("span", null, `${s.right} / ${s.total}`));
    const track = el("div", "type-bar-track");
    const fill = el("div", "type-bar-fill");
    fill.style.width = `${(s.right / s.total) * 100}%`;
    track.appendChild(fill);
    wrap.append(head, track);
    box.appendChild(wrap);
  }
}

function renderHistory(box, list, latest) {
  box.innerHTML = "";
  if (!list.length) return;
  const recent = list.slice(-12);
  const bars = el("div", "history-bars");
  recent.forEach((h, i) => {
    const bar = el("div", "history-bar" + (i === recent.length - 1 ? " latest" : ""));
    const g = h.grade;
    const fill = el("div", "history-bar-fill");
    fill.style.height = `${Math.max(4, ((g - 1) / 5) * 88)}%`;
    const d = new Date(h.date);
    bar.title = `${d.toLocaleDateString("de-CH")} · ${h.points}/${h.max} Punkte · Note ${formatGrade(g)}`;
    bar.append(el("div", "history-bar-value", formatGrade(g)), fill);
    bars.appendChild(bar);
  });
  box.appendChild(bars);

  // Trend: Durchschnitt der ersten und letzten Hälfte vergleichen.
  const note = el("div", "history-note");
  const avg = (arr) => arr.reduce((a, h) => a + (h.exact != null ? h.exact : h.grade), 0) / arr.length;
  if (list.length >= 2) {
    const half = Math.floor(list.length / 2);
    const early = avg(list.slice(0, half));
    const late = avg(list.slice(half));
    const best = Math.max(...list.map((h) => h.grade));
    const diff = late - early;
    const trend =
      Math.abs(diff) < 0.1
        ? "Deine Noten sind stabil."
        : diff > 0
          ? `Du hast dich im Schnitt um ${diff.toFixed(1)} verbessert.`
          : `Im Schnitt ${Math.abs(diff).toFixed(1)} schwächer als am Anfang.`;
    note.textContent = `${list.length} Tests · Bestnote ${formatGrade(best)} · ${trend}`;
  } else {
    note.textContent = latest ? "" : `1 Test · Note ${formatGrade(list[0].grade)}`;
  }
  if (note.textContent) box.appendChild(note);
}

function line(label, value, cls) {
  const row = el("div", "mistake-line");
  row.append(el("span", "k", label), el("span", cls, value));
  return row;
}

function renderMistakes(mistakes) {
  const box = $("mistakes");
  box.innerHTML = "";
  const open = mistakes.filter((m) => !m.overridden).length;
  $("mistakeTitle").textContent = open ? `Fehler (${open})` : "Fehler";
  if (!mistakes.length) {
    box.appendChild(el("div", "no-mistakes", "Keine Fehler – alles richtig! 🎉"));
    return;
  }

  for (const m of mistakes) {
    const q = m.question;
    const r = m.response;
    const unanswered = r === null || r === "";
    const card = el("div", "mistake" + (m.overridden ? " overridden" : ""));
    const head = el("div", "mistake-head");
    head.append(
      el("span", null, `Frage ${m.index + 1}`),
      el("span", null, m.overridden ? `${TYPE_LABELS[q.type]} · selbst als richtig gewertet` : TYPE_LABELS[q.type])
    );
    card.appendChild(head);

    if (q.type === "tf") {
      card.appendChild(el("div", "mistake-prompt", `${q.shown.prompt}  =  ${q.shown.solution}`));
      card.appendChild(
        unanswered
          ? line("Deine Antwort", "keine Antwort", "empty")
          : line("Deine Antwort", r ? "Richtig" : "Falsch", "wrong")
      );
      if (q.isTrue) {
        card.appendChild(line("Lösung", "Richtig – das Paar stimmt.", "right"));
      } else {
        const correctText = q.fakeSide === "prompt" ? q.original : q.original;
        card.appendChild(line("Lösung", `Falsch – richtig heisst es „${correctText}“`, "right"));
        if (q.fakeDetail) card.appendChild(line("Der Fehler", q.fakeDetail, ""));
      }
    } else {
      card.appendChild(el("div", "mistake-prompt", q.prompt));
      let given = "keine Antwort";
      if (!unanswered) given = q.type === "mc" ? q.options[r] : String(r);
      card.appendChild(line("Deine Antwort", given, unanswered ? "empty" : "wrong"));
      card.appendChild(line("Richtig", q.solution, "right"));
    }

    // Selbst werten: z. B. nur ein Punkt oder Tippfehler vergessen.
    if (!unanswered) {
      const btn = el(
        "button",
        "override-mark" + (m.overridden ? " undo" : ""),
        m.overridden ? "↩︎ Wertung zurücknehmen" : "✓ Als richtig werten"
      );
      btn.addEventListener("click", () => toggleOverride(m.index));
      card.appendChild(btn);
    }
    box.appendChild(card);
  }
}

function toggleOverride(index) {
  if (!resultState) return;
  const o = resultState.overrides;
  if (o.has(index)) o.delete(index);
  else o.add(index);
  // Scrollposition halten, die Liste wird neu aufgebaut.
  const y = window.scrollY;
  renderResults();
  window.scrollTo(0, y);
}

// ----------------- Dem Lernfortschritt anrechnen -----------------
// Jede Antwort zählt wie im Lernmodus: richtig senkt den Stand der Karte
// um "Abzug bei richtig", falsch (oder leer) hebt ihn um "Zuschlag bei
// falsch". Der Stand vor dem Anrechnen wird gemerkt, damit es sich
// rückgängig machen und nach "Als richtig werten" neu rechnen lässt.
function learnCfg() {
  return { ...LEARN_DEFAULTS, ...readJson(localStorage, LEARN_SETTINGS_KEY, {}) };
}

function queueCredit(fn) {
  creditQueue = creditQueue.then(fn).catch((e) => {
    console.error("Fehler beim Anrechnen:", e);
    resultState.credit.status = "error";
    renderCredit();
  });
  return creditQueue;
}

async function loadSavedSet() {
  const res = await CVOC.loadQuizzes();
  const all = (res && res.success && res.quizzes) || [];
  const saved = all.find((q) => q.name === (quiz && quiz.name));
  return { all, saved };
}

// Ordnet jeder Testkarte die Karte im gespeicherten Set zu.
function matchCards(saved) {
  const key = (c) => `${c.question}\u0000${c.answer}`;
  const byKey = new Map();
  saved.cards.forEach((c, i) => {
    if (!byKey.has(key(c))) byKey.set(key(c), i);
  });
  return quiz.cards.map((c, i) => {
    const s = saved.cards[i];
    if (s && key(s) === key(c)) return i;
    return byKey.has(key(c)) ? byKey.get(key(c)) : -1;
  });
}

function setPercent(cards, c) {
  const n = cards.length;
  if (!n) return 0;
  const sum = cards.reduce((a, card) => a + (card.amount === undefined ? 5 : card.amount), 0);
  const worst = c.maxAmount * n;
  const best = c.minAmount * n;
  if (worst === best) return 100;
  return Math.round(((worst - sum) / (worst - best)) * 100);
}

async function checkCreditable() {
  const state = resultState;
  try {
    const { saved } = await loadSavedSet();
    const ok = saved && Array.isArray(saved.cards) && matchCards(saved).some((i) => i !== -1);
    if (state !== resultState) return;
    state.credit.status = ok ? "ask" : "unavailable";
  } catch (e) {
    state.credit.status = "unavailable";
  }
  renderCredit();
}

async function applyCredit() {
  const credit = resultState.credit;
  const c = learnCfg();
  const { all, saved } = await loadSavedSet();
  if (!saved) {
    credit.status = "unavailable";
    return renderCredit();
  }
  const map = matchCards(saved);

  // Immer vom Stand vor dem Anrechnen ausgehen.
  if (!credit.snapshot) {
    credit.snapshot = saved.cards.map((card) => card.amount);
    credit.percentBefore = setPercent(saved.cards, c);
  } else {
    saved.cards.forEach((card, i) => (card.amount = credit.snapshot[i]));
  }

  const result = CvocTest.summarize(questions, responses, settings.check, [...resultState.overrides]);
  const wrong = new Set(result.mistakes.filter((m) => !m.overridden).map((m) => m.index));

  questions.forEach((q, i) => {
    const target = map[q.cardIndex];
    if (target === -1 || target === undefined) return;
    const card = saved.cards[target];
    let amount = card.amount === undefined ? 5 : card.amount;
    amount = Math.min(c.maxAmount, Math.max(c.minAmount, amount));
    amount = wrong.has(i)
      ? Math.min(c.maxAmount, amount + c.wrongStep)
      : Math.max(c.minAmount, amount - c.rightStep);
    card.amount = amount;
  });

  let better = 0;
  let worse = 0;
  saved.cards.forEach((card, i) => {
    const before = credit.snapshot[i] === undefined ? 5 : credit.snapshot[i];
    if (card.amount < before) better++;
    else if (card.amount > before) worse++;
  });
  saved.percent = setPercent(saved.cards, c);

  const res = await CVOC.saveQuizzes(all);
  if (res && res.success === false) throw new Error(res.error || "Speichern fehlgeschlagen");
  credit.status = "applied";
  credit.stats = { better, worse, before: credit.percentBefore, after: saved.percent };
  renderCredit();
}

async function undoCredit() {
  const credit = resultState.credit;
  if (!credit.snapshot) return;
  const { all, saved } = await loadSavedSet();
  if (saved) {
    saved.cards.forEach((card, i) => {
      if (i < credit.snapshot.length) card.amount = credit.snapshot[i];
    });
    saved.percent = setPercent(saved.cards, learnCfg());
    const res = await CVOC.saveQuizzes(all);
    if (res && res.success === false) throw new Error(res.error || "Speichern fehlgeschlagen");
  }
  credit.snapshot = null;
  credit.stats = null;
  credit.status = "ask";
  renderCredit();
}

function creditButton(text, cls, onClick) {
  const b = el("button", cls, text);
  b.addEventListener("click", () => {
    b.disabled = true;
    onClick();
  });
  return b;
}

function renderCredit() {
  const box = $("creditBox");
  const credit = resultState && resultState.credit;
  if (!credit || credit.status === "checking" || credit.status === "unavailable") {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.className = "credit-box " + credit.status;
  const title = $("creditTitle");
  const text = $("creditText");
  const actions = $("creditActions");
  actions.innerHTML = "";
  const c = learnCfg();

  if (credit.status === "ask") {
    title.textContent = "Dem Lernfortschritt anrechnen?";
    text.textContent =
      `Die Antworten zählen dann wie im Lernmodus: richtige Wörter −${c.rightStep}, ` +
      `falsche und leere +${c.wrongStep}. Was du falsch hattest, kommt beim Lernen häufiger dran.`;
    actions.append(
      creditButton("Anrechnen", "credit-btn primary", () => queueCredit(applyCredit)),
      creditButton("Nein danke", "credit-btn", () => {
        credit.status = "declined";
        renderCredit();
      })
    );
  } else if (credit.status === "declined") {
    title.textContent = "Nicht angerechnet";
    text.textContent = "Dein Lernfortschritt bleibt, wie er war.";
    actions.append(creditButton("Doch anrechnen", "credit-btn", () => queueCredit(applyCredit)));
  } else if (credit.status === "applied") {
    const s = credit.stats;
    title.textContent = "✓ Dem Lernfortschritt angerechnet";
    const parts = [];
    if (s.better) parts.push(`${s.better} ${s.better === 1 ? "Wort" : "Wörter"} verbessert`);
    if (s.worse) parts.push(`${s.worse} ${s.worse === 1 ? "Wort" : "Wörter"} verschlechtert`);
    if (!parts.length) parts.push("Keine Karte hat sich verändert");
    text.textContent = `${parts.join(" · ")}. Lernfortschritt ${s.before} % → ${s.after} %.`;
    actions.append(creditButton("↩︎ Rückgängig", "credit-btn", () => queueCredit(undoCredit)));
  } else {
    title.textContent = "Anrechnen fehlgeschlagen";
    text.textContent = "Der Lernfortschritt konnte nicht gespeichert werden.";
    actions.append(creditButton("Nochmals versuchen", "credit-btn", () => queueCredit(applyCredit)));
  }
}

// ----------------- Verdrahtung -----------------
function wireRun() {
  $("prevBtn").addEventListener("click", () => go(-1));
  $("nextBtn").addEventListener("click", () => go(1));
  $("writeInput").addEventListener("input", (e) => {
    responses[current] = e.target.value;
    updateDots();
    $("runProgress").style.width = `${(responses.filter((x) => x !== null && x !== "").length / questions.length) * 100}%`;
  });
  document.querySelectorAll("[data-tf]").forEach((b) => {
    b.addEventListener("click", () => choose(b.dataset.tf === "true"));
  });
  $("timer").addEventListener("click", () => {
    settings.timerHidden = !settings.timerHidden;
    saveSettings();
    updateTimer();
  });

  $("againBtn").addEventListener("click", startTest);
  $("setupBtn").addEventListener("click", renderSetup);

  document.addEventListener("keydown", (e) => {
    if (!running || $("customAlertOverlay").classList.contains("show")) return;
    const q = questions[current];
    const inInput = document.activeElement === $("writeInput");

    if (e.key === "Enter") {
      e.preventDefault();
      go(1);
      return;
    }
    if (inInput) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (q.type === "mc" && /^[1-9]$/.test(e.key)) {
      const i = parseInt(e.key, 10) - 1;
      if (i < q.options.length) choose(i);
    } else if (q.type === "tf") {
      const k = e.key.toLowerCase();
      if (k === "r" || k === "j") choose(true);
      if (k === "f" || k === "n") choose(false);
    }
  });
}

$("backBtn").addEventListener("click", async () => {
  if (running) {
    const ok = await customAlert({
      title: "Test abbrechen?",
      icon: "⚠️",
      message: "Deine Antworten gehen verloren und der Test wird nicht gespeichert.",
      confirmText: "Abbrechen",
      cancelText: "Weitermachen",
    });
    if (!ok) return;
  }
  window.location.href = "home.html";
});

document.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  quiz = loadQuiz();
  if (!quiz || !quiz.cards || quiz.cards.length < 2) {
    await customAlertSimple({
      title: "Kein Lernset",
      icon: "⚠️",
      message: "Bitte zuerst auf der Startseite ein Lernset mit mindestens 2 Karten laden.",
      confirmText: "Zur Startseite",
    });
    window.location.href = "home.html";
    return;
  }
  wireSetup();
  wireRun();
  renderSetup();
});

// ----------------- Custom Alerts -----------------
function customAlert(options) {
  return new Promise((resolve) => {
    const overlay = $("customAlertOverlay");
    $("alertTitle").textContent = options.title || "Achtung";
    $("alertIcon").textContent = options.icon || "⚠️";
    $("alertMessage").textContent = options.message || "";
    const ok = $("alertBtnConfirm");
    const no = $("alertBtnCancel");
    ok.textContent = options.confirmText || "Bestätigen";
    no.textContent = options.cancelText || "Abbrechen";
    no.style.display = "block";
    overlay.classList.add("show");

    const done = (v) => {
      overlay.classList.remove("show");
      ok.removeEventListener("click", onOk);
      no.removeEventListener("click", onNo);
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onOk = () => done(true);
    const onNo = () => done(false);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        done(true);
      }
    };
    ok.addEventListener("click", onOk);
    no.addEventListener("click", onNo);
    document.addEventListener("keydown", onKey, true);
  });
}

function customAlertSimple(options) {
  return new Promise((resolve) => {
    const overlay = $("customAlertOverlay");
    $("alertTitle").textContent = options.title || "Hinweis";
    $("alertIcon").textContent = options.icon || "ℹ️";
    $("alertMessage").textContent = options.message || "";
    const ok = $("alertBtnConfirm");
    const no = $("alertBtnCancel");
    ok.textContent = options.confirmText || "OK";
    no.style.display = "none";
    overlay.classList.add("show");

    const done = () => {
      overlay.classList.remove("show");
      no.style.display = "block";
      ok.removeEventListener("click", done);
      document.removeEventListener("keydown", onKey, true);
      resolve(true);
    };
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        done();
      }
    };
    ok.addEventListener("click", done);
    document.addEventListener("keydown", onKey, true);
  });
}
