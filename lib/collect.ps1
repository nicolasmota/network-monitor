$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$gw = Get-NetRoute -DestinationPrefix '0.0.0.0/0' |
  Sort-Object RouteMetric, InterfaceMetric |
  Select-Object -First 1

$stats = @{}
Get-NetAdapterStatistics | ForEach-Object { $stats[$_.Name] = $_ }

$adapters = @(Get-NetAdapter | ForEach-Object {
  $st = $stats[$_.Name]
  [PSCustomObject]@{
    name = $_.Name
    description = $_.InterfaceDescription
    status = [string]$_.Status
    linkSpeed = [string]$_.LinkSpeed
    mac = $_.MacAddress
    receivedBytes = if ($st) { [string]([int64]$st.ReceivedBytes) } else { '0' }
    sentBytes = if ($st) { [string]([int64]$st.SentBytes) } else { '0' }
  }
})

$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  ForEach-Object {
    [PSCustomObject]@{
      interface = $_.InterfaceAlias
      ip = $_.IPAddress
      prefix = [int]$_.PrefixLength
    }
  })

[PSCustomObject]@{
  gateway = if ($gw) { [string]$gw.NextHop } else { $null }
  gatewayInterface = if ($gw) { [string]$gw.InterfaceAlias } else { $null }
  adapters = $adapters
  ips = $ips
} | ConvertTo-Json -Depth 5 -Compress
