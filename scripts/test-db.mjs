// Lance les tests d'intégration (vraie base SQLite chiffrée) avec le Node embarqué d'Electron,
// car le module natif SQLite est compilé pour Electron.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron') // chemin de l'exécutable
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const res = spawnSync(electron, [vitest, 'run', 'tests/services', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(res.status ?? 1)
