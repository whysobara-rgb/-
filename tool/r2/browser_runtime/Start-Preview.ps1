# Static Flutter files only. No API proxy, credentials, or external listener.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'web'))
$prefix = $root + [IO.Path]::DirectorySeparatorChar
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 8765)
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript'; '.json'='application/json'; '.css'='text/css'; '.wasm'='application/wasm'; '.png'='image/png'; '.jpg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml'; '.otf'='font/otf'; '.ttf'='font/ttf'; '.woff2'='font/woff2' }
$csp = "default-src 'self' data: blob:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'; form-action 'none'"
try {
    $listener.Start()
    Write-Host 'GachiGacha review: http://127.0.0.1:8765'
    Write-Host 'This PC only. Keep this window open. Ctrl+C to stop.'
    Start-Process 'http://127.0.0.1:8765'
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        try {
            $client.ReceiveTimeout = 3000
            $client.SendTimeout = 10000
            $stream = $client.GetStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $line = $reader.ReadLine()
            if (!$line) { continue }
            $parts = $line.Split(' ')
            $headers = 0
            while ($reader.ReadLine()) { $headers++; if ($headers -gt 100) { throw 'Header limit' } }
            $method = $parts[0]
            $requestPath = [Uri]::UnescapeDataString(($parts[1].Split('?')[0])).TrimStart('/')
            if (!$requestPath) { $requestPath = 'index.html' }
            $path = [IO.Path]::GetFullPath((Join-Path $root $requestPath))
            $status = '200 OK'
            if ($method -ne 'GET' -and $method -ne 'HEAD') { $status = '405 Method Not Allowed' }
            elseif (!$path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $path -PathType Leaf)) { $status = '404 Not Found' }
            $body = [byte[]]@()
            $type = 'text/plain'
            if ($status -eq '200 OK') {
                $body = [IO.File]::ReadAllBytes($path)
                $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
                if ($mime.ContainsKey($extension)) { $type = $mime[$extension] } else { $type = 'application/octet-stream' }
            }
            $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nContent-Security-Policy: $csp`r`nX-Content-Type-Options: nosniff`r`n`r`n"
            $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
            $stream.Write($headBytes, 0, $headBytes.Length)
            if ($method -ne 'HEAD' -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            # No request headers or payloads are logged.
            Write-Host 'A local request could not be served; refresh the page.'
        } finally {
            if ($stream) { $stream.Dispose() }
            $client.Dispose()
        }
    }
} finally { $listener.Stop() }
