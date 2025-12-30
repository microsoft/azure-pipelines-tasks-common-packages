#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Collects all arguments passed to tl.loc() function in changed files

.DESCRIPTION
    This script finds all files changed in git (staged, unstaged, or both)
    and extracts all arguments passed to the tl.loc() function.

.PARAMETER Source
    The source control state to check: 'staged', 'unstaged', or 'all' (default: 'all')

.PARAMETER OutputFormat
    Output format: 'list' (default), 'json', or 'csv'

.PARAMETER CI
    Enable CI mode with structured output suitable for CI/CD pipelines

.PARAMETER FailOnMissing
    Exit with code 1 if any localization keys are missing from module.json

.EXAMPLE
    .\collect-tl-loc-args.ps1
    .\collect-tl-loc-args.ps1 -Source staged
    .\collect-tl-loc-args.ps1 -OutputFormat json
    .\collect-tl-loc-args.ps1 -CI -FailOnMissing
#>

param(
    [ValidateSet('staged', 'unstaged', 'all')]
    [string]$Source = 'all',

    [ValidateSet('list', 'json', 'csv')]
    [string]$OutputFormat = 'list',

    [switch]$CI,

    [switch]$FailOnMissing
)

function Get-ChangedFiles {
    param([string]$Source)

    $files = @()

    switch ($Source) {
        'staged' {
            $files = git diff --cached --name-only --diff-filter=ACM
        }
        'unstaged' {
            $files = git diff --name-only --diff-filter=ACM
        }
        'all' {
            $stagedFiles = git diff --cached --name-only --diff-filter=ACM
            $unstagedFiles = git diff --name-only --diff-filter=ACM
            $files = ($stagedFiles + $unstagedFiles) | Select-Object -Unique
        }
    }

    # Filter for TypeScript/JavaScript files
    return $files | Where-Object { $_ -match '\.(ts|js)$' }
}

function Extract-TlLocArguments {
    param(
        [string]$FilePath,
        [string]$Content
    )

    $results = @()

    # Pattern to match tl.loc() calls with various argument patterns
    # Matches: tl.loc('key'), tl.loc("key"), tl.loc('key', arg1, arg2), etc.
    $pattern = 'tl\.loc\s*\(((?:[^()]*|\([^()]*\))*)\)'

    $matches = [regex]::Matches($Content, $pattern)

    foreach ($match in $matches) {
        $argsString = $match.Groups[1].Value.Trim()

        # Try to parse the arguments
        # This is a simple parser - may need enhancement for complex cases
        $args = @()
        $currentArg = ''
        $inString = $false
        $stringChar = ''
        $parenDepth = 0
        $bracketDepth = 0

        for ($i = 0; $i -lt $argsString.Length; $i++) {
            $char = $argsString[$i]

            if ($inString) {
                $currentArg += $char
                if ($char -eq $stringChar -and $argsString[$i-1] -ne '\') {
                    $inString = $false
                    $stringChar = ''
                }
            }
            elseif ($char -eq '"' -or $char -eq "'" -or $char -eq '`') {
                $inString = $true
                $stringChar = $char
                $currentArg += $char
            }
            elseif ($char -eq '(') {
                $parenDepth++
                $currentArg += $char
            }
            elseif ($char -eq ')') {
                $parenDepth--
                $currentArg += $char
            }
            elseif ($char -eq '[') {
                $bracketDepth++
                $currentArg += $char
            }
            elseif ($char -eq ']') {
                $bracketDepth--
                $currentArg += $char
            }
            elseif ($char -eq ',' -and $parenDepth -eq 0 -and $bracketDepth -eq 0) {
                if ($currentArg.Trim()) {
                    $args += $currentArg.Trim()
                }
                $currentArg = ''
            }
            else {
                $currentArg += $char
            }
        }

        # Add the last argument
        if ($currentArg.Trim()) {
            $args += $currentArg.Trim()
        }

        # Find line number
        $lineNumber = ($Content.Substring(0, $match.Index) -split "`n").Count

        $results += [PSCustomObject]@{
            File = $FilePath
            Line = $lineNumber
            FullCall = "tl.loc($argsString)"
            Arguments = $args
            ArgumentCount = $args.Count
            FirstArgument = if ($args.Count -gt 0) { $args[0] } else { '' }
        }
    }

    return $results
}

function Find-NearestModuleJson {
    param([string]$FilePath)

    $currentDir = Split-Path -Parent (Join-Path $PWD $FilePath)

    while ($currentDir) {
        $moduleJsonPath = Join-Path $currentDir "module.json"

        if (Test-Path $moduleJsonPath) {
            return $moduleJsonPath
        }

        $parentDir = Split-Path -Parent $currentDir
        if ($parentDir -eq $currentDir) {
            break
        }
        $currentDir = $parentDir
    }

    return $null
}

function Get-ModuleJsonMessages {
    param([string]$ModuleJsonPath)

    if (-not (Test-Path $ModuleJsonPath)) {
        return @{}
    }

    try {
        $content = Get-Content $ModuleJsonPath -Raw | ConvertFrom-Json
        if ($content.messages) {
            return $content.messages
        }
    }
    catch {
        Write-Host "Warning: Could not parse module.json at $ModuleJsonPath" -ForegroundColor Yellow
    }

    return @{}
}

function Get-CleanKey {
    param([string]$Argument)

    # Remove quotes from the argument to get the clean key
    if ($Argument -match "^[`'`"](.+)[`'`"]$") {
        return $matches[1]
    }
    return $Argument
}

# Main script execution
if ($CI) {
    Write-Host "##[section]Collecting tl.loc() arguments from changed files..."
    Write-Host "Source: $Source"
} else {
    Write-Host "Collecting tl.loc() arguments from changed files..." -ForegroundColor Cyan
    Write-Host "Source: $Source" -ForegroundColor Gray
    Write-Host ""
}

$changedFiles = Get-ChangedFiles -Source $Source

if ($changedFiles.Count -eq 0) {
    if ($CI) {
        Write-Host "##[section]No changed TypeScript/JavaScript files found."
    } else {
        Write-Host "No changed TypeScript/JavaScript files found." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Tip: Make some changes to files or use git to stage files." -ForegroundColor Gray
    }
    exit 0
}

if ($CI) {
    Write-Host "##[section]Found $($changedFiles.Count) changed file(s)"
    $changedFiles | ForEach-Object { Write-Host "  - $_" }
} else {
    Write-Host "Found $($changedFiles.Count) changed file(s):" -ForegroundColor Green
    $changedFiles | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
    Write-Host ""
}

$allResults = @()
$moduleJsonCache = @{}

foreach ($file in $changedFiles) {
    $fullPath = Join-Path $PWD $file

    if (-not (Test-Path $fullPath)) {
        if ($CI) {
            Write-Host "##[warning]Skipping $file (file not found)"
        } else {
            Write-Host "Skipping $file (file not found)" -ForegroundColor Yellow
        }
        continue
    }

    $content = Get-Content $fullPath -Raw -ErrorAction SilentlyContinue

    if ($null -eq $content) {
        continue
    }

    $results = Extract-TlLocArguments -FilePath $file -Content $content

    if ($results.Count -gt 0) {
        # Find nearest module.json
        $moduleJsonPath = Find-NearestModuleJson -FilePath $file

        # Get messages from module.json
        $messages = @{}
        if ($moduleJsonPath) {
            if (-not $moduleJsonCache.ContainsKey($moduleJsonPath)) {
                $moduleJsonCache[$moduleJsonPath] = Get-ModuleJsonMessages -ModuleJsonPath $moduleJsonPath
            }
            $messages = $moduleJsonCache[$moduleJsonPath]
        }

        # Add validation info to each result
        foreach ($result in $results) {
            $cleanKey = Get-CleanKey -Argument $result.FirstArgument

            $result | Add-Member -MemberType NoteProperty -Name "ModuleJsonPath" -Value $moduleJsonPath
            $result | Add-Member -MemberType NoteProperty -Name "CleanKey" -Value $cleanKey
            $result | Add-Member -MemberType NoteProperty -Name "ExistsInModuleJson" -Value ($messages.PSObject.Properties.Name -contains $cleanKey)
        }

        $allResults += $results
        if ($CI) {
            Write-Host "Found $($results.Count) tl.loc() call(s) in $file"
        } else {
            Write-Host "Found $($results.Count) tl.loc() call(s) in $file" -ForegroundColor Green
        }
    }
}

if ($CI) {
    Write-Host ""
    Write-Host "##[section]Total: $($allResults.Count) tl.loc() call(s) found"
} else {
    Write-Host ""
    Write-Host "Total: $($allResults.Count) tl.loc() call(s) found" -ForegroundColor Cyan
    Write-Host ""
}

# Output results based on format
switch ($OutputFormat) {
    'json' {
        $allResults | ConvertTo-Json -Depth 10
    }
    'csv' {
        $allResults | Select-Object File, Line, FirstArgument, ArgumentCount | ConvertTo-Csv -NoTypeInformation
    }
    'list' {
        if ($allResults.Count -eq 0) {
            Write-Host "No tl.loc() calls found in changed files." -ForegroundColor Yellow
        }
        else {
            foreach ($result in $allResults) {
                $statusColor = if ($result.ExistsInModuleJson) { "Green" } else { "Red" }
                $statusSymbol = if ($result.ExistsInModuleJson) { "✓" } else { "✗" }

                Write-Host "File: $($result.File):$($result.Line)" -ForegroundColor Cyan
                Write-Host "  Call: $($result.FullCall)" -ForegroundColor White
                Write-Host "  Key: $($result.CleanKey)" -ForegroundColor White
                Write-Host "  Status: $statusSymbol " -NoNewline
                Write-Host $(if ($result.ExistsInModuleJson) { "Found in module.json" } else { "NOT FOUND in module.json" }) -ForegroundColor $statusColor
                if ($result.ModuleJsonPath) {
                    Write-Host "  Module.json: $($result.ModuleJsonPath)" -ForegroundColor Gray
                } else {
                    Write-Host "  Module.json: NOT FOUND" -ForegroundColor Yellow
                }
                Write-Host "  Arguments ($($result.ArgumentCount)):" -ForegroundColor Gray

                for ($i = 0; $i -lt $result.Arguments.Count; $i++) {
                    Write-Host "    [$i] $($result.Arguments[$i])" -ForegroundColor White
                }
                Write-Host ""
            }

            # Summary of validation
            $missingKeys = $allResults | Where-Object { -not $_.ExistsInModuleJson }
            $foundKeys = $allResults | Where-Object { $_.ExistsInModuleJson }

            if ($CI) {
                Write-Host ""
                Write-Host "##[section]Validation Summary"
                Write-Host "Total tl.loc() calls: $($allResults.Count)"
                Write-Host "Keys found in module.json: $($foundKeys.Count)"
                Write-Host "Keys NOT found in module.json: $($missingKeys.Count)"

                if ($missingKeys.Count -gt 0) {
                    Write-Host ""
                    Write-Host "##[error]Missing keys in module.json:"
                    $uniqueMissing = $missingKeys | Select-Object -Property CleanKey, File, Line, ModuleJsonPath -Unique
                    foreach ($missing in $uniqueMissing) {
                        $relModulePath = if ($missing.ModuleJsonPath) {
                            (Resolve-Path -Relative $missing.ModuleJsonPath) -replace '\\', '/'
                        } else {
                            "NOT FOUND"
                        }
                        Write-Host "##[error]  Key '$($missing.CleanKey)' not found in $relModulePath"
                        Write-Host "##[error]    Used in: $($missing.File):$($missing.Line)"
                    }

                    if ($FailOnMissing) {
                        Write-Host ""
                        Write-Host "##[error]Localization key validation failed! $($missingKeys.Count) missing key(s) found."
                        exit 1
                    }
                } else {
                    Write-Host ""
                    Write-Host "##[section]✓ All localization keys are present in module.json files"
                }
            } else {
                Write-Host "================================" -ForegroundColor Gray
                Write-Host "Validation Summary:" -ForegroundColor Cyan
                Write-Host "  Total tl.loc() calls: $($allResults.Count)" -ForegroundColor White
                Write-Host "  Keys found in module.json: $($foundKeys.Count)" -ForegroundColor Green
                Write-Host "  Keys NOT found in module.json: $($missingKeys.Count)" -ForegroundColor $(if ($missingKeys.Count -gt 0) { "Red" } else { "Green" })

                if ($missingKeys.Count -gt 0) {
                    Write-Host ""
                    Write-Host "Missing keys in module.json:" -ForegroundColor Red
                    $uniqueMissing = $missingKeys | Select-Object -Property CleanKey, File -Unique
                    foreach ($missing in $uniqueMissing) {
                        Write-Host "  - $($missing.CleanKey)" -ForegroundColor Yellow
                        Write-Host "    in $($missing.File)" -ForegroundColor Gray
                    }

                    if ($FailOnMissing) {
                        Write-Host ""
                        Write-Host "ERROR: Localization key validation failed!" -ForegroundColor Red
                        Write-Host "$($missingKeys.Count) missing key(s) found." -ForegroundColor Red
                        exit 1
                    }
                }

                # Summary of unique first arguments (localization keys)
                Write-Host ""
                $uniqueKeys = $allResults | Select-Object -ExpandProperty CleanKey | Sort-Object -Unique
                Write-Host "Unique localization keys found: $($uniqueKeys.Count)" -ForegroundColor Cyan
                foreach ($key in $uniqueKeys) {
                    $exists = $allResults | Where-Object { $_.CleanKey -eq $key } | Select-Object -First 1 -ExpandProperty ExistsInModuleJson
                    $color = if ($exists) { "Green" } else { "Red" }
                    $symbol = if ($exists) { "✓" } else { "✗" }
                    Write-Host "  $symbol $key" -ForegroundColor $color
                }
            }
        }
    }
}
