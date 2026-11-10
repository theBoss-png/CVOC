/* ============================================================
   CVOC – Quizlet-Import (Oberfläche)
   Der Parser steckt in quizlet.js, das Speichern in platform.js.
   ============================================================ */

const el = (id) => document.getElementById(id);
const input = el("input");
const preview = el("preview");
const cardCount = el("cardCount");
const detectBadge = el("detectBadge");
const skippedEl = el("skipped");
const setName = el("setName");
const optionsPanel = el("optionsPanel");
const previewPanel = el("previewPanel");
const createRow = el("createRow");
const sepBlock = el("sepBlock");
const modeHint = el("modeHint");

let lastCards = [];
let parseTimer = null;
let userTouchedSeparators = false;

const EXAMPLE = [
  "accurate\tgenau, präzise",
  "thorough\tgründlich",
  "reliable\tzuverlässig",
  "anxious\tbesorgt, ängstlich",
  "genuine\techt",
].join("\n");

function goBack() {
  window.location.href = "home.html";
}

// ----------------- Auswahllisten füllen -----------------
function fillSelect(select, list, extraLabel) {
  select.innerHTML = "";
  for (const sep of list) {
    const opt = document.createElement("option");
    opt.value = sep.id;
    opt.textContent = sep.label;
    select.appendChild(opt);
  }
  if (extraLabel) {
    const opt = document.createElement("option");
    opt.value = "custom";
    opt.textContent = extraLabel;
    select.appendChild(opt);
  }
}

fillSelect(el("termSep"), CvocQuizlet.TERM_SEPARATORS);
fillSelect(el("cardSep"), CvocQuizlet.CARD_SEPARATORS);

function sepValue(select, list) {
  const found = CvocQuizlet.findSeparator(list, select.value);
  return found ? found.value : "\t";
}

function radioValue(name) {
  const found = document.querySelector(`input[name="${name}"]:checked`);
  return found ? found.value : null;
}

// ----------------- Erkennen + Zerlegen -----------------
function schedule() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(run, 150);
}

function autoDetect() {
  const detected = CvocQuizlet.detect(input.value);
  const modeRadio = document.querySelector(
    `input[name="mode"][value="${detected.mode}"]`
  );
  if (modeRadio) modeRadio.checked = true;
  if (detected.termId) el("termSep").value = detected.termId;
  if (detected.cardId) el("cardSep").value = detected.cardId;

  const termLabel =
    (CvocQuizlet.TERM_SEPARATORS.find((s) => s.id === detected.termId) || {}).label || "?";
  const cardLabel =
    (CvocQuizlet.CARD_SEPARATORS.find((s) => s.id === detected.cardId) || {}).label || "?";

  if (!input.value.trim()) {
    detectBadge.textContent = "wartet auf Eingabe";
  } else if (detected.mode === "alternating") {
    detectBadge.textContent = "erkannt: abwechselnde Zeilen";
  } else if (detected.confident) {
    detectBadge.textContent = `erkannt: ${termLabel} / ${cardLabel}`;
  } else {
    detectBadge.textContent = "unsicher – bitte unten prüfen";
  }
}

function run() {
  const text = input.value;
  const hasText = !!text.trim();

  optionsPanel.hidden = !hasText;
  previewPanel.hidden = !hasText;
  createRow.hidden = !hasText;
  if (!hasText) {
    detectBadge.textContent = "wartet auf Eingabe";
    lastCards = [];
    return;
  }

  if (!userTouchedSeparators) autoDetect();

  const mode = radioValue("mode") || "separator";
  sepBlock.style.opacity = mode === "alternating" ? "0.4" : "1";
  sepBlock.querySelectorAll("select").forEach((s) => (s.disabled = mode === "alternating"));
  modeHint.textContent =
    mode === "alternating"
      ? "Erste Zeile Begriff, zweite Zeile Definition, dann wieder von vorn."
      : "Jede Karte steht in einem Datensatz, getrennt durch die Zeichen rechts.";

  const result = CvocQuizlet.parse(text, {
    mode,
    termSep: sepValue(el("termSep"), CvocQuizlet.TERM_SEPARATORS),
    cardSep: sepValue(el("cardSep"), CvocQuizlet.CARD_SEPARATORS),
    swap: el("swap").checked,
    stripIpa: el("stripIpa").checked,
    stripNumbering: el("stripNumbering").checked,
    dedupe: el("dedupe").checked,
  });

  lastCards = result.cards;
  cardCount.textContent =
    result.cards.length === 1 ? "1 Karte" : `${result.cards.length} Karten`;

  const notes = [];
  if (result.skippedNoSeparator)
    notes.push(`${result.skippedNoSeparator} Zeilen ohne Trennzeichen übersprungen`);
  if (result.skippedEmpty) notes.push(`${result.skippedEmpty} unvollständige übersprungen`);
  if (result.skippedDuplicate) notes.push(`${result.skippedDuplicate} Duplikate entfernt`);
  skippedEl.textContent = notes.join(" · ");

  renderPreview(result.cards);

  if (!setName.value.trim() && result.cards.length) {
    setName.placeholder = "Name des Lernsets";
  }
}

function renderPreview(cards) {
  preview.innerHTML = "";
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent =
      "Daraus entstehen keine Karten. Stimmen die Trennzeichen oben?";
    preview.appendChild(empty);
    return;
  }

  for (const card of cards.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const q = document.createElement("div");
    q.className = "preview-q";
    q.textContent = card.question;
    const a = document.createElement("div");
    a.className = "preview-a";
    a.textContent = card.answer;
    row.append(q, a);
    preview.appendChild(row);
  }

  if (cards.length > 8) {
    const more = document.createElement("div");
    more.className = "preview-more";
    more.textContent = `… und ${cards.length - 8} weitere`;
    preview.appendChild(more);
  }
}

// ----------------- Datei laden -----------------
function loadFromFile() {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".txt,.csv,.tsv,text/plain";
  picker.style.display = "none";
  document.body.appendChild(picker);
  picker.addEventListener("change", async () => {
    const file = picker.files && picker.files[0];
    picker.remove();
    if (!file) return;
    try {
      input.value = await file.text();
      if (!setName.value.trim()) {
        setName.value = file.name.replace(/\.(txt|csv|tsv)$/i, "").replace(/[_-]+/g, " ").trim();
      }
      userTouchedSeparators = false;
      run();
    } catch (e) {
      await customAlertSimple({
        title: "Datei nicht lesbar",
        icon: "❌",
        message: String((e && e.message) || e),
        confirmText: "OK",
      });
    }
  });
  picker.click();
}

// ----------------- Lernset erstellen -----------------
async function createSet() {
  const name = setName.value.trim();
  if (!name) {
    await customAlertSimple({
      title: "Name fehlt",
      icon: "✏️",
      message: "Gib dem Lernset einen Namen.",
      confirmText: "OK",
    });
    setName.focus();
    return;
  }

  if (lastCards.length < 2) {
    await customAlertSimple({
      title: "Zu wenig Karten",
      icon: "⚠️",
      message: "Ein Lernset braucht mindestens 2 Karten.",
      confirmText: "OK",
    });
    return;
  }

  const loaded = await CVOC.loadQuizzes();
  const quizzes = loaded.success ? loaded.quizzes : [];
  const existing = quizzes.findIndex((q) => q.name === name);

  if (existing !== -1) {
    const ok = await customAlert({
      title: "Lernset überschreiben?",
      icon: "⚠️",
      message: `Es gibt bereits ein Lernset "${name}". Beim Überschreiben geht der Lernfortschritt verloren.`,
      confirmText: "Überschreiben",
      cancelText: "Abbrechen",
    });
    if (!ok) return;
  }

  const quiz = { name, percent: 50, cards: lastCards };
  if (existing !== -1) quizzes[existing] = quiz;
  else quizzes.push(quiz);

  const saved = await CVOC.saveQuizzes(quizzes);
  if (!saved.success) {
    await customAlertSimple({
      title: "Fehler beim Speichern",
      icon: "❌",
      message: saved.error,
      confirmText: "OK",
    });
    return;
  }

  await customAlertSimple({
    title: "Fertig",
    icon: "✅",
    message: `"${name}" wurde mit ${lastCards.length} Karten angelegt.`,
    confirmText: "Weiter",
  });
  window.location.href = "home.html";
}

// ----------------- Verdrahtung -----------------
input.addEventListener("input", () => {
  userTouchedSeparators = false;
  schedule();
});
input.addEventListener("paste", () => {
  userTouchedSeparators = false;
  setTimeout(() => {
    el("howto").open = false;
    run();
  }, 0);
});

for (const id of ["termSep", "cardSep"]) {
  el(id).addEventListener("change", () => {
    userTouchedSeparators = true;
    run();
  });
}
for (const id of ["swap", "stripIpa", "stripNumbering", "dedupe"]) {
  el(id).addEventListener("change", run);
}
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", () => {
    userTouchedSeparators = true;
    run();
  });
}

el("btnFile").addEventListener("click", loadFromFile);
el("btnClear").addEventListener("click", () => {
  input.value = "";
  userTouchedSeparators = false;
  run();
  input.focus();
});
el("btnExample").addEventListener("click", () => {
  input.value = EXAMPLE;
  userTouchedSeparators = false;
  el("howto").open = false;
  run();
});
el("btnCreate").addEventListener("click", createSet);

// Datei auf die Seite ziehen
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!/\.(txt|csv|tsv)$/i.test(file.name)) {
    await customAlertSimple({
      title: "Falscher Dateityp",
      icon: "📄",
      message: "Bitte eine Textdatei (.txt, .csv oder .tsv) verwenden.",
      confirmText: "OK",
    });
    return;
  }
  input.value = await file.text();
  if (!setName.value.trim()) {
    setName.value = file.name.replace(/\.(txt|csv|tsv)$/i, "").replace(/[_-]+/g, " ").trim();
  }
  userTouchedSeparators = false;
  el("howto").open = false;
  run();
});

run();
input.focus();

// ----------------- Custom Alerts -----------------
function customAlert(options) {
  return new Promise((resolve) => {
    const overlay = el("customAlertOverlay");
    el("alertTitle").textContent = options.title || "Achtung";
    el("alertIcon").textContent = options.icon || "⚠️";
    el("alertMessage").textContent = options.message || "";
    const btnConfirm = el("alertBtnConfirm");
    const btnCancel = el("alertBtnCancel");
    btnConfirm.textContent = options.confirmText || "Bestätigen";
    btnCancel.textContent = options.cancelText || "Abbrechen";
    btnCancel.style.display = "block";
    overlay.classList.add("show");

    const done = (value) => {
      overlay.classList.remove("show");
      btnConfirm.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onNo);
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onOk = () => done(true);
    const onNo = () => done(false);
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };

    btnConfirm.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onNo);
    document.addEventListener("keydown", onKey, true);
  });
}

function customAlertSimple(options) {
  return new Promise((resolve) => {
    const overlay = el("customAlertOverlay");
    el("alertTitle").textContent = options.title || "Hinweis";
    el("alertIcon").textContent = options.icon || "ℹ️";
    el("alertMessage").textContent = options.message || "";
    const btnConfirm = el("alertBtnConfirm");
    const btnCancel = el("alertBtnCancel");
    btnConfirm.textContent = options.confirmText || "OK";
    btnCancel.style.display = "none";
    overlay.classList.add("show");

    const done = () => {
      overlay.classList.remove("show");
      btnCancel.style.display = "block";
      btnConfirm.removeEventListener("click", done);
      document.removeEventListener("keydown", onKey, true);
      resolve(true);
    };
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") done();
    };

    btnConfirm.addEventListener("click", done);
    document.addEventListener("keydown", onKey, true);
  });
}
