# BrainCraft: the app, shared boards, live sessions and the HTTP API in one container.
#   docker build -t braincraft .
#   docker run -p 8080:8080 -v braincraft-data:/data braincraft
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV PORT=8080 BRAINCRAFT_DATA=/data NODE_ENV=production
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "dist/braincraft-server.mjs"]
