# ---------- 构建前端 ----------
FROM node:24-slim AS web-build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 安装后端依赖 ----------
FROM node:24-slim AS server-deps
WORKDIR /srv/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---------- 运行镜像 ----------
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx supervisor \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# 前端静态文件
COPY --from=web-build /src/dist /srv/www

# 后端代码与生产依赖
COPY server/ /srv/server/
COPY --from=server-deps /srv/server/node_modules /srv/server/node_modules

# Nginx 配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# supervisord 配置——CMD 要用它启动，必须复制进镜像，否则容器起不来
COPY supervisord.conf /srv/supervisord.conf

# 照片库挂载点（运行时由 compose 挂载宿主机目录）
RUN mkdir -p /data/photos/originals /data/photos/thumbs /data/photos/web

EXPOSE 80

CMD ["supervisord", "-c", "/srv/supervisord.conf"]
