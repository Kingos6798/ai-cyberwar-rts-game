import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the mobile build works from any folder or host (an app wrapper, a subpath).
  base: './',
  // Inline the UI font files into the CSS, so the game has no font requests (offline app, sandboxed hosts).
  build: { assetsInlineLimit: 64 * 1024 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
