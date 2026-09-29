#!/bin/bash
set -e

# Iniciar Xvfb virtual display para Chromium headless=False
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Aguardar Xvfb estar pronto
sleep 2

# Verificar se Xvfb está rodando
if kill -0 $XVFB_PID 2>/dev/null; then
    echo "[ENTRYPOINT] Xvfb iniciado (PID=$XVFB_PID, DISPLAY=$DISPLAY)"
else
    echo "[ENTRYPOINT] ERRO: Xvfb falhou ao iniciar"
    exit 1
fi

# Garantir DISPLAY exportado para todos os processos filhos
export DISPLAY=:99

# Executar o worker
exec python -u worker.py