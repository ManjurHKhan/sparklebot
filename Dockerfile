# Build stage -- install deps with native compilation support
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

# Runtime stage -- minimal image
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY src/ ./src/
EXPOSE 3000
USER node
CMD ["node", "src/app.js"]
