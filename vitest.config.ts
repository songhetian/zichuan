import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// 全量测试配置（前端组件 + 服务端 action / DB）
//
// ⚠️ DATABASE_URL 必须指向【测试库】，绝不能是真实库：
//    测试库 asset-manage-test 在你本机的 MySQL（3306）里，
//    与真实库（Docker 3308 / asset-manage）物理隔离，测试清空表也伤不到真实数据。
//    另见 tests/db-guard.ts —— 即使这里的配置被改错，闸门也会把运行拦下来。
//
// 测试库不存在时先执行：npm run db test:init
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts", "./tests/setup-frontend.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // 独立的测试库：本机 MySQL 3306，库名 asset-manage-test
    env: {
      DATABASE_URL: "mysql://root:root@localhost:3306/asset-manage-test",
    },
    coverage: {
      provider: "v8",
      exclude: ["node_modules/", ".next/", "src/app/", "src/components/ui/"],
    },
  },
});
