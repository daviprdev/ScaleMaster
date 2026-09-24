FROM python:3.11-slim

# System deps for Playwright + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium for Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/*

# App code
COPY . .

# Health check port
EXPOSE 8080

CMD ["python", "-u", "worker.py"]