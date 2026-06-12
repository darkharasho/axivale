import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    // User constraint: never exceed 2 workers (memory limits on this machine)
    poolOptions: { forks: { minForks: 1, maxForks: 2 } }
  }
})
