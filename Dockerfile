FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose API port
EXPOSE 3000

# Default command
CMD ["node", "server.js"]
