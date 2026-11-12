// ----------------- Karten-Daten laden -----------------
let cards = [];

// Versuch, aktuelles Quiz aus localStorage zu laden
const storedQuiz = localStorage.getItem('currentQuiz');
if (storedQuiz) {
  try {
    const quiz = JSON.parse(storedQuiz);
    cards = quiz.cards.map(c => ({
      term: c.question,
      definition: c.answer
    }));
  } catch (e) {
    console.error('Fehler beim Parsen des Quizzes:', e);
  }
}

// Wenn kein Quiz geladen, Standardkarten benutzen
if (cards.length === 0) {
  cards = [
    { term: "HTML", definition: "HyperText Markup Language - Strukturierungssprache für Webseiten" },
    { term: "CSS", definition: "Cascading Style Sheets - Sprache zur Gestaltung von Webseiten" },
    { term: "JavaScript", definition: "Programmiersprache für interaktive Webseiten" },
    { term: "API", definition: "Application Programming Interface - Schnittstelle für Softwareanwendungen" },
    { term: "DOM", definition: "Document Object Model - Programmierschnittstelle für HTML-Dokumente" }
  ];
}

// ----------------- Karten mischen -----------------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

cards = shuffle(cards);

// ----------------- State -----------------
let deck = cards.slice();   // Karten im aktuellen Durchgang
let unknownCards = [];      // in diesem Durchgang als "noch nicht gelernt" markiert
let knownTotal = 0;         // insgesamt gelernte Karten
let round = 1;
let currentIndex = 0;
let isRevealed = false;
let isAnimating = false;
let summaryOpen = false;
let finished = false;
let askForDefinition = true; // Standard: Nach Definition fragen

// ----------------- DOM Elemente -----------------
const termElement = document.getElementById("term");
const definitionElement = document.getElementById("definition");
const definitionCard = document.getElementById("definitionCard");
const cardContainer = document.getElementById("cardContainer");
const currentElement = document.getElementById("current");
const totalElement = document.getElementById("total");
const roundElement = document.getElementById("round");
const knownCountElement = document.getElementById("knownCount");
const unknownCountElement = document.getElementById("unknownCount");
const modeToggle = document.getElementById("modeToggle");
const modeText = document.getElementById("modeText");
const btnKnown = document.getElementById("btnKnown");
const btnUnknown = document.getElementById("btnUnknown");

const summary = document.getElementById("summary");
const summaryTitle = document.getElementById("summaryTitle");
const summarySubtitle = document.getElementById("summarySubtitle");
const summaryHint = document.getElementById("summaryHint");
const pie = document.getElementById("pie");
const piePercent = document.getElementById("piePercent");
const legendKnown = document.getElementById("legendKnown");
const legendUnknown = document.getElementById("legendUnknown");
const btnContinue = document.getElementById("btnContinue");
const btnHome = document.getElementById("btnHome");

// ----------------- Karten-Funktionen -----------------
function init() {
  showCard();
}

function updateCounters() {
  roundElement.textContent = round;
  totalElement.textContent = deck.length;
  currentElement.textContent = Math.min(currentIndex + 1, deck.length);
  knownCountElement.textContent = knownTotal;
  unknownCountElement.textContent = unknownCards.length;
}

function showCard() {
  definitionCard.classList.add("hidden");
  definitionCard.classList.remove("revealed");
  isRevealed = false;

  const card = deck[currentIndex];
  if (askForDefinition) {
    termElement.textContent = card.term;
    definitionElement.textContent = card.definition;
  } else {
    termElement.textContent = card.definition;
    definitionElement.textContent = card.term;
  }

  updateCounters();
}

function toggleReveal() {
  isRevealed = !isRevealed;
  definitionCard.classList.toggle("hidden", !isRevealed);
  definitionCard.classList.toggle("revealed", isRevealed);
}

// Karte als gelernt (true) oder noch nicht gelernt (false) einsortieren
function answer(known) {
  if (isAnimating || summaryOpen || finished) return;
  isAnimating = true;

  const card = deck[currentIndex];
  if (known) knownTotal++;
  else unknownCards.push(card);
  updateCounters();

  const cls = known ? "swipe-right" : "swipe-left";
  cardContainer.classList.add(cls);

  setTimeout(() => {
    cardContainer.classList.remove(cls);
    isAnimating = false;
    currentIndex++;
    if (currentIndex >= deck.length) {
      showSummary();
    } else {
      showCard();
    }
  }, 280);
}

function showSummary() {
  summaryOpen = true;
  const total = cards.length;
  const unknown = unknownCards.length;
  const percent = total ? Math.round((knownTotal / total) * 100) : 0;
  const deg = total ? (knownTotal / total) * 360 : 0;

  pie.style.setProperty("--known-deg", deg + "deg");
  piePercent.textContent = percent + "%";
  legendKnown.textContent = knownTotal;
  legendUnknown.textContent = unknown;

  const roundKnown = deck.length - unknown;
  if (unknown === 0) {
    finished = true;
    summaryTitle.textContent = "Alles gelernt! 🎉";
    summarySubtitle.textContent = round === 1
      ? `Du hast alle ${total} Karten im ersten Durchgang gewusst.`
      : `Du hast alle ${total} Karten in ${round} Durchgängen gelernt.`;
    btnContinue.textContent = "Nochmal von vorne";
    btnHome.classList.remove("hidden");
  } else {
    summaryTitle.textContent = `Zwischenstand – Durchgang ${round}`;
    summarySubtitle.textContent =
      `In diesem Durchgang: ${roundKnown} von ${deck.length} gewusst.`;
    btnContinue.textContent = unknown === 1
      ? "Weiter mit 1 Karte"
      : `Weiter mit ${unknown} Karten`;
    btnHome.classList.add("hidden");
  }

  summary.classList.remove("hidden");
}

function continueFromSummary() {
  summary.classList.add("hidden");
  summaryOpen = false;

  if (finished) {
    // Komplett neu starten
    finished = false;
    knownTotal = 0;
    round = 1;
    deck = shuffle(cards.slice());
  } else {
    // Nur die noch nicht gelernten Karten erneut abfragen
    round++;
    deck = shuffle(unknownCards.slice());
  }
  unknownCards = [];
  currentIndex = 0;
  showCard();
}

function toggleMode() {
  askForDefinition = !askForDefinition;
  modeToggle.classList.toggle("active");
  modeText.textContent = askForDefinition ? "Definition" : "Begriff";
  if (!summaryOpen) showCard();
}

// ----------------- Event Listener -----------------
modeToggle.addEventListener("click", toggleMode);
btnKnown.addEventListener("click", () => answer(true));
btnUnknown.addEventListener("click", () => answer(false));
btnContinue.addEventListener("click", continueFromSummary);
definitionCard.addEventListener("click", () => {
  if (suppressClick) { suppressClick = false; return; }
  if (!summaryOpen) toggleReveal();
});

// ----------------- Wischen (nur Touch) -----------------
// Rechts = gelernt, links = noch nicht gelernt. Die Maus bleibt
// unberührt, damit sich am Computer nichts ändert.
const SWIPE_THRESHOLD = 80; // px, ab hier zählt das Loslassen als Antwort
let swipeStartX = 0;
let swipeStartY = 0;
let swipeDx = 0;
let swipePointer = null;
let swipeHorizontal = null; // null = Richtung noch unklar
let suppressClick = false;

function setSwipeVisual(dx) {
  cardContainer.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
  const strength = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
  cardContainer.style.setProperty("--swipe-strength", strength);
  cardContainer.classList.toggle("dragging-right", dx > 0);
  cardContainer.classList.toggle("dragging-left", dx < 0);
}

function resetSwipeVisual() {
  cardContainer.classList.remove("dragging", "dragging-right", "dragging-left");
  cardContainer.style.transform = "";
  cardContainer.style.removeProperty("--swipe-strength");
}

cardContainer.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch" || isAnimating || summaryOpen || finished) return;
  swipePointer = e.pointerId;
  swipeStartX = e.clientX;
  swipeStartY = e.clientY;
  swipeDx = 0;
  swipeHorizontal = null;
});

cardContainer.addEventListener("pointermove", (e) => {
  if (e.pointerId !== swipePointer) return;
  const dx = e.clientX - swipeStartX;
  const dy = e.clientY - swipeStartY;

  if (swipeHorizontal === null) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    swipeHorizontal = Math.abs(dx) > Math.abs(dy);
    if (!swipeHorizontal) { swipePointer = null; return; } // senkrecht = scrollen
    cardContainer.classList.add("dragging");
  }

  swipeDx = dx;
  setSwipeVisual(dx);
});

function endSwipe(e) {
  if (e.pointerId !== swipePointer) return;
  swipePointer = null;
  if (!swipeHorizontal) return;

  suppressClick = true; // kein "Aufdecken" nach einer Wischbewegung
  setTimeout(() => { suppressClick = false; }, 350);

  const dx = swipeDx;
  cardContainer.classList.remove("dragging");
  if (e.type === "pointerup" && Math.abs(dx) >= SWIPE_THRESHOLD) {
    // Von der aktuellen Position aus wegfliegen lassen
    cardContainer.style.transform = "";
    cardContainer.classList.remove("dragging-right", "dragging-left");
    cardContainer.style.removeProperty("--swipe-strength");
    answer(dx > 0);
  } else {
    resetSwipeVisual(); // zurückschnappen
  }
}

cardContainer.addEventListener("pointerup", endSwipe);
cardContainer.addEventListener("pointercancel", endSwipe);

document.addEventListener("keydown", (e) => {
  if (summaryOpen) {
    if (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter") {
      e.preventDefault();
      continueFromSummary();
    }
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    if (!isAnimating) toggleReveal();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    answer(false);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    answer(true);
  }
});

// ----------------- Start -----------------
init();
