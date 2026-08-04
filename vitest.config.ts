import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts', './tests/setup-frontend.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // 测试使用独立的测试数据库，避免清空生产数据
    env: {
      DATABASE_URL: 'mysql://root:root@localhost:3308/asset-manage-test',
    },
    coverage: {
      provider: 'v8',
      exclude: ['node_modules/', '.next/', 'src/app/', 'src/components/ui/'],
    },
  },
});
