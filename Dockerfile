FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=30s CMD wget -q --spider http://localhost:8080/ || exit 1

CMD ["npm", "start"]
