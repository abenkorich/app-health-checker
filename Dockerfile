# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:22-alpine AS builder
WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3099 \
    HOSTNAME=0.0.0.0

# Saved settings, history, and the probe cache live in .status.
# Mount a volume there so they survive a new image:
#   -v app-health-checker:/usr/src/app/.status
# 127.0.0.1 inside this container is the container itself. Point
# PLATFORM_HEALTH_URL and the other URLs at the service hostnames.
# The sign-in cookie is Secure in production, so the board needs HTTPS.

RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /usr/src/app/.status \
  && chown nextjs:nodejs /usr/src/app/.status

COPY --from=builder --chown=nextjs:nodejs /usr/src/app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/src/app/.next/static ./.next/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3099
VOLUME ["/usr/src/app/.status"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
