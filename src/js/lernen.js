
/* ============================================================
   CVOC – Lernmodus
   Bucket-basierter Algorithmus mit gewichtetem Würfeln.

   Kurzfassung des Algorithmus:
   1. Alle noch nicht gelernten Wörter liegen im "Pool".
   2. Aus dem Pool wird ein "Bucket" (aktives Lernfenster) gefüllt.
   3. Gefragt wird immer nur aus dem Bucket – per gewichtetem
      Würfeln: schlecht gekonnte Wörter haben mehr Gewicht.
   4. Kürzlich gefragte Wörter bekommen einen Wahrscheinlichkeits-
      Malus (0 für das direkt vorherige Wort), damit zwischen zwei
      Wiederholungen möglichst `minGap` andere Wörter liegen.
   5. Sobald ein Wort gelernt ist, verlässt es den Bucket und wird
      sofort durch ein neues aus dem Pool ersetzt (fliessender
      Übergang – der Bucket bleibt immer gleich voll).
   ============================================================ */

// ----------------- Einstellungen -----------------
const SETTINGS_KEY = "cvoc.lernen.settings";

const DEFAULT_SETTINGS = {
  // Abfrage
  questionFirst: false, // false = Begriff zeigen / Definition abfragen
  checkCapitalized: false, // Gross-/Kleinschreibung prüfen
  bothAnswers: false, // alle Lösungen verlangen
  removeParentheses: true, // (Klammerinhalte) ignorieren
  autoNext: true, // bei richtig automatisch weiter
  autoNextDelay: 1000, // ms
  shufflePool: false, // Reihenfolge der Wörter mischen

  // Buckets
  bucketSize: 10, // Wörter gleichzeitig im aktiven Fenster
  masteryStreak: 2, // richtige in Folge, damit ein Wort rausfällt

  // Wahrscheinlichkeiten
  weightExponent: 3, // wie stark Fehler die Chance erhöhen
  minGap: 8, // gewünschter Mindestabstand (Wörter dazwischen)
  recencyStrength: 2, // wie hart der Abstand erzwungen wird

  // Bewertung
  minAmount: 2, // bestmöglicher Stand einer Karte
  maxAmount: 8, // schlechtestmöglicher Stand
  rightStep: 1, // Abzug bei richtig
  wrongStep: 1, // Zuschlag bei falsch

  // Sonstiges
  showDebug: false, // Gewicht neben dem Wort anzeigen
};

let cfg = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) cfg = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.error("Einstellungen konnten nicht gelesen werden:", e);
    cfg = { ...DEFAULT_SETTINGS };
  }
  if (cfg.minAmount >= cfg.maxAmount) cfg.maxAmount = cfg.minAmount + 1;
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.error("Einstellungen konnten nicht gespeichert werden:", e);
  }
}

// ----------------- Antwortprüfung -----------------
// Trennzeichen für mehrere Lösungen. Bewusst OHNE Leerzeichen –
// sonst würde "Leonardo da Vinci" in drei Einzellösungen zerfallen.
const SPLIT_RE = /\s*[\/;|,]\s*/;

function removeParentheses(text) {
  return text.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
}

function splitVariants(text) {
  return text
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(text) {
  let t = String(text || "").trim();
  if (!cfg.checkCapitalized) t = t.toLowerCase();
  if (cfg.removeParentheses) t = removeParentheses(t);
  return t.replace(/\s+/g, " ").trim();
}

function correctAnswer(userInput, correct) {
  const answer = normalize(userInput);
  const solution = normalize(correct);

  const correctParts = splitVariants(solution);
  const userParts = splitVariants(answer);

  if (correctParts.length <= 1) return answer === solution;

  if (cfg.bothAnswers) {
    // Alle Lösungen müssen genannt werden – Reihenfolge egal.
    if (userParts.length !== correctParts.length) return false;
    const pool = [...correctParts];
    for (const part of userParts) {
      const idx = pool.indexOf(part);
      if (idx === -1) return false;
      pool.splice(idx, 1);
    }
    return true;
  }

  // Eine passende Lösung reicht.
  return userParts.some((p) => correctParts.includes(p));
}

// ----------------- Zustand -----------------
let questions = [
  { term: "Was ist die Hauptstadt von Frankreich?", answer: "Paris", amount: 5 },
  { term: "Wie viele Kontinente gibt es?", answer: "7", amount: 5 },
  { term: "Was ist das chemische Symbol für Wasser?", answer: "H2O", amount: 5 },
  { term: "Wer malte die Mona Lisa?", answer: "Leonardo da Vinci", amount: 5 },
  { term: "Was ist 5 × 7?", answer: "35", amount: 5 },
];

let savedQuizzes = [];
let currentQuizName = null;

let bucket = []; // Indizes im aktiven Lernfenster
let pool = []; // Indizes, die noch warten
let recent = []; // zuletzt gefragte Indizes (ältestes zuerst)
let currentQuestion = 0;
let finished = false;
let autoNextTimer = null;

// ----------------- DOM -----------------
const termEl = document.getElementById("term");
const answerInput = document.getElementById("answerInput");
const checkBtn = document.getElementById("checkBtn");
const nextBtn = document.getElementById("nextBtn");
const overrideBtn = document.getElementById("overrideBtn");
const feedback = document.getElementById("feedback");
const learnedEl = document.getElementById("learned");
const totalEl = document.getElementById("total");
const bucketInfoEl = document.getElementById("bucketInfo");
const autoNextInfo = document.getElementById("autoNextInfo");
const progressBar = document.getElementById("progressBar");
const finishAnimation = document.getElementById("finishAnimation");

// ----------------- Bucket-Logik -----------------
function isMastered(q) {
  return q.amount <= cfg.minAmount && (q.streak || 0) >= cfg.masteryStreak;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initSession() {
  questions.forEach((q) => {
    if (q.amount === undefined) q.amount = 5;
    q.amount = Math.min(cfg.maxAmount, Math.max(cfg.minAmount, q.amount));
    // Karten, die aus einer früheren Sitzung schon am Ziel sind,
    // gelten weiterhin als gelernt.
    q.streak = q.amount <= cfg.minAmount ? cfg.masteryStreak : 0;
  });

  const order = questions.map((_, i) => i);
  if (cfg.shufflePool) shuffle(order);

  pool = order.filter((i) => !isMastered(questions[i]));
  bucket = [];
  recent = [];
  finished = false;
  refillBucket();
}

// Hält den Bucket auf Sollgrösse: gelernte Wörter raus,
// neue aus dem Pool nach – und bei verkleinerter Bucketgrösse
// wandern die überzähligen (nie das aktuelle Wort) zurück in den Pool.
function refillBucket(protectedIndex = -1) {
  bucket = bucket.filter(
    (i) => !isMastered(questions[i]) || i === protectedIndex
  );

  while (bucket.length > cfg.bucketSize) {
    let removeAt = -1;
    for (let k = bucket.length - 1; k >= 0; k--) {
      if (bucket[k] !== protectedIndex) {
        removeAt = k;
        break;
      }
    }
    if (removeAt === -1) break;
    pool.unshift(bucket.splice(removeAt, 1)[0]);
  }

  while (bucket.length < cfg.bucketSize && pool.length > 0) {
    const next = pool.shift();
    if (!isMastered(questions[next]) && !bucket.includes(next)) {
      bucket.push(next);
    }
  }

  // Endspurt: bleibt nur noch ein Wort übrig, käme es sonst direkt
  // hintereinander dran. Darum werden bereits gelernte Wörter als
  // Auffrischung dazugeholt (sie haben minimales Gewicht und tauchen
  // deshalb nur selten auf).
  if (bucket.length < 2 && pool.length === 0) {
    const fillers = questions
      .map((_, i) => i)
      .filter((i) => !bucket.includes(i) && isMastered(questions[i]))
      .sort((a, b) => questions[b].amount - questions[a].amount);
    while (bucket.length < 2 && fillers.length) bucket.push(fillers.shift());
  }
}

function allLearned() {
  return questions.every(isMastered);
}

// Grundgewicht: je weiter eine Karte vom Ziel entfernt ist,
// desto häufiger kommt sie dran.
function baseWeight(q) {
  const level = Math.max(1, q.amount - cfg.minAmount + 1);
  return Math.pow(level, cfg.weightExponent);
}

// Abstands-Malus: 0 für das direkt zuvor gefragte Wort, danach
// steigt der Faktor bis `minGap` wieder auf 1.
function recencyFactor(idx) {
  const pos = recent.lastIndexOf(idx);
  if (pos === -1) return 1;
  const distance = recent.length - pos; // 1 = zuletzt gefragt
  if (distance > cfg.minGap) return 1;
  if (distance === 1) return 0;
  return Math.pow(distance / (cfg.minGap + 1), cfg.recencyStrength);
}

function weightFor(idx) {
  return baseWeight(questions[idx]) * recencyFactor(idx);
}

function chooseNext() {
  if (allLearned()) return null;
  refillBucket();
  if (bucket.length === 0) return null;
  if (bucket.length === 1) return bucket[0];

  let weights = bucket.map(weightFor);
  let total = weights.reduce((a, b) => a + b, 0);

  // Falls der Abstands-Malus alles auf 0 drückt: ohne Malus würfeln.
  if (total <= 0) {
    weights = bucket.map((i) => baseWeight(questions[i]));
    total = weights.reduce((a, b) => a + b, 0);
  }
  if (total <= 0) {
    weights = bucket.map(() => 1);
    total = bucket.length;
  }

  let roll = Math.random() * total;
  let chosen = bucket[bucket.length - 1];
  for (let i = 0; i < bucket.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      chosen = bucket[i];
      break;
    }
  }
  return chosen;
}

function rememberShown(idx) {
  recent.push(idx);
  const keep = Math.max(cfg.minGap, 1) + 2;
  while (recent.length > keep) recent.shift();
}

// ----------------- Anzeige -----------------
function getDisplayQuestion() {
  const q = questions[currentQuestion];
  return cfg.questionFirst ? q.answer : q.term;
}

function getExpectedAnswer() {
  const q = questions[currentQuestion];
  return cfg.questionFirst ? q.term : q.answer;
}

function displayCurrentQuestion() {
  const q = questions[currentQuestion];
  if (!q) return;
  termEl.textContent = cfg.showDebug
    ? `${getDisplayQuestion()}  ·  w=${Math.round(baseWeight(q))}`
    : getDisplayQuestion();
}

function learnedCount() {
  return questions.filter(isMastered).length;
}

function calculateSetPercent(cards) {
  const n = cards.length;
  if (!n) return 0;
  const actualSum = cards.reduce((acc, c) => acc + c.amount, 0);
  const worstSum = cfg.maxAmount * n;
  const bestSum = cfg.minAmount * n;
  if (worstSum === bestSum) return 100;
  return Math.round(((worstSum - actualSum) / (worstSum - bestSum)) * 100);
}

function updateProgressBar() {
  const progress = calculateSetPercent(questions);
  progressBar.style.width = Math.max(0, Math.min(100, progress)) + "%";
  if (learnedEl) learnedEl.textContent = learnedCount();
  if (totalEl) totalEl.textContent = questions.length;
  if (bucketInfoEl) {
    bucketInfoEl.textContent = finished
      ? ""
      : `Bucket ${bucket.length} · Warteschlange ${pool.length}`;
  }
}

// ----------------- Ablauf -----------------
function checkAnswer() {
  if (finished) return;
  const userAnswer = answerInput.value.trim();
  if (userAnswer === "") return;

  const q = questions[currentQuestion];
  const correct = getExpectedAnswer();

  if (correctAnswer(userAnswer, correct)) {
    applyCorrect(q);
    answerInput.classList.add("correct");
    feedback.className = "feedback correct";
    feedback.style.display = "block";
    feedback.innerHTML = "✓ Richtig!";
    if (cfg.autoNext) {
      autoNextTimer = setTimeout(nextQuestion, cfg.autoNextDelay);
    } else {
      nextBtn.style.display = "block";
    }
  } else {
    q.streak = 0;
    q.amount = Math.min(cfg.maxAmount, q.amount + cfg.wrongStep);
    answerInput.classList.add("incorrect");
    feedback.className = "feedback incorrect";
    feedback.style.display = "block";
    feedback.innerHTML = `✗ Falsch! | Richtige Antwort: ${correct}`;
    nextBtn.style.display = "block";
    overrideBtn.style.display = "block";
  }

  updateProgressBar();
  saveQuiz();
  checkBtn.style.display = "none";
  answerInput.disabled = true;
}

function applyCorrect(q) {
  q.streak = (q.streak || 0) + 1;
  q.amount = Math.max(cfg.minAmount, q.amount - cfg.rightStep);
}

function overrideAnswer() {
  const q = questions[currentQuestion];
  // Falschbewertung zurücknehmen …
  q.amount = Math.min(cfg.maxAmount, Math.max(cfg.minAmount, q.amount - cfg.wrongStep));
  // … und als richtig werten.
  applyCorrect(q);

  answerInput.classList.remove("incorrect");
  answerInput.classList.add("correct");
  feedback.className = "feedback correct";
  feedback.innerHTML = "✓ Als richtig markiert!";
  overrideBtn.style.display = "none";
  nextBtn.style.display = "none";
  updateProgressBar();
  saveQuiz();

  if (cfg.autoNext) {
    autoNextTimer = setTimeout(nextQuestion, cfg.autoNextDelay);
  } else {
    nextBtn.style.display = "block";
  }
}

function nextQuestion() {
  clearTimeout(autoNextTimer);
  if (finished) return;

  const next = chooseNext();
  if (next === null) return showResults();

  currentQuestion = next;
  rememberShown(next);

  displayCurrentQuestion();
  answerInput.value = "";
  answerInput.disabled = false;
  answerInput.classList.remove("correct", "incorrect");
  feedback.style.display = "none";
  autoNextInfo.style.display = "none";
  nextBtn.style.display = "none";
  overrideBtn.style.display = "none";
  checkBtn.style.display = "block";
  updateProgressBar();
  answerInput.focus();
}

async function showResults() {
  clearTimeout(autoNextTimer);
  finished = true;

  const percentage = calculateSetPercent(questions);

  termEl.textContent = "Quiz abgeschlossen!";
  answerInput.style.display = "none";
  checkBtn.style.display = "none";
  nextBtn.style.display = "none";
  overrideBtn.style.display = "none";
  autoNextInfo.style.display = "none";
  feedback.className = "feedback correct";
  feedback.style.display = "block";
  feedback.innerHTML = `🎉 Alle Wörter gelernt!<br><br>Fortschritt: ${percentage}%`;
  updateProgressBar();
  playFinishAnimation();

  await saveQuiz();
}

function playFinishAnimation() {
  if (!finishAnimation) return;
  finishAnimation.innerHTML = "";
  finishAnimation.classList.add("active");

  const colors = ["#ff6b35", "#ffc842", "#ff7247", "#ffffff"];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = Math.random() * 1.5 + "s";
    piece.style.animationDuration = 2 + Math.random() * 2 + "s";
    finishAnimation.appendChild(piece);
  }

  const trophy = document.createElement("div");
  trophy.className = "trophy-container";
  trophy.textContent = "🏆";
  finishAnimation.appendChild(trophy);

  setTimeout(() => {
    finishAnimation.classList.remove("active");
    finishAnimation.innerHTML = "";
  }, 5000);
}

// ----------------- Laden / Speichern -----------------
async function loadExistingQuiz() {
  const quizData = localStorage.getItem("currentQuiz");
  if (!quizData) return;

  try {
    const quiz = JSON.parse(quizData);
    currentQuizName = quiz.name;
    questions = quiz.cards.map((card) => ({
      term: card.question,
      answer: card.answer,
      amount: card.amount === undefined ? 5 : card.amount,
      streak: 0,
    }));
    localStorage.removeItem("currentQuiz");

    const result = await CVOC.loadQuizzes();
    if (result.success) savedQuizzes = result.quizzes;
  } catch (e) {
    console.error("Fehler beim Laden des Quiz:", e);
  }
}

// Gebündeltes Speichern: schnelle Antworten hintereinander lösen
// nur einen Schreibvorgang aus, aber jeder Aufruf wartet korrekt darauf.
let savePending = null;
let saveWaiters = [];

function saveQuiz() {
  if (!currentQuizName) return Promise.resolve();
  clearTimeout(savePending);
  return new Promise((resolve) => {
    saveWaiters.push(resolve);
    savePending = setTimeout(async () => {
      const waiters = saveWaiters;
      saveWaiters = [];
      try {
        const idx = savedQuizzes.findIndex((q) => q.name === currentQuizName);
        if (idx !== -1) {
          savedQuizzes[idx].percent = calculateSetPercent(questions);
          savedQuizzes[idx].cards = questions.map((q) => ({
            question: q.term,
            answer: q.answer,
            amount: q.amount,
          }));
          const result = await CVOC.saveQuizzes(savedQuizzes);
          if (!result.success) console.error("Fehler beim Speichern:", result.error);
        }
      } catch (e) {
        console.error("Fehler beim Speichern:", e);
      } finally {
        waiters.forEach((r) => r());
      }
    }, 200);
  });
}

function goBack() {
  window.location.href = "home.html";
}

async function resetProgress() {
  const confirmed = await customAlert({
    title: "Fortschritt zurücksetzen?",
    icon: "🔄",
    message: "Alle Wörter dieses Lernsets werden wieder auf Anfang gesetzt.",
    confirmText: "Zurücksetzen",
    cancelText: "Abbrechen",
  });
  if (!confirmed) return;

  questions.forEach((q) => {
    q.amount = 5;
    q.streak = 0;
  });
  initSession();
  await saveQuiz();

  answerInput.style.display = "block";
  closeSettings();
  startFirstQuestion();
}

function startFirstQuestion() {
  const first = chooseNext();
  if (first === null) return showResults();
  currentQuestion = first;
  rememberShown(first);
  displayCurrentQuestion();
  answerInput.value = "";
  answerInput.disabled = false;
  answerInput.classList.remove("correct", "incorrect");
  feedback.style.display = "none";
  nextBtn.style.display = "none";
  overrideBtn.style.display = "none";
  checkBtn.style.display = "block";
  updateProgressBar();
  answerInput.focus();
}

// ----------------- Einstellungs-Panel -----------------
const settingsOverlay = document.getElementById("settingsOverlay");

function openSettings() {
  syncSettingsUI();
  settingsOverlay.classList.add("show");
}

function closeSettings() {
  settingsOverlay.classList.remove("show");
  if (!finished && !answerInput.disabled) answerInput.focus();
}

function syncSettingsUI() {
  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.classList.toggle("active", !!cfg[el.dataset.toggle]);
  });
  document.querySelectorAll("[data-range]").forEach((el) => {
    el.value = cfg[el.dataset.range];
    updateRangeLabel(el);
  });
  const qLabel = document.getElementById("question_def");
  if (qLabel) qLabel.textContent = cfg.questionFirst ? "Begriff" : "Definition";
}

function updateRangeLabel(el) {
  const out = document.querySelector(`[data-value-for="${el.dataset.range}"]`);
  if (!out) return;
  const suffix = el.dataset.suffix || "";
  out.textContent = el.value + suffix;
}

function initSettingsUI() {
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  document.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.toggle;
      cfg[key] = !cfg[key];
      el.classList.toggle("active", cfg[key]);
      persistSettings();
      onSettingChanged(key);
    });
  });

  document.querySelectorAll("[data-range]").forEach((el) => {
    el.addEventListener("input", () => {
      const key = el.dataset.range;
      cfg[key] = parseFloat(el.value);
      updateRangeLabel(el);
      persistSettings();
      onSettingChanged(key);
    });
  });

  document.getElementById("btnDefaults").addEventListener("click", async () => {
    const ok = await customAlert({
      title: "Standard wiederherstellen?",
      icon: "↩️",
      message: "Alle Einstellungen werden auf die Standardwerte zurückgesetzt. Dein Lernfortschritt bleibt erhalten.",
      confirmText: "Zurücksetzen",
      cancelText: "Abbrechen",
    });
    if (!ok) return;
    cfg = { ...DEFAULT_SETTINGS };
    persistSettings();
    syncSettingsUI();
    onSettingChanged("*");
  });

  document.getElementById("btnResetProgress").addEventListener("click", resetProgress);
}

function onSettingChanged(key) {
  if (key === "questionFirst" || key === "*") {
    const qLabel = document.getElementById("question_def");
    if (qLabel) qLabel.textContent = cfg.questionFirst ? "Begriff" : "Definition";
  }

  if (key === "minAmount" || key === "maxAmount" || key === "*") {
    if (cfg.minAmount >= cfg.maxAmount) {
      cfg.maxAmount = cfg.minAmount + 1;
      persistSettings();
      syncSettingsUI();
    }
    questions.forEach((q) => {
      q.amount = Math.min(cfg.maxAmount, Math.max(cfg.minAmount, q.amount));
    });
  }

  // Bucketgrösse / Mastery live nachziehen, ohne die laufende Frage zu verlieren.
  if (["bucketSize", "masteryStreak", "minAmount", "maxAmount", "*"].includes(key)) {
    questions.forEach((q, i) => {
      if (!bucket.includes(i) && !pool.includes(i) && !isMastered(q)) pool.push(i);
    });
    refillBucket(currentQuestion);
  }

  if (!finished) displayCurrentQuestion();
  updateProgressBar();
}

// ----------------- Start -----------------
document.addEventListener("DOMContentLoaded", async () => {
  loadSettings();
  await loadExistingQuiz();
  initSession();
  initSettingsUI();
  syncSettingsUI();
  startFirstQuestion();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsOverlay.classList.contains("show")) {
    closeSettings();
    return;
  }
  if (e.key !== "Enter") return;
  if (settingsOverlay.classList.contains("show")) return;
  if (finished) return;

  if (!answerInput.disabled) {
    checkAnswer();
  } else if (nextBtn.style.display === "block" || overrideBtn.style.display === "block") {
    nextQuestion();
  }
});

// ----------------- Custom Alerts -----------------
function customAlert(options) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("customAlertOverlay");
    const icon = document.getElementById("alertIcon");
    const title = document.getElementById("alertTitle");
    const message = document.getElementById("alertMessage");
    const btnConfirm = document.getElementById("alertBtnConfirm");
    const btnCancel = document.getElementById("alertBtnCancel");

    title.textContent = options.title || "Achtung";
    icon.textContent = options.icon || "⚠️";
    message.textContent = options.message || "";
    btnConfirm.textContent = options.confirmText || "Bestätigen";
    btnCancel.textContent = options.cancelText || "Abbrechen";
    btnCancel.style.display = "block";
    overlay.classList.add("show");

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") handleCancel();
      if (e.key === "Enter") handleConfirm();
    };
    const cleanup = () => {
      overlay.classList.remove("show");
      btnConfirm.removeEventListener("click", handleConfirm);
      btnCancel.removeEventListener("click", handleCancel);
      document.removeEventListener("keydown", handleEscape, true);
    };

    btnConfirm.addEventListener("click", handleConfirm);
    btnCancel.addEventListener("click", handleCancel);
    document.addEventListener("keydown", handleEscape, true);
  });
}

function customAlertSimple(options) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("customAlertOverlay");
    const icon = document.getElementById("alertIcon");
    const title = document.getElementById("alertTitle");
    const message = document.getElementById("alertMessage");
    const btnConfirm = document.getElementById("alertBtnConfirm");
    const btnCancel = document.getElementById("alertBtnCancel");

    title.textContent = options.title || "Hinweis";
    icon.textContent = options.icon || "ℹ️";
    message.textContent = options.message || "";
    btnConfirm.textContent = options.confirmText || "OK";
    btnCancel.style.display = "none";
    overlay.classList.add("show");

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape" || e.key === "Enter") handleConfirm();
    };
    const cleanup = () => {
      overlay.classList.remove("show");
      btnCancel.style.display = "block";
      btnConfirm.removeEventListener("click", handleConfirm);
      document.removeEventListener("keydown", handleEscape, true);
    };

    btnConfirm.addEventListener("click", handleConfirm);
    document.addEventListener("keydown", handleEscape, true);
  });
}
