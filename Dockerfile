# ============================================================
# 阶段1: 安装依赖
# ============================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Prisma 引擎（libquery_engine）下载走国内镜像：
# 默认的 binaries.prisma.sh 国内服务器不可达，构建会在 npx prisma generate 卡死
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

# 安装 Prisma 运行所需的系统依赖
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install --ignore-scripts && \
    npx prisma generate

# ============================================================
# 阶段2: 构建应用
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app

# 同 deps：build 阶段的 prisma generate 也不回源官方（ engines 已随 node_modules 复制过来，仅兜底）
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

# 安装 Prisma 运行所需的系统依赖
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 确保 public 目录存在（Next.js standalone 需要）
RUN mkdir -p public

ENV DATABASE_URL="mysql://root:root@localhost:3306/asset-manage"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================================================
# 阶段3: 数据库初始化（仅供 db-init 容器使用，非默认构建目标）
# 复用 builder：自带完整源码 + tsconfig.json + node_modules，
# 使 tsx 能在容器内解析 @/* 别名运行 prisma/seed.ts。
# （standalone 运行镜像不含源码，直接跑 seed 会报 Cannot find package '@/lib'）
# ⚠️ 必须放在 runner 之前：多阶段构建以最后一个阶段为默认目标。
# ============================================================
FROM builder AS db-init

# ============================================================
# 阶段4: 生产运行（自定义 server.ts：启动时挂载 Socket.IO 供实时通知）
# ⚠️ 不能用 standalone server.js——它不含 server.ts 挂载的 Socket.IO，
#    浏览器 /api/socket 握手会 404，通知弹窗在生产静默失效（2026-11-06 审查确认）。
# 复用 builder：全量 node_modules（含 socket.io / tsx）+ 源码 + 构建产物，镜像会大一些。
# ============================================================
FROM builder AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

# tsx 运行 TS 入口（server.ts → src/lib/socket-server → Socket.IO 挂载）
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server.ts"]
