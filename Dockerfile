FROM node:22-alpine
WORKDIR /srv/gamcecos
COPY package.json server.js joc.mjs ./
COPY app app
COPY data data
COPY casos casos
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
