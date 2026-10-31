// Programa de escritorio (Electron): abre la app compilada en un solo archivo
// (dist-file/index.html) en su propia ventana y ofrece diálogos nativos de Windows para
// abrir y guardar el archivo de proyecto compartido.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const FILTERS = [{ name: 'Proyecto de planta', extensions: ['json'] }];

// ---- Ajustes (último archivo de proyecto abierto) ----
const settingsFile = () => path.join(app.getPath('userData'), 'ajustes.json');
async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
async function writeSettings(patch) {
  const s = { ...(await readSettings()), ...patch };
  await fs.writeFile(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}

// La app solo puede leer o escribir archivos que la persona haya elegido en un diálogo
const allowed = new Set();
const fileInfo = (p) => ({ path: p, name: path.basename(p) });

ipcMain.handle('project:open', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Abrir archivo de proyecto',
    filters: FILTERS,
    properties: ['openFile'],
  });
  const p = r.filePaths?.[0];
  if (r.canceled || !p) return null;
  allowed.add(p);
  await writeSettings({ lastProject: p });
  return { ...fileInfo(p), text: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('project:saveAs', async (e, text) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Guardar archivo de proyecto',
    filters: FILTERS,
    defaultPath: 'proyecto-planta.json',
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, String(text), 'utf8');
  allowed.add(r.filePath);
  await writeSettings({ lastProject: r.filePath });
  return fileInfo(r.filePath);
});

ipcMain.handle('project:write', async (_e, p, text) => {
  if (!allowed.has(p)) throw new Error('archivo no autorizado');
  await fs.writeFile(p, String(text), 'utf8');
  return true;
});

ipcMain.handle('project:read', async (_e, p) => {
  if (!allowed.has(p)) throw new Error('archivo no autorizado');
  return { ...fileInfo(p), text: await fs.readFile(p, 'utf8') };
});

// Último archivo usado: se puede reabrir sin volver a elegirlo
ipcMain.handle('project:last', async () => {
  const { lastProject } = await readSettings();
  if (!lastProject) return null;
  try {
    await fs.access(lastProject);
    allowed.add(lastProject);
    return fileInfo(lastProject);
  } catch {
    return null;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Modelo 3D de oficina',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#eef1f5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist-file', 'index.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // Los enlaces externos se abren en el navegador; la ventana nunca sale de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });
}

// Una sola ventana: si se abre otra vez, se trae al frente la existente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  if (app.isPackaged) Menu.setApplicationMenu(null);
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
