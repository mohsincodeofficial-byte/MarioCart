# Run this script as Administrator to allow phone controllers on the LAN
# to reach the Kart Party server on port 3000.
#
# Right-click PowerShell -> "Run as Administrator", then:
#   cd D:\Games-Project\MarioCart
#   powershell -ExecutionPolicy Bypass -File .\open-firewall.ps1

Write-Host "Opening Windows Firewall for Kart Party..." -ForegroundColor Cyan

# 1. Allow TCP port 3000 and port 80 on ALL network profiles (Domain, Private, Public)
netsh advfirewall firewall delete rule name="KartParty-Server-3000" | Out-Null
netsh advfirewall firewall add rule `
  name="KartParty-Server-3000" `
  dir=in `
  action=allow `
  protocol=TCP `
  localport=3000 `
  profile=any `
  description="Allows LAN devices (phone controllers) to reach Kart Party on port 3000 across all network profiles."

netsh advfirewall firewall delete rule name="KartParty-Server-80" | Out-Null
netsh advfirewall firewall add rule `
  name="KartParty-Server-80" `
  dir=in `
  action=allow `
  protocol=TCP `
  localport=80 `
  profile=any `
  description="Allows LAN devices (phone controllers) to reach Kart Party on port 80 without port numbers."

# 2. Allow Node.js binary on ALL profiles
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodePath) {
  netsh advfirewall firewall delete rule name="KartParty-Node" | Out-Null
  netsh advfirewall firewall add rule `
    name="KartParty-Node" `
    dir=in `
    action=allow `
    program="$nodePath" `
    profile=any `
    description="Allows Node.js for Kart Party across all network profiles."
  Write-Host "✅ Node.js firewall rule added for: $nodePath" -ForegroundColor Green
}

# 3. Allow ICMP Ping so you can test connectivity from phone
netsh advfirewall firewall delete rule name="KartParty-ICMP" | Out-Null
netsh advfirewall firewall add rule `
  name="KartParty-ICMP" `
  dir=in `
  action=allow `
  protocol=icmpv4 `
  profile=any `
  description="Allows ICMP Ping for Kart Party diagnostics."

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Wi-Fi -ErrorAction SilentlyContinue).IPAddress
if (-not $lanIp) {
  $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }).IPAddress | Select-Object -First 1
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "✅ Firewall opened successfully on all profiles (Private + Public)!" -ForegroundColor Green
Write-Host "   Open on your phone browser:" -ForegroundColor Yellow
Write-Host "   👉 http://${lanIp}:3000/controller" -ForegroundColor Yellow
Write-Host "   (Make sure to include http:// at the start!)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green

