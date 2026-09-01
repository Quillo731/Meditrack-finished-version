$root = $PSScriptRoot
$port = 4173
$localUrl = "http://127.0.0.1:$port/"
$sharedDataPath = [System.IO.Path]::Combine($root, "app-data.json")
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)

function Get-ContentType($path) {
  $extension = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($extension) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".webmanifest" { "application/manifest+json; charset=utf-8" }
    ".svg" { "image/svg+xml; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

function Send-Response($stream, $status, $contentType, $bytes) {
  $statusText = if ($status -eq 200) { "OK" } elseif ($status -eq 400) { "Bad Request" } elseif ($status -eq 404) { "Not Found" } else { "Method Not Allowed" }
  $header = "HTTP/1.1 $status $statusText`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($bytes.Length -gt 0) {
    $stream.Write($bytes, 0, $bytes.Length)
  }
}

function Get-LocalIpAddresses {
  [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
    Where-Object { $_.OperationalStatus -eq "Up" } |
    ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
    Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and -not $_.Address.ToString().StartsWith("127.") } |
    ForEach-Object { $_.Address.ToString() } |
    Select-Object -Unique
}

if (-not [System.IO.File]::Exists($sharedDataPath)) {
  [System.IO.File]::WriteAllText($sharedDataPath, '{"personName":"","medications":[],"history":[],"notifications":{}}', [System.Text.Encoding]::UTF8)
}

$listener.Start()
Write-Host "İlaç Hatırlatıcı läuft unter $localUrl"
Write-Host "Dieses Fenster offen lassen, solange die App benutzt wird."
Write-Host "Familienmitglieder im selben WLAN öffnen eine dieser Adressen:"
Get-LocalIpAddresses | ForEach-Object { Write-Host "http://$($_):$port/" }
Start-Process $localUrl

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $client.Close()
        continue
      }

      $parts = $requestLine.Split(" ")
      $method = $parts[0]
      $urlPath = if ($parts.Length -gt 1) { $parts[1].Split("?")[0] } else { "/" }
      $contentLength = 0

      while ($true) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) { break }
        if ($line.ToLowerInvariant().StartsWith("content-length:")) {
          [int]::TryParse($line.Substring(15).Trim(), [ref]$contentLength) | Out-Null
        }
      }

      if ($urlPath -eq "/api/shared-state") {
        if ($method -eq "GET") {
          $json = [System.IO.File]::ReadAllText($sharedDataPath, [System.Text.Encoding]::UTF8)
          Send-Response $stream 200 "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes($json))
        } elseif ($method -eq "POST") {
          $buffer = New-Object char[] $contentLength
          $reader.Read($buffer, 0, $contentLength) | Out-Null
          $json = -join $buffer

          try {
            $parsed = $json | ConvertFrom-Json
            $clean = [ordered]@{
              personName = if ($null -ne $parsed.personName) { [string]$parsed.personName } else { "" }
              medications = if ($null -ne $parsed.medications) { $parsed.medications } else { @() }
              history = if ($null -ne $parsed.history) { $parsed.history } else { @() }
              notifications = if ($null -ne $parsed.notifications) { $parsed.notifications } else { @{} }
            } | ConvertTo-Json -Depth 20

            [System.IO.File]::WriteAllText($sharedDataPath, $clean, [System.Text.Encoding]::UTF8)
            Send-Response $stream 200 "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes('{"ok":true}'))
          } catch {
            Send-Response $stream 400 "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes('{"ok":false}'))
          }
        } else {
          Send-Response $stream 405 "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes(""))
        }

        $client.Close()
        continue
      }

      if ($urlPath -eq "/") {
        $urlPath = "/index.html"
      }

      $relativePath = [System.Uri]::UnescapeDataString($urlPath.TrimStart("/")).Replace("/", "\")
      $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))
      $rootPath = [System.IO.Path]::GetFullPath($root)

      if (-not $filePath.StartsWith($rootPath) -or -not [System.IO.File]::Exists($filePath)) {
        Send-Response $stream 404 "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Not found"))
        $client.Close()
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      Send-Response $stream 200 (Get-ContentType $filePath) $bytes
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
