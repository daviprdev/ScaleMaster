FROM python:3.11-slim

# System deps for Playwright + Chromium + git (for instagrapi from source)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps (instagrapi instalado separadamente do GitHub master)
COPY requirements.txt .
RUN grep -v '^instagrapi' requirements.txt > /tmp/req_no_ig.txt \
    && pip install --no-cache-dir -r /tmp/req_no_ig.txt \
    && pip install --no-cache-dir git+https://github.com/subzeroid/instagrapi.git@master

# Install Chromium + headless shell for Playwright 1.63+
# Playwright 1.63 requires both chromium AND chromium-headless-shell
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium \
    && playwright install chromium-headless-shell \
    && rm -rf /var/lib/apt/lists/*

# App code
COPY . .

# Entrypoint que inicia Xvfb antes do worker
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Health check port
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]