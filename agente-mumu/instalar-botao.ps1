# Faz o botao "Iniciar agente" da aba Emulador funcionar neste PC: registra o link
# scalemaster-agente: (so para este usuario do Windows, sem admin) para subir o agente sem janela.
# O link nao passa nada do site para o agente: so roda o iniciar-oculto.vbs desta pasta.
# Se a pasta do Scale Master mudar de lugar, rode de novo (o link guarda o caminho dela).
# Desfazer: powershell -ExecutionPolicy Bypass -File remover-botao.ps1
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $pasta 'iniciar-oculto.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$chave = 'HKCU:\Software\Classes\scalemaster-agente'

New-Item -Path "$chave\shell\open\command" -Force | Out-Null
Set-Item -Path $chave -Value 'URL:Scale Master - Agente MuMu'
New-ItemProperty -Path $chave -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-Item -Path "$chave\shell\open\command" -Value ('"' + $wscript + '" "' + $vbs + '"')

Write-Output 'Pronto: o botao Iniciar agente da aba Emulador liga o agente neste PC.'
Write-Output 'Se o PC ainda nao tiver codigo, o botao abre um aviso dizendo o que falta.'
