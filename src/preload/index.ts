// Pont sécurisé entre l'interface et le processus principal : seulement deux fonctions exposées.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onLocked: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('locked', listener)
    return () => ipcRenderer.removeListener('locked', listener)
  }
})
