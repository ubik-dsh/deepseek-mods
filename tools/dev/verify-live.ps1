# End-to-end verification of @local/dsh-system-prompt-mod against the isolated
# test instance on port 3081.
param(
  [string]$Base = 'http://127.0.0.1:3081',
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = 'Stop'

# 1. Authenticate the browser session.
$index = Invoke-WebRequest -Uri "$Base/?token=$Token" -SessionVariable sess -UseBasicParsing -TimeoutSec 30
Write-Output "index status=$($index.StatusCode) len=$($index.Content.Length)"

# 2. The boot graph must roster this plugin's browser half.
$rowsMod = $index.Content -match '@local/dsh-system-prompt-mod/client\.js'
Write-Output "boot graph rosters the mod: $rowsMod"

# 3. The served bundle bytes must be the current client half.
$comboMatch = [regex]::Match($index.Content, '(/plugins/\?\?[^"]*dsh-system-prompt-mod[^"]*)')
if ($comboMatch.Success) {
  $combo = $comboMatch.Groups[1].Value -replace '&amp;', '&'
  $bundle = Invoke-WebRequest -Uri "$Base$combo" -WebSession $sess -UseBasicParsing -TimeoutSec 30
  Write-Output "combo bundle status=$($bundle.StatusCode) len=$($bundle.Content.Length)"
  Write-Output "  forwards sessionId: $($bundle.Content -match 'searchParams\.set')"
  Write-Output "  reports scope: $($bundle.Content -match 'snapshot\.scoped')"
  Write-Output "  carries tolerant preview: $($bundle.Content -match 'exact === false')"
} else {
  Write-Output 'combo url: NOT FOUND'
}

# 4. Create a real session through the compiled Session RPC.
$rpcId = [guid]::NewGuid().ToString()
$endpoint = 'session/create'
$createBody = @{
  type    = 'client-request'
  rpcId   = $rpcId
  method  = $endpoint
  payload = @{ args = @{ request = @{ cwd = 'C:\Users\you\Documents\ds1' } } }
} | ConvertTo-Json -Compress -Depth 8

try {
  $created = Invoke-WebRequest -Uri "$Base/api/$endpoint" -Method POST -Body $createBody `
    -ContentType 'application/json' -WebSession $sess -UseBasicParsing -TimeoutSec 90
  Write-Output "session.create status=$($created.StatusCode)"
  Write-Output "  body: $($created.Content)"
  $parsed = $created.Content | ConvertFrom-Json
  $sessionId = $parsed.result.value.sessionId
  Write-Output "  sessionId: $sessionId"
} catch {
  Write-Output "session.create FAILED: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output "  body: $($reader.ReadToEnd())"
  }
}

# 5. Read the mod state, once unscoped and once in the created session's scope.
foreach ($label in @('global', 'session')) {
  $uri = if ($label -eq 'global') { "$Base/api/system-prompt.mod" } else { "$Base/api/system-prompt.mod?sessionId=$sessionId" }
  try {
    $state = Invoke-WebRequest -Uri $uri -WebSession $sess -UseBasicParsing -TimeoutSec 90
    $body = $state.Content | ConvertFrom-Json
    Write-Output "[$label] status=$($state.StatusCode) scoped=$($body.scoped) exact=$($body.exact) active=$($body.active) baseAvailable=$($body.baseAvailable)"
    Write-Output "  error: $($body.error)"
    $text = if ($body.baseAvailable) { $body.basePrompt } else { $body.effectivePrompt }
    if ($text) {
      $preview = $text.Substring(0, [Math]::Min(220, $text.Length)) -replace "`r?`n", ' | '
      Write-Output "  prompt[$($text.Length) chars]: $preview"
    }
  } catch {
    Write-Output "[$label] FAILED: $($_.Exception.Message)"
  }
}

# 6. Write path: apply an override, then disable it, in the session scope.
if ($sessionId) {
  $marker = 'MOD-VERIFY-MARKER-7f3a'
  function Send-Mod([hashtable]$payload) {
    $rpc = [guid]::NewGuid().ToString()
    $body = @{ type = 'client-request'; rpcId = $rpc; method = 'unused'; payload = @{} } | ConvertTo-Json -Compress
    return Invoke-WebRequest -Uri "$Base/api/system-prompt.mod" -Method POST `
      -Body ($payload | ConvertTo-Json -Compress -Depth 6) -ContentType 'application/json' `
      -WebSession $sess -UseBasicParsing -TimeoutSec 90
  }

  $applied = (Send-Mod @{ enabled = $true; mode = 'append'; text = $marker; sessionId = $sessionId }).Content | ConvertFrom-Json
  Write-Output "[apply] active=$($applied.active) mode=$($applied.mode) len=$($applied.effectivePrompt.Length)"
  Write-Output "  effective ends with marker: $($applied.effectivePrompt.EndsWith($marker))"
  Write-Output "  base excludes marker: $(-not $applied.basePrompt.Contains($marker))"
  Write-Output "  base length: $($applied.basePrompt.Length)"

  $replaced = (Send-Mod @{ enabled = $true; mode = 'replace'; text = $marker; sessionId = $sessionId }).Content | ConvertFrom-Json
  Write-Output "[replace] active=$($replaced.active) baseAvailable=$($replaced.baseAvailable) effective='$($replaced.effectivePrompt)'"

  $guard = $null
  try {
    Send-Mod @{ enabled = $true; mode = 'append'; text = 'breaks {{cwd}} here'; sessionId = $sessionId } | Out-Null
  } catch {
    $guard = $_.Exception.Response.StatusCode.value__
  }
  Write-Output "[guard] {{variable}} rejected with status: $guard"

  $off = (Send-Mod @{ enabled = $false; sessionId = $sessionId }).Content | ConvertFrom-Json
  Write-Output "[disable] active=$($off.active) restores prompt: $(-not $off.effectivePrompt.Contains($marker))"
}
