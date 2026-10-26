# 卸掉开机自启（不删服务本体，只是不再自动启动）
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\submerge.lnk'
if (Test-Path $lnk) {
  Remove-Item $lnk -Force
  Write-Host "已移除开机自启：$lnk"
} else {
  Write-Host "没有找到开机自启项，无需处理"
}

# 顺手把正在跑的进程停掉
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "已停止 PID $($_.ProcessId)" }
