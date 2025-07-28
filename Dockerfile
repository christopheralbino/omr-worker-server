# OMR Worker Server Dockerfile
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    xvfb \
    libxss1 \
    libgconf-2-4 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Install MuseScore
RUN wget https://github.com/musescore/MuseScore/releases/download/v3.6.2/MuseScore-3.6.2.548021370-x86_64.AppImage \
    && chmod +x MuseScore-3.6.2.548021370-x86_64.AppImage \
    && ./MuseScore-3.6.2.548021370-x86_64.AppImage --appimage-extract \
    && mv squashfs-root /opt/musescore \
    && ln -s /opt/musescore/usr/bin/mscore /usr/local/bin/mscore

# Install Audiveris
RUN wget https://github.com/Audiveris/audiveris/releases/download/5.3/audiveris-5.3.tar.gz \
    && tar -xzf audiveris-5.3.tar.gz \
    && mv audiveris-5.3 /opt/audiveris \
    && ln -s /opt/audiveris/bin/audiveris /usr/local/bin/audiveris

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
ENV AUDIVERIS_PATH=/usr/local/bin/audiveris
ENV MUSESCORE_PATH=/usr/local/bin/mscore
ENV NODE_ENV=production

# Expose port
EXPOSE 3001

# Start command
CMD ["npm", "start"]

