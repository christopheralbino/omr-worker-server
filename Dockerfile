# OMR Worker Server Dockerfile
FROM node:18-slim

# Install system dependencies including ImageMagick and MuseScore
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    imagemagick \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install MuseScore 4 AppImage
RUN wget -O /tmp/MuseScore-4.4.3.AppImage https://github.com/musescore/MuseScore/releases/download/v4.4.3/MuseScore-Studio-4.4.3.241851110-x86_64.AppImage \
    && chmod +x /tmp/MuseScore-4.4.3.AppImage \
    && cd /tmp && ./MuseScore-4.4.3.AppImage --appimage-extract \
    && mv squashfs-root /opt/musescore \
    && ln -s /opt/musescore/usr/bin/mscore /usr/local/bin/mscore \
    && rm /tmp/MuseScore-4.4.3.AppImage

# Set up app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create temp directory
RUN mkdir -p temp

# Set environment variables
ENV MUSESCORE_PATH=/usr/local/bin/mscore
ENV NODE_ENV=production

# Expose port
EXPOSE 3001

# Start command
CMD ["npm", "start"]


