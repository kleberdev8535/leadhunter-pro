# Imagem da API (Railway). O frontend é publicado separadamente na Vercel.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm ci --workspace @leadhunter/api --include-workspace-root=false
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/
WORKDIR /app/apps/api
# Aplica migrações pendentes antes de subir (idempotente).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
