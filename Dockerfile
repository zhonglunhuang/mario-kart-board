FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ENV PORT=3100 BASE_PATH=/mario TURN_SECONDS=45
EXPOSE 3100
USER node
CMD ["node", "server/index.js"]
