FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY mobile/package.json mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY backend backend
COPY packages/shared packages/shared
RUN npm run build:shared && npm run build -w @service-center/backend

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

USER node
EXPOSE 4000
CMD ["node", "backend/dist/index.js"]
