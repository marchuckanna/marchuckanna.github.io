param(
    [int]$Port = 8080,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootPrefix = $siteRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Cannot start preview on port $Port. Close another preview or use: preview.cmd -Port 8081"
    exit 1
}
$localUrl = "http://127.0.0.1:$Port/"
Write-Host "Portfolio preview: $localUrl"
Write-Host 'Keep this window open. Press Ctrl+C to stop.'
Write-Host 'Project folders are discovered automatically on every page load.'
if ($OpenBrowser) { Start-Process $localUrl }
$types = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.md' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'
    '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.png' = 'image/png'
    '.webp' = 'image/webp'; '.avif' = 'image/avif'; '.gif' = 'image/gif'
    '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'
}
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 5000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine()
            if (-not $request) { continue }
            do { $headerLine = $reader.ReadLine() } while ($headerLine)
            $parts = $request.Split(' ')
            $status = '200 OK'
            $contentType = 'text/plain; charset=utf-8'
            $body = [byte[]]@()
            try {
                if ($parts[0] -notin @('GET', 'HEAD')) {
                    $status = '405 Method Not Allowed'
                } else {
                    $requestPath = [Uri]::UnescapeDataString(($parts[1] -split '\?', 2)[0])
                    $relative = $requestPath.TrimStart('/')
                    if (-not $relative) { $relative = 'index.html' }
                    $target = [IO.Path]::GetFullPath((Join-Path $siteRoot $relative))
                    if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                        $relative -match '(^|[/\\])[._]' -or $relative -match ':') {
                        $status = '403 Forbidden'
                    } elseif ($relative -eq 'projects/index.json') {
                        # Discover new folders without Node.js or changing a manifest.
                        $folders = @(Get-ChildItem -LiteralPath (Join-Path $siteRoot 'projects') -Directory |
                            Where-Object { $_.Name -match '^[a-z0-9]+(-[a-z0-9]+)*$' } |
                            Sort-Object Name | ForEach-Object { $_.Name })
                        $json = ConvertTo-Json -InputObject $folders
                        $body = [Text.Encoding]::UTF8.GetBytes($json)
                        $contentType = $types['.json']
                    } elseif ([IO.File]::Exists($target)) {
                        $body = [IO.File]::ReadAllBytes($target)
                        $extension = [IO.Path]::GetExtension($target).ToLowerInvariant()
                        $contentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
                    } else {
                        $status = '404 Not Found'
                    }
                }
            } catch {
                $status = '400 Bad Request'
            }
            if ($status -ne '200 OK') { $body = [Text.Encoding]::UTF8.GetBytes($status) }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
            $bytes = [Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($bytes, 0, $bytes.Length)
            if ($parts[0] -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            Write-Verbose $_
        } finally {
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}
