[cmdletbinding()]
param()

# Arrange.
. $PSScriptRoot\..\..\..\..\Tests\lib\Initialize-Test.ps1
Microsoft.PowerShell.Core\Import-Module $PSScriptRoot\..\MSBuildHelpers.psm1
Register-Mock Write-Warning
Register-Mock Get-MSBuildPath { 'Some resolved location' } -- -Version '12.0' -Architecture 'Some architecture'

# Act.
$actual = Select-MSBuildPath -Method 'Version' -Location '' -PreferredVersion '14.0' -Architecture 'Some architecture'

# Assert.
Assert-WasCalled Write-Warning

$expectedCallCount = if ($env:MSBUILDHELPERS_ENABLE_TELEMETRY -eq "true") { 10 } else { 5 }
Assert-WasCalled Get-MSBuildPath -Times $expectedCallCount

Assert-AreEqual -Expected 'Some resolved location' -Actual $actual
