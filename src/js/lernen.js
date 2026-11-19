
/* ============================================================
   CVOC – Lernmodus
   Bucket-basierter Algorithmus mit gewichtetem Würfeln.

   Kurzfassung des Algorithmus:
   1. Alle noch nicht gelernten Wörter liegen im "Pool".
   2. Aus dem Pool wird ein "Bucket" (aktives Lernfenster) gefüllt.
   3. Gefragt wird immer nur aus dem Bucket – per gewichtetem
      Würfeln: schlecht gekonnte Wörter haben mehr Gewicht.
   4. Zwischen zwei Abfragen desselben Wortes liegen mindestens
      `minGap` andere Wörter (harte Sperre, solange der Bucket gross
      genug ist). Danach kommt ein Wort über einen sanften Malus
      langsam wieder auf volles Gewicht.
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
  retypeWrong: false, // falsche Antwort muss richtig abgetippt werden
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
const fillers = new Set(); // gelernte Wörter, die im Endspurt als Wiederholung im Bucket sind
const usedFillers = new Set(); // Wiederholungen, die schon dran waren (für die Rotation)
let beforeWrong = null; // Stand vor der Falschbewertung, für "Meine Antwort war richtig"
let currentQuestion = 0;
let retyping = false; // falsch beantwortet, Lösung muss abgetippt werden
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
  fillers.clear();
  usedFillers.clear();
  finished = false;
  refillBucket();
}

// Hält den Bucket auf Sollgrösse: gelernte Wörter raus,
// neue aus dem Pool nach – und bei verkleinerter Bucketgrösse
// wandern die überzähligen (nie das aktuelle Wort) zurück in den Pool.
function refillBucket(protectedIndex = -1) {
  // Falsch beantwortete Wiederholungen sind wieder echte Lernwörter.
  for (const f of [...fillers]) {
    if (!isMastered(questions[f]) || !bucket.includes(f)) fillers.delete(f);
  }

  bucket = bucket.filter(
    (i) => !isMastered(questions[i]) || fillers.has(i) || i === protectedIndex
  );
  // Gibt es wieder Wörter im Pool, haben die Vorrang vor Wiederholungen.
  if (pool.length > 0) {
    bucket = bucket.filter((i) => !fillers.has(i) || i === protectedIndex);
    fillers.clear();
  }

  while (bucket.length > cfg.bucketSize) {
    // Zuerst Wiederholungen entfernen, dann von hinten echte Wörter.
    let removeAt = bucket.findIndex((i) => fillers.has(i) && i !== protectedIndex);
    if (removeAt === -1) {
      for (let k = bucket.length - 1; k >= 0; k--) {
        if (bucket[k] !== protectedIndex) {
          removeAt = k;
          break;
        }
      }
    }
    if (removeAt === -1) break;
    const removed = bucket.splice(removeAt, 1)[0];
    if (fillers.has(removed)) fillers.delete(removed);
    else pool.unshift(removed);
  }

  while (bucket.length < cfg.bucketSize && pool.length > 0) {
    const next = pool.shift();
    if (!isMastered(questions[next]) && !bucket.includes(next)) {
      bucket.push(next);
    }
  }

  // Endspurt: Ist der Pool leer und der Bucket nicht mehr voll, werden
  // zufällig bereits gelernte Wörter als Wiederholung dazugeholt. Wer
  // eine Wiederholung richtig beantwortet, fällt wieder raus und macht
  // Platz für eine neue – so rotieren die Wiederholungen durch, bis die
  // letzten echten Wörter sitzen. Wird eine Wiederholung falsch
  // beantwortet, gilt sie nicht mehr als gelernt und bleibt drin.
  if (pool.length === 0) {
    const free = questions
      .map((_, i) => i)
      .filter((i) => !bucket.includes(i) && isMastered(questions[i]));
    let fresh = free.filter((i) => !usedFillers.has(i));
    if (fresh.length === 0 && free.length > 0) {
      usedFillers.clear(); // alle einmal dran gewesen – neue Runde
      fresh = free;
    }
    shuffle(fresh);
    // Zuletzt gefragte Wörter erst am Schluss nachziehen.
    fresh.sort((a, b) => (distanceSince(a) === Infinity ? 0 : 1) - (distanceSince(b) === Infinity ? 0 : 1));
    while (bucket.length < cfg.bucketSize && fresh.length) {
      const f = fresh.shift();
      bucket.push(f);
      fillers.add(f);
    }
  }
}

// Wiederholung richtig beantwortet: raus aus dem Bucket (beim nächsten
// Auffüllen), damit eine andere nachrückt.
function retireFiller(idx) {
  if (fillers.has(idx) && isMastered(questions[idx])) {
    fillers.delete(idx);
    usedFillers.add(idx);
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

// Abstand zum letzten Auftritt: 1 = direkt zuvor gefragt,
// es liegen also (distance - 1) andere Wörter dazwischen.
function distanceSince(idx) {
  const pos = recent.lastIndexOf(idx);
  return pos === -1 ? Infinity : recent.length - pos;
}

// Kleinster erlaubter Abstand. Bei Härte 0 wird nur die direkte
// Wiederholung verhindert, sonst gilt der Mindestabstand strikt.
function requiredDistance() {
  if (cfg.recencyStrength <= 0) return 2;
  return Math.max(2, cfg.minGap + 1);
}

// Sanfter Malus NACH dem Mindestabstand: Wörter, die die Sperre
// gerade erst verlassen haben, kommen über weitere `minGap` Wörter
// langsam wieder auf volles Gewicht. Die Härte bestimmt, wie stark.
function recencyFactor(idx) {
  const distance = distanceSince(idx);
  if (distance === Infinity || cfg.recencyStrength <= 0 || cfg.minGap <= 0) return 1;
  const since = distance - requiredDistance() + 1; // 1 = gerade freigegeben
  if (since > cfg.minGap) return 1;
  return Math.pow(since / (cfg.minGap + 1), cfg.recencyStrength);
}

function weightFor(idx) {
  return baseWeight(questions[idx]) * recencyFactor(idx);
}

function weightedPick(candidates, weightOf) {
  let weights = candidates.map(weightOf);
  let total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) {
    weights = candidates.map(() => 1);
    total = candidates.length;
  }
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function chooseNext() {
  if (allLearned()) return null;
  refillBucket();
  if (bucket.length === 0) return null;
  if (bucket.length === 1) return bucket[0];

  // 1. Nur Wörter, die den Mindestabstand einhalten.
  const need = requiredDistance();
  const allowed = bucket.filter((i) => distanceSince(i) >= need);
  if (allowed.length) return weightedPick(allowed, weightFor);

  // 2. Bucket zu klein für den Abstand (z. B. im Endspurt): das Wort
  //    nehmen, das am längsten nicht dran war – so bleibt der Abstand
  //    so gross wie möglich.
  const longest = Math.max(...bucket.map(distanceSince));
  const oldest = bucket.filter((i) => distanceSince(i) === longest);
  return weightedPick(oldest, (i) => baseWeight(questions[i]));
}

function rememberShown(idx) {
  recent.push(idx);
  // Sperre + Ausklingzone müssen im Gedächtnis bleiben.
  const keep = Math.max(cfg.minGap, 1) * 2 + 3;
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
      : `Bucket ${bucket.length} · Warteschlange ${pool.length}` +
        (fillers.size ? ` · Wiederholung ${fillers.size}` : "");
  }
}

// ----------------- Ablauf -----------------
function checkAnswer() {
  if (finished) return;
  const userAnswer = answerInput.value.trim();
  if (userAnswer === "") return;

  const q = questions[currentQuestion];
  const correct = getExpectedAnswer();

  if (retyping) return checkRetype(userAnswer, correct);

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
    beforeWrong = { index: currentQuestion, amount: q.amount, streak: q.streak || 0 };
    q.streak = 0;
    q.amount = Math.min(cfg.maxAmount, q.amount + cfg.wrongStep);
    answerInput.classList.add("incorrect");
    feedback.className = "feedback incorrect";
    feedback.style.display = "block";
    feedback.innerHTML =
      `✗ Falsch! | Richtige Antwort: ${escapeHtml(correct)}` +
      diffBlock(userAnswer, correct);
    overrideBtn.style.display = "block";

    if (cfg.retypeWrong) {
      // Weiter geht es erst, wenn die Lösung einmal richtig abgetippt ist.
      retyping = true;
      feedback.innerHTML = retypeFeedback("✗ Falsch!", userAnswer, correct);
      updateProgressBar();
      saveQuiz();
      answerInput.value = "";
      answerInput.focus();
      return;
    }
    nextBtn.style.display = "block";
  }

  updateProgressBar();
  saveQuiz();
  checkBtn.style.display = "none";
  answerInput.disabled = true;
}

// Abtippen nach einer falschen Antwort: zählt nicht für die Bewertung,
// gibt nur den Weg zur nächsten Karte frei.
function checkRetype(userAnswer, correct) {
  if (!correctAnswer(userAnswer, correct)) {
    answerInput.classList.remove("incorrect");
    void answerInput.offsetWidth; // Rot-Markierung neu auslösen
    answerInput.classList.add("incorrect");
    feedback.className = "feedback incorrect";
    feedback.innerHTML = retypeFeedback("✗ Noch nicht richtig", userAnswer, correct);
    answerInput.select();
    return;
  }

  retyping = false;
  answerInput.classList.remove("incorrect");
  answerInput.classList.add("correct");
  feedback.className = "feedback correct";
  feedback.innerHTML = "✓ Richtig abgetippt – weiter geht's.";
  overrideBtn.style.display = "none";
  checkBtn.style.display = "none";
  answerInput.disabled = true;
  if (cfg.autoNext) {
    autoNextTimer = setTimeout(nextQuestion, cfg.autoNextDelay);
  } else {
    nextBtn.style.display = "block";
  }
}

// Zeigt beim Abtippen weiter an, was zuletzt falsch geschrieben wurde,
// damit man den Fehler mit der Lösung vergleichen kann.
function retypeFeedback(title, attempt, correct) {
  return (
    `<div>${title}</div>` +
    `<div class="retype-compare">` +
    `<div class="retype-row"><span class="retype-label">Du hast geschrieben</span>` +
    `<span class="retype-wrong">${escapeHtml(attempt)}</span></div>` +
    `<div class="retype-row"><span class="retype-label">Richtig ist</span>` +
    `<span class="retype-right">${escapeHtml(correct)}</span></div>` +
    `</div>` +
    diffBlock(attempt, correct) +
    `<div class="retype-hint">Tippe die richtige Antwort ab, um weiterzumachen.</div>`
  );
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ----------------- Fehleranzeige -----------------
// Vergleicht die Eingabe Zeichen für Zeichen mit der Lösung und zeigt,
// was genau falsch ist: falscher Buchstabe, Buchstabe zu wenig, zu viel
// oder vertauscht. Bei sehr vielen Fehlern nur die erste Abweichung.
const MAX_LISTED_ERRORS = 3;

function diffPrep(text) {
  let t = String(text || "");
  if (cfg.removeParentheses) t = removeParentheses(t);
  return t.replace(/\s+/g, " ").trim();
}

function sameChar(a, b) {
  return cfg.checkCapitalized ? a === b : a.toLowerCase() === b.toLowerCase();
}

// Levenshtein mit Rückverfolgung: Liste der Schritte von Eingabe zu Lösung.
function editOps(got, want) {
  const a = Array.from(got);
  const b = Array.from(want);
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (sameChar(a[i - 1], b[j - 1]) ? 0 : 1)
      );
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = sameChar(a[i - 1], b[j - 1]);
      if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
        ops.push({ type: same ? "ok" : "sub", got: a[i - 1], want: b[j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: "extra", got: a[i - 1] });
      i--;
    } else {
      ops.push({ type: "missing", want: b[j - 1] });
      j--;
    }
  }
  ops.reverse();

  // Zwei benachbarte Buchstaben vertauscht ("Hasu" statt "Haus")
  // zählt als ein Fehler, nicht als zwei falsche Buchstaben.
  const merged = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    const p = ops[k + 1];
    if (
      o.type === "sub" && p && p.type === "sub" &&
      sameChar(o.got, p.want) && sameChar(p.got, o.want)
    ) {
      merged.push({ type: "swap", got: o.got + p.got, want: o.want + p.want });
      k++;
    } else {
      merged.push(o);
    }
  }
  return merged;
}

function quoteChar(c) {
  return c === " " ? "Leerzeichen" : `„${escapeHtml(c)}“`;
}

function describeOp(o) {
  switch (o.type) {
    case "sub":
      if (o.got.toLowerCase() === o.want.toLowerCase()) {
        return `Gross-/Kleinschreibung: ${quoteChar(o.got)} statt ${quoteChar(o.want)}`;
      }
      return `Falscher Buchstabe: ${quoteChar(o.got)} statt ${quoteChar(o.want)}`;
    case "missing":
      return `Buchstabe zu wenig: ${quoteChar(o.want)} fehlt`;
    case "extra":
      return `Buchstabe zu viel: ${quoteChar(o.got)}`;
    case "swap":
      return `Buchstaben vertauscht: ${quoteChar(o.got)} statt ${quoteChar(o.want)}`;
  }
  return "";
}

function markChars(text, cls) {
  return `<span class="${cls}">${escapeHtml(text === " " ? "␣" : text)}</span>`;
}

// Liefert { marked, notes } als HTML oder null, wenn kein Vergleich passt.
function diffHint(attempt, correct) {
  const got = diffPrep(attempt);
  const whole = diffPrep(correct);
  if (!got || !whole) return null;

  // Bei mehreren Lösungen mit der ähnlichsten vergleichen.
  const targets = cfg.bothAnswers ? [whole] : [whole, ...splitVariants(whole)];
  let best = null;
  for (const want of targets) {
    const ops = editOps(got, want);
    const errors = ops.filter((o) => o.type !== "ok").length;
    if (!best || errors < best.errors) best = { ops, errors, want };
  }
  if (!best || best.errors === 0) return null;

  const tooMany =
    best.errors > MAX_LISTED_ERRORS || best.errors * 2 > Array.from(best.want).length;
  if (tooMany) return firstDeviation(got, best.want);

  let marked = "";
  const notes = [];
  let pos = 0; // Stelle in der Lösung (1-basiert für die Anzeige)
  for (const o of best.ops) {
    const at = pos + 1;
    switch (o.type) {
      case "ok":
        marked += escapeHtml(o.got);
        break;
      case "sub":
      case "swap":
        marked += markChars(o.got, "diff-del") + markChars(o.want, "diff-ins");
        break;
      case "missing":
        marked += markChars(o.want, "diff-ins");
        break;
      case "extra":
        marked += markChars(o.got, "diff-del");
        break;
    }
    if (o.type !== "ok") notes.push(`Stelle ${at}: ${describeOp(o)}`);
    if (o.want) pos += Array.from(o.want).length;
  }

  return {
    marked,
    notes: `<ul class="diff-notes">${notes.map((t) => `<li>${t}</li>`).join("")}</ul>`,
  };
}

// Zu viele Fehler für eine Liste: nur zeigen, wo es zum ersten Mal
// nicht mehr stimmt – der Rest der Eingabe wird ausgegraut.
function firstDeviation(got, want) {
  const a = Array.from(got);
  const b = Array.from(want);
  let i = 0;
  while (i < a.length && i < b.length && sameChar(a[i], b[i])) i++;

  let op;
  let marked = escapeHtml(a.slice(0, i).join(""));
  if (i >= a.length) {
    op = { type: "missing", want: b[i] };
    marked += markChars(b[i], "diff-ins");
  } else if (i >= b.length) {
    op = { type: "extra", got: a[i] };
    marked += markChars(a[i], "diff-del");
  } else {
    op = { type: "sub", got: a[i], want: b[i] };
    marked += markChars(a[i], "diff-del") + markChars(b[i], "diff-ins");
  }
  const rest = a.slice(i + 1).join("");
  if (rest) marked += markChars(rest, "diff-rest");

  return {
    marked,
    notes: `<ul class="diff-notes"><li>Erste Abweichung an Stelle ${i + 1}: ${describeOp(op)}</li></ul>`,
  };
}

function diffBlock(attempt, correct) {
  const hint = diffHint(attempt, correct);
  if (!hint) return "";
  return (
    `<div class="diff-hint">` +
    `<div class="diff-marked">${hint.marked}</div>` +
    hint.notes +
    `</div>`
  );
}

function applyCorrect(q) {
  q.streak = (q.streak || 0) + 1;
  q.amount = Math.max(cfg.minAmount, q.amount - cfg.rightStep);
  retireFiller(questions.indexOf(q));
}

function overrideAnswer() {
  const q = questions[currentQuestion];
  retyping = false;
  checkBtn.style.display = "none";
  answerInput.disabled = true;
  // Falschbewertung vollständig zurücknehmen (Stand UND Serie) …
  if (beforeWrong && beforeWrong.index === currentQuestion) {
    q.amount = beforeWrong.amount;
    q.streak = beforeWrong.streak;
  } else {
    q.amount = Math.min(cfg.maxAmount, Math.max(cfg.minAmount, q.amount - cfg.wrongStep));
  }
  beforeWrong = null;
  // … und genau so werten, als wäre die Antwort richtig gewesen.
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
  retyping = false;

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
  retyping = false;
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

function setHelpOpen(open) {
  document.querySelector(".settings-panel").classList.toggle("help-open", open);
  document.getElementById("settingsTitle").textContent = open ? "Erklärung" : "Einstellungen";
  const btn = document.getElementById("settingsHelpBtn");
  btn.textContent = open ? "←" : "?";
  btn.title = open ? "Zurück zu den Einstellungen" : "Erklärung der Einstellungen";
  document.getElementById("settingsHelp").scrollTop = 0;
}

function closeSettings() {
  setHelpOpen(false);
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
  document.getElementById("settingsHelpBtn").addEventListener("click", () => {
    setHelpOpen(!document.querySelector(".settings-panel").classList.contains("help-open"));
  });
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
