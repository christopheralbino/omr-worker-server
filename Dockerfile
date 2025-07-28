# OMR Worker Server Dockerfile
FROM node:18-slim

# Install system dependencies  
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    imagemagick \
    ghostscript \
    poppler-utils \
    xvfb \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install music21 for basic music processing
RUN pip3 install music21 opencv-python-headless pillow

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
ENV NODE_ENV=production

# Expose port
EXPOSE 3001

# Start command
CMD ["npm", "start"]
