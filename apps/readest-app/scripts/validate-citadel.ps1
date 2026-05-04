<#
.SYNOPSIS
    Citadel validation script — runs lint, tests, and prints manual checklists.
.DESCRIPTION
    Multi-mode validation for Citadel agents. Use in Verify Mode before reporting
    any task complete. Always prints git status at start and end.
.PARAMETER Area
    Validation area: sync, visual, reader, full.
.EXAMPLE
    .\scripts\validate-citadel.ps1 -Area sync
    .\scripts\validate-citadel.ps1 -Area visual
    .\scripts\validate-citadel.ps1 -Area reader
    .\scripts\validate-citadel.ps1 -Area full
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("sync", "visual", "reader", "full")]
    [string]$Area
)

$ErrorActionPreference = "Stop"

# ── Resolve repo root ────────────────────────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir
$repoRoot = git rev-parse --show-toplevel 2>$null
Pop-Location
if (-not $repoRoot) {
    # Fallback: assume script is at <repo>/apps/readest-app/scripts/
    $repoRoot = Resolve-Path "$scriptDir\..\.."
}
$appDir = Join-Path $repoRoot "apps\readest-app"

if (-not (Test-Path (Join-Path $appDir "package.json"))) {
    Write-Error "Could not find app directory: $appDir"
    exit 1
}

# ── Helpers ───────────────────────────────────────────────────────────
function Write-Step {
    param([string]$Message, [string]$Color = "Cyan")
    Write-Host "`n── $Message ──" -ForegroundColor $Color
}

function Write-Pass {
    param([string]$Message)
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  FAIL  $Message" -ForegroundColor Red
}

function Write-Manual {
    param([string]$Message)
    Write-Host "  MANUAL  $Message" -ForegroundColor Yellow
}

function Invoke-Check {
    param(
        [string]$Description,
        [scriptblock]$Command,
        [string]$WorkingDir = $appDir
    )
    Write-Host "  Running: $Description" -ForegroundColor Gray
    try {
        Push-Location $WorkingDir
        & $Command
        Pop-Location
        Write-Pass $Description
    }
    catch {
        Pop-Location
        Write-Fail $Description
        Write-Host "  Error: $_" -ForegroundColor Red
        throw
    }
}

# ── Start ─────────────────────────────────────────────────────────────
Write-Step "Citadel Validation — Area: $Area"
Write-Step "git status --short (start)"
Push-Location $repoRoot
git status --short
Pop-Location

# ── Lint (all modes) ──────────────────────────────────────────────────
Write-Step "Lint"
Invoke-Check "biome check + tsgo" {
    pnpm.cmd --filter @readest/readest-app lint
}

# ── Sync mode ─────────────────────────────────────────────────────────
if ($Area -eq "sync" -or $Area -eq "full") {
    Write-Step "Audiobook Sync Tests"
    $syncTests = @(
        "src/__tests__/utils/audiobookTranscript.test.ts",
        "src/__tests__/utils/transcriptSync.test.ts",
        "src/__tests__/utils/audiobookSync.test.ts"
    )
    foreach ($test in $syncTests) {
        Invoke-Check "vitest run $test" {
            pnpm.cmd --filter @readest/readest-app exec vitest run $test
        }
    }
}

# ── Full mode: all tests ─────────────────────────────────────────────
if ($Area -eq "full") {
    Write-Step "Full Test Suite"
    Invoke-Check "vitest run (all)" {
        pnpm.cmd --filter @readest/readest-app exec vitest run
    }
}

# ── Visual / Reader manual checklists ─────────────────────────────────
if ($Area -eq "visual" -or $Area -eq "full") {
    Write-Step "Visual/UI Manual Checklist (from docs/VALIDATION_CHECKLISTS.md)"
    Write-Host @"

  Manual proof required (run the Tauri app):
  - [ ] Homepage featured book uses correct asset/presentation
  - [ ] Featured book frame is visible and not clipped
  - [ ] Background texture is visible but subtle
  - [ ] Reader page ornaments visible on chapter openings
  - [ ] GOT sigil size, position, and color match reference
  - [ ] Drop cap wraps correctly
  - [ ] Non-themed fallback still works
  - [ ] Dark mode: textures and ornaments remain readable
  - [ ] Library shelf book cards render correctly

"@
}

if ($Area -eq "reader" -or $Area -eq "full") {
    Write-Step "Reader Core Manual Checklist (from docs/VALIDATION_CHECKLISTS.md)"
    Write-Host @"

  Manual proof required (run the Tauri app):
  - [ ] Reader opens from library
  - [ ] Page navigation works
  - [ ] Resize/maximize/minimize preserves reading position
  - [ ] CFI/location recovery works on reopen
  - [ ] Page turns do not break audio/highlight if sync exists
  - [ ] Scroll mode and paginated mode both work
  - [ ] Sidebar opens/closes without breaking layout

"@
}

if ($Area -eq "sync" -or $Area -eq "full") {
    Write-Step "Audiobook Sync Manual Checklist (from docs/VALIDATION_CHECKLISTS.md)"
    Write-Host @"

  Manual proof required (run the Tauri app with audiobook-attached EPUB):
  - [ ] Press Play produces a playback diagnostic log
  - [ ] Timeupdate logs appear
  - [ ] Active sync entry is found
  - [ ] View is resolved
  - [ ] Marker application result is logged
  - [ ] Visible highlight appears on current spoken word
  - [ ] Page turns near spoken section transitions
  - [ ] Seek updates highlight
  - [ ] Reopen preserves sync state

  If agent cannot visually verify: report "not verified" + first failing log.
"@
}

# ── End ───────────────────────────────────────────────────────────────
Write-Step "git status --short (end)"
Push-Location $repoRoot
git status --short
Pop-Location

Write-Host "`nValidation complete for area: $Area" -ForegroundColor Green
Write-Host "Remember: automated checks pass. Manual items above must be verified or reported as 'not verified'." -ForegroundColor Yellow
