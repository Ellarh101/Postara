# Runs the app on a server. See DEPLOY.md.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data TRUST_PROXY=1 POSTER_SUPERVISED=1
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
