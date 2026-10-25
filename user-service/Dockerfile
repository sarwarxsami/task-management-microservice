FROM node:24-alpine AS builder

WORKDIR /app

COPY ./package.json ./package-lock.json ./

RUN npm ci --omit=dev

FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /user-service

COPY --from=builder /app/node_modules ./node_modules
COPY ./package.json ./
COPY ./src/ ./src/

USER node

CMD [ "node", "./src/server.js" ]
