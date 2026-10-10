FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_MAIN_API_URL=http://localhost:5001
ARG NEXT_PUBLIC_GRAPH_API_URL=http://localhost:5002
ARG NEXT_PUBLIC_ML_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_MAIN_API_URL=$NEXT_PUBLIC_MAIN_API_URL
ENV NEXT_PUBLIC_GRAPH_API_URL=$NEXT_PUBLIC_GRAPH_API_URL
ENV NEXT_PUBLIC_ML_API_URL=$NEXT_PUBLIC_ML_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
