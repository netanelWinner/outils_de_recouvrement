// Processus principal Electron : fenêtre, sécurité, IPC, verrouillage.
import { app, BrowserWindow, ipcMain, Menu, powerMonitor, shell } from 'electron'
import { join } from 'node:path'
import { api, PUBLIC_METHODS } from './api'
import { auth } from './security/auth'
import { isOpen } from './db/connection'
import { scheduler } from './scheduler'
import { toUserMessage } from './errors'

let win: BrowserWindow | null = null

// Interface en français (champs de date JJ/MM/AAAA, correcteur orthographique)
app.commandLine.appendSwitch('lang', 'fr-FR')

// Tests automatisés : dossier de données isolé
if (process.env.RECOUVREMENT_DATA_DIR) app.setPath('userData', process.env.RECOUVREMENT_DATA_DIR)

// Une seule instance : un second lancement ramène la fenêtre existante.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Recouvrement',
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true
    }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  // Aucune navigation ni nouvelle fenêtre : les liens externes s'ouvrent dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  win.webContents.session.setSpellCheckerLanguages(['fr'])
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (win = null))
}

/** Un seul canal IPC : « espace.méthode » résolu dans la liste blanche `api`. */
function registerIpc(): void {
  ipcMain.handle('api', async (event, method: unknown, args: unknown) => {
    if (event.senderFrame?.url && !/^(file|http:\/\/localhost|http:\/\/127\.0\.0\.1)/.test(event.senderFrame.url)) {
      return { ok: false, error: 'Origine non autorisée' }
    }
    if (typeof method !== 'string' || !/^[a-zA-Z]+\.[a-zA-Z]+$/.test(method)) return { ok: false, error: 'Appel invalide' }
    const [ns, fn] = method.split('.')
    const target = Object.prototype.hasOwnProperty.call(api, ns) ? (api as Record<string, Record<string, unknown>>)[ns] : undefined
    const func = target && Object.prototype.hasOwnProperty.call(target, fn) ? target[fn] : undefined
    if (typeof func !== 'function') return { ok: false, error: `Fonction inconnue : ${method}` }
    if (!PUBLIC_METHODS.has(method) && !isOpen()) return { ok: false, error: 'L’application est verrouillée.', locked: true }
    try {
      const data = await (func as (...a: unknown[]) => unknown)(...(Array.isArray(args) ? args : []))
      return { ok: true, data }
    } catch (e) {
      console.error(`[${method}]`, e)
      return { ok: false, error: toUserMessage(e) }
    }
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('cg.hopital.recouvrement') // nécessaire pour les notifications Windows
  Menu.setApplicationMenu(null)
  registerIpc()
  scheduler.init(showWindow)
  createWindow()

  // Verrouillage automatique quand Windows est verrouillé ou mis en veille.
  const lockNow = () => {
    if (isOpen()) {
      auth.lock()
      win?.webContents.send('locked')
    }
  }
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
})

app.on('window-all-closed', () => {
  if (isOpen()) auth.lock()
  app.quit()
})

app.on('before-quit', () => {
  if (isOpen()) auth.lock()
})
