import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// 纯服务端逻辑测试（server actions / 纯函数）。
// 注意：这些测试会写数据库，所以 DATABASE_URL 必须指向测试库；
// 而它没有加载 tests/setup.ts 的表清理，因此不要用本配置跑「依赖清库」的测试，
// 那类测试请用 npm run test（全量配置）。
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "tests/e2e"],
    env: {
      DATABASE_URL: "mysql://root:root@localhost:3306/asset-manage-test",
    },
  },
});
