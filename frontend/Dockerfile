FROM node:26.8.1-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY mobile/package.json mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY frontend frontend
COPY packages/shared packages/shared

ARG SUPABASE_URL
ARG SUPABASE_ANON_KEY
ARG API_URL=http://localhost:4000
ENV SUPABASE_URL=$SUPABASE_URL
ENV SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
ENV API_URL=$API_URL

RUN npm run build:shared && npm run build -w @service-center/frontend

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
