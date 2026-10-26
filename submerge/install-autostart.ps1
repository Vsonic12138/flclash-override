# 装开机自启：在「启动」文件夹里放一个指向 node server.js 的快捷方式（不需要管理员权限）
$Startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$lnk = Join-Path $Startup 'submerge.lnk'
$node = (Get-Command node).Source
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $node
$s.Arguments = 'server.js'
$s.WorkingDirectory = $dir
$s.WindowStyle = 7
$s.Description = 'submerge 合并订阅服务'
$s.Save()

Write-Host "已写入开机自启：$lnk"
