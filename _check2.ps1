$js = Get-Content 'C:\Users\User\Documents\GitHub\Hackathon-project-1\app.js' -Raw
$stripped = [regex]::Replace($js, '"(?:\\.|[^"\\])*"', '""')
$stripped = [regex]::Replace($stripped, "'(?:\\.|[^'\\])*'", "''")
$stripped = [regex]::Replace($stripped, '`(?:\\.|[^`\\])*`', '``')
$stripped = [regex]::Replace($stripped, '/\*.*?\*/', '', 'Singleline')
$lines = $stripped -split "`n"
$depth = 0
for ($i = 0; $i -lt $lines.Length; $i++) {
  $L = $lines[$i]
  $opens  = ([regex]::Matches($L, '\{')).Count
  $closes = ([regex]::Matches($L, '\}')).Count
  $oldDepth = $depth
  $depth += $opens - $closes
  if ($depth -lt 0) {
    Write-Host ("NEG at line " + ($i+1) + " (was " + $oldDepth + "): " + $L.Trim())
    $depth = 0
  }
}
Write-Host 'Final depth:' $depth
