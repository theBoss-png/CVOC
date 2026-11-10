/* ============================================================
   CVOC – Quizlet-Import (Parser)

   Quizlet hat seit Jahren keine offene API mehr. Der offizielle
   Weg aus einem Set heraus ist der Export-Dialog:
     Set öffnen -> ⋯ -> Exportieren -> Trennzeichen wählen -> Text kopieren
   Dieser Parser nimmt genau solchen Text entgegen - und zusätzlich
   die üblichen Formen, die beim blossen Markieren und Kopieren
   entstehen.

   Läuft unter Node und im Browser.
   ============================================================ */

const CvocQuizlet = (() => {
  // ----------------- Trennzeichen -----------------
  // Reihenfolge = Vorrang bei gleichem Trefferanteil.
  const TERM_SEPARATORS = [
    { id: "tab", label: "Tabulator", value: "\t" },
    { id: "semicolon", label: "Semikolon", value: ";" },
    { id: "dash", label: "Bindestrich", value: " - " },
    { id: "endash", label: "Gedankenstrich", value: " – " },
    { id: "pipe", label: "Senkrechter Strich", value: "|" },
    { id: "equals", label: "Gleichzeichen", value: "=" },
    { id: "colon", label: "Doppelpunkt", value: ": " },
    { id: "comma", label: "Komma", value: "," },
  ];

  const CARD_SEPARATORS = [
    { id: "blankline", label: "Leerzeile", value: "\n\n" },
    { id: "newline", label: "Zeilenumbruch", value: "\n" },
    { id: "semicolons", label: "Zwei Semikolon", value: ";;" },
  ];

  function findSeparator(list, id) {
    return list.find((s) => s.id === id) || null;
  }

  // ----------------- Hilfen -----------------
  function normalizeNewlines(text) {
    return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  }

  // Nur am ERSTEN Vorkommen trennen: "Haus, house, home" wird dann
  // zu "Haus" + "house, home" statt in drei Teile zu zerfallen.
  function splitOnce(record, sep) {
    const at = record.indexOf(sep);
    if (at === -1) return null;
    return [record.slice(0, at), record.slice(at + sep.length)];
  }

  function stripNumbering(text) {
    return text.replace(/^\s*\d+\s*[.)\]]\s+/, "");
  }

  function cleanPart(text, options) {
    let t = String(text == null ? "" : text);
    t = t.replace(/ /g, " ");
    if (options.stripNumbering) t = stripNumbering(t);
    t = t.replace(/[ \t]+/g, " ").trim();
    // Anführungszeichen, die manche Tabellen-Exporte um jedes Feld legen
    if (t.length > 1 && /^".*"$/.test(t)) t = t.slice(1, -1).replace(/""/g, '"').trim();
    if (options.stripIpa && typeof CvocText !== "undefined") {
      t = CvocText.stripPronunciation(t);
    }
    return t;
  }

  // ----------------- Zerlegen -----------------
  // mode "separator": ein Datensatz pro Karte, Begriff/Definition per Trennzeichen
  // mode "alternating": Zeilen wechseln sich ab (Begriff, Definition, Begriff, ...)
  function parse(text, options) {
    const o = Object.assign(
      {
        mode: "separator",
        termSep: "\t",
        cardSep: "\n",
        swap: false,
        stripNumbering: true,
        stripIpa: true,
        dedupe: true,
      },
      options || {}
    );

    const raw = normalizeNewlines(text);
    const pairs = [];
    let skippedNoSeparator = 0;
    let skippedEmpty = 0;
    let skippedDuplicate = 0;

    if (o.mode === "alternating") {
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 >= lines.length) {
          skippedEmpty++;
          break;
        }
        pairs.push([lines[i], lines[i + 1]]);
      }
    } else {
      const records =
        o.cardSep === "\n\n"
          ? raw.split(/\n\s*\n/)
          : raw.split(o.cardSep);

      for (const record of records) {
        // Bei Leerzeilen-Trennung dürfen Felder selbst Umbrüche haben.
        const flat = o.cardSep === "\n\n" ? record : record;
        if (!flat.trim()) continue;
        const split = splitOnce(flat, o.termSep);
        if (!split) {
          skippedNoSeparator++;
          continue;
        }
        pairs.push(split);
      }
    }

    const cards = [];
    const seen = new Set();
    for (const [a, b] of pairs) {
      const first = cleanPart(a, o);
      const second = cleanPart(b, o);
      const question = o.swap ? second : first;
      const answer = o.swap ? first : second;

      if (!question || !answer) {
        skippedEmpty++;
        continue;
      }
      if (o.dedupe) {
        const key = question + "\u0000" + answer;
        if (seen.has(key)) {
          skippedDuplicate++;
          continue;
        }
        seen.add(key);
      }
      cards.push({ question, answer, amount: 5 });
    }

    return { cards, skippedNoSeparator, skippedEmpty, skippedDuplicate };
  }

  // ----------------- Automatische Erkennung -----------------
  // Jede Kombination wird daran gemessen, wie viele Datensätze sie
  // sauber in zwei nicht-leere Hälften zerlegt.
  function score(text, mode, termSep, cardSep) {
    const result = parse(text, {
      mode,
      termSep,
      cardSep,
      stripIpa: false,
      dedupe: false,
      stripNumbering: false,
    });
    const total =
      result.cards.length + result.skippedNoSeparator + result.skippedEmpty;
    if (!total || !result.cards.length) return { ratio: 0, count: 0 };
    return { ratio: result.cards.length / total, count: result.cards.length };
  }

  function detect(text) {
    const raw = normalizeNewlines(text);
    if (!raw.trim()) {
      return { mode: "separator", termSep: "\t", cardSep: "\n", confident: false };
    }

    let best = null;
    for (const card of CARD_SEPARATORS) {
      for (const term of TERM_SEPARATORS) {
        const s = score(raw, "separator", term.value, card.value);
        if (s.ratio < 0.6 || s.count < 1) continue;
        const candidate = {
          mode: "separator",
          termSep: term.value,
          cardSep: card.value,
          termId: term.id,
          cardId: card.id,
          ratio: s.ratio,
          count: s.count,
        };
        // Mehr saubere Karten gewinnt; bei Gleichstand der frühere Eintrag.
        if (!best || candidate.count > best.count) best = candidate;
      }
    }

    // Abwechselnde Zeilen: nur wenn kein Trennzeichen überzeugt hat
    // und eine gerade Zeilenzahl vorliegt.
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if ((!best || best.ratio < 0.9) && lines.length >= 4 && lines.length % 2 === 0) {
      const s = score(raw, "alternating", "\t", "\n");
      if (!best || s.count > best.count) {
        best = {
          mode: "alternating",
          termSep: "\t",
          cardSep: "\n",
          termId: "tab",
          cardId: "newline",
          ratio: s.ratio,
          count: s.count,
        };
      }
    }

    if (!best) {
      return { mode: "separator", termSep: "\t", cardSep: "\n", termId: "tab", cardId: "newline", confident: false, count: 0 };
    }
    best.confident = best.ratio >= 0.9;
    return best;
  }

  return {
    parse,
    detect,
    TERM_SEPARATORS,
    CARD_SEPARATORS,
    findSeparator,
    _internals: { splitOnce, cleanPart, stripNumbering, normalizeNewlines },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CvocQuizlet;
if (typeof window !== "undefined") window.CvocQuizlet = CvocQuizlet;
