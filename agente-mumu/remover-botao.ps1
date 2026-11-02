# Tira o link scalemaster-agente: (o botao Iniciar agente da aba Emulador para de funcionar neste PC).
$chave = 'HKCU:\Software\Classes\scalemaster-agente'
if (Test-Path $chave) {
  Remove-Item $chave -Recurse -Force
  Write-Output 'Botao Iniciar agente removido deste PC.'
} else {
  Write-Output 'O botao Iniciar agente nao estava instalado neste PC.'
}
