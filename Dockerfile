FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=4600
EXPOSE 4600
CMD ["node", "server.js"]
