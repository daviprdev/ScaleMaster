# Faz o botao "Iniciar agente" da aba Emulador funcionar neste PC: registra o link
# scalemaster-agente: (so para este usuario do Windows, sem admin) para subir o agente sem janela.
# O link nao passa nada do site para o agente: so roda o iniciar-oculto.vbs desta pasta.
# Desfazer: powershell -ExecutionPolicy Bypass -File remover-botao.ps1
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $pasta 'config.json'))) {
  Write-Output 'Conecte o PC antes: node agente.mjs conectar <codigo> (o codigo sai na aba Emulador).'
  exit 1
}
$vbs = Join-Path $pasta 'iniciar-oculto.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$chave = 'HKCU:\Software\Classes\scalemaster-agente'

New-Item -Path "$chave\shell\open\command" -Force | Out-Null
Set-Item -Path $chave -Value 'URL:Scale Master - Agente MuMu'
New-ItemProperty -Path $chave -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-Item -Path "$chave\shell\open\command" -Value ('"' + $wscript + '" "' + $vbs + '"')

Write-Output 'Pronto: o botao Iniciar agente da aba Emulador liga o agente neste PC.'
