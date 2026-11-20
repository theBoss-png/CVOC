let cardCount = 2;
let savedQuizzes = [];
let currentQuiz = null;

async function initializeQuizzes() {
    const result = await CVOC.loadQuizzes();
    if (result.success) {
        savedQuizzes = result.quizzes;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeQuizzes();
    loadExistingQuiz(); // Neu hinzufügen
});


function addCard() {
    const container = document.getElementById("cardsContainer");
    const newCard = document.createElement("div");
    newCard.className = "card";
    newCard.setAttribute("data-card-index", cardCount);
    newCard.setAttribute("data-amount", 5);
    newCard.innerHTML = `
    <span class="card-number">${cardCount + 1}</span>
    <div class="card-inputs">
    <div class="card-input-group">
        <label class="input-label">Begriff</label>
        <input type="text" class="card-input" placeholder="Begriff eingeben" />
    </div>
    <div class="card-input-group">
        <label class="input-label">Definition</label>
        <input type="text" class="card-input" placeholder="Definition eingeben" />
    </div>
    </div>
    <button class="delete-card-btn" onclick="deleteCard(${cardCount})">×</button>
`;
    container.appendChild(newCard);
    cardCount++;
    updateCardNumbers();
}

function deleteCard(index) {
    const cards = document.querySelectorAll(".card");
    if (cards.length <= 2) {
        customAlertSimple({
            title: 'Hinweis',
            message: 'Ein Lernset muss mindestens 2 Karten enthalten!',
            confirmText: 'OK'
        });
        return;
    }
    const card = document.querySelector(`[data-card-index="${index}"]`);
    if (card) {
        card.remove();
        updateCardNumbers();
    }
}

function updateCardNumbers() {
    const cards = document.querySelectorAll(".card");
    cards.forEach((card, index) => {
        const numberSpan = card.querySelector(".card-number");
        numberSpan.textContent = index + 1;
        card.setAttribute("data-card-index", index);
        const deleteBtn = card.querySelector(".delete-card-btn");
        deleteBtn.setAttribute("onclick", `deleteCard(${index})`);
    });
    checkDuplicates();
}

// ----------------- Doppelte Wörter -----------------
// Gleiche Begriffe oder gleiche Definitionen werden markiert.
// Gross-/Kleinschreibung und Leerzeichen spielen keine Rolle.
// Speichern bleibt möglich, es gibt nur eine Warnung.
function dupKey(text) {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDuplicates() {
    const cards = [...document.querySelectorAll(".card")];
    const groups = [];
    [0, 1].forEach((col) => {
        const seen = new Map(); // Wert -> Kartennummern
        cards.forEach((card, i) => {
            const input = card.querySelectorAll(".card-input")[col];
            const key = input ? dupKey(input.value) : '';
            if (!key) return;
            if (!seen.has(key)) seen.set(key, []);
            seen.get(key).push(i);
        });
        seen.forEach((idxs) => {
            if (idxs.length > 1) {
                groups.push({ col, cards: idxs, text: cards[idxs[0]].querySelectorAll(".card-input")[col].value.trim() });
            }
        });
    });
    return groups;
}

function checkDuplicates() {
    const cards = [...document.querySelectorAll(".card")];
    cards.forEach((card) => {
        card.classList.remove("card-duplicate");
        card.querySelectorAll(".card-input").forEach((input) => {
            input.classList.remove("duplicate");
            input.removeAttribute("title");
        });
        card.querySelectorAll(".dup-hint").forEach((el) => el.remove());
    });

    const groups = findDuplicates();
    groups.forEach(({ col, cards: idxs }) => {
        idxs.forEach((i) => {
            const card = cards[i];
            const input = card.querySelectorAll(".card-input")[col];
            const others = idxs.filter((j) => j !== i).map((j) => j + 1);
            const label = col === 0 ? 'Begriff' : 'Definition';
            const msg = `${label} doppelt – auch in Karte ${others.join(', ')}`;
            card.classList.add("card-duplicate");
            input.classList.add("duplicate");
            input.title = msg;
            const hint = document.createElement("div");
            hint.className = "dup-hint";
            hint.textContent = msg;
            input.parentElement.appendChild(hint);
        });
    });

    let banner = document.getElementById("dupBanner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "dupBanner";
        banner.className = "dup-banner";
        const container = document.getElementById("cardsContainer");
        container.parentElement.insertBefore(banner, container);
    }
    if (groups.length) {
        banner.textContent = `⚠️ ${groups.length === 1 ? '1 doppelter Eintrag' : groups.length + ' doppelte Einträge'} – die betroffenen Karten sind rot markiert.`;
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
    return groups;
}

document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('card-input')) checkDuplicates();
});

function switchAllCards() {
    const cards = document.querySelectorAll(".card");
    cards.forEach((card) => {
        const inputs = card.querySelectorAll(".card-input");
        const begriffInput = inputs[0];
        const definitionInput = inputs[1];
        
        const temp = begriffInput.value;
        begriffInput.value = definitionInput.value;
        definitionInput.value = temp;
    });
    checkDuplicates();
}

function collectData() {
    const title = document.getElementById("setTitle").value.trim();
    const cards = document.querySelectorAll(".card");
    const cardData = [];

    if (!title) {
        customAlertSimple({
            title: 'Hinweis',
            message: 'Das Lernset benötigt einen Titel.',
            confirmText: 'OK'
        });;
        return null;
    }

    cards.forEach((card) => {
        const inputs = card.querySelectorAll(".card-input");
        const question = inputs[0].value.trim();
        const answer = inputs[1].value.trim();

        if (question && answer) {
            const amount = card.getAttribute('data-amount') ? parseInt(card.getAttribute('data-amount')) : 5;
            cardData.push({ question, answer, amount: amount });
        }
    });

    if (cardData.length < 2) {
        customAlertSimple({
            title: 'Hinweis',
            message: 'Ein Lernset muss mindestens 2 Karten enthalten!',
            confirmText: 'OK'
        });;
        return null;
    }

    return {
        name: title,
        cards: cardData,
    };
}

// ----------------- Fortschritt beim Bearbeiten -----------------
// Unveränderte Karten (gleicher Begriff + gleiche Definition) behalten ihren
// Lernstand, auch wenn sie verschoben wurden. Neue oder geänderte Karten
// beginnen wieder bei 5. Gibt die Anzahl zurückgesetzter Karten zurück.
const LEARN_SETTINGS_KEY = "cvoc.lernen.settings";
const LEARN_DEFAULTS = { minAmount: 2, maxAmount: 8 };

function learnCfg() {
    try {
        return { ...LEARN_DEFAULTS, ...JSON.parse(localStorage.getItem(LEARN_SETTINGS_KEY) || '{}') };
    } catch (e) {
        return { ...LEARN_DEFAULTS };
    }
}

function setPercent(cards) {
    const c = learnCfg();
    const n = cards.length;
    if (!n) return 0;
    const sum = cards.reduce((a, card) => a + (card.amount === undefined ? 5 : card.amount), 0);
    const worst = c.maxAmount * n;
    const best = c.minAmount * n;
    if (worst === best) return 100;
    return Math.round(((worst - sum) / (worst - best)) * 100);
}

function keepProgress(data, oldQuiz) {
    // Pro Inhalt eine Liste alter Stände, damit auch doppelte Karten passen
    const old = new Map();
    (oldQuiz.cards || []).forEach((card) => {
        const key = card.question.trim() + '\u0000' + card.answer.trim();
        if (!old.has(key)) old.set(key, []);
        old.get(key).push(card.amount === undefined ? 5 : card.amount);
    });

    let changed = 0;
    data.cards.forEach((card) => {
        const list = old.get(card.question + '\u0000' + card.answer);
        if (list && list.length) {
            card.amount = list.shift();
        } else {
            card.amount = 5;
            changed++;
        }
    });
    data.percent = setPercent(data.cards);
    return changed;
}

async function createSet() {
    const data = collectData();
    if (!data) return;

    const dups = checkDuplicates();
    if (dups.length) {
        const list = dups
            .map((d) => `${d.col === 0 ? 'Begriff' : 'Definition'} „${d.text}“ (Karten ${d.cards.map((i) => i + 1).join(', ')})`)
            .join('\n');
        const goOn = await customAlert({
            title: 'Doppelte Wörter',
            icon: '⚠️',
            message: `Diese Einträge kommen mehrfach vor:\n${list}\n\nTrotzdem speichern?`,
            confirmText: 'Trotzdem speichern',
            cancelText: 'Zurück'
        });
        if (!goOn) {
            const first = document.querySelector('.card-input.duplicate');
            if (first) {
                first.scrollIntoView({ behavior: 'smooth', block: 'center' });
                first.focus({ preventScroll: true });
            }
            return;
        }
    }

    // Prüfe ob ein Quiz mit diesem Namen bereits existiert
    const existingIndex = savedQuizzes.findIndex(q => q.name === data.name);
    
    if (existingIndex !== -1) {
        const changed = keepProgress(data, savedQuizzes[existingIndex]);

        // Quiz existiert bereits - Warnung anzeigen
        const confirmed = await customAlert({
            title: 'Lernset aktualisieren?',
            icon: '⚠️',
            message: changed === 0
                ? `Möchtest du das Lernset "${data.name}" aktualisieren? Dein Lernfortschritt bleibt erhalten.`
                : `Möchtest du das Lernset "${data.name}" aktualisieren? Bei ${changed === 1 ? '1 neuen oder geänderten Karte' : changed + ' neuen oder geänderten Karten'} beginnt der Lernfortschritt von vorne, alle anderen behalten ihn.`,
            confirmText: 'Bestätigen',
            cancelText: 'Abbrechen'
        });

        if (!confirmed) return;

        // Überschreibe das bestehende Quiz
        savedQuizzes[existingIndex] = data;
    } else {
        // Neues Quiz - füge percent hinzu
        data.percent = 50;
        savedQuizzes.push(data);
    }

    // Speichern...
    const result = await CVOC.saveQuizzes(savedQuizzes);

    if (result.success) {
        window.location.href = 'home.html';
    } else {
        await customAlertSimple({
            title: 'Fehler',
            message: 'Fehler beim Speichern: ' + result.error,
            confirmText: 'OK'
        });
    }
}


function loadExistingQuiz() {
    const quizData = localStorage.getItem('currentQuiz');
    if (!quizData) return;

    try {
        const quiz = JSON.parse(quizData);
        
        // Titel setzen
        document.getElementById("setTitle").value = quiz.name;
        
        // Bestehende Karten löschen (außer die ersten 2)
        const container = document.getElementById("cardsContainer");
        container.innerHTML = '';
        
        // Karten neu erstellen
        quiz.cards.forEach((card, index) => {
            const newCard = document.createElement("div");
            newCard.className = "card";
            newCard.setAttribute("data-card-index", index);
            newCard.innerHTML = `
                <div class="card-header">
                    <span class="card-number">${index + 1}</span>
                    <button class="delete-card-btn" onclick="deleteCard(${index})">×</button>
                </div>
                <div class="card-inputs">
                    <div class="card-input-group">
                        <label class="input-label">Begriff</label>
                        <input type="text" class="card-input" placeholder="Begriff eingeben" />
                    </div>
                    <div class="card-input-group">
                        <label class="input-label">Definition</label>
                        <input type="text" class="card-input" placeholder="Definition eingeben" />
                    </div>
                </div>
            `;
            // Werte direkt setzen statt ins HTML zu schreiben – sonst brechen
            // Anführungszeichen im Text das Eingabefeld.
            const inputs = newCard.querySelectorAll(".card-input");
            inputs[0].value = card.question;
            inputs[1].value = card.answer;
            container.appendChild(newCard);
            
            // Speichere amount als data-attribute für später
            if (card.amount !== undefined) {
                newCard.setAttribute('data-amount', card.amount);
            }
        });
        
        cardCount = quiz.cards.length;
        checkDuplicates();
        
        // Quiz-Daten aus localStorage entfernen
        localStorage.removeItem('currentQuiz');
        button = document.getElementById('btnErstellen');
        button.textContent = 'Lernset aktualisieren';
        
    } catch (e) {
        console.error('Fehler beim Laden des Quiz:', e);
    }
}

// Custom Alert Funktion
function customAlert(options) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customAlertOverlay');
        const icon = document.getElementById('alertIcon');
        const title = document.getElementById('alertTitle');
        const message = document.getElementById('alertMessage');
        const btnConfirm = document.getElementById('alertBtnConfirm');
        const btnCancel = document.getElementById('alertBtnCancel');

        // Setze Texte
        title.textContent = options.title || 'Achtung';
        icon.textContent = options.icon || '⚠️';
        message.textContent = options.message || '';
        btnConfirm.textContent = options.confirmText || 'Bestätigen';
        btnCancel.textContent = options.cancelText || 'Abbrechen';

        // Zeige Overlay
        overlay.classList.add('show');

        // Event Handler
        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };

        const cleanup = () => {
            overlay.classList.remove('show');
            btnConfirm.removeEventListener('click', handleConfirm);
            btnCancel.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleEscape);
        };

        // Event Listener hinzufügen
        btnConfirm.addEventListener('click', handleConfirm);
        btnCancel.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleEscape);
    });
}

// Einfache Alert-Funktion (nur OK Button)
function customAlertSimple(options) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('customAlertOverlay');
        const icon = document.getElementById('alertIcon');
        const title = document.getElementById('alertTitle');
        const message = document.getElementById('alertMessage');
        const btnConfirm = document.getElementById('alertBtnConfirm');
        const btnCancel = document.getElementById('alertBtnCancel');

        // Setze Texte
        title.textContent = options.title || 'Hinweis';
        icon.textContent = options.icon || 'ℹ️';
        message.textContent = options.message || '';
        btnConfirm.textContent = options.confirmText || 'OK';
        
        // Verstecke Cancel Button
        btnCancel.style.display = 'none';

        // Zeige Overlay
        overlay.classList.add('show');

        // Event Handler
        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleConfirm();
            }
        };

        const cleanup = () => {
            overlay.classList.remove('show');
            btnCancel.style.display = 'block'; // Zeige Cancel wieder für nächstes Mal
            btnConfirm.removeEventListener('click', handleConfirm);
            document.removeEventListener('keydown', handleEscape);
        };

        // Event Listener hinzufügen
        btnConfirm.addEventListener('click', handleConfirm);
        document.addEventListener('keydown', handleEscape);
    });
}