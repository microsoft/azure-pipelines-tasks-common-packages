# Web deployment common

## Filename diagnostics and caller-owned VSO command mode

Version 4.282.1 uses `azure-pipelines-task-lib` external-output APIs (dependency
`^5.281.2`) for JSON, XML, and XDT filename diagnostics. Filesystem matching,
reads, writes, and XDT arguments always use the original paths. The writer adds
a trailing newline to each informational diagnostic, preserving the previous
`console.log` framing. Basic XDT filename diagnostics retain debug severity.

The following APIs accept a trailing optional `vsoCommandMode` of type
`VsoCommandMode` from `azure-pipelines-task-lib/externaloutput`:

| Module | API | Mode parameter |
| --- | --- | --- |
| `fileTransformationsUtility` | `fileTransformations`, `advancedFileTransformations`, `enhancedFileTransformations` | 7th |
| `jsonvariablesubstitutionutility` | `jsonVariableSubstitution` | 4th (after `substituteAllTypes`) |
| `xmlvariablesubstitutionutility` | `substituteAppSettingsVariables` | 4th (after `fileName`) |
| `xmlvariablesubstitutionutility` | `substituteXmlVariables` | 5th |
| `xdttransformationutility` | `basicXdtTransformation` | 3rd |
| `xdttransformationutility` | `specialXdtTransformation` | 5th (after `destinationConfig`) |
| `utility` | `generateTemporaryFolderForDeployment` | 4th (archive extraction, since 4.282.2) |
| `ziputility` | `unzip` | 3rd (since 4.282.2) |

Omitted or `undefined` modes explicitly default to **`disabled`** for compatibility
with existing unconfigured callers, rather than task-lib's `blockOnly` default.
Existing argument positions remain unchanged; pass `undefined` for preceding
optional arguments when needed.

| Mode | Blocks exact `##vso[` markers | Task-lib command telemetry |
| --- | --- | --- |
| `disabled` (package default) | No | No |
| `telemetryOnly` | No | Yes |
| `blockOnly` | Yes | No |
| `blockAndTelemetry` | Yes | Yes |

**Callers must explicitly choose `blockOnly` or `blockAndTelemetry` to protect
these diagnostics. Default/disabled and telemetry-only callers are not protected.**
The consuming task owns mode selection and any shared rollout policy; this package
does not read a new feature flag or cache process-global logging policy.

For example, a consuming task can pass its chosen policy through the public API:

```typescript
import { VsoCommandMode } from 'azure-pipelines-task-lib/externaloutput';
import { enhancedFileTransformations } from 'azure-pipelines-tasks-webdeployment-common/fileTransformationsUtility';

const vsoCommandMode: VsoCommandMode = 'blockOnly';
enhancedFileTransformations(
    true, false, folderPath, [], ['**/*.config'], ['**/*.json'], vsoCommandMode);
```

Blocking delegates to task-lib's exact-marker behavior: `##vso[` becomes
`##_vso[` wherever it occurs, including after CR/LF. Surrounding text and
newlines remain intact; mixed-case markers and `##[` formatting markers are
not normalized. No VSO commands are allowlisted for these repository-origin
diagnostics. Telemetry is task-lib command metadata only, not filenames,
command arguments/data, file contents, or substitution values. This mode is
scoped to the listed diagnostics and, since 4.282.2, archive extraction. Extraction
uses the caller's mode for tool command display, stdout/stderr, and path debug
messages on unzip, 7-Zip, and PowerShell paths. Raw tool arguments and extracted
filenames remain unchanged; other subprocesses and logs are not covered.
Consuming tasks must adopt the published package and pass their selected mode;
updating this package alone does not opt existing tasks into blocking.

FileTransform adoption is deferred to the consuming task. After this package is
published, FileTransform must update its dependency and lockfile to bundle the
published version and explicitly pass its shared RM policy mode:
`EnableVsoCommandBlockingRMTasks` enabled selects `blockAndTelemetry`, while
disabled or unset selects `telemetryOnly` (which does not block commands).
This common package does not read that policy or any task-specific kill switch.

## Hardened XDT and compatibility rollout flag

Version 4.282.0 gates the original XDT security hardening from PR #665 and the
compatibility fixes below in the common package using
`DistributedTask.Tasks.WebDeploymentCompatibilityFixEnabled`. The package uses
`tl.getPipelineFeature` directly, matching other task feature rollouts. The
feature defaults to **false** when it is not supplied by the agent. A disabled
feature blocks XDT before reading transform bytes or executing `ctt.exe`.
It does not restore pre-#665 behavior or run unhardened transformations.
Only a case-insensitive `true` enables the feature; absent, empty, `false`, and
other values are treated as disabled by the task library. The feature is read
on each operation, not cached when the module loads.

| Compatibility flag | `DistributedTask.Tasks.SecureMSDeployCommandExecution` | XDT behavior | MSDeploy behavior |
| --- | --- | --- | --- |
| Absent / empty / false / other | Absent / false | XDT rejected before execution | Existing legacy execution |
| Absent / empty / false / other | true | XDT rejected before execution | Published 4.281.3 secure execution |
| true | Absent / false | Security hardening and compatibility fixes | Existing legacy execution |
| true | true | Security hardening and compatibility fixes | Secure compatibility fixes |

Consuming tasks must adopt the published common-package version containing this
flag; they do not need duplicate gating logic or new task inputs. A dependency
range alone does not update a task's locked, bundled package. The prepared
4.282.0 version is not yet published, and task dependencies remain on 4.281.3.

To explicitly enable the behavior, supply non-secret pipeline variables:

```yaml
variables:
  DistributedTask.Tasks.WebDeploymentCompatibilityFixEnabled: 'true'
  DistributedTask.Tasks.SecureMSDeployCommandExecution: 'true'
```

The task library reads these as agent-provided environment variables
`DISTRIBUTEDTASK_TASKS_WEBDEPLOYMENTCOMPATIBILITYFIXENABLED` and
`DISTRIBUTEDTASK_TASKS_SECUREMSDEPLOYCOMMANDEXECUTION`. Set them before the task
starts; they are not task inputs.

For MSDeploy, enable or retain the existing security flag and explicitly enable
the compatibility feature before adopting this package.
Do not turn the security flag off to roll back compatibility changes.
Setting the compatibility flag to `false` for subsequent task executions
restores published 4.281.3 MSDeploy behavior, including its known compatibility
limitations, but **rejects all XDT transformations**. Pipelines that request XDT
will fail rather than fall back to weaker validation. JSON substitution or other
operations that do not invoke XDT are not disabled. This switch does not retry,
undo, or interrupt a transformation or deployment already in progress.

No Azure DevOps service-side registration or deployment is included. Register
and enable the feature through the standard service-side pipeline-feature
rollout before publishing and adopting this version. Without that enablement,
pipelines that request XDT fail closed.

## XML transformation compatibility

With the compatibility flag enabled, version 4.282.0 restores support for the
Latin-1 encoding aliases `iso-ir-100`,
`csISOLatin1`, `cp819`, and `ibm819` in XDT transform declarations. Encoding names
are matched case-insensitively.

For these restored aliases, transforms containing non-ASCII Latin-1 bytes require
a source with a Latin-1 encoding declaration and no Unicode BOM. Incompatible combinations, including
a UTF-8 source with a Latin-1 transform, are rejected before `ctt.exe` runs or
the source/destination is overwritten. Re-save both files using the same encoding.
ASCII-only transforms using these aliases remain compatible with UTF-8 sources.
Previously accepted encoding names retain their existing behavior; this guard
does not fix the engine's pre-existing mixed-encoding limitation for `iso-8859-1`.

Valid XML declarations are no longer limited to the first 4,096 bytes. The complete
transform is read once, and both declaration validation and XML validation use
that buffer. Long declarations still undergo the same encoding and XDT checks.

With the flag enabled, the gated path always performs security
validation. XDT imports and custom transform/locator types are rejected, as are
unsupported transform encodings, malformed declarations, unreadable transforms,
and UTF-16 decoder disagreements. When the feature is not enabled, the entire XDT
operation is rejected, so there is no unvalidated fallback.
`AZP_ALLOW_UNSAFE_XDT_TRANSFORMS` remains unsupported. Security encoding checks apply
to the transform document; the separate Latin-1 compatibility check also reads
the source encoding to prevent data corruption.

## DOCTYPE blocking and rollback

Version 4.282.2 adds this check.

When XDT is enabled by `DistributedTask.Tasks.WebDeploymentCompatibilityFixEnabled`,
transform files containing `<!DOCTYPE` (case-insensitive) are rejected by default.
The check runs on the decoded transform before DOM parsing and semantic validation,
including for UTF-16 LE files. All DOCTYPEs are blocked, including internal and
external DTD subsets, because .NET applies DTD attribute defaults that the
JavaScript validator does not see. The broad check also rejects this literal text
inside comments or CDATA. Remove DOCTYPE declarations and DTD dependencies from
transform files.

The independent kill-switch
`DistributedTask.Tasks.XdtDoctypeBlockDisabled` uses `tl.getPipelineFeature`:

| Kill-switch value | DOCTYPE check |
| --- | --- |
| Unset / false / other | Active (default) |
| true (case-insensitive) | Skipped for emergency rollback |

The agent environment variable is
`DISTRIBUTEDTASK_TASKS_XDTDOCTYPEBLOCKDISABLED`. The switch is read on each
transformation. Setting it to `true` restores the previous DOCTYPE behavior and
reintroduces the DTD validation gap; use it only temporarily while fixing affected
transforms. It does not bypass encoding, import, custom-type, or compatibility
validation, and does not enable XDT when the compatibility flag is disabled.

The dedicated `TaskHub` / `XdtDoctypeBlock` telemetry feature (separate from
`XdtTransformationSecurity`, so it can be queried on its own) records
`{result: "blocked", reason: "doctype"}`,
`{result: "passed", reason: "doctypeCheckPassed"}`, or
`{result: "skipped", reason: "doctypeCheckDisabled"}`. Monitor blocks for rollout
impact and skipped checks for kill-switch use.

## Secure MSDeploy compatibility

When both flags are enabled, MSDeploy is started directly
without a shell or an 8.3 short-path requirement. Executable paths and parameter
filenames containing spaces are supported. Backticks, ampersands, and percent
signs are passed literally instead of being expanded by a shell.
MSDeploy's own environment-variable expansion in provider paths is unchanged.

MSDeploy reads its raw Windows command line rather than relying solely on normal
Windows argument decoding. Secure execution therefore retains MSDeploy's
value-level quoting and explicitly quotes the executable's command-line name.
Generic Windows quoting of whole arguments is not compatible with this parser.

Structured values still reject single/double quotes and CR/LF. Additional
arguments retain the existing MSDeploy syntax. Surrounding whitespace, including
trailing LF/CRLF from pipeline variables, is trimmed before validation; interior
CR/LF remains rejected. Disabling the new compatibility flag preserves the
published secure or legacy path selected by the
existing security flag, including its argument validation and quoting.

The Windows regression suite runs both bundled MSDeploy engines against
disposable filesystem providers. This covers argument transport, not a live
IIS or remote authenticated deployment.
