FROM node:22-alpine AS builder
WORKDIR /app
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"

RUN apk add --no-cache openssl

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/prisma.config.ts ./
COPY --from=builder --chown=node:node /app/prisma ./prisma

USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/src/main.js"]