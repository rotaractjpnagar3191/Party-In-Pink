# Script to finalize order and dispatch tickets
param(
    [string]$OrderId = "pip_1763832776270_jwrbe4"
)

Write-Host "Finalizing order: $OrderId"
Write-Host "Waiting 10s for server to start..."
Start-Sleep -Seconds 10

$uri = "http://localhost:8888/.netlify/functions/finalize-order"
$body = @{ order_id = $OrderId } | ConvertTo-Json

try {
    $result = Invoke-WebRequest -Uri $uri `
        -Method POST `
        -Headers @{"Content-Type"="application/json"} `
        -Body $body `
        -TimeoutSec 30
    
    Write-Host "[OK] Success!"
    Write-Host "Response:"
    $result.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5
} catch {
    Write-Host "[ERROR] $_"
    Write-Host $_.Exception.Message
    exit 1
}
