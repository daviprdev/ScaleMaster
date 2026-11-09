# Faz o agente subir sozinho (sem janela) quando voce entra no Windows e ja liga agora.
# Desfazer: powershell -ExecutionPolicy Bypass -File remover-inicializacao.ps1
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
# O codigo fica fora desta pasta (lib/estado.mjs); o da pasta antiga e levado na 1a vez que o agente roda.
$estado = Join-Path $env:LOCALAPPDATA 'ScaleMaster\agente-mumu'
if (-not ((Test-Path (Join-Path $estado 'config.json')) -or (Test-Path (Join-Path $pasta 'config.json')))) {
  Write-Output 'Conecte o PC antes: node agente.mjs conectar <codigo> (o codigo sai na aba Emulador).'
  exit 1
}
$vbs = Join-Path $pasta 'iniciar-oculto.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Scale Master - Agente MuMu.lnk'

$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($atalho)
$lnk.TargetPath = $wscript
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $pasta
$lnk.Save()

Start-Process $wscript -ArgumentList ('"' + $vbs + '"')
Write-Output "Pronto: o agente sobe com o Windows e ja esta rodando. Log em $estado\agente.log"
