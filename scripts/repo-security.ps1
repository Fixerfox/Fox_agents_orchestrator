# Aplica los rulesets de .github/rulesets/ al repositorio de GitHub (SPEC-094).
# Idempotente: si un ruleset con ese nombre ya existe lo actualiza; si no, lo crea.
# Requiere GitHub CLI con sesión de un administrador del repo: gh auth login
param([string]$Repo = 'Fixerfox/Fox_orchestrator')
$ErrorActionPreference = 'Stop'

$existing = gh api "repos/$Repo/rulesets" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "No se pudieron leer los rulesets de $Repo" }

foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot '..\.github\rulesets') -Filter *.json) {
  $name = (Get-Content $file.FullName -Raw | ConvertFrom-Json).name
  $match = $existing | Where-Object { $_.name -eq $name }
  if ($match) {
    gh api -X PUT "repos/$Repo/rulesets/$($match.id)" --input $file.FullName | Out-Null
    $verb = 'actualizado'
  } else {
    gh api -X POST "repos/$Repo/rulesets" --input $file.FullName | Out-Null
    $verb = 'creado'
  }
  if ($LASTEXITCODE -ne 0) { throw "Falló el ruleset $name" }
  Write-Host "✓ $name $verb"
}
