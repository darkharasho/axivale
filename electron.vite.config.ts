import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Second entry so the report summarizer compiles to its own worker file.
        // Keep `[name].js` naming so `index.js` stays the Electron main entry
        // (package.json "main"); the package is `type: module`, so the emitted
        // worker `.js` loads as ESM under worker_threads.
        input: {
          index: 'src/main/index.ts',
          axibridgeWorker: 'src/main/axibridgeWorker.ts'
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    optimizeDeps: {
      // forge-render ships raw ESM with Vite `?raw` SVG imports; esbuild
      // pre-bundling chokes on the query suffix, so serve it as source.
      exclude: ['@axiapps/forge-render']
    }
  }
})
