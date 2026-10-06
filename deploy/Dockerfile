# Build dist on the release machine first: npm ci && npm run build.
# Only the runtime dependencies are installed on the production server.
FROM node:24-slim
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/SinCircle/photo-gallery" \
      org.opencontainers.image.revision=$VCS_REF
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx supervisor \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY server/scripts ./scripts
COPY dist /srv/www
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /srv/supervisord.conf
RUN mkdir -p /data/photos/originals /data/photos/thumbs /data/photos/web
EXPOSE 80
CMD ["supervisord", "-c", "/srv/supervisord.conf"]
