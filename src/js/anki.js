/* ============================================================
   CVOC – Anki-Import (.apkg)

   Läuft sowohl im Electron-Hauptprozess (Node) als auch direkt im
   Browser (Web-Version). Alles Node-Spezifische ist herausgezogen:
   openApkg() bekommt die Bytes, nicht den Pfad.

   Ein .apkg ist ein ZIP mit einer SQLite-Datenbank darin:
     collection.anki21b  – neu (Anki 2.1.50+), zstd-komprimiert
     collection.anki21   – Zwischenformat
     collection.anki2    – altes Format (Schema 11)

   Gelesen werden nur die Tabelle `notes` (Inhalte + Tags) und die
   Notiztyp-Definitionen. Karten- und Lernstatistiken aus Anki werden
   bewusst ignoriert – CVOC bringt seinen eigenen Algorithmus mit.
   ============================================================ */

// ------------------------------------------------------------
//  Umgebung: im Browser liegen die Bibliotheken als globale
//  Variablen vor (per <script>), unter Node kommen sie per require.
// ------------------------------------------------------------
function nodeRequire(name) {
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    return require(name);
  }
  return null;
}

function getPako() {
  if (typeof pako !== "undefined") return pako;
  const mod = nodeRequire("pako");
  if (!mod) throw new Error("pako ist nicht geladen.");
  return mod;
}

function getFzstd() {
  if (typeof fzstd !== "undefined") return fzstd;
  const mod = nodeRequire("fzstd");
  if (!mod) throw new Error("fzstd ist nicht geladen.");
  return mod;
}

// Pfad, unter dem sql-wasm.wasm im Web liegt (überschreibbar).
let wasmBase = "vendor/";
function setWasmBase(path) {
  wasmBase = path;
}

const utf8 = new TextDecoder("utf-8");

function asciiAt(u8, from, to) {
  let out = "";
  for (let i = from; i < to && i < u8.length; i++) out += String.fromCharCode(u8[i]);
  return out;
}

// ============================================================
//  Minimaler ZIP-Leser (nur was ein .apkg braucht)
// ============================================================
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEOCD(u8, dv) {
  const min = Math.max(0, u8.length - 65557);
  for (let i = u8.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

function readZip(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const u64 = (o) => Number(dv.getBigUint64(o, true));

  const eocd = findEOCD(u8, dv);
  if (eocd === -1) throw new Error("Keine gültige ZIP-Datei (.apkg erwartet).");

  let count = u16(eocd + 10);
  let cdOffset = u32(eocd + 16);

  // ZIP64, falls die 32-Bit-Felder übergelaufen sind
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locAt = eocd - 20;
    if (locAt >= 0 && u32(locAt) === SIG_EOCD64_LOC) {
      const z64 = u64(locAt + 8);
      if (z64 >= 0 && z64 + 56 <= u8.length && u32(z64) === SIG_EOCD64) {
        count = u64(z64 + 32);
        cdOffset = u64(z64 + 48);
      }
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > u8.length || u32(p) !== SIG_CENTRAL) break;
    const method = u16(p + 10);
    let compSize = u32(p + 20);
    let uncompSize = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    let localOffset = u32(p + 42);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = u16(e);
        const size = u16(e + 2);
        let q = e + 4;
        if (id === 0x0001) {
          if (uncompSize === 0xffffffff) { uncompSize = u64(q); q += 8; }
          if (compSize === 0xffffffff) { compSize = u64(q); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = u64(q); q += 8; }
          break;
        }
        e += 4 + size;
      }
    }

    entries.set(name, { method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    const lo = e.localOffset;
    if (lo + 30 > u8.length || u32(lo) !== SIG_LOCAL) {
      throw new Error("ZIP: defekter Eintrag " + name);
    }
    const nameLen = u16(lo + 26);
    const extraLen = u16(lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const raw = u8.subarray(start, start + e.compSize);
    if (e.method === 0) return raw;
    if (e.method === 8) return getPako().inflateRaw(raw);
    throw new Error("ZIP: nicht unterstützte Komprimierung (" + e.method + ")");
  }

  return { names: [...entries.keys()], read };
}

// ============================================================
//  SQLite (sql.js / WASM – kein nativer Build nötig)
// ============================================================
let SQL = null;
async function getSQL() {
  if (SQL) return SQL;

  // Browser: sql-wasm.js hängt initSqlJs an window, das .wasm kommt per URL.
  if (typeof initSqlJs !== "undefined") {
    SQL = await initSqlJs({ locateFile: (file) => wasmBase + file });
    return SQL;
  }

  // Node/Electron: Binary direkt einlesen, damit es auch in einer asar geht.
  const init = nodeRequire("sql.js");
  const fs = nodeRequire("fs");
  if (!init || !fs) throw new Error("sql.js ist nicht geladen.");
  const wasmBinary = fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"));
  SQL = await init({ wasmBinary });
  return SQL;
}

function queryAll(db, sql) {
  const out = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) out.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return out;
}

function hasTable(db, name) {
  return (
    queryAll(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0
  );
}

// ============================================================
//  Textaufbereitung (ausgelagert nach text-clean.js, damit der
//  Quizlet-Import dieselben Funktionen nutzt statt einer Kopie)
// ============================================================
const Text = (() => {
  if (typeof CvocText !== "undefined") return CvocText;
  const mod = nodeRequire("./text-clean.js");
  if (!mod) throw new Error("text-clean.js ist nicht geladen.");
  return mod;
})();

const decodeEntities = Text.decodeEntities;
const collapse = Text.collapse;
const htmlToText = Text.htmlToText;
const stripPronunciation = Text.stripPronunciation;

// ============================================================
//  Cloze-Zerlegung  ({{c1::Wort}} / {{c1::Wort::Hinweis}})
// ============================================================
const CLOZE_RE = /\{\{c(\d+)::/;

function hasCloze(text) {
  return CLOZE_RE.test(String(text || ""));
}

function parseCloze(text) {
  const segments = [];
  let cursor = 0;
  let search = 0;

  while (search < text.length) {
    const start = text.indexOf("{{c", search);
    if (start === -1) break;
    const m = CLOZE_RE.exec(text.slice(start, start + 24));
    if (!m || m.index !== 0) {
      search = start + 3;
      continue;
    }

    const contentStart = start + m[0].length;
    let depth = 1;
    let j = contentStart;
    let end = -1;
    while (j < text.length - 1) {
      if (text[j] === "{" && text[j + 1] === "{") { depth++; j += 2; continue; }
      if (text[j] === "}" && text[j + 1] === "}") {
        depth--;
        if (depth === 0) { end = j; break; }
        j += 2;
        continue;
      }
      j++;
    }
    if (end === -1) {
      search = contentStart;
      continue;
    }

    const inner = text.slice(contentStart, end);
    const hintAt = inner.indexOf("::");
    const value = hintAt === -1 ? inner : inner.slice(0, hintAt);
    const hint = hintAt === -1 ? "" : inner.slice(hintAt + 2);

    if (start > cursor) segments.push({ type: "text", value: text.slice(cursor, start) });
    segments.push({
      type: "cloze",
      ord: parseInt(m[1], 10),
      value: value.trim(),
      hint: hint.trim(),
    });
    cursor = end + 2;
    search = cursor;
  }

  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });
  return segments;
}

function blankFor(seg, blank, showHints) {
  return showHints && seg.hint ? `${blank} (${seg.hint})` : blank;
}

// Erzeugt {gap, word}-Paare aus einem Cloze-Text.
function clozePairs(text, opts) {
  const { clozeMode = "per", blank = "___", showHints = true } = opts || {};
  const segments = parseCloze(String(text || ""));
  const clozes = segments.filter((s) => s.type === "cloze");
  if (!clozes.length) return [];

  if (clozeMode === "all") {
    const gap = segments
      .map((s) => (s.type === "text" ? s.value : blankFor(s, blank, showHints)))
      .join("");
    const word = clozes.map((s) => s.value).join(", ");
    return [{ gap: collapse(gap), word: collapse(word) }];
  }

  const ords = [...new Set(clozes.map((s) => s.ord))].sort((a, b) => a - b);
  return ords.map((ord) => {
    const gap = segments
      .map((s) => {
        if (s.type === "text") return s.value;
        return s.ord === ord ? blankFor(s, blank, showHints) : s.value;
      })
      .join("");
    const word = clozes
      .filter((s) => s.ord === ord)
      .map((s) => s.value)
      .join(", ");
    return { gap: collapse(gap), word: collapse(word) };
  });
}

// ============================================================
//  .apkg öffnen
// ============================================================
const COLLECTION_CANDIDATES = ["collection.anki21b", "collection.anki21", "collection.anki2"];

function extractCollection(zip) {
  const problems = [];
  for (const name of COLLECTION_CANDIDATES) {
    let raw;
    try {
      raw = zip.read(name);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
      continue;
    }
    if (!raw || raw.length < 16) continue;

    let data = raw;
    // zstd-Magic 0x28 B5 2F FD
    if (raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd) {
      try {
        data = getFzstd().decompress(raw);
      } catch (e) {
        problems.push(`${name}: zstd – ${e.message}`);
        continue;
      }
    }
    if (asciiAt(data, 0, 15) !== "SQLite format 3") {
      problems.push(`${name}: keine SQLite-Datei`);
      continue;
    }
    return { name, data };
  }
  throw new Error(
    "In der Datei wurde keine lesbare Anki-Sammlung gefunden." +
      (problems.length ? " (" + problems.join("; ") + ")" : "")
  );
}

function readNotetypes(db) {
  const types = new Map();

  if (hasTable(db, "notetypes") && hasTable(db, "fields")) {
    for (const row of queryAll(db, "SELECT id, name FROM notetypes")) {
      types.set(String(row.id), {
        id: String(row.id),
        name: row.name || "Unbenannt",
        fields: [],
      });
    }
    for (const row of queryAll(db, "SELECT ntid, ord, name FROM fields ORDER BY ntid, ord")) {
      const t = types.get(String(row.ntid));
      if (t) t.fields[row.ord] = row.name || `Feld ${row.ord + 1}`;
    }
  } else if (hasTable(db, "col")) {
    const rows = queryAll(db, "SELECT models FROM col LIMIT 1");
    const json = rows.length ? rows[0].models : null;
    if (json) {
      let models = {};
      try {
        models = JSON.parse(json);
      } catch (e) {
        models = {};
      }
      for (const key of Object.keys(models)) {
        const m = models[key] || {};
        const fields = (m.flds || [])
          .slice()
          .sort((a, b) => (a.ord || 0) - (b.ord || 0))
          .map((f, i) => f.name || `Feld ${i + 1}`);
        const id = String(m.id != null ? m.id : key);
        types.set(id, { id, name: m.name || "Unbenannt", fields });
      }
    }
  }

  for (const t of types.values()) {
    for (let i = 0; i < t.fields.length; i++) {
      if (!t.fields[i]) t.fields[i] = `Feld ${i + 1}`;
    }
  }
  return types;
}

function splitTags(raw) {
  return String(raw == null ? "" : raw)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Zwischenspeicher, damit der Renderer nicht Tausende Notizen bekommt.
let cache = null;

// bytes: Uint8Array oder ArrayBuffer mit dem Inhalt der .apkg-Datei.
// label: nur zur Anzeige (Dateiname), rein kosmetisch.
async function openApkg(bytes, label) {
  const zip = readZip(bytes);
  const collection = extractCollection(zip);

  const SQLjs = await getSQL();
  const db = new SQLjs.Database(collection.data);

  try {
    if (!hasTable(db, "notes")) throw new Error("Die Sammlung enthält keine Notizen-Tabelle.");

    const types = readNotetypes(db);
    const notes = [];
    const tagCounts = new Map();

    for (const row of queryAll(db, "SELECT id, mid, tags, flds FROM notes")) {
      const fields = String(row.flds == null ? "" : row.flds).split("");
      const tags = splitTags(row.tags);
      const mid = String(row.mid);
      notes.push({ id: String(row.id), mid, tags, fields });
      for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    // Notiztypen anreichern: Anzahl, Cloze-Erkennung, Feldnamen absichern
    const typeInfo = new Map();
    for (const note of notes) {
      let info = typeInfo.get(note.mid);
      if (!info) {
        const t = types.get(note.mid);
        info = {
          id: note.mid,
          name: t ? t.name : "Unbekannter Notiztyp",
          fields: t ? t.fields.slice() : [],
          count: 0,
          clozeCount: 0,
          clozeFieldGuess: -1,
        };
        typeInfo.set(note.mid, info);
      }
      info.count++;
      while (info.fields.length < note.fields.length) {
        info.fields.push(`Feld ${info.fields.length + 1}`);
      }
      const clozeAt = note.fields.findIndex((f) => hasCloze(f));
      if (clozeAt !== -1) {
        info.clozeCount++;
        if (info.clozeFieldGuess === -1) info.clozeFieldGuess = clozeAt;
      }
    }

    const notetypes = [...typeInfo.values()]
      .map((t) => ({
        id: t.id,
        name: t.name,
        fields: t.fields,
        count: t.count,
        clozeCount: t.clozeCount,
        isCloze: t.clozeCount * 2 > t.count,
        clozeField: t.clozeFieldGuess === -1 ? 0 : t.clozeFieldGuess,
      }))
      .sort((a, b) => b.count - a.count);

    const tags = [...tagCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));

    cache = { label: label || "", notes, notetypes };

    return {
      file: label || "",
      source: collection.name,
      noteCount: notes.length,
      untaggedCount: notes.filter((n) => !n.tags.length).length,
      notetypes,
      tags,
    };
  } finally {
    db.close();
  }
}

// ============================================================
//  Karten bauen
// ============================================================
function matchesTags(note, selected, mode, includeUntagged) {
  if (!note.tags.length) return includeUntagged;
  if (!selected.length) return true;
  if (mode === "all") return selected.every((t) => note.tags.includes(t));
  return note.tags.some((t) => selected.includes(t));
}

function buildCards(options) {
  if (!cache) throw new Error("Es ist keine Anki-Datei geladen.");
  const o = options || {};

  const tags = o.tags || [];
  const tagMode = o.tagMode || "any";
  const includeUntagged = o.includeUntagged !== false;
  const notetypes = o.notetypes || {};
  const clozeMode = o.clozeMode || "per";
  const swap = o.swap !== false;
  const stripHtml = o.stripHtml !== false;
  const showHints = o.showHints !== false;
  const dedupe = o.dedupe !== false;
  const stripIpa = o.stripIpa !== false;
  const blank = o.blank || "___";
  const limit = o.limit || 0;

  const prep = (s) => {
    let t = stripHtml ? htmlToText(s) : collapse(s);
    if (stripIpa) t = stripPronunciation(t);
    return t;
  };
  const cards = [];
  const seen = new Set();
  let skippedEmpty = 0;
  let skippedDuplicate = 0;
  let skippedNoCloze = 0;

  for (const note of cache.notes) {
    const cfg = notetypes[note.mid];
    if (!cfg || cfg.include === false) continue;
    if (!matchesTags(note, tags, tagMode, includeUntagged)) continue;

    const pairs = [];

    if (cfg.mode === "cloze") {
      const text = prep(note.fields[cfg.clozeField] || "");
      const made = clozePairs(text, { clozeMode, blank, showHints });
      if (!made.length) {
        skippedNoCloze++;
        continue;
      }
      for (const p of made) {
        pairs.push(swap ? { question: p.gap, answer: p.word } : { question: p.word, answer: p.gap });
      }
    } else {
      const front = prep(note.fields[cfg.frontField] || "");
      const back = prep(note.fields[cfg.backField] || "");
      pairs.push({ question: front, answer: back });
    }

    for (const pair of pairs) {
      if (!pair.question || !pair.answer) {
        skippedEmpty++;
        continue;
      }
      if (dedupe) {
        const key = pair.question + " " + pair.answer;
        if (seen.has(key)) {
          skippedDuplicate++;
          continue;
        }
        seen.add(key);
      }
      cards.push({ question: pair.question, answer: pair.answer, amount: 5 });
    }
  }

  return {
    total: cards.length,
    skippedEmpty,
    skippedDuplicate,
    skippedNoCloze,
    cards: limit > 0 ? cards.slice(0, limit) : cards,
  };
}

function clearCache() {
  cache = null;
}

const CvocAnki = {
  openApkg,
  buildCards,
  clearCache,
  setWasmBase,
  _internals: {
    readZip,
    htmlToText,
    decodeEntities,
    parseCloze,
    clozePairs,
    hasCloze,
    stripPronunciation,
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = CvocAnki;
if (typeof window !== "undefined") window.CvocAnki = CvocAnki;
