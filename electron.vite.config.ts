import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    // forge-render ships raw ESM with Vite `?raw` SVG imports; esbuild
    // pre-bundling chokes on the query suffix, so serve it as source.
    optimizeDeps: { exclude: ['@axiapps/forge-render'] }
  }
})
