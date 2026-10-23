import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every test spawns the CLI; give slow machines some room.
    testTimeout: 20000,
  },
});
