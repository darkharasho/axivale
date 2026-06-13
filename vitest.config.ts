import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // globals exposes afterEach so @testing-library/react auto-cleans the DOM
    // between component tests; existing tests import from vitest explicitly.
    globals: true,
    environment: 'node',
    pool: 'forks',
    // User constraint: never exceed 2 workers (memory limits on this machine)
    poolOptions: { forks: { minForks: 1, maxForks: 2 } }
  }
})
