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
}

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

async function createSet() {
    const data = collectData();
    if (!data) return;

    // Prüfe ob ein Quiz mit diesem Namen bereits existiert
    const existingIndex = savedQuizzes.findIndex(q => q.name === data.name);
    
    if (existingIndex !== -1) {
        // Quiz existiert bereits - Warnung anzeigen
        const confirmed = await customAlert({
            title: 'Lernset aktualisieren?',
            icon: '⚠️',
            message: `Möchtest du das Lernset "${data.name}" aktualisieren? Du wirst deinen ganzen Fortschritt verlieren.`,
            confirmText: 'Bestätigen',
            cancelText: 'Abbrechen'
        });

        if (!confirmed) return;

        // Behalte den percent vom alten Quiz
        data.percent = savedQuizzes[existingIndex].percent;
        
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
                        <input type="text" class="card-input" placeholder="Begriff eingeben" value="${card.question}" />
                    </div>
                    <div class="card-input-group">
                        <label class="input-label">Definition</label>
                        <input type="text" class="card-input" placeholder="Definition eingeben" value="${card.answer}" />
                    </div>
                </div>
            `;
            container.appendChild(newCard);
            
            // Speichere amount als data-attribute für später
            if (card.amount !== undefined) {
                newCard.setAttribute('data-amount', card.amount);
            }
        });
        
        cardCount = quiz.cards.length;
        
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