FROM python:3.11-slim

# FFmpeg + dependências de sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Railway injeta $PORT automaticamente; fallback 8000 para testes locais
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
