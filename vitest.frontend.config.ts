import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// 仅前端组件测试配置：不加载 DB 初始化（tests/setup.ts），
// 避免纯 UI 组件测试依赖 MySQL。
//
// 两处防护（防的是「测试污染真实库」这类事故）：
//   1. include 只收 .tsx —— 服务端 / DB 测试归全量配置（vitest.config.ts），
//      它们需要 tests/setup.ts 的建表清理，混进来会在真实库上留下垃圾数据。
//   2. env.DATABASE_URL 强制指向测试库 —— 即使有测试间接访问数据库也碰不到真实数据。
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
    // 只跑 UI 组件测试；服务端/DB 测试用 npm run test
    include: ["tests/**/*.test.tsx"],
    exclude: ["node_modules/", ".next/", "src/app/", "src/components/ui/"],
    env: {
      DATABASE_URL: "mysql://root:root@localhost:3306/asset-manage-test",
    },
  },
});
