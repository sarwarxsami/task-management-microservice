FROM node:20 AS builder

WORKDIR /app

COPY ./package.json ./package.json
COPY ./src/ /app/src

RUN npm install

FROM node:20-alpine AS runtime

WORKDIR /user-service

COPY --from=builder /app ./

CMD [ "node", "./src/server.js" ]