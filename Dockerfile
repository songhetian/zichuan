# ============================================================
# 阶段1: 安装依赖
# ============================================================
FROM node:20-alpine AS deps
WORKDIR /app

# 换用国内镜像源：官方 dl-cdn.alpinelinux.org 在本网络环境下 TLS 握手常被重置
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories && \
    apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# npm 与 Prisma 引擎同样走国内镜像（国外源在本网络环境不稳定）
RUN npm install --ignore-scripts --registry=https://registry.npmmirror.com && \
    PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma npx prisma generate

# ============================================================
# 阶段2: 构建应用
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app

# 换用国内镜像源（同阶段1）
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories && \
    apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 确保 public 目录存在（Next.js standalone 需要）
RUN mkdir -p public

ENV DATABASE_URL="mysql://root:root@localhost:3306/asset-manage"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================================================
# 阶段3: 生产运行
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

# 换用国内镜像源（同阶段1）
RUN sed -i 's#https\?://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories && \
    apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 复制 Prisma 运行时文件
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# 复制 xlsx 依赖（Server Actions 需要）
COPY --from=builder /app/node_modules/xlsx ./node_modules/xlsx

# 复制 bcryptjs 依赖（seed.ts 需要）
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# 复制 tsx 依赖（db-init 运行 seed.ts 需要）
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/@esbuild ./node_modules/@esbuild

# 复制数据库初始化脚本（db-init 容器内运行，避免依赖宿主机 bind mount）
COPY scripts/docker-init.cjs ./scripts/docker-init.cjs

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
