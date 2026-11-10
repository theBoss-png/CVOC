const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;

ipcMain.handle('get-version', () => {
    return app.getVersion();
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 1000,

        minWidth: 1200,   // minimale Breite
        minHeight: 850,   // minimale Höhe

        icon: path.join(__dirname, 'icon.icns'),

        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('src/html/home.html');
}


app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        // macOS: Fenster neu erstellen, wenn Dock-Symbol geklickt wird und keine Fenster offen sind
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', function () {
    // macOS: App bleibt aktiv, bis Cmd+Q gedrückt wird
});

// ----------------- IPC Handlers für Quiz-Speicherung -----------------

function getQuizzesPath() {
    return path.join(app.getPath('userData'), 'quizzes.json');
}

// Lade alle Quizzes
ipcMain.handle('load-quizzes', async () => {
    try {
        const filePath = getQuizzesPath();
        
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const quizzes = JSON.parse(content);
            return { success: true, quizzes };
        } catch (err) {
            if (err.code === 'ENOENT') {
                return { success: true, quizzes: [] };
            }
            throw err;
        }
    } catch (e) {
        console.error('Fehler beim Laden:', e);
        return { success: false, error: e.message };
    }
});

// Speichere alle Quizzes
ipcMain.handle('save-quizzes', async (event, quizzes) => {
    try {
        const filePath = getQuizzesPath();
        const dirPath = path.dirname(filePath);
        
        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(quizzes, null, 2), 'utf-8');

        return { success: true };
    } catch (e) {
        console.error('Fehler beim Speichern:', e);
        return { success: false, error: e.message };
    }
});

// Lösche ein Quiz
ipcMain.handle('delete-quiz', async (event, quizName) => {
    try {
        const filePath = getQuizzesPath();
        
        const content = await fs.readFile(filePath, 'utf-8');
        const quizzes = JSON.parse(content);
        
        const filteredQuizzes = quizzes.filter(q => q.name !== quizName);
        
        await fs.writeFile(filePath, JSON.stringify(filteredQuizzes, null, 2), 'utf-8');

        return { success: true };
    } catch (e) {
        console.error('Fehler beim Löschen:', e);
        return { success: false, error: e.message };
    }
});

// ----------------- IPC Handlers für den Anki-Import -----------------

const anki = require('./src/js/anki.js');

// Dateidialog
ipcMain.handle('anki:pick', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
            title: 'Anki-Datei wählen',
            buttonLabel: 'Öffnen',
            properties: ['openFile'],
            filters: [
                { name: 'Anki-Stapel', extensions: ['apkg', 'colpkg'] },
                { name: 'Alle Dateien', extensions: ['*'] }
            ]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: true, canceled: true };
        }
        return { success: true, path: result.filePaths[0] };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// .apkg einlesen und zusammenfassen
ipcMain.handle('anki:open', async (event, filePath) => {
    try {
        // anki.js ist umgebungsneutral und bekommt die Bytes, nicht den Pfad.
        const bytes = new Uint8Array(await fs.readFile(filePath));
        const info = await anki.openApkg(bytes, path.basename(filePath));
        return { success: true, info };
    } catch (e) {
        console.error('Anki-Import:', e);
        return { success: false, error: e.message };
    }
});

// Karten nach den gewählten Optionen bauen
ipcMain.handle('anki:build', async (event, options) => {
    try {
        return { success: true, result: anki.buildCards(options) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Zwischenspeicher freigeben
ipcMain.handle('anki:close', async () => {
    anki.clearCache();
    return { success: true };
});
