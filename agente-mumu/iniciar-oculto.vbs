' Sobe o agente sem janela: botao Iniciar agente da aba Emulador e atalho da inicializacao do Windows.
' Fica esperando o agente; se ele nao subir (PC sem codigo, codigo recusado, erro), mostra o motivo
' num aviso do Windows - o agente escreve o texto no arquivo de SCALEMASTER_AGENTE_AVISO antes de sair.
' Arquivo so com ASCII (o wscript le ANSI): acento, so por ChrW.
' O log fica em %LOCALAPPDATA%\ScaleMaster\agente-mumu\agente.log.
Option Explicit
Const TITULO = "Scale Master - Agente MuMu"
Const ICONE = 69680 ' exclamacao (48) + na frente das outras janelas (4096 + 65536)
Dim fso, sh, pasta, aviso, erro, arq, texto

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
aviso = fso.BuildPath(fso.GetSpecialFolder(2), "scalemaster-agente-" & fso.GetTempName())
sh.CurrentDirectory = pasta
sh.Environment("PROCESS")("SCALEMASTER_AGENTE_AVISO") = aviso

On Error Resume Next
sh.Run "node """ & pasta & "\agente.mjs""", 0, True
erro = Err.Number
On Error GoTo 0

If erro <> 0 Then
  MsgBox "O Node.js n" & ChrW(227) & "o foi encontrado neste PC. Instale o Node 18 ou mais novo (nodejs.org) e clique de novo em Iniciar agente.", ICONE, TITULO
ElseIf fso.FileExists(aviso) Then
  Set arq = fso.OpenTextFile(aviso, 1, False, -1)
  texto = arq.ReadAll
  arq.Close
  fso.DeleteFile aviso, True
  MsgBox texto, ICONE, TITULO
End If
