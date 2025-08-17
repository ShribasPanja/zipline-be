FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN cd db && npx prisma generate

RUN npm install typescript

RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache bash git openssh

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/db/prisma /db/prisma

EXPOSE 3001

CMD ["npm", "start"]
