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
Assert-WasCalled Get-MSBuildPath -Times 5 -ParametersEvaluator {
    $Version -in @('17.0', '16.0', '15.0', '14.0', '12.0') -and
    $Architecture -eq 'Some architecture'
}
Assert-AreEqual -Expected 'Some resolved location' -Actual $actual
