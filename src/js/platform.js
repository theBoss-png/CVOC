/* ============================================================
   CVOC – Plattform-Schicht

   Die eine Stelle, an der sich Desktop- und Web-Version
   unterscheiden. Alles darüber (home.js, create.js, lernen.js,
   cards.js, anki-import.js) ist identisch.

     Desktop  → Electron-IPC, quizzes.json im Benutzerordner
     Web      → localStorage im Browser, Anki-Parser direkt im Tab

   Erkannt wird die Umgebung daran, ob `require("electron")`
   verfügbar ist.
   ============================================================ */

const CVOC = (() => {
  // ----------------- Umgebung erkennen -----------------
  let ipcRenderer = null;
  let electron = null;
  try {
    if (typeof require === "function") {
      electron = require("electron");
      ipcRenderer = electron.ipcRenderer || null;
    }
  } catch (e) {
    ipcRenderer = null;
  }

  const isDesktop = !!ipcRenderer;
  const STORAGE_KEY = "cvoc.quizzes";
  const APP_VERSION = "0.1.0"; // wird im Web angezeigt, Desktop fragt Electron

  // ----------------- Lernsets -----------------
  function readWeb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Lernsets konnten nicht gelesen werden:", e);
      return [];
    }
  }

  function writeWeb(quizzes) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quizzes));
      return { success: true };
    } catch (e) {
      // Häufigster Fall: Speicher voll (QuotaExceededError)
      const full =
        e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
      return {
        success: false,
        error: full
          ? "Der Speicher des Browsers ist voll. Lösche ein Lernset oder exportiere es."
          : String((e && e.message) || e),
      };
    }
  }

  async function loadQuizzes() {
    if (isDesktop) return ipcRenderer.invoke("load-quizzes");
    return { success: true, quizzes: readWeb() };
  }

  async function saveQuizzes(quizzes) {
    if (isDesktop) return ipcRenderer.invoke("save-quizzes", quizzes);
    return writeWeb(quizzes);
  }

  async function deleteQuiz(name) {
    if (isDesktop) return ipcRenderer.invoke("delete-quiz", name);
    return writeWeb(readWeb().filter((q) => q.name !== name));
  }

  async function getVersion() {
    if (isDesktop) {
      try {
        return await ipcRenderer.invoke("get-version");
      } catch (e) {
        return APP_VERSION;
      }
    }
    return APP_VERSION;
  }

  // ----------------- Anki-Import -----------------
  // Desktop: der Hauptprozess liest und parst die Datei.
  // Web: derselbe Parser (anki.js) läuft direkt im Tab.

  // Datei auswählen. Liefert { canceled } oder { file } bzw. { path }.
  function pickFile() {
    if (isDesktop) return ipcRenderer.invoke("anki:pick");

    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".apkg,.colpkg";
      input.style.display = "none";
      document.body.appendChild(input);

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };

      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        finish(file ? { success: true, file } : { success: true, canceled: true });
      });
      // Abbruch im Dateidialog meldet der Browser nicht zuverlässig –
      // der Fokus-Trick reicht, um nicht ewig zu warten.
      window.addEventListener(
        "focus",
        () => setTimeout(() => finish({ success: true, canceled: true }), 800),
        { once: true }
      );

      input.click();
    });
  }

  // source: im Desktop ein Pfad, im Web ein File-Objekt.
  async function openApkg(source) {
    if (isDesktop) return ipcRenderer.invoke("anki:open", source);

    try {
      const bytes = new Uint8Array(await source.arrayBuffer());
      const info = await window.CvocAnki.openApkg(bytes, source.name);
      return { success: true, info };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  }

  async function buildCards(options) {
    if (isDesktop) return ipcRenderer.invoke("anki:build", options);
    try {
      return { success: true, result: window.CvocAnki.buildCards(options) };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  }

  async function closeApkg() {
    if (isDesktop) return ipcRenderer.invoke("anki:close");
    try {
      window.CvocAnki.clearCache();
    } catch (e) {
      /* Parser war nie geladen */
    }
    return { success: true };
  }

  // Pfad einer per Drag & Drop fallengelassenen Datei (nur Desktop nötig).
  function droppedFile(file) {
    if (!isDesktop) return file;
    try {
      if (electron && electron.webUtils && electron.webUtils.getPathForFile) {
        return electron.webUtils.getPathForFile(file);
      }
    } catch (e) {
      /* ältere Electron-Version */
    }
    return file.path || "";
  }

  // ----------------- Sicherung -----------------
  // Im Web liegt alles nur im Browser. Ein Export ist dort kein
  // Luxus, sondern die einzige Sicherung.
  function exportBackup() {
    const data = JSON.stringify(
      { app: "cvoc", version: 1, exported: new Date().toISOString(), quizzes: readWeb() },
      null,
      2
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cvoc-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.quizzes;
      if (!Array.isArray(incoming)) throw new Error("Datei enthält keine Lernsets.");

      const current = (await loadQuizzes()).quizzes || [];
      const byName = new Map(current.map((q) => [q.name, q]));
      let added = 0;
      let replaced = 0;
      for (const quiz of incoming) {
        if (!quiz || !quiz.name || !Array.isArray(quiz.cards)) continue;
        if (byName.has(quiz.name)) replaced++;
        else added++;
        byName.set(quiz.name, quiz);
      }

      const saved = await saveQuizzes([...byName.values()]);
      if (!saved.success) return saved;
      return { success: true, added, replaced };
    } catch (e) {
      return { success: false, error: String((e && e.message) || e) };
    }
  }

  return {
    isDesktop,
    isWeb: !isDesktop,
    loadQuizzes,
    saveQuizzes,
    deleteQuiz,
    getVersion,
    pickFile,
    openApkg,
    buildCards,
    closeApkg,
    droppedFile,
    exportBackup,
    importBackup,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CVOC;
