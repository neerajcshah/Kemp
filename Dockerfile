# Google Cloud Run production container
FROM node:22-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

EXPOSE 8080

CMD ["node", "server/index.js"]
