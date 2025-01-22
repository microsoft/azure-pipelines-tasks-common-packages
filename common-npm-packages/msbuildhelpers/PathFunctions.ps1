. $PSScriptRoot\TelemetryHelper

########################################
# Public functions.
########################################
$script:visualStudioCache = @{ }

########################################
# Public functions.
########################################
function Get-MSBuildPath {
    [CmdletBinding()]
    param(
        [string]$Version,
        [string]$Architecture)

    $VersionNumber = [int]($Version.Remove(2))

    Trace-VstsEnteringInvocation $MyInvocation
    try {
        # Only attempt to find Microsoft.Build.Utilities.Core.dll from a VS 15 Willow install
        # when "15.0" or latest is specified. In 15.0, the method GetPathToBuildToolsFile(...)
        # has regressed. When it is called for a version that is not found, the latest version
        # found is returned instead. Same for "16.0" and "17.0"
        [System.Reflection.Assembly]$msUtilities = $null

        if (($VersionNumber -ge 16 -or !$Version) -and # !$Version indicates "latest"
            ($specifiedStudio = Get-VisualStudio $VersionNumber) -and
            $specifiedStudio.installationPath) {

            $msbuildUtilitiesPath = [System.IO.Path]::Combine($specifiedStudio.installationPath, "MSBuild\Current\Bin\Microsoft.Build.Utilities.Core.dll")
            if (Test-Path -LiteralPath $msbuildUtilitiesPath -PathType Leaf) {
                Write-Verbose "Loading $msbuildUtilitiesPath"
                $msUtilities = [System.Reflection.Assembly]::LoadFrom($msbuildUtilitiesPath)
            }
        }

        elseif (($Version -eq "15.0" -or !$Version) -and # !$Version indicates "latest"
            ($visualStudio15 = Get-VisualStudio 15) -and
            $visualStudio15.installationPath) {

            $msbuildUtilitiesPath = [System.IO.Path]::Combine($visualStudio15.installationPath, "MSBuild\15.0\Bin\Microsoft.Build.Utilities.Core.dll")
            if (Test-Path -LiteralPath $msbuildUtilitiesPath -PathType Leaf) {
                Write-Verbose "Loading $msbuildUtilitiesPath"
                $msUtilities = [System.Reflection.Assembly]::LoadFrom($msbuildUtilitiesPath)
            }
        }

        # Fallback to searching the GAC.
        if (!$msUtilities) {
            $msbuildUtilitiesAssemblies = @(
                "Microsoft.Build.Utilities.Core, Version=15.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.Core, Version=14.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.v12.0, Version=12.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.v4.0, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
            )

            # Attempt to load a Microsoft build utilities DLL.
            $index = 0
            [System.Reflection.Assembly]$msUtilities = $null
            while (!$msUtilities -and $index -lt $msbuildUtilitiesAssemblies.Length) {
                Write-Verbose "Loading $($msbuildUtilitiesAssemblies[$index])"
                try {
                    $msUtilities = [System.Reflection.Assembly]::Load((New-Object System.Reflection.AssemblyName($msbuildUtilitiesAssemblies[$index])))
                } catch [System.IO.FileNotFoundException] {
                    Write-Verbose "Not found."
                }

                $index++
            }
        }

        [string]$msBuildPath = $null

        # Default to x86 architecture if not specified.
        if (!$Architecture) {
            $Architecture = "x86"
        }

        if ($msUtilities -ne $null) {
            [type]$t = $msUtilities.GetType('Microsoft.Build.Utilities.ToolLocationHelper')
            if ($t -ne $null) {
                # Attempt to load the method info for GetPathToBuildToolsFile. This method
                # is available in the 16.0, 15.0, 14.0, and 12.0 utilities DLL. It is not available
                # in the 4.0 utilities DLL.
                [System.Reflection.MethodInfo]$mi = $t.GetMethod(
                    "GetPathToBuildToolsFile",
                    [type[]]@( [string], [string], $msUtilities.GetType("Microsoft.Build.Utilities.DotNetFrameworkArchitecture") ))
                if ($mi -ne $null -and $mi.GetParameters().Length -eq 3) {
                    $versions = "16.0", "15.0", "14.0", "12.0", "4.0"
                    if ($Version) {
                        $versions = @( $Version )
                    }

                    # Translate the architecture parameter into the corresponding value of the
                    # DotNetFrameworkArchitecture enum. Parameter three of the target method info
                    # takes this enum. Leverage parameter three to get to the enum's type info.
                    $param3 = $mi.GetParameters()[2]
                    $archValues = [System.Enum]::GetValues($param3.ParameterType)
                    [object]$archValue = $null
                    if ($Architecture -eq 'x86') {
                        $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                    } elseif ($Architecture -eq 'x64') {
                        $archValue = $archValues.GetValue(2) # DotNetFrameworkArchitecture.Bitness64
                    } else {
                        $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                    }

                    # Attempt to resolve the path for each version.
                    $versionIndex = 0
                    while (!$msBuildPath -and $versionIndex -lt $versions.Length) {
                        $msBuildPath = $mi.Invoke(
                            $null,
                            @( 'msbuild.exe' # string fileName
                                $versions[$versionIndex] # string toolsVersion
                                $archValue ))
                        $versionIndex++
                    }
                } elseif (!$Version -or $Version -eq "4.0") {
                    # Attempt to load the method info GetPathToDotNetFrameworkFile. This method
                    # is available in the 4.0 utilities DLL.
                    $mi = $t.GetMethod(
                        "GetPathToDotNetFrameworkFile",
                        [type[]]@( [string], $msUtilities.GetType("Microsoft.Build.Utilities.TargetDotNetFrameworkVersion"), $msUtilities.GetType("Microsoft.Build.Utilities.DotNetFrameworkArchitecture") ))
                    if ($mi -ne $null -and $mi.GetParameters().Length -eq 3) {
                        # Parameter two of the target method info takes the TargetDotNetFrameworkVersion
                        # enum. Leverage parameter two to get the enum's type info.
                        $param2 = $mi.GetParameters()[1];
                        $frameworkVersionValues = [System.Enum]::GetValues($param2.ParameterType);

                        # Translate the architecture parameter into the corresponding value of the
                        # DotNetFrameworkArchitecture enum. Parameter three of the target method info
                        # takes this enum. Leverage parameter three to get to the enum's type info.
                        $param3 = $mi.GetParameters()[2];
                        $archValues = [System.Enum]::GetValues($param3.ParameterType);
                        [object]$archValue = $null
                        if ($Architecture -eq "x86") {
                            $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                        } elseif ($Architecture -eq "x64") {
                            $archValue = $archValues.GetValue(2) # DotNetFrameworkArchitecture.Bitness64
                        } else {
                            $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                        }

                        # Attempt to resolve the path.
                        $msBuildPath = $mi.Invoke(
                            $null,
                            @( "msbuild.exe" # string fileName
                                $frameworkVersionValues.GetValue($frameworkVersionValues.Length - 1) # enum TargetDotNetFrameworkVersion.VersionLatest
                                $archValue ))
                    }
                }
            }
        }

        if ($msBuildPath -and (Test-Path -LiteralPath $msBuildPath -PathType Leaf)) {
            Write-Verbose "MSBuild: $msBuildPath"
            $msBuildPath
        }
    } finally {
        Trace-VstsLeavingInvocation $MyInvocation
    }
}

# This is an updated version of Get-MsBuildPath for VS version greater than equal to 15.0.
# Get-MsBuildPath function script first locates Microsoft.Build.Utilities.Core.dll and then uses it to locate the msbuild.exe. 
# Under the current preview version of VS 17.3.2 this fails due to an assembly conflict.
# the reflection usage here is redundant, since the msbuild exe lives either in the same folder as this .dll file or in its direct subfolder.
# [TODO] : Once we have enough telemetry records to be confident of the correctness of this method, replace Get-MSBuildPath with Get-MSBuildPathV2 and remove feature flags.
function Get-MSBuildPathV2 {
    [CmdletBinding()]
    param(
        [string]$Version,
        [string]$Architecture)

    $VersionNumber = 0
    try {
        $VersionNumber = [int]($Version.Remove(2))
    } catch {
        Write-Debug "Exception caught while parsing VersionNumber : $_"
    }

    Trace-VstsEnteringInvocation $MyInvocation
    try {
        # Only attempt to find Microsoft.Build.Utilities.Core.dll from a VS 15 Willow install
        # when "15.0" or latest is specified. In 15.0, the method GetPathToBuildToolsFile(...)
        # has regressed. When it is called for a version that is not found, the latest version
        # found is returned instead. Same for "16.0" and "17.0"
        [System.Reflection.Assembly]$msUtilities = $null


        # We do not need Microsoft.Build.Utilities.Core.dll - if we have located this .dll file, we also have the location of msbuild.exe
        # for the Bitness32 variant since it resides in the same folder.
        # and for the Bitness64 variant since it resides in the /amd64 folders.
        # These paths are fixed due to the way VS is installed.
        $VersionNumber = [int]($Version.Remove(2))

        $specifiedStudio = Get-VisualStudio $VersionNumber
        if (($VersionNumber -ge 15 -or !$Version) -and # !$Version indicates "latest"
            ($specifiedStudio = Get-VisualStudio $VersionNumber) -and
            $specifiedStudio.installationPath) {

                $MsBuildDirectory = "Current"
            if ($VersionNumber -eq 15) {
                $MsBuildDirectory = "15.0"
            }

            if ($Architecture -eq 'x86') {
                $msBuildPath = [System.IO.Path]::Combine($specifiedStudio.installationPath, "MSBuild", $MsBuildDirectory, "Bin\MSBuild.exe");
                # DotNetFrameworkArchitecture.Bitness32
            } elseif ($Architecture -eq 'x64') {
                $msBuildPath = [System.IO.Path]::Combine($specifiedStudio.installationPath, "MSBuild", $MsBuildDirectory, "Bin\amd64\MSBuild.exe");
                # DotNetFrameworkArchitecture.Bitness64
            } else {
                $msBuildPath = [System.IO.Path]::Combine($specifiedStudio.installationPath, "MSBuild", $MsBuildDirectory, "Bin\MSBuild.exe");
                # DotNetFrameworkArchitecture.Bitness32
            }

            if ($msBuildPath -and (Test-Path -LiteralPath $msBuildPath -PathType Leaf)) {
                Write-Verbose "MSBuild: $msBuildPath"
                return $msBuildPath
            }
        }

        # Fallback to searching the GAC.
        if (!$msUtilities) {
            $msbuildUtilitiesAssemblies = @(
                "Microsoft.Build.Utilities.Core, Version=15.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.Core, Version=14.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.v12.0, Version=12.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
                "Microsoft.Build.Utilities.v4.0, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a, processorArchitecture=MSIL"
            )

            # Attempt to load a Microsoft build utilities DLL.
            $index = 0
            [System.Reflection.Assembly]$msUtilities = $null
            while (!$msUtilities -and $index -lt $msbuildUtilitiesAssemblies.Length) {
                Write-Verbose "Loading $($msbuildUtilitiesAssemblies[$index])"
                try {
                    $msUtilities = [System.Reflection.Assembly]::Load((New-Object System.Reflection.AssemblyName($msbuildUtilitiesAssemblies[$index])))
                } catch [System.IO.FileNotFoundException] {
                    Write-Verbose "Not found."
                }

                $index++
            }
        }

        [string]$msBuildPath = $null

        # Default to x86 architecture if not specified.
        if (!$Architecture) {
            $Architecture = "x86"
        }

        if ($msUtilities -ne $null) {
            [type]$t = $msUtilities.GetType('Microsoft.Build.Utilities.ToolLocationHelper')
            if ($t -ne $null) {
                # Attempt to load the method info for GetPathToBuildToolsFile. This method
                # is available in the 16.0, 15.0, 14.0, and 12.0 utilities DLL. It is not available
                # in the 4.0 utilities DLL.
                [System.Reflection.MethodInfo]$mi = $t.GetMethod(
                    "GetPathToBuildToolsFile",
                    [type[]]@( [string], [string], $msUtilities.GetType("Microsoft.Build.Utilities.DotNetFrameworkArchitecture") ))
                if ($mi -ne $null -and $mi.GetParameters().Length -eq 3) {
                    $versions = "16.0", "15.0", "14.0", "12.0", "4.0"
                    if ($Version) {
                        $versions = @( $Version )
                    }

                    # Translate the architecture parameter into the corresponding value of the
                    # DotNetFrameworkArchitecture enum. Parameter three of the target method info
                    # takes this enum. Leverage parameter three to get to the enum's type info.
                    $param3 = $mi.GetParameters()[2]
                    $archValues = [System.Enum]::GetValues($param3.ParameterType)
                    [object]$archValue = $null
                    if ($Architecture -eq 'x86') {
                        $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                    } elseif ($Architecture -eq 'x64') {
                        $archValue = $archValues.GetValue(2) # DotNetFrameworkArchitecture.Bitness64
                    } else {
                        $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                    }

                    # Attempt to resolve the path for each version.
                    $versionIndex = 0
                    while (!$msBuildPath -and $versionIndex -lt $versions.Length) {
                        $msBuildPath = $mi.Invoke(
                            $null,
                            @( 'msbuild.exe' # string fileName
                                $versions[$versionIndex] # string toolsVersion
                                $archValue ))
                        $versionIndex++
                    }
                } elseif (!$Version -or $Version -eq "4.0") {
                    # Attempt to load the method info GetPathToDotNetFrameworkFile. This method
                    # is available in the 4.0 utilities DLL.
                    $mi = $t.GetMethod(
                        "GetPathToDotNetFrameworkFile",
                        [type[]]@( [string], $msUtilities.GetType("Microsoft.Build.Utilities.TargetDotNetFrameworkVersion"), $msUtilities.GetType("Microsoft.Build.Utilities.DotNetFrameworkArchitecture") ))
                    if ($mi -ne $null -and $mi.GetParameters().Length -eq 3) {
                        # Parameter two of the target method info takes the TargetDotNetFrameworkVersion
                        # enum. Leverage parameter two to get the enum's type info.
                        $param2 = $mi.GetParameters()[1];
                        $frameworkVersionValues = [System.Enum]::GetValues($param2.ParameterType);

                        # Translate the architecture parameter into the corresponding value of the
                        # DotNetFrameworkArchitecture enum. Parameter three of the target method info
                        # takes this enum. Leverage parameter three to get to the enum's type info.
                        $param3 = $mi.GetParameters()[2];
                        $archValues = [System.Enum]::GetValues($param3.ParameterType);
                        [object]$archValue = $null
                        if ($Architecture -eq "x86") {
                            $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                        } elseif ($Architecture -eq "x64") {
                            $archValue = $archValues.GetValue(2) # DotNetFrameworkArchitecture.Bitness64
                        } else {
                            $archValue = $archValues.GetValue(1) # DotNetFrameworkArchitecture.Bitness32
                        }

                        # Attempt to resolve the path.
                        $msBuildPath = $mi.Invoke(
                            $null,
                            @( "msbuild.exe" # string fileName
                                $frameworkVersionValues.GetValue($frameworkVersionValues.Length - 1) # enum TargetDotNetFrameworkVersion.VersionLatest
                                $archValue ))
                    }
                }
            }
        }

        if ($msBuildPath -and (Test-Path -LiteralPath $msBuildPath -PathType Leaf)) {
            Write-Verbose "MSBuild: $msBuildPath"
            $msBuildPath
        }
    } finally {
        Trace-VstsLeavingInvocation $MyInvocation
    }
}

function Get-SolutionFiles {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Solution)

    Trace-VstsEnteringInvocation $MyInvocation
    try {
        if ($Solution.Contains("*") -or $Solution.Contains("?")) {
            $solutionFiles = Find-VstsFiles -LegacyPattern $Solution
            if (!$solutionFiles.Count) {
                throw (Get-VstsLocString -Key MSB_SolutionNotFoundUsingSearchPattern0 -ArgumentList $Solution)
            }
        } else {
            $solutionFiles = ,$Solution
        }

        $solutionFiles
    } finally {
        Trace-VstsLeavingInvocation $MyInvocation
    }
}

function Get-VisualStudio {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(15, 16, 17)]
        [int]$MajorVersion)

    Trace-VstsEnteringInvocation $MyInvocation
    try {
        if (!$script:visualStudioCache.ContainsKey("$MajorVersion.0")) {
            try {
                # Query for the latest $MajorVersion.* version.
                #
                # Note, the capability is registered as VisualStudio_16.0, however the actual version
                # may be something like 16.2.
                Write-Verbose "Getting latest Visual Studio $MajorVersion setup instance."
                $output = New-Object System.Text.StringBuilder
                Invoke-VstsTool -FileName "$PSScriptRoot\tools\vswhere.exe" -Arguments "-version [$MajorVersion.0,$($MajorVersion+1).0) -latest -format json" -RequireExitCodeZero 2>&1 |
                    ForEach-Object {
                        if ($_ -is [System.Management.Automation.ErrorRecord]) {
                            Write-Verbose "STDERR: $($_.Exception.Message)"
                        }
                        else {
                            Write-Verbose $_
                            $null = $output.AppendLine($_)
                        }
                    }
                $script:visualStudioCache["$MajorVersion.0"] = (ConvertFrom-Json -InputObject $output.ToString()) |
                    Select-Object -First 1
                if (!$script:visualStudioCache["$MajorVersion.0"]) {
                    # Query for the latest $MajorVersion.* BuildTools.
                    #
                    # Note, whereas VS 16.x version number is always 16.0.*, BuildTools does not follow the
                    # the same scheme. It appears to follow the 16.<UPDATE_NUMBER>.* versioning scheme.
                    Write-Verbose "Getting latest BuildTools 16 setup instance."
                    $output = New-Object System.Text.StringBuilder
                    Invoke-VstsTool -FileName "$PSScriptRoot\tools\vswhere.exe" -Arguments "-version [$MajorVersion.0,$($MajorVersion+1).0) -products Microsoft.VisualStudio.Product.BuildTools -latest -format json" -RequireExitCodeZero 2>&1 |
                        ForEach-Object {
                            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                                Write-Verbose "STDERR: $($_.Exception.Message)"
                            }
                            else {
                                Write-Verbose $_
                                $null = $output.AppendLine($_)
                            }
                        }
                    $script:visualStudioCache["$MajorVersion.0"] = (ConvertFrom-Json -InputObject $output.ToString()) |
                        Select-Object -First 1
                }
            } catch {
                Write-Verbose ($_ | Out-String)
                $script:visualStudioCache["$MajorVersion.0"] = $null
            }
        }

        return $script:visualStudioCache["$MajorVersion.0"]
    } finally {
        Trace-VstsLeavingInvocation $MyInvocation
    }
}

function Select-MSBuildPath {
    [CmdletBinding()]
    param(
        [string]$Method,
        [string]$Location,
        [string]$PreferredVersion,
        [string]$Architecture)

    Trace-VstsEnteringInvocation $MyInvocation

    $featureFlags = Get-FeatureFlags

    $selectMSBuildPathTelemetry = [PSCustomObject]@{
        PreferredVersion = $PreferredVersion
        LookedUpVersion = ""
        Architecture = $Architecture
        PathMatches = ""
    }

    try {
        # Default the msbuildLocationMethod if not specified. The input msbuildLocationMethod
        # was added to the definition after the input msbuildLocation.
        if ("$Method".ToUpperInvariant() -ne 'LOCATION' -and "$Method".ToUpperInvariant() -ne 'VERSION') {
            # Infer the msbuildLocationMethod based on the whether msbuildLocation is specified.
            if ($Location) {
                $Method = 'location'
            } else {
                $Method = 'version'
            }

            Write-Verbose "Defaulted MSBuild location method to: $Method"
        }

        if ("$Method".ToUpperInvariant() -eq 'LOCATION') {
            # Return the location.
            if ($Location) {
                return $Location
            }

            # Fallback to version lookup.
            Write-Verbose "Location not specified. Looking up by version instead."
        }

        $specificVersion = $PreferredVersion -and $PreferredVersion -ne 'latest'
        $versions = '17.0', '16.0', '15.0', '14.0', '12.0', '4.0' | Where-Object { $_ -ne $PreferredVersion }

        # Look for a specific version of MSBuild.
        if ($specificVersion) {
            if($featureFlags.enableTelemetry) {
                $pathFromGetMSBuildPathV2 = $null
                try {
                    $selectMSBuildPathTelemetry.LookedUpVersion = $PreferredVersion
                    $pathFromGetMSBuildPath = Get-MSBuildPath -Version $PreferredVersion -Architecture $Architecture
                    $pathFromGetMSBuildPathV2 = Get-MSBuildPathV2 -Version $PreferredVersion -Architecture $Architecture                    
                    $selectMSBuildPathTelemetry.PathMatches = ($pathFromGetMSBuildPath -eq $pathFromGetMSBuildPathV2)
                } catch {
                    Write-Debug "Exception caught : $_"
                }

                EmitTelemetry -TelemetryPayload $selectMSBuildPathTelemetry -TaskName "MSBuildHelpers"

                if($featureFlags.useGetMSBuildPathV2 -and $pathFromGetMSBuildPathV2) {
                    Write-Debug "Returning path from GetMSBuildPathV2"
                    return $pathFromGetMSBuildPathV2
                }
            }
            
            if (($path = Get-MSBuildPath -Version $PreferredVersion -Architecture $Architecture)) {
                return $path
            }
            
            # Attempt to fallback.
            Write-Verbose "Specified version '$PreferredVersion' and architecture '$Architecture' not found. Attempting to fallback."
        }

        # Look for the latest version of MSBuild.
        foreach ($version in $versions) {
            if($featureFlags.enableTelemetry) {
                $pathFromGetMSBuildPathV2 = $null
                try {
                    $selectMSBuildPathTelemetry.LookedUpVersion = $version
                    $pathFromGetMSBuildPath = Get-MSBuildPath -Version $version -Architecture $Architecture
                    $pathFromGetMSBuildPathV2 = Get-MSBuildPathV2 -Version $version -Architecture $Architecture
                    $selectMSBuildPathTelemetry.PathMatches = ($pathFromGetMSBuildPath -eq $pathFromGetMSBuildPathV2)
                } catch {
                    Write-Debug "Exception caught : $_"
                }

                EmitTelemetry -TelemetryPayload $selectMSBuildPathTelemetry -TaskName "MSBuildHelpers"
                
                if($featureFlags.useGetMSBuildPathV2 -and $pathFromGetMSBuildPathV2) {
                    # Warn falling back.
                    if ($specificVersion) {
                        Write-Warning (Get-VstsLocString -Key 'MSB_UnableToFindMSBuildVersion0Architecture1FallbackVersion2' -ArgumentList $PreferredVersion, $Architecture, $version)
                    }
                    Write-Debug "Returning path from GetMSBuildPathV2"
                    return $pathFromGetMSBuildPathV2
                }
            }

            if (($path = Get-MSBuildPath -Version $version -Architecture $Architecture)) {
                # Warn falling back.
                if ($specificVersion) {
                    Write-Warning (Get-VstsLocString -Key 'MSB_UnableToFindMSBuildVersion0Architecture1FallbackVersion2' -ArgumentList $PreferredVersion, $Architecture, $version)
                }
                return $path
            }
        }

        # Error. Not found.
        if ($specificVersion) {
            Write-Error (Get-VstsLocString -Key 'MSB_MSBuildNotFoundVersion0Architecture1' -ArgumentList $PreferredVersion, $Architecture)
        } else {
            Write-Error (Get-VstsLocString -Key 'MSB_MSBuildNotFound')
        }
    } finally {
        Trace-VstsLeavingInvocation $MyInvocation
    }
}

function Get-FeatureFlags {
    $featureFlags = @{
        enableTelemetry  = $false
        useGetMSBuildPathV2 = $false
    }

    try {
        $enableTelemetry = [System.Convert]::ToBoolean($env:MSBUILDHELPERS_ENABLE_TELEMETRY)
        $featureFlags.enableTelemetry = $enableTelemetry
    } catch {
        Write-Debug "Error while reading feature flag : MSBUILDHELPERS_ENABLE_TELEMETRY"
    }

    try {
        $useGetMSBuildPathV2 = [System.Convert]::ToBoolean($env:MSBUILDHELPERS_ENABLE_GETMSBUILDPATHV2)
        $featureFlags.useGetMSBuildPathV2 = $useGetMSBuildPathV2
    } catch {
        Write-Debug "Error while reading feature flag : MSBUILDHELPERS_ENABLE_GETMSBUILDPATHV2"
    }

    return $featureFlags
}