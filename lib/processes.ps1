$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$conns = @(Get-NetTCPConnection -State Established)
$groups = @($conns | Group-Object OwningProcess | Sort-Object Count -Descending | Select-Object -First 8)
$top = @(foreach ($g in $groups) {
  $procId = 0
  [void][int]::TryParse([string]$g.Name, [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    pid = $procId
    name = if ($p) { $p.ProcessName } else { "pid $procId" }
    count = [int]$g.Count
  }
})

[PSCustomObject]@{
  established = @($conns).Count
  top = $top
} | ConvertTo-Json -Depth 4 -Compress
