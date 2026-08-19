import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// scripts/version.js is the single source of truth for the version and writes it to every
// package.json, so the UI reads it from there at build time rather than repeating it in source
// where it would silently go stale. Read rather than imported: the Node tsconfig is
// module: "nodenext" without resolveJsonModule, and this needs no extra compiler config.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
})
