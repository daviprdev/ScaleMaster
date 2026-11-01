' Sobe o agente sem janela (usado pelo atalho da inicializacao do Windows).
' O log fica em agente.log, nesta pasta.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = pasta
sh.Run "node """ & pasta & "\agente.mjs""", 0, False
