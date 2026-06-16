import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // globals exposes afterEach so @testing-library/react auto-cleans the DOM
    // between component tests; existing tests import from vitest explicitly.
    globals: true,
    environment: 'node',
    // forge-render imports `gw2-class-icons/...svg?raw`. As a registry dep it
    // lives in node_modules, which vitest externalizes by default → Node's
    // native loader chokes on `.svg` ("Unknown file extension"). Inline it so
    // Vite transforms the `?raw` SVG imports (the old file: symlink, treated as
    // source, got this for free).
    // jq-web is a CommonJS WASM module that itself resolves as a thenable. Under
    // vitest's default externalization, the ESM namespace wrapper breaks the
    // thenable interop ("Promise.prototype.then on incompatible receiver"). Inline
    // it so Vite transforms it to a proper CJS interop default export.
    server: { deps: { inline: [/@axiapps\/forge-render/, 'jq-web'] } },
    pool: 'forks',
    // User constraint: never exceed 2 workers (memory limits on this machine)
    poolOptions: { forks: { minForks: 1, maxForks: 2 } }
  }
})
