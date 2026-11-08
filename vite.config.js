import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const provider = env.VITE_LLM_PROVIDER || 'ollama'
  const model = env.VITE_GROQ_MODEL || 'openai/gpt-oss-20b'
  const apiUrl = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
  if (!['http:', 'https:'].includes(new URL(apiUrl).protocol)) throw new Error('VITE_API_URL must be an HTTP(S) URL')
  if (!['ollama', 'groq'].includes(provider)) throw new Error('VITE_LLM_PROVIDER must be ollama or groq')
  // Only these public settings enter the frontend. API keys stay on the backend.
  const config = JSON.stringify({ apiUrl, provider, groqModel: model }).replace(/</g, '\\u003c')
  return {
  resolve: {
    // Monaco also vendors DOMPurify inside its ESM tree. Use the patched
    // package for that relative import, as well as the npm dependency.
    alias: [{
      find: './dompurify/dompurify.js',
      replacement: fileURLToPath(new URL('./node_modules/dompurify/dist/purify.es.mjs', import.meta.url))
    }]
  },
  plugins: [react(), {
    name: 'pyglide-public-config',
    transformIndexHtml() {
      return [{ tag: 'script', children: `window.PYGLIDE_CONFIG = ${config};`, injectTo: 'head-prepend' }]
    }
  }, {
    name: 'pyglide-runtime-assets',
    apply: 'build',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (id.replaceAll('\\', '/').includes('/base/browser/dompurify/dompurify.js')) {
          throw new Error('Monaco must use the patched DOMPurify package, not its vendored copy.')
        }
      }
      for (const fileName of ['pyworker.js', 'sw.js']) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8')
        })
      }
    }
  }],
  server: {
    port: 3000,
    open: true
  }
  }
})
