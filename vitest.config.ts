import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts', './tests/setup-frontend.ts'],
    coverage: {
      provider: 'v8',
      exclude: ['node_modules/', '.next/', 'src/app/', 'src/components/ui/'],
    },
  },
});
