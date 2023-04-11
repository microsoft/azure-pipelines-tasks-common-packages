import * as nuGetGetter from "../../nuget/NuGetToolGetter";

export async function getMSBuildVersionString(): Promise<string> {
    return await nuGetGetter.getMSBuildVersionString();
}

export async function resolveNuGetVersion() : Promise<string>
{
    return await nuGetGetter.resolveNuGetVersion();
}