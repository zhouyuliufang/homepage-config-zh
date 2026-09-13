# 中文 Homepage 配置管理器 — Dockerfile
# 采用 node:18-alpine 精简基础镜像，仅依赖 yaml 包，构建稳定可控。
FROM node:18-alpine

# 设置 npm 镜像为 npmmirror（国内可访问，规避 GitHub/registry 超时）
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# 先拷贝依赖声明，利用层缓存
COPY package.json ./
RUN npm install --production --no-audit --no-fund

# 拷贝应用代码
COPY server.js ./
COPY public ./public

# 配置目录由宿主机挂载进来（与 Homepage 共用同一 /config）
ENV CONFIG_PATH=/app/config
ENV PORT=3005
ENV NODE_ENV=production

EXPOSE 3005

# 健康检查（kwangyeonc 思路的 /api/health）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
