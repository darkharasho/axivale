// vite.viewer.config.ts
// Standalone build for the public share-viewer SPA. Relative base so assets load
// under https://<user>.github.io/axivale-shares/. Output lands in out/share-viewer
// (packaged via the existing electron-builder `files: ["out/**/*"]`).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/share-viewer',
  base: './',
  plugins: [react()],
  // forge-render ships ?raw SVG imports that esbuild pre-bundling chokes on
  // (same reason electron.vite.config.ts excludes it for the renderer).
  optimizeDeps: { exclude: ['@axiapps/forge-render'] },
  build: {
    outDir: '../../out/share-viewer',
    emptyOutDir: true
  }
})
