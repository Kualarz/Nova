FROM node:20-slim AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Build TypeScript
RUN npm install --include=dev && npx tsc && npm prune --omit=dev

# Runtime
FROM node:20-slim
WORKDIR /app
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

# Workspace files are mounted as a volume in fly.toml
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
