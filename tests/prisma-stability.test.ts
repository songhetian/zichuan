import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "@prisma/client"
import fs from "fs"
import path from "path"

describe("Prisma 稳定性测试 - 防止DLL锁定导致空白页面", () => {
  describe("Prisma 客户端完整性", () => {
    it("Prisma Client 应该已正确生成", () => {
      const clientPath = path.resolve(
        __dirname,
        "..",
        "node_modules",
        "@prisma",
        "client"
      )
      const indexPath = path.join(clientPath, "index.js")
      expect(fs.existsSync(indexPath)).toBe(true)
    })

    it("Prisma 引擎文件应该存在", () => {
      const enginePath = path.resolve(
        __dirname,
        "..",
        "node_modules",
        ".prisma",
        "client",
        "query_engine-windows.dll.node"
      )
      expect(fs.existsSync(enginePath)).toBe(true)
    })

    it("Prisma schema 应该配置了 library 引擎类型", () => {
      const schemaPath = path.resolve(__dirname, "..", "prisma", "schema.prisma")
      const schemaContent = fs.readFileSync(schemaPath, "utf-8")
      expect(schemaContent).toContain("engineType = \"library\"")
    })

    it("Prisma Client 应该能够正常导入", async () => {
      const mod = await import("@prisma/client")
      expect(mod.PrismaClient).toBeDefined()
      expect(typeof mod.PrismaClient).toBe("function")
    })
  })

  describe("Prisma 数据库连接", () => {
    let prisma: PrismaClient

    beforeAll(() => {
      prisma = new PrismaClient()
    })

    afterAll(async () => {
      await prisma.$disconnect()
    })

    it("应该能够成功连接到数据库", async () => {
      const result = await prisma.$queryRaw`SELECT 1 as test`
      expect(result).toBeDefined()
    })

    it("应该能够查询资产表（验证基本功能）", async () => {
      const count = await prisma.asset.count()
      expect(typeof count).toBe("number")
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it("应该能够执行分组查询（Dashboard所需功能）", async () => {
      const groups = await prisma.asset.groupBy({
        by: ["status"],
        _count: { id: true },
      })
      expect(Array.isArray(groups)).toBe(true)
      groups.forEach((g) => {
        expect(g.status).toBeDefined()
        expect(g._count.id).toBeGreaterThanOrEqual(0)
      })
    })

    it("应该能够查询员工数据", async () => {
      const employees = await prisma.employee.findMany({ take: 5 })
      expect(Array.isArray(employees)).toBe(true)
    })

    it("应该能够查询配件库存数据", async () => {
      const stocks = await prisma.componentStock.findMany({ take: 5 })
      expect(Array.isArray(stocks)).toBe(true)
    })
  })

  describe("工具脚本完整性", () => {
    it("prisma-generate.js 脚本应该存在", () => {
      const scriptPath = path.resolve(
        __dirname,
        "..",
        "scripts",
        "prisma-generate.js"
      )
      expect(fs.existsSync(scriptPath)).toBe(true)
    })

    it("kill-node.js 脚本应该存在", () => {
      const scriptPath = path.resolve(
        __dirname,
        "..",
        "scripts",
        "kill-node.js"
      )
      expect(fs.existsSync(scriptPath)).toBe(true)
    })

    it("health-check.js 脚本应该存在", () => {
      const scriptPath = path.resolve(
        __dirname,
        "..",
        "scripts",
        "health-check.js"
      )
      expect(fs.existsSync(scriptPath)).toBe(true)
    })

    it("package.json 应该包含所有必要的脚本命令", () => {
      const pkgPath = path.resolve(__dirname, "..", "package.json")
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      const requiredScripts = [
        "dev",
        "predev",
        "build",
        "prisma:gen",
        "kill-node",
        "health",
        "dev:clean",
        "dev:restart",
      ]
      requiredScripts.forEach((script) => {
        expect(pkg.scripts[script]).toBeDefined()
      })
    })
  })
})
