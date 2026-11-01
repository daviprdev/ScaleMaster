# Tira o agente da inicializacao do Windows e para o que estiver rodando.
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Scale Master - Agente MuMu.lnk'
if (Test-Path $atalho) {
  Remove-Item $atalho -Force
  Write-Output 'Removido da inicializacao do Windows.'
} else {
  Write-Output 'Nao estava na inicializacao do Windows.'
}
node (Join-Path $pasta 'agente.mjs') parar
