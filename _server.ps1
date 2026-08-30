Add-Type -AssemblyName System.Net.Http
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:8765/')
$listener.Start()
Write-Host 'Serving on http://127.0.0.1:8765/'
$root = 'C:\Users\User\Documents\GitHub\Hackathon-project-1'
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $resp = $ctx.Response
    $path = $req.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $full = Join-Path $root $path
    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        default { 'text/plain; charset=utf-8' }
      }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $resp.ContentType = $ct
      $resp.ContentLength64 = $bytes.Length
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resp.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $resp.Close()
  } catch {
    Write-Host $_
    break
  }
}
