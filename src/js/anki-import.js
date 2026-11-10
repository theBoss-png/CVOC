
/* ============================================================
   CVOC – Anki-Import (Oberfläche)
   Das eigentliche Lesen der .apkg passiert im Hauptprozess
   (src/js/anki.js), hier laufen nur Auswahl und Vorschau.
   ============================================================ */

let info = null; // Ergebnis von anki:open
let ntState = {}; // Notiztyp-Einstellungen, key = Notiztyp-Id
let selectedTags = new Set();
let buildTimer = null;
let lastTotal = 0;

// ----------------- DOM -----------------
const el = (id) => document.getElementById(id);
const dropzone = el("dropzone");
const loading = el("loading");
const importBody = el("importBody");
const tagList = el("tagList");
const tagEmpty = el("tagEmpty");
const tagSearch = el("tagSearch");
const notetypeList = el("notetypeList");
const preview = el("preview");
const cardCount = el("cardCount");
const skippedEl = el("skipped");
const setName = el("setName");
const swapHint = el("swapHint");

function goBack() {
  CVOC.closeApkg();
  window.location.href = "home.html";
}

// ----------------- Datei wählen -----------------
async function pickFile() {
  const res = await CVOC.pickFile();
  if (!res.success || res.canceled) return;
  await loadFile(res.file || res.path);
}

async function loadFile(source) {
  dropzone.hidden = true;
  importBody.hidden = true;
  loading.hidden = false;

  const res = await CVOC.openApkg(source);
  loading.hidden = true;

  if (!res.success) {
    dropzone.hidden = false;
    await customAlertSimple({
      title: "Datei konnte nicht gelesen werden",
      icon: "❌",
      message: res.error,
      confirmText: "OK",
    });
    return;
  }

  info = res.info;
  setupFromInfo(source);
  importBody.hidden = false;
  scheduleBuild();
}

function baseName(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function setupFromInfo(source) {
  const name = baseName(typeof source === "string" ? source : source.name);
  el("fileName").textContent = name;
  el("fileMeta").textContent =
    `${info.noteCount} Notizen · ${info.notetypes.length} Notiztypen · ` +
    `${info.tags.length} Tags · ${info.source}`;

  if (!setName.value.trim()) {
    setName.value = name.replace(/\.(apkg|colpkg)$/i, "").replace(/[_-]+/g, " ").trim();
  }

  selectedTags = new Set();
  renderTags();

  ntState = {};
  for (const t of info.notetypes) {
    ntState[t.id] = {
      include: true,
      mode: t.isCloze ? "cloze" : "basic",
      clozeField: t.clozeField,
      frontField: 0,
      backField: Math.min(1, Math.max(0, t.fields.length - 1)),
    };
  }
  renderNotetypes();
  updateSwapHint();
}

// ----------------- Tags -----------------
function renderTags() {
  const filter = tagSearch.value.trim().toLowerCase();
  tagList.innerHTML = "";

  if (!info.tags.length) {
    tagEmpty.hidden = false;
    tagSearch.hidden = true;
    return;
  }
  tagEmpty.hidden = true;
  tagSearch.hidden = false;

  const shown = info.tags.filter((t) => !filter || t.name.toLowerCase().includes(filter));
  if (!shown.length) {
    const div = document.createElement("div");
    div.className = "tag-empty";
    div.textContent = "Kein Tag passt zur Suche.";
    tagList.appendChild(div);
    return;
  }

  for (const tag of shown) {
    const label = document.createElement("label");
    label.className = "tag-item";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selectedTags.has(tag.name);
    box.addEventListener("change", () => {
      if (box.checked) selectedTags.add(tag.name);
      else selectedTags.delete(tag.name);
      scheduleBuild();
    });
    const text = document.createElement("span");
    text.className = "tag-name";
    text.textContent = tag.name;
    const count = document.createElement("span");
    count.className = "tag-count";
    count.textContent = tag.count;
    label.append(box, text, count);
    tagList.appendChild(label);
  }
}

// ----------------- Notiztypen -----------------
function fieldSelect(type, kind, value) {
  const sel = document.createElement("select");
  sel.className = "field-select";
  type.fields.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.value = String(value);
  sel.addEventListener("change", () => {
    ntState[type.id][kind] = parseInt(sel.value, 10);
    scheduleBuild();
  });
  return sel;
}

function renderNotetypes() {
  notetypeList.innerHTML = "";

  for (const type of info.notetypes) {
    const state = ntState[type.id];

    const card = document.createElement("div");
    card.className = "nt";

    const head = document.createElement("label");
    head.className = "nt-head";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.include;
    const title = document.createElement("span");
    title.className = "nt-name";
    title.textContent = type.name;
    const count = document.createElement("span");
    count.className = "nt-count";
    count.textContent = `${type.count} Notizen`;
    head.append(box, title, count);

    const body = document.createElement("div");
    body.className = "nt-body";

    const modeRow = document.createElement("div");
    modeRow.className = "nt-row";
    const modeLabel = document.createElement("span");
    modeLabel.textContent = "Umwandeln als";
    const modeSel = document.createElement("select");
    modeSel.className = "field-select";
    [
      ["cloze", "Lückentext (Cloze)"],
      ["basic", "Begriff / Definition"],
      ["skip", "Nicht importieren"],
    ].forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      modeSel.appendChild(o);
    });
    modeSel.value = state.include ? state.mode : "skip";
    modeRow.append(modeLabel, modeSel);

    const clozeRow = document.createElement("div");
    clozeRow.className = "nt-row";
    const clozeLabel = document.createElement("span");
    clozeLabel.textContent = "Feld mit dem Lückentext";
    clozeRow.append(clozeLabel, fieldSelect(type, "clozeField", state.clozeField));

    const basicRow = document.createElement("div");
    basicRow.className = "nt-row nt-row-double";
    const fLabel = document.createElement("span");
    fLabel.textContent = "Begriff";
    const bLabel = document.createElement("span");
    bLabel.textContent = "Definition";
    basicRow.append(
      fLabel,
      fieldSelect(type, "frontField", state.frontField),
      bLabel,
      fieldSelect(type, "backField", state.backField)
    );

    body.append(modeRow, clozeRow, basicRow);
    card.append(head, body);
    notetypeList.appendChild(card);

    const sync = () => {
      const skip = modeSel.value === "skip";
      state.include = !skip;
      if (!skip) state.mode = modeSel.value;
      box.checked = !skip;
      card.classList.toggle("off", skip);
      clozeRow.hidden = skip || state.mode !== "cloze";
      basicRow.hidden = skip || state.mode !== "basic";
      scheduleBuild();
    };

    modeSel.addEventListener("change", sync);
    box.addEventListener("change", () => {
      modeSel.value = box.checked ? state.mode : "skip";
      sync();
    });
    sync();
  }
}

// ----------------- Optionen einsammeln -----------------
function radioValue(name) {
  const found = document.querySelector(`input[name="${name}"]:checked`);
  return found ? found.value : null;
}

function currentOptions(limit) {
  const notetypes = {};
  for (const id of Object.keys(ntState)) {
    const s = ntState[id];
    notetypes[id] = {
      include: s.include,
      mode: s.mode,
      clozeField: s.clozeField,
      frontField: s.frontField,
      backField: s.backField,
    };
  }
  return {
    tags: [...selectedTags],
    tagMode: radioValue("tagMode") || "any",
    includeUntagged: el("includeUntagged").checked,
    notetypes,
    clozeMode: radioValue("clozeMode") || "per",
    swap: radioValue("swap") !== "0",
    stripHtml: el("stripHtml").checked,
    stripIpa: el("stripIpa").checked,
    showHints: el("showHints").checked,
    dedupe: el("dedupe").checked,
    blank: el("blank").value || "___",
    limit: limit || 0,
  };
}

function updateSwapHint() {
  const swap = radioValue("swap") !== "0";
  swapHint.textContent = swap
    ? "Im Lernmodus siehst du den Satz mit der Lücke und tippst das fehlende Wort."
    : "Im Lernmodus siehst du das Wort. Zum Abfragen des Lückentexts musst du dort «Abgefragt wird» umstellen.";
}

// ----------------- Vorschau -----------------
function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(runBuild, 120);
}

async function runBuild() {
  if (!info) return;
  const res = await CVOC.buildCards(currentOptions(8));
  if (!res.success) {
    cardCount.textContent = "Fehler";
    preview.innerHTML = "";
    skippedEl.textContent = res.error;
    return;
  }

  const r = res.result;
  lastTotal = r.total;
  cardCount.textContent = r.total === 1 ? "1 Karte" : `${r.total} Karten`;

  const notes = [];
  if (r.skippedDuplicate) notes.push(`${r.skippedDuplicate} Duplikate entfernt`);
  if (r.skippedEmpty) notes.push(`${r.skippedEmpty} unvollständige übersprungen`);
  if (r.skippedNoCloze) notes.push(`${r.skippedNoCloze} ohne Lücke übersprungen`);
  skippedEl.textContent = notes.join(" · ");

  preview.innerHTML = "";
  if (!r.cards.length) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = "Mit dieser Auswahl entstehen keine Karten.";
    preview.appendChild(empty);
    return;
  }

  for (const card of r.cards) {
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

  if (r.total > r.cards.length) {
    const more = document.createElement("div");
    more.className = "preview-more";
    more.textContent = `… und ${r.total - r.cards.length} weitere`;
    preview.appendChild(more);
  }
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

  const built = await CVOC.buildCards(currentOptions(0));
  if (!built.success) {
    await customAlertSimple({
      title: "Fehler",
      icon: "❌",
      message: built.error,
      confirmText: "OK",
    });
    return;
  }

  const cards = built.result.cards;
  if (cards.length < 2) {
    await customAlertSimple({
      title: "Zu wenig Karten",
      icon: "⚠️",
      message: "Ein Lernset braucht mindestens 2 Karten. Passe die Auswahl an.",
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

  const quiz = { name, percent: 50, cards };
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

  await CVOC.closeApkg();
  await customAlertSimple({
    title: "Fertig",
    icon: "✅",
    message: `"${name}" wurde mit ${cards.length} Karten angelegt.`,
    confirmText: "Weiter",
  });
  window.location.href = "home.html";
}

// ----------------- Verdrahtung -----------------
dropzone.addEventListener("click", pickFile);
el("btnChangeFile").addEventListener("click", pickFile);
el("btnCreate").addEventListener("click", createSet);
tagSearch.addEventListener("input", renderTags);

el("tagsAll").addEventListener("click", () => {
  const filter = tagSearch.value.trim().toLowerCase();
  for (const t of info.tags) {
    if (!filter || t.name.toLowerCase().includes(filter)) selectedTags.add(t.name);
  }
  renderTags();
  scheduleBuild();
});

el("tagsNone").addEventListener("click", () => {
  selectedTags = new Set();
  renderTags();
  scheduleBuild();
});

for (const id of ["includeUntagged", "stripHtml", "stripIpa", "showHints", "dedupe", "blank"]) {
  el(id).addEventListener("change", scheduleBuild);
}
el("blank").addEventListener("input", scheduleBuild);

for (const radio of document.querySelectorAll('input[type="radio"]')) {
  radio.addEventListener("change", () => {
    updateSwapHint();
    scheduleBuild();
  });
}

// Drag & Drop

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!importBody.hidden) return;
  dropzone.classList.add("hover");
});

window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropzone.classList.remove("hover");
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("hover");
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;

  if (!/\.(apkg|colpkg)$/i.test(file.name)) {
    await customAlertSimple({
      title: "Falscher Dateityp",
      icon: "📦",
      message: "Bitte eine Anki-Datei (.apkg oder .colpkg) verwenden.",
      confirmText: "OK",
    });
    return;
  }

  // Desktop braucht den Dateipfad, im Web reicht das File-Objekt.
  const source = CVOC.droppedFile(file);
  if (!source) {
    await customAlertSimple({
      title: "Datei nicht lesbar",
      icon: "❌",
      message: "Der Pfad der Datei konnte nicht ermittelt werden. Nutze bitte den Dateidialog.",
      confirmText: "OK",
    });
    return;
  }
  await loadFile(source);
});

window.addEventListener("beforeunload", () => {
  CVOC.closeApkg();
});

updateSwapHint();

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
