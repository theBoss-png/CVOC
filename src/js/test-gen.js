/* ============================================================
   CVOC – Testmodus (Logik)

   Erzeugt Testfragen aus einem Lernset, prüft Antworten und
   rechnet Note, Genauigkeit und Statistik aus.

   Fragetypen:
     write – Begriff zeigen, Lösung eintippen
     mc    – Multiple Choice mit bis zu 4 Antworten
     tf    – Richtig oder falsch: ein Paar wird gezeigt, die Hälfte
             davon ist manipuliert (falsches Wörtchen, Schreibfehler
             oder die Übersetzung eines anderen Wortes)

   Für Französisch, Englisch und Deutsch gibt es eigene Fehler-
   Tabellen (le/la, a/an, der/die …), damit die Fehler realistisch
   und knifflig sind statt offensichtlich.

   Läuft unter Node und im Browser.
   ============================================================ */

const CvocTest = (() => {
  // ----------------- Zufall -----------------
  let rand = Math.random;

  function pick(list) {
    return list[Math.floor(rand() * list.length)];
  }

  function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ----------------- Antwortprüfung -----------------
  // Gleiche Regeln wie im Lernmodus, aber mit eigenen Optionen.
  const SPLIT_RE = /\s*[\/;|,]\s*/;

  function removeParentheses(text) {
    return text.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalize(text, o) {
    let t = String(text == null ? "" : text).trim();
    if (!o.checkCapitalized) t = t.toLowerCase();
    if (o.removeParentheses) t = removeParentheses(t);
    return t.replace(/\s+/g, " ").trim();
  }

  function splitVariants(text) {
    return text
      .split(SPLIT_RE)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isCorrect(userInput, solution, options) {
    const o = Object.assign(
      { checkCapitalized: false, removeParentheses: true, bothAnswers: false },
      options || {}
    );
    const answer = normalize(userInput, o);
    const correct = normalize(solution, o);
    if (!answer) return false;

    const correctParts = splitVariants(correct);
    const userParts = splitVariants(answer);
    if (correctParts.length <= 1) return answer === correct;

    if (o.bothAnswers) {
      if (userParts.length !== correctParts.length) return false;
      const rest = [...correctParts];
      for (const part of userParts) {
        const idx = rest.indexOf(part);
        if (idx === -1) return false;
        rest.splice(idx, 1);
      }
      return true;
    }
    return answer === correct || userParts.some((p) => correctParts.includes(p));
  }

  // Für Vergleiche "ist das dieselbe Antwort?" – grosszügig normalisiert.
  function sameText(a, b) {
    const n = (t) =>
      String(t || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return n(a) === n(b);
  }

  // ----------------- Spracherkennung -----------------
  const LANG_MARKERS = {
    fr: {
      words:
        /(^|[^\p{L}])(le|la|les|un|une|des|du|au|aux|qn|qc|est|et|je|tu|il|elle|nous|vous|ils|ne|pas|que|qui|se|ce|cette|avec|pour|dans|sur|être|avoir|faire)(?=$|[^\p{L}])/giu,
      chars: /[éèêëàâçùûôîïœ]|(^|\s)[ldsnjcm]'/giu,
    },
    en: {
      words:
        /(^|[^\p{L}])(the|a|an|to|of|and|is|are|be|you|it|in|on|with|for|sth|sb|someone|something|this|that|have|has|do|does)(?=$|[^\p{L}])/giu,
      chars: /'(s|t|re|ll|ve)\b/giu,
    },
    de: {
      words:
        /(^|[^\p{L}])(der|die|das|den|dem|des|ein|eine|einen|einem|sich|jdn|jdm|etw|etwas|und|ist|nicht|zu|auf|über|mit|von|sein|haben|werden)(?=$|[^\p{L}])/giu,
      chars: /[äöüß]/giu,
    },
  };

  function langScores(text) {
    const t = String(text || "");
    const scores = {};
    for (const [lang, m] of Object.entries(LANG_MARKERS)) {
      const w = (t.match(m.words) || []).length;
      const c = (t.match(m.chars) || []).length;
      scores[lang] = w * 2 + c;
    }
    return scores;
  }

  // Sprache einer ganzen Seite (alle Begriffe bzw. alle Definitionen).
  // Einzelne Wörter wie "laid,-e" verraten nichts – das ganze Set schon.
  function detectLanguage(texts) {
    const total = { fr: 0, en: 0, de: 0 };
    for (const t of texts) {
      const s = langScores(t);
      for (const k of Object.keys(total)) total[k] += s[k];
    }
    let best = null;
    for (const [k, v] of Object.entries(total)) {
      if (!best || v > total[best]) best = k;
    }
    return total[best] >= Math.max(3, texts.length * 0.3) ? best : null;
  }

  // ----------------- Fehler einbauen -----------------
  // Kleine Wörtchen, die sich leicht verwechseln lassen.
  // Jeder Eintrag: Wort -> mögliche falsche Ersatzwörter.
  const WORD_SWAPS = {
    fr: {
      le: ["la", "les"],
      la: ["le", "les"],
      les: ["des", "le", "la"],
      un: ["une"],
      une: ["un"],
      des: ["les", "de"],
      du: ["de", "des"],
      de: ["du", "à"],
      au: ["à la", "aux"],
      aux: ["au"],
      à: ["a", "de"],
      a: ["à"],
      ce: ["cet", "cette", "se"],
      cet: ["ce", "cette"],
      cette: ["ce", "cet"],
      ces: ["ses"],
      ses: ["ces", "sa"],
      son: ["sa", "ses"],
      sa: ["son", "ses"],
      mon: ["ma"],
      ma: ["mon"],
      ton: ["ta"],
      ta: ["ton"],
      se: ["ce", "s'en"],
      qui: ["que"],
      que: ["qui", "quoi"],
      et: ["est"],
      est: ["et", "ai"],
      ou: ["où"],
      où: ["ou"],
      en: ["dans", "y"],
      y: ["en"],
      dans: ["en", "sur"],
      sur: ["sous", "dans"],
      sous: ["sur"],
      pour: ["par"],
      par: ["pour"],
      lui: ["leur", "le"],
      leur: ["lui", "leurs"],
      leurs: ["leur"],
      ne: ["n'"],
      pas: ["plus"],
      plus: ["pas"],
      il: ["elle", "ils"],
      elle: ["il", "elles"],
      avant: ["après"],
      après: ["avant"],
      tout: ["tous", "toute"],
      tous: ["tout", "toutes"],
    },
    en: {
      a: ["an", "the"],
      an: ["a"],
      the: ["a"],
      in: ["on", "at"],
      on: ["in", "at"],
      at: ["in", "on"],
      to: ["too", "for"],
      too: ["to"],
      for: ["since", "to"],
      since: ["for"],
      their: ["there", "they're"],
      there: ["their"],
      "they're": ["their"],
      its: ["it's"],
      "it's": ["its"],
      your: ["you're"],
      "you're": ["your"],
      then: ["than"],
      than: ["then"],
      much: ["many"],
      many: ["much"],
      few: ["little"],
      little: ["few"],
      of: ["off"],
      off: ["of"],
      who: ["which"],
      which: ["who"],
      lose: ["loose"],
      loose: ["lose"],
      affect: ["effect"],
      effect: ["affect"],
      quite: ["quiet"],
      quiet: ["quite"],
      been: ["being"],
      by: ["with"],
      with: ["by"],
      up: ["down"],
      down: ["up"],
      make: ["do"],
      do: ["make"],
      sb: ["sth"],
      sth: ["sb"],
    },
    de: {
      der: ["die", "das"],
      die: ["der", "das"],
      das: ["der", "die", "dass"],
      dass: ["das"],
      den: ["dem"],
      dem: ["den"],
      ein: ["eine"],
      eine: ["ein"],
      einen: ["einem"],
      einem: ["einen"],
      jdn: ["jdm"],
      jdm: ["jdn"],
      sich: ["sie"],
      über: ["unter"],
      unter: ["über"],
      auf: ["an", "in"],
      an: ["auf"],
      mit: ["ohne"],
      vor: ["nach"],
      nach: ["vor"],
      seit: ["seid"],
      seid: ["seit"],
      wieder: ["wider"],
      wider: ["wieder"],
    },
  };

  const WORD_RE = /[\p{L}]+(?:'[\p{L}]+)?/gu;

  // Teile ausserhalb von Klammern – dort wird nichts verändert,
  // weil Klammerinhalte meist nur Zusatzinfos sind.
  function outsideParens(text) {
    const ranges = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") {
        if (depth === 0 && i > start) ranges.push([start, i]);
        depth++;
      } else if (text[i] === ")" && depth > 0) {
        depth--;
        if (depth === 0) start = i + 1;
      }
    }
    if (depth === 0 && start < text.length) ranges.push([start, text.length]);
    return ranges;
  }

  function wordsOf(text) {
    const out = [];
    for (const [from, to] of outsideParens(text)) {
      const part = text.slice(from, to);
      for (const m of part.matchAll(WORD_RE)) {
        out.push({ word: m[0], start: from + m.index, end: from + m.index + m[0].length });
      }
    }
    return out;
  }

  function matchCase(original, replacement) {
    if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  function replaceAt(text, w, replacement) {
    return text.slice(0, w.start) + replacement + text.slice(w.end);
  }

  // 1. Ein kleines Wörtchen austauschen (le -> la, a -> an, der -> die).
  function swapSmallWord(text, lang) {
    const table = WORD_SWAPS[lang];
    if (!table) return null;
    const candidates = wordsOf(text).filter((w) => table[w.word.toLowerCase()]);
    // französische Elision: l'homme -> le homme ist offensichtlich,
    // darum nur ganze Wörter.
    if (!candidates.length) return null;
    const w = pick(candidates);
    const replacement = matchCase(w.word, pick(table[w.word.toLowerCase()]));
    const result = replaceAt(text, w, replacement);
    return result === text ? null : { text: result, kind: "word", detail: `${w.word} → ${replacement}` };
  }

  // 2. Schreibfehler – passend zur Sprache.
  const ACCENT_SWAPS = {
    é: ["è", "e", "ê"],
    è: ["é", "e"],
    ê: ["è", "é", "e"],
    ë: ["é", "e"],
    à: ["a", "â"],
    â: ["a", "à"],
    ç: ["c"],
    ù: ["u"],
    û: ["u", "ù"],
    ô: ["o"],
    î: ["i", "ï"],
    ï: ["i", "î"],
  };
  const UMLAUT_SWAPS = { ä: ["a", "e"], ö: ["o"], ü: ["u"] };
  const DOUBLE_OK = /[bdfglmnprstz]/;

  // Liefert Varianten in Stufen: zuerst die subtilen, sprachtypischen
  // Fehler (Akzente, Umlaute, Endungen, Doppelkonsonanten), erst
  // zuletzt Buchstabendreher, weil die sofort auffallen.
  function spellingVariants(word, lang) {
    return spellingTiers(word, lang).flat();
  }

  function spellingTiers(word, lang) {
    const out = new Set();
    const doubles = new Set();
    const swaps = new Set();
    const chars = [...word];
    const n = chars.length;
    const lower = word.toLowerCase();

    // Akzente (Französisch)
    if (lang === "fr" || !lang) {
      chars.forEach((c, i) => {
        const alts = ACCENT_SWAPS[c.toLowerCase()];
        if (alts) for (const a of alts) out.add(chars.slice(0, i).join("") + a + chars.slice(i + 1).join(""));
      });
      // Akzent, wo keiner hingehört – nur in offener Silbe
      // ("retenir" -> "rétenir"), nicht vor "-er" am Wortende.
      chars.forEach((c, i) => {
        if (
          c === "e" &&
          i > 0 &&
          i < n - 2 &&
          /[bcdfgjlmnpqrstvz]/i.test(chars[i + 1]) &&
          /[aeiouy]/i.test(chars[i + 2])
        ) {
          out.add(chars.slice(0, i).join("") + "é" + chars.slice(i + 1).join(""));
        }
      });
      // typische Endungen
      if (/é$/.test(lower)) out.add(word.slice(0, -1) + "er");
      if (/er$/.test(lower) && n > 4) out.add(word.slice(0, -2) + "é");
      if (/ent$/.test(lower)) out.add(word.slice(0, -3) + "ant");
      if (/ant$/.test(lower)) out.add(word.slice(0, -3) + "ent");
      if (/eau$/.test(lower)) out.add(word.slice(0, -3) + "au");
      // Konjugations-/Angleichungsfehler: "tourne" -> "tournes"
      if (lang === "fr" && /[^aeiouy]e$/.test(lower) && n >= 4) out.add(word + "s");
      if (lang === "fr" && /ais$/.test(lower)) out.add(word.slice(0, -1) + "t");
      if (lang === "fr" && /ait$/.test(lower)) out.add(word.slice(0, -1) + "s");
    }

    // Umlaute (Deutsch)
    if (lang === "de") {
      chars.forEach((c, i) => {
        const alts = UMLAUT_SWAPS[c];
        const nearVowel =
          /[aeiouäöü]/i.test(chars[i - 1] || "") || /[aeiouäöü]/i.test(chars[i + 1] || "");
        if (alts && ("äöü".includes(c) || (i > 0 && !nearVowel))) {
          for (const a of alts) out.add(chars.slice(0, i).join("") + a + chars.slice(i + 1).join(""));
        }
      });
      if (lower.includes("ie")) out.add(word.replace(/ie/, "i"));
      if (lower.includes("ss")) out.add(word.replace(/ss/, "s"));
    }

    // ie/ei (Englisch, Deutsch)
    if (lang === "en" || lang === "de") {
      if (lower.includes("ie")) out.add(word.replace(/ie/, "ei"));
      if (lower.includes("ei")) out.add(word.replace(/ei/, "ie"));
    }
    if (lang === "en") {
      if (/ful$/.test(lower)) out.add(word + "l");
      if (/ly$/.test(lower) && n > 4) out.add(word.slice(0, -2) + "ley");
      if (/ence$/.test(lower)) out.add(word.slice(0, -4) + "ance");
      if (/ance$/.test(lower)) out.add(word.slice(0, -4) + "ence");
    }

    // Doppelkonsonanten – alle Sprachen
    for (let i = 1; i < n; i++) {
      const c = chars[i].toLowerCase();
      if (c === chars[i - 1].toLowerCase() && DOUBLE_OK.test(c)) {
        doubles.add(chars.slice(0, i).join("") + chars.slice(i + 1).join(""));
      }
    }
    for (let i = 1; i < n - 1; i++) {
      const c = chars[i].toLowerCase();
      // nur zwischen Vokalen verdoppeln – "abandonner" -> "abbandonner" wirkt echt
      if (
        DOUBLE_OK.test(c) &&
        /[aeiouyéèàâêîôû]/i.test(chars[i - 1]) &&
        /[aeiouyéèàâêîôû]/i.test(chars[i + 1])
      ) {
        doubles.add(chars.slice(0, i + 1).join("") + chars[i] + chars.slice(i + 1).join(""));
      }
    }

    // Buchstabendreher im Wortinneren (nur zwei Vokale tauschen: "eu" -> "ue")
    for (let i = 1; i < n - 2; i++) {
      if (chars[i] !== chars[i + 1] && /[aeiou]/i.test(chars[i]) && /[aeiou]/i.test(chars[i + 1])) {
        const c = [...chars];
        [c[i], c[i + 1]] = [c[i + 1], c[i]];
        swaps.add(c.join(""));
      }
    }

    const clean = (set) => [...set].filter((v) => v !== word);
    return [clean(out), clean(doubles), clean(swaps)];
  }

  function misspell(text, lang) {
    const words = wordsOf(text).filter((w) => [...w.word].length >= 4);
    if (!words.length) return null;
    // Stufe für Stufe über alle Wörter: lieber ein Akzentfehler im
    // zweiten Wort als ein Buchstabendreher im ersten.
    const shuffled = shuffle(words);
    const tiers = shuffled.map((w) => spellingTiers(w.word, lang));
    for (let tier = 0; tier < 3; tier++) {
      const options = [];
      shuffled.forEach((w, k) => tiers[k][tier].forEach((v) => options.push({ w, v })));
      if (!options.length) continue;
      const { w, v } = pick(options);
      return { text: replaceAt(text, w, v), kind: "spelling", detail: `${w.word} → ${v}` };
    }
    return null;
  }

  // Liefert eine falsche, aber plausible Variante – oder null.
  function mutate(text, lang, prefer) {
    const order =
      prefer === "spelling"
        ? [misspell, swapSmallWord]
        : prefer === "word"
          ? [swapSmallWord, misspell]
          : rand() < 0.55
            ? [swapSmallWord, misspell]
            : [misspell, swapSmallWord];
    for (const fn of order) {
      const r = fn(text, lang);
      if (r && !sameText(r.text, text)) return r;
    }
    return null;
  }

  // ----------------- Fragen bauen -----------------
  // Richtung pro Karte: "term" = Begriff zeigen, Definition fragen.
  function orient(card, direction) {
    const dir = direction === "mixed" ? (rand() < 0.5 ? "term" : "answer") : direction;
    return dir === "answer"
      ? { prompt: card.answer, solution: card.question, promptSide: "answer", solutionSide: "question" }
      : { prompt: card.question, solution: card.answer, promptSide: "question", solutionSide: "answer" };
  }

  // Andere Lösungen als Ablenker – möglichst ähnliche (Länge, Wortzahl,
  // gleiche Artikel), damit man nicht nur ausschliessen kann.
  function distractors(cards, cardIndex, side, solution, count) {
    const solWords = String(solution).toLowerCase().split(/\s+/);
    const scored = [];
    const seen = new Set([String(solution).toLowerCase().trim()]);
    cards.forEach((c, i) => {
      if (i === cardIndex) return;
      const text = side === "answer" ? c.answer : c.question;
      const key = String(text).toLowerCase().trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const words = key.split(/\s+/);
      let score = -Math.abs(key.length - solution.length) / Math.max(4, solution.length);
      score -= Math.abs(words.length - solWords.length) * 0.3;
      if (words[0] === solWords[0]) score += 0.6; // gleicher Artikel/Anfang
      score += rand() * 0.8;
      scored.push({ text, score });
    });
    scored.sort((a, b) => b.score - a.score);
    // Aus den ähnlichsten zufällig ziehen, nicht immer dieselben.
    const top = shuffle(scored.slice(0, Math.max(count * 2, 6)));
    return top.slice(0, count).map((s) => s.text);
  }

  function buildQuestion(type, cards, cardIndex, direction, langs) {
    const card = cards[cardIndex];
    const o = orient(card, direction);
    const q = {
      type,
      cardIndex,
      prompt: o.prompt,
      solution: o.solution,
      promptSide: o.promptSide,
      solutionSide: o.solutionSide,
    };

    if (type === "mc") {
      const solLang = langs[o.solutionSide];
      let wrong = [];
      // Eine Antwort ist oft eine verfälschte Version der richtigen –
      // so reicht ungefähres Wiedererkennen nicht.
      if (rand() < 0.5) {
        const m = mutate(o.solution, solLang);
        if (m) wrong.push(m.text);
      }
      for (const d of distractors(cards, cardIndex, o.solutionSide, o.solution, 3)) {
        if (wrong.length >= 3) break;
        if (!wrong.some((w) => sameText(w, d))) wrong.push(d);
      }
      // Kleines Set: mit weiteren Verfälschungen auffüllen.
      let guard = 0;
      while (wrong.length < 3 && guard++ < 10) {
        const m = mutate(o.solution, solLang);
        if (m && !wrong.some((w) => sameText(w, m.text))) wrong.push(m.text);
      }
      q.options = shuffle([o.solution, ...wrong]);
      q.correctOption = q.options.indexOf(o.solution);
    }

    if (type === "tf") {
      // Geprüft wird die Fremdsprache, wenn eine Seite FR/EN ist.
      const foreign = ["fr", "en"];
      let side = o.solutionSide;
      if (!foreign.includes(langs[side]) && foreign.includes(langs[o.promptSide])) side = o.promptSide;
      const lang = langs[side];

      q.shown = { prompt: o.prompt, solution: o.solution };
      q.isTrue = true;
      if (rand() < 0.5) {
        const original = side === o.promptSide ? o.prompt : o.solution;
        let fake = null;
        const roll = rand();
        if (roll < 0.85) {
          const m = mutate(original, lang, roll < 0.5 ? "word" : "spelling");
          if (m) fake = { text: m.text, kind: m.kind, detail: m.detail };
        }
        if (!fake) {
          const d = distractors(cards, cardIndex, side === o.promptSide ? o.promptSide : o.solutionSide, original, 1)[0];
          if (d) fake = { text: d, kind: "swap", detail: "" };
        }
        if (fake) {
          q.isTrue = false;
          q.fakeSide = side === o.promptSide ? "prompt" : "solution";
          q.fakeKind = fake.kind;
          q.fakeDetail = fake.detail;
          q.original = original;
          if (q.fakeSide === "prompt") q.shown.prompt = fake.text;
          else q.shown.solution = fake.text;
        }
      }
    }
    return q;
  }

  // types: ["write","mc","tf"], count: Anzahl Fragen (= Punkte)
  function buildTest(cards, options) {
    const o = Object.assign({ types: ["write"], count: 10, direction: "term", seed: null }, options || {});
    const usable = cards
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => String(c.question || "").trim() && String(c.answer || "").trim());
    if (!usable.length || !o.types.length) return [];

    const langs = {
      question: detectLanguage(cards.map((c) => c.question)),
      answer: detectLanguage(cards.map((c) => c.answer)),
    };

    const max = usable.length * o.types.length;
    const count = Math.max(1, Math.min(o.count, max));

    // Jede Karte kommt erst einmal dran, bevor sich eine wiederholt –
    // dann mit einem anderen Fragetyp.
    const usedTypes = new Map(); // cardIndex -> Set(types)
    const questions = [];
    let round = shuffle(usable);
    let typeCycle = shuffle(o.types);
    let t = 0;
    while (questions.length < count) {
      if (!round.length) round = shuffle(usable);
      const { i } = round.shift();
      const used = usedTypes.get(i) || new Set();
      let type = typeCycle[t++ % typeCycle.length];
      if (t % typeCycle.length === 0) typeCycle = shuffle(o.types);
      if (used.has(type)) {
        const free = o.types.filter((x) => !used.has(x));
        if (!free.length) continue;
        type = pick(free);
      }
      used.add(type);
      usedTypes.set(i, used);
      questions.push(buildQuestion(type, cards, i, o.direction, langs));
    }
    return shuffle(questions);
  }

  function maxQuestions(cards, types) {
    const usable = cards.filter((c) => String(c.question || "").trim() && String(c.answer || "").trim());
    return usable.length * Math.max(1, types.length);
  }

  // ----------------- Auswerten -----------------
  function scoreQuestion(q, response, checkOptions) {
    if (response == null || response === "") return false;
    if (q.type === "write") return isCorrect(response, q.solution, checkOptions);
    if (q.type === "mc") return response === q.correctOption;
    if (q.type === "tf") return response === q.isTrue;
    return false;
  }

  // Schweizer Notenskala: 1 + 5 · Punkte / Punkte-für-die-6
  function grade(points, max, scale) {
    const s = Object.assign({ fullAt: 100, rounding: 0.5 }, scale || {});
    if (!max) return 1;
    const needed = max * (s.fullAt / 100);
    const raw = Math.min(6, 1 + (5 * points) / needed);
    return roundGrade(raw, s.rounding);
  }

  function roundGrade(value, step) {
    if (!step) return Math.round(value * 100) / 100;
    return Math.min(6, Math.max(1, Math.round(value / step) * step));
  }

  // Genauigkeit: Wie sicher ist die Note bei so wenigen Punkten?
  // Agresti-Coull-Intervall (95 %) für den Anteil richtiger Antworten,
  // umgerechnet auf die Notenskala. Mehr Punkte = schmaleres Intervall.
  function gradeRange(points, max, scale) {
    const s = Object.assign({ fullAt: 100, rounding: 0.5 }, scale || {});
    if (!max) return { low: 1, high: 6, plusMinus: 2.5 };
    const z = 1.96;
    const n = max + z * z;
    const p = (points + (z * z) / 2) / n;
    const half = z * Math.sqrt((p * (1 - p)) / n);
    const toGrade = (share) => Math.min(6, Math.max(1, 1 + (5 * share * 100) / s.fullAt));
    const exact = toGrade(points / max);
    const low = toGrade(Math.max(0, points / max - half));
    const high = toGrade(Math.min(1, points / max + half));
    return {
      low: Math.round(low * 10) / 10,
      high: Math.round(high * 10) / 10,
      plusMinus: Math.round(((high - low) / 2) * 10) / 10,
      exact: Math.round(exact * 100) / 100,
    };
  }

  function summarize(questions, responses, checkOptions) {
    const byType = {};
    const mistakes = [];
    let points = 0;
    questions.forEach((q, i) => {
      const ok = scoreQuestion(q, responses[i], checkOptions);
      byType[q.type] = byType[q.type] || { right: 0, total: 0 };
      byType[q.type].total++;
      if (ok) {
        points++;
        byType[q.type].right++;
      } else {
        mistakes.push({ index: i, question: q, response: responses[i] });
      }
    });
    return { points, max: questions.length, byType, mistakes };
  }

  return {
    buildTest,
    maxQuestions,
    scoreQuestion,
    summarize,
    grade,
    gradeRange,
    isCorrect,
    mutate,
    detectLanguage,
    _internals: {
      spellingVariants,
      spellingTiers,
      swapSmallWord,
      misspell,
      outsideParens,
      setRandom: (fn) => (rand = fn || Math.random),
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CvocTest;
if (typeof window !== "undefined") window.CvocTest = CvocTest;
