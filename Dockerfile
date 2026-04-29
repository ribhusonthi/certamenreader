# syntax=docker/dockerfile:1.7

FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json .babelrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/client ./client
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/database ./database
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/server ./server
COPY --from=builder /app/*.js ./
EXPOSE 8080
USER node
CMD ["node", "index.js"]
