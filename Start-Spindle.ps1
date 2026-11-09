$ErrorActionPreference = 'Stop'
$spindleNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($spindleNode) {
    $spindleNodePath = $spindleNode.Source
} else {
    throw 'Node.js 22 or newer is required. Install it from nodejs.org, then run this launcher again.'
}
$spindleMajor = & $spindleNodePath -p 'Number(process.versions.node.split(".")[0])'
if ([int]$spindleMajor -lt 22) {
    throw 'Update Node.js to version 22 or newer, then run this launcher again.'
}
$spindlePort = if ($env:SPINDLE_PORT) { $env:SPINDLE_PORT } else { '8437' }
Write-Host ('Open Spindle at http://127.0.0.1:' + $spindlePort)
Write-Host 'Keep this terminal open. Press Ctrl+C to stop the local server.'
& $spindleNodePath (Join-Path $PSScriptRoot 'server.mjs')
