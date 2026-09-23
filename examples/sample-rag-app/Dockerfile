# Exact tag, per docs/RULES.md. Node 26 executes TypeScript directly, so there
# is no build stage and the app has no dependencies to install.
FROM node:26.8.1-trixie-slim

ENV NODE_ENV=production \
    PORT=8000 \
    KNOWLEDGE_BASE_DIR=/app/docs/knowledge-base

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY docs ./docs

# Never run as root, and never bake an API key into the image; keys arrive
# through the environment at run time.
USER node

EXPOSE 8000

CMD ["node", "src/index.ts"]
