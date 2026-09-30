# CJK ASCII-transparency verification

`Program.cs` empirically verifies, against .NET's own `System.Text.Encoding`
tables, that none of the multi-byte CJK code pages allowed by
`asciiTransparentEncodings` in `../../xdttransformationutility.ts` can decode a
non-ASCII byte pair into an XML delimiter (`<`, `>`, `&`, `"`, `'`, `=`, `/`).

This mirrors, for the CJK entries in the encoding allowlist, the same rigor
that the `builtInXdtTransformTypes` / `builtInXdtLocatorTypes` lists get from
reflecting the bundled `ctt.exe` assembly: a verification run directly against
the real .NET encoding implementation, not just against documentation.

`verified-results.json` records the last verified run. **Re-run this program
and refresh that file whenever a multi-byte CJK encoding is added to the
allowlist.**

## How to run

Requires the classic .NET Framework compiler (already present wherever
`ctt.exe`, itself a .NET Framework binary, can run):

```powershell
& "C:\Windows\Microsoft.Net\Framework\v4.0.30319\csc.exe" /nologo /out:verify.exe Program.cs
.\verify.exe
```

A non-zero exit code, or any line starting with `VIOLATION:`, means a code
page in the allowlist can synthesise an XML delimiter from non-ASCII bytes and
must be removed from `asciiTransparentEncodings`.
