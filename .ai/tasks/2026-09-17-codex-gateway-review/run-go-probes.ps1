param([string]$GatewayRepo = 'F:\Son\tool\CreateMediaTool')

$ErrorActionPreference = 'Stop'
$reviewSourceDir = $PSScriptRoot
$gatewayRoot = (Resolve-Path -LiteralPath $GatewayRepo).Path
$overlayPath = Join-Path ([System.IO.Path]::GetTempPath()) ('codex-gateway-review-' + [guid]::NewGuid().ToString('N') + '.json')
$replacements = @{}
$replacements[(Join-Path $gatewayRoot 'internal/modules/providers/zz_review_test.go')] = Join-Path $reviewSourceDir 'review_providers_test.go'
$replacements[(Join-Path $gatewayRoot 'internal/modules/openai/zz_review_test.go')] = Join-Path $reviewSourceDir 'review_openai_test.go'
$overlayJson = @{ Replace = $replacements } | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($overlayPath, $overlayJson, [System.Text.UTF8Encoding]::new($false))

Push-Location -LiteralPath $gatewayRoot
try {
    # These regression expectations FAIL on the reviewed implementation.
    # The overlay injects test files without changing gateway source files.
    & go test "-overlay=$overlayPath" ./internal/modules/providers ./internal/modules/openai -run '^TestReview' -count=1 -timeout=20s
    $testExit = $LASTEXITCODE
} finally {
    Pop-Location
}
Write-Output "Review overlay: $overlayPath"
exit $testExit
