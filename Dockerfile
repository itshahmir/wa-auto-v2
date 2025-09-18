# WhatsApp Automation Docker Container
FROM node:18-alpine

# Install system dependencies for Playwright and Docker
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl \
    bash \
    docker-cli

# Set Chrome executable path and create symlink
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create symlink for the expected Chrome path
RUN ln -sf /usr/bin/chromium-browser /usr/bin/google-chrome-stable

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create sessions directory
RUN mkdir -p /app/sessions /app/data

# Set permissions
RUN chmod +x /app/index.js

# Create startup script
RUN echo '#!/bin/bash' > /app/start.sh && \
    echo 'echo "Starting WhatsApp Automation API on PORT: $PORT"' >> /app/start.sh && \
    echo 'echo "Container IP: $(hostname -i)"' >> /app/start.sh && \
    echo 'exec node index.js --api' >> /app/start.sh && \
    chmod +x /app/start.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["/app/start.sh"]