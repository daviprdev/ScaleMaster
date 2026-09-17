FROM python:3.11-slim

# FFmpeg (efeitos de vídeo) + Xvfb (Chromium em modo "com janela" sem monitor,
# usado só se BROWSER_HEADLESS=0 — fallback caso o headless seja detectado).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Motor "browser": Chromium do Playwright + libs de sistema que ele exige.
# --no-shell: não baixa o chromium-headless-shell (o motor usa o Chromium
# completo no headless novo, channel="chromium"), economiza ~100 MB.
# PLAYWRIGHT_BROWSERS_PATH fixo para o binário ficar numa camada própria e
# ser encontrado independentemente do usuário que roda o processo.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps --no-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . .

EXPOSE 8000

# Railway injeta $PORT automaticamente; fallback 8000 para testes locais
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
