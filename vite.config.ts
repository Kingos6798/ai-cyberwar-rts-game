import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the mobile build works from any folder or host (an app wrapper, a subpath).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
