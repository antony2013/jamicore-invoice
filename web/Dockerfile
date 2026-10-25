FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG S3_ENDPOINT=http://localhost:4566
ENV S3_ENDPOINT=$S3_ENDPOINT
# next build imports route modules for page-data collection; those modules
# validate required secrets at import time. Runtime values are passed by the
# container env (Coolify/compose), these dummies never serve traffic.
ENV NEXTAUTH_SECRET=build-time-dummy-not-a-real-secret
ENV JWT_SECRET=build-time-dummy-not-a-real-secret
ENV DATABASE_URL=postgres://build:build@localhost/build
ENV NODE_ENV=production
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src ./src
# Runtime migration runner (no dev deps): node scripts/migrate.mjs
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres
EXPOSE 3000
CMD ["node", "server.js"]
