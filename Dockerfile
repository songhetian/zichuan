# ============================================================
# 阶段1: 安装依赖
# ============================================================
FROM node:20-alpine AS deps
WORKDIR /app

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
# 阶段3: 生产运行
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

# 安装 Prisma 运行所需的系统依赖
RUN apk add --no-cache openssl

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

# 安装 tsx 和 prisma（db-init 运行迁移和种子需要，版本需与项目一致）
RUN npm install -g tsx prisma@5

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
