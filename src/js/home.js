
let savedQuizzes = [];
let currentQuiz = null;

// ----------------- Hilfsfunktionen -----------------
function uint8ToBase64(u8Arr) {
    const CHUNK_SIZE = 0x8000;
    const arr = [];
    for (let i = 0; i < u8Arr.length; i += CHUNK_SIZE) {
        arr.push(String.fromCharCode.apply(null, u8Arr.subarray(i, i + CHUNK_SIZE)));
    }
    return btoa(arr.join(''));
}

function base64ToUint8(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function compressQuiz(quiz) {
    const serialized = JSON.stringify(quiz);
    const compressed = pako.deflate(serialized);
    return uint8ToBase64(compressed);
}

function decompressQuiz(base64) {
    try {
        const compressed = base64ToUint8(base64);
        const decompressed = pako.inflate(compressed, { to: 'string' });
        return JSON.parse(decompressed);
    } catch (e) {
        console.error('Fehler beim Dekomprimieren:', e);
        return null;
    }
}

// ----------------- Private/Public Daten -----------------
function stripPrivateData(quiz) {
    return {
        name: quiz.name,
        cards: quiz.cards.map(c => ({ question: c.question, answer: c.answer }))
    };
}

function addPrivateData(quiz) {
    return {
        name: quiz.name,
        percent: quiz.percent !== undefined ? quiz.percent : 50,
        cards: quiz.cards.map(c => ({
            question: c.question,
            answer: c.answer,
            amount: c.amount !== undefined ? c.amount : 5
        }))
    };
}

// ----------------- Quiz laden -----------------
async function loadQuizzes() {
    try {
        const result = await CVOC.loadQuizzes();
        
        if (result.success) {
            savedQuizzes = result.quizzes.map(addPrivateData);
            savedQuizzes.forEach(addQuizItem);
        } else {
            await customAlertSimple({ // ✅ await hinzugefügt
                title: 'Fehler',
                icon: '❌',
                message: 'Lernsets konnten nicht geladen werden: ' + result.error,
                confirmText: 'OK'
            });
        }
    } catch (e) {
        console.error('Fehler beim Laden:', e);
        await customAlertSimple({ // ✅ await hinzugefügt
            title: 'Fehler',
            icon: '❌',
            message: 'Lernsets konnten nicht geladen werden: ' + e.message,
            confirmText: 'OK'
        });
    }
}


// ----------------- Sidebar -----------------
function addQuizItem(quiz) {
    const quizList = document.getElementById('quizList');
    const div = document.createElement('div');
    div.className = 'quiz-item';
    div.innerHTML = `
        <div>
            <div class="quiz-name">${quiz.name}</div>
            <div class="quiz-meta">${quiz.cards.length} Wörter</div>
        </div>
        <div class="quiz-score">${quiz.percent}%</div>
    `;
    div.addEventListener('click', () => loadQuizToInput(quiz));
    quizList.appendChild(div);
}

// ----------------- Quiz Info -----------------
function showQuizInfo(quiz, isSaved) {
    currentQuiz = quiz;
    const card = document.getElementById('quizInfoCard');
    const name = document.getElementById('quizInfoName');
    const meta = document.getElementById('quizInfoMeta');
    const btnSave = document.getElementById('btnSave');
    const btnDelete = document.getElementById('btnDelete');
    const btnCreate = document.getElementById('btnCreate');

    name.textContent = quiz.name;
    meta.textContent = `${quiz.cards.length} Wörter`;

    btnSave.style.display = isSaved ? 'none' : 'block';
    btnDelete.style.display = isSaved ? 'block' : 'none';

    if (isSaved) {
        btnCreate.textContent = 'Bearbeiten';
    } else {
        btnCreate.textContent = 'Erstellen';
    }

    card.classList.add('show');
}

// ----------------- Input überwachen -----------------
document.getElementById('text-input').addEventListener('input', e => {
    const value = e.target.value.trim();
    if (!value) {
        document.getElementById('quizInfoCard').classList.remove('show');
        currentQuiz = null;
        return;
    }
    const quiz = decompressQuiz(value);
    if (quiz) {
        const quizWithPrivateData = addPrivateData(quiz);
        const isSaved = savedQuizzes.some(q => q.name === quizWithPrivateData.name);
        showQuizInfo(quizWithPrivateData, isSaved);
    } else {
        document.getElementById('quizInfoCard').classList.remove('show');
        currentQuiz = null;
        // ✅ Korrekt: Element per ID holen
        const btnCreate = document.getElementById('btnCreate');
        btnCreate.textContent = 'Erstellen';
    }
});


// ----------------- Quiz in Input laden -----------------
function loadQuizToInput(quiz) {
    const input = document.getElementById('text-input');
    input.value = compressQuiz(stripPrivateData(quiz));
    const isSaved = savedQuizzes.some(q => q.name === quiz.name);
    showQuizInfo(quiz, isSaved);
}

// ----------------- Save/Delete -----------------
document.getElementById('btnSave').addEventListener('click', async () => {
    if (!currentQuiz) return;

    const existingIndex = savedQuizzes.findIndex(q => q.name === currentQuiz.name);
    
    if (existingIndex === -1) {
        savedQuizzes.push(currentQuiz);
    } else {
        savedQuizzes[existingIndex] = currentQuiz;
    }

    const result = await CVOC.saveQuizzes(savedQuizzes);
    
    if (result.success) {
        // ✅ Sidebar komplett neu laden
        const quizList = document.getElementById('quizList');
        quizList.innerHTML = '';
        savedQuizzes.forEach(addQuizItem);
        
        showQuizInfo(currentQuiz, true);
        
        // Optional: Erfolgs-Feedback
        await customAlertSimple({
            title: 'Gespeichert',
            icon: '✅',
            message: `Lernset "${currentQuiz.name}" wurde gespeichert.`,
            confirmText: 'OK'
        });
    } else {
        await customAlertSimple({
            title: 'Fehler',
            message: 'Fehler beim Speichern: ' + result.error,
            confirmText: 'OK'
        });
    }
});


document.getElementById('btnDelete').addEventListener('click', async () => {
    if (!currentQuiz) return;

    const quizName = currentQuiz.name;
    const btnCreate = document.getElementById('btnCreate');
    
    // ✅ ERST Bestätigung abwarten
    const confirmed = await customAlert({
        title: 'Warnung',
        icon: '🗑️',
        message: `Sind Sie sicher, dass das Lernset "${quizName}" gelöscht werden soll? Dies kann nicht rückgängig gemacht werden.`,
        confirmText: 'Löschen',
        cancelText: 'Abbrechen'
    });

    // ✅ Wenn abgebrochen, nichts tun
    if (!confirmed) return;

    // ✅ DANN erst löschen
    savedQuizzes = savedQuizzes.filter(q => q.name !== quizName);

    // ✅ UI aktualisieren
    const quizList = document.getElementById('quizList');
    quizList.innerHTML = '';
    savedQuizzes.forEach(addQuizItem);

    // ✅ Backend-Löschung
    const result = await CVOC.deleteQuiz(quizName);
    
    if (!result.success) {
        await customAlertSimple({
            title: 'Fehler',
            message: 'Fehler beim Löschen: ' + result.error,
            confirmText: 'OK'
        });
        btnCreate.textContent = 'Bearbeiten';
        // Optional: Quiz wieder hinzufügen bei Fehler
        // savedQuizzes.push(currentQuiz);
        // addQuizItem(currentQuiz);
        return;
    }

    // ✅ Erfolg - UI aufräumen
    document.getElementById('quizInfoCard').classList.remove('show');
    document.getElementById('text-input').value = '';
    currentQuiz = null;
});


// ----------------- Copy Button -----------------
const copyBtn = document.getElementById("copyBtn");
copyBtn.addEventListener("click", () => {
    const text = document.getElementById('text-input').value;
    navigator.clipboard.writeText(text)
        .then(() => {
            copyBtn.classList.add("copied");
            setTimeout(() => copyBtn.classList.remove("copied"), 2000);
        })
        .catch(err => console.error("Fehler beim Kopieren:", err));
});

// ----------------- Sidebar Toggle -----------------
document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('quizSidebar').classList.toggle('open');
});

// ----------------- Start / Create -----------------
// ----------------- Start / Create -----------------
document.getElementById('btnStart').addEventListener('click', () => {
    let quiz;
    
    if (currentQuiz) {
        quiz = currentQuiz;
    } else {
        const inputVal = document.getElementById('text-input').value.trim();
        
        // Prüfen, ob überhaupt Daten vorhanden sind
        if (!inputVal) {
            customAlertSimple({
                title: 'Hinweis',
                icon: '⚠️',
                message: 'Bitte erst ein Lernset laden oder erstellen, bevor du das Lernen startest.',
                confirmText: 'OK'
            });
            return;
        }
        
        quiz = decompressQuiz(inputVal);
        if (!quiz || !quiz.cards || quiz.cards.length === 0) {
            return;
        }
        quiz = addPrivateData(quiz);
    }

    localStorage.setItem('currentQuiz', JSON.stringify(quiz));
    window.location.href = 'lernen.html';
});

document.getElementById('btnCreate').addEventListener('click', () => {
    const inputVal = document.getElementById('text-input').value.trim();
    const quiz = decompressQuiz(inputVal);
    if (!quiz && inputVal) return;

    if (quiz) {
        const quizWithPrivateData = addPrivateData(quiz);
        localStorage.setItem('currentQuiz', JSON.stringify(quizWithPrivateData));
    } else {
        // Wenn kein Quiz geladen ist, lösche currentQuiz
        localStorage.removeItem('currentQuiz');
    }
    
    window.location.href = 'create.html';
});


// ----------------- Script starten -----------------
window.addEventListener('DOMContentLoaded', () => {
    loadQuizzes();
    loadVersion();
});

async function loadVersion() {
    try {
        const version = await CVOC.getVersion();
        const versionInfo = document.getElementById('versionInfo');
        versionInfo.textContent = `v${version}`;
    } catch (error) {
        console.error('Fehler beim Laden der Version:', error);
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

// ----------------- Quizlet-Import Button -----------------
document.getElementById('btnQuizlet').addEventListener('click', () => {
    window.location.href = 'quizlet.html';
});

// ----------------- Anki-Import Button -----------------
document.getElementById('btnAnki').addEventListener('click', () => {
    window.location.href = 'anki.html';
});

// ----------------- Karteikarten Button -----------------
document.getElementById('btnCards').addEventListener('click', () => {
    const inputVal = document.getElementById('text-input').value.trim();

    // Prüfen, ob überhaupt Daten vorhanden sind
    if (!inputVal) {
        customAlertSimple({
            title: 'Hinweis',
            icon: '⚠️',
            message: 'Bitte erst ein Lernset laden oder erstellen, bevor du die Karteikarten startest.',
            confirmText: 'OK'
        });
        return;
    }

    // Versuch, das Quiz zu dekomprimieren
    const quiz = decompressQuiz(inputVal);
    if (!quiz || !quiz.cards || quiz.cards.length === 0) {
        return;
    }

    // Quiz in localStorage speichern und zur Lernseite wechseln
    localStorage.setItem('currentQuiz', JSON.stringify(addPrivateData(quiz)));
    window.location.href = 'cards.html';
});
