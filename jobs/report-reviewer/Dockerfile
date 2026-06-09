# syntax=docker/dockerfile:1.7

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY index.js ./

USER node
CMD ["node", "index.js"]
