FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN cd db && npx prisma generate

RUN npm install typescript

RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache bash git openssh curl zip unzip docker-cli

RUN git --version

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/db/prisma /db/prisma

RUN which git && git --version

EXPOSE 3001

CMD ["npm", "start"]
