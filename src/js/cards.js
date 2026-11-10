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
let currentIndex = 0;
let isRevealed = false;
let askForDefinition = true; // Standard: Nach Definition fragen

// ----------------- DOM Elemente -----------------
const termElement = document.getElementById("term");
const definitionElement = document.getElementById("definition");
const definitionCard = document.getElementById("definitionCard");
const currentElement = document.getElementById("current");
const totalElement = document.getElementById("total");
const modeToggle = document.getElementById("modeToggle");
const modeText = document.getElementById("modeText");

// ----------------- Karten-Funktionen -----------------
function init() {
  totalElement.textContent = cards.length;
  showCard();
}

function showCard() {
  definitionCard.classList.add("hidden");
  definitionCard.classList.remove("revealed");
  isRevealed = false;

  if (askForDefinition) {
    termElement.textContent = cards[currentIndex].term;
    definitionElement.textContent = cards[currentIndex].definition;
  } else {
    termElement.textContent = cards[currentIndex].definition;
    definitionElement.textContent = cards[currentIndex].term;
  }

  currentElement.textContent = currentIndex + 1;
}

function revealDefinition() {
  definitionCard.classList.remove("hidden");
  definitionCard.classList.add("revealed");
  isRevealed = true;
}

function nextCard() {
  currentIndex = (currentIndex + 1) % cards.length;
  showCard();
}

function toggleMode() {
  askForDefinition = !askForDefinition;
  modeToggle.classList.toggle("active");
  modeText.textContent = askForDefinition ? "Definition" : "Begriff";
  showCard();
}

// ----------------- Event Listener -----------------
modeToggle.addEventListener("click", toggleMode);

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (!isRevealed) {
      revealDefinition();
    } else {
      nextCard();
    }
  }
});

// ----------------- Start -----------------
init();
