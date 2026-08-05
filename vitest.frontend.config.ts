import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// 仅前端组件测试配置：不加载 DB 初始化（tests/setup.ts），
// 避免纯 UI 组件测试依赖 MySQL。
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup-frontend.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/", ".next/", "src/app/", "src/components/ui/"],
  },
});
