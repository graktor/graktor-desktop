// Graktor desktop — a thin native window around the live app. No bundled frontend, no local
// server: every install loads https://app.zendoriaventures.com directly and talks straight to
// the real API, exactly like a browser tab, just packaged as a real Windows app with its own
// icon/shortcut. The existing offline-POS support (IndexedDB queue, built into the web app
// itself) carries over here for free, since this is still just Chromium under the hood.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_URL = "https://app.zendoriaventures.com";
const STATE_FILE = path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { width: 1400, height: 900 };
  }
}

function saveWindowState(win) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(win.getBounds()));
  } catch {
    // Not remembering window position/size next launch is harmless -- never worth crashing over.
  }
}

// Only one copy running at a time -- a second launch just focuses the existing window
// instead of opening a confusing second one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    const state = loadWindowState();
    mainWindow = new BrowserWindow({
      ...state,
      minWidth: 900,
      minHeight: 600,
      title: "Graktor",
      backgroundColor: "#111318",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
      show: false,
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("resize", () => saveWindowState(mainWindow));
    mainWindow.on("move", () => saveWindowState(mainWindow));

    // A link meant to open in a new tab (e.g. an export download, a help link) opens in the
    // OS's real default browser instead of a second bare Electron window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return; // ERR_ABORTED -- a normal in-page navigation, not a real failure
      mainWindow.loadFile(path.join(__dirname, "offline.html"));
    });

    mainWindow.loadURL(APP_URL);

    // No menu bar -- this is meant to feel like an installed app, not a browser chrome
    // around one. Ctrl+R / Ctrl+Shift+I still work via the shortcuts below for support.
    mainWindow.setMenu(null);
  }

  app.whenReady().then(() => {
    // Every install's cookies/localStorage/IndexedDB are its own -- correct for "each PC
    // connects as whoever is signed in on that PC", same as separate browser profiles.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    createWindow();

    Menu.setApplicationMenu(null);

    const { globalShortcut } = require("electron");
    globalShortcut.register("CommandOrControl+R", () => mainWindow?.reload());
    globalShortcut.register("F5", () => mainWindow?.reload());
    globalShortcut.register("CommandOrControl+Shift+I", () => mainWindow?.webContents.toggleDevTools());
  });

  app.on("window-all-closed", () => app.quit());
}
