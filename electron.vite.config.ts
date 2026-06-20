import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import type { Plugin as EsbuildPlugin } from 'esbuild'

// forge-render imports its weapon/spec icons as `gw2-class-icons/.../X.svg?raw`.
// Vite's dev server understands `?raw` (returns the file as a string), but the
// esbuild dep-optimizer does not, so historically forge-render was excluded from
// optimization. Excluding it, however, leaves its CommonJS transitive dep
// `@axiapps/gw2-data/engine` to be served raw → `require is not defined` in the
// browser. The fix is to OPTIMIZE forge-render (so esbuild bundles the CJS engine
// to ESM) while teaching the optimizer to load `*.svg?raw` as text, matching
// Vite's runtime semantics. The production build already handles both via Rollup.
const svgRawPlugin: EsbuildPlugin = {
  name: 'svg-raw',
  setup(build) {
    build.onResolve({ filter: /\.svg\?raw$/ }, async (args) => {
      const resolved = await build.resolve(args.path.replace(/\?raw$/, ''), {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind
      })
      if (resolved.errors.length) return { errors: resolved.errors }
      return { path: resolved.path, namespace: 'svg-raw' }
    })
    build.onLoad({ filter: /.*/, namespace: 'svg-raw' }, async (args) => {
      const contents = await readFile(args.path, 'utf8')
      return { contents, loader: 'text' }
    })
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Second entry so the report summarizer compiles to its own worker file.
        // Keep `[name].js` naming so `index.js` stays the Electron main entry
        // (package.json "main"); the package is `type: module`, so the emitted
        // worker `.js` loads as ESM under worker_threads. EXCEPT
        // codexOfficerServer, which runs under PLAIN node (codex spawns it via
        // ELECTRON_RUN_AS_NODE=1) — plain node can't read app.asar to find the
        // `type: module` package.json, so it defaults .js to CJS and dies on
        // the ESM `import` syntax. Emit it as `.mjs` so node treats it as ESM
        // unconditionally.
        input: {
          index: 'src/main/index.ts',
          axibridgeWorker: 'src/main/axibridgeWorker.ts',
          // Standalone stdio MCP server Codex spawns; must compile to its own
          // sibling file so CodexAdapter can point Codex at it on disk.
          codexOfficerServer: 'src/main/providers/codexOfficerServer.ts'
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'codexOfficerServer' ? '[name].mjs' : '[name].js'
        }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    // Off Vite's default 5173 so AxiVale's dev server doesn't collide with the
    // sibling AxiForge repo's windowed dev (its `npm run dev` hardcodes vite on
    // 5173). electron-vite syncs VITE_DEV_SERVER_URL to whatever we pick here,
    // so the two can run side by side. strictPort:false → bump if 5273 is taken.
    server: { port: 5273, strictPort: false },
    plugins: [react()],
    optimizeDeps: {
      // Optimize forge-render (bundles its CJS dep gw2-data/engine to ESM) and
      // inline its `.svg?raw` icons via the plugin above.
      include: ['@axiapps/forge-render'],
      esbuildOptions: { plugins: [svgRawPlugin] }
    }
  }
})
