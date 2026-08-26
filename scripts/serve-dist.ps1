$ErrorActionPreference = 'Stop'
$preferredPort = 4173
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dist'))

if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host 'Production build not found. Run npm run build first.' -ForegroundColor Red
  exit 1
}

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
  '.svg' = 'image/svg+xml'
  '.woff2' = 'font/woff2'
  '.png' = 'image/png'
  '.ico' = 'image/x-icon'
}

$listener = $null
foreach ($port in $preferredPort..($preferredPort + 10)) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $listener.Start()
    break
  }
  catch [System.Net.Sockets.SocketException] {
    $listener = $null
  }
}
if (-not $listener) {
  Write-Host 'No free local port found.' -ForegroundColor Red
  exit 1
}
$address = "http://127.0.0.1:$port/"
Write-Host "Kontakt Board is running at $address" -ForegroundColor Green
Write-Host 'Keep this window open. Press Ctrl+C to stop.'
Start-Process $address

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 5000
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      while ($reader.ReadLine()) { }
      if (-not $requestLine) { continue }

      $parts = $requestLine.Split(' ')
      $requestPath = [System.Uri]::UnescapeDataString($parts[1].Split('?')[0]).TrimStart('/')
      if (-not $requestPath) { $requestPath = 'index.html' }
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $requestPath.Replace('/', '\')))
      $rootBoundary = $root.TrimEnd('\') + '\'
      if ($candidate -ne $root -and -not $candidate.StartsWith($rootBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = Join-Path $root 'index.html'
      }
      if (-not (Test-Path $candidate -PathType Leaf)) {
        $candidate = Join-Path $root 'index.html'
      }

      $body = [System.IO.File]::ReadAllBytes($candidate)
      $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
      $contentType = $mimeTypes[$extension]
      if (-not $contentType) { $contentType = 'application/octet-stream' }
      $relativePath = $candidate.Substring($root.Length).TrimStart('\')
      $cacheControl = if ($relativePath.StartsWith('assets\')) { 'public, max-age=31536000, immutable' } else { 'no-cache' }
      $headers = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: $cacheControl`r`nConnection: close`r`n`r`n"
      $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    }
    catch {
      Write-Warning $_.Exception.Message
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
