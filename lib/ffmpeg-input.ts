/**
 * ffmpeg-input.ts — Como TODO FFmpeg do app lê a mídia de entrada.
 *
 * Binário: o FFmpeg do sistema (`apk add ffmpeg` no Dockerfile do app). O
 * fluent-ffmpeg o encontra sozinho via FFMPEG_PATH ou PATH (/usr/bin/ffmpeg).
 * Até 2026-10-17 o app usava o @ffmpeg-installer/ffmpeg, que trazia um FFmpeg
 * 4.1 de 2018 cheio de CVEs de corrupção de memória em demuxers — e a mídia
 * aqui vem de fora (CDN do Instagram, uploads de usuário).
 *
 * Opções de entrada (antes do -i):
 *   -protocol_whitelist file — o FFmpeg só abre arquivo local. Um arquivo
 *                              malicioso não consegue mandar o FFmpeg buscar
 *                              http://, tcp:// etc.
 *   -format_whitelist mov,matroska
 *                            — só os demuxers MOV/MP4 (mov,mp4,m4a,3gp,3g2,mj2)
 *                              e Matroska/WebM, os formatos que o bucket
 *                              videos-library aceita. Bloqueia HLS/concat
 *                              disfarçados de .mp4, que leriam arquivos locais
 *                              (/etc/passwd, /proc/self/environ) para dentro do
 *                              vídeo publicado, e tira dezenas de demuxers da
 *                              superfície de ataque.
 *
 * Comparado com o FFmpeg 4.1 em vídeo real e sintético antes da troca: o
 * clean_metadata continua stream copy, bit a bit (H.264/AAC idênticos à
 * entrada), e os efeitos do Loop saem com o mesmo codec, resolução, frames e
 * duração.
 */
export const FFMPEG_INPUT_OPTIONS: string[] = [
  "-protocol_whitelist", "file",
  "-format_whitelist", "mov,matroska",
];
