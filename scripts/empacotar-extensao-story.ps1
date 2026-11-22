# Empacota a extensão Scale Master Story num .zip para subir no AdsPower (Extensões → Enviar extensão).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\empacotar-extensao-story.ps1
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$origem = Join-Path $raiz 'extensao-story'
$versao = (Get-Content (Join-Path $origem 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $raiz 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "scalemaster-story-$versao.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# decisão: tar.exe do Windows grava o zip com "/" nos caminhos (o Compress-Archive do PS 5.1 grava "\" e o Chrome recusa).
& tar.exe -a -c -f $zip -C $origem --exclude 'LEIAME.md' *
if ($LASTEXITCODE -ne 0) { throw "tar falhou ($LASTEXITCODE)" }
Write-Output $zip
