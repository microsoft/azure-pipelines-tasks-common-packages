# Web deployment common

## Hardened XDT and compatibility rollout flag

Version 4.281.4 gates the original XDT security hardening from PR #665 and the
compatibility fixes below in the common package using
`DistributedTask.Tasks.WebDeploymentCompatibilityFixEnabled`. It defaults to
**true** when absent or empty. Explicit, case-insensitive `false` disables XDT:
the operation fails before reading transform bytes or executing `ctt.exe`.
It does not restore pre-#665 behavior or run unhardened transformations.
When evaluated for XDT or secure MSDeploy, other nonempty values are
configuration errors; use `true` or `false`.
The flag is read on each operation, not cached when the module loads.

| Compatibility flag | `DistributedTask.Tasks.SecureMSDeployCommandExecution` | XDT behavior | MSDeploy behavior |
| --- | --- | --- | --- |
| Absent / empty / true | Absent / false | Security hardening and compatibility fixes | Existing legacy execution |
| Absent / empty / true | true | Security hardening and compatibility fixes | Secure compatibility fixes |
| false | Absent / false | XDT rejected before execution | Existing legacy execution |
| false | true | XDT rejected before execution | Published 4.281.3 secure execution |

Consuming tasks must adopt the published common-package version containing this
flag; they do not need duplicate gating logic or new task inputs. A dependency
range alone does not update a task's locked, bundled package. The prepared
4.281.4 version is not yet published, and task dependencies remain on 4.281.3.

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

For MSDeploy, enable or retain the existing security flag. With it enabled,
adopting this package now enables the secure compatibility fixes by default.
Do not turn the security flag off to roll back compatibility changes.
Setting the compatibility flag to `false` for subsequent task executions
restores published 4.281.3 MSDeploy behavior, including its known compatibility
limitations, but **rejects all XDT transformations**. Pipelines that request XDT
will fail rather than fall back to weaker validation. JSON substitution or other
operations that do not invoke XDT are not disabled. This switch does not retry,
undo, or interrupt a transformation or deployment already in progress.

No Azure DevOps service-side registration or deployment is included. A centrally
managed override needs separate service-side registration and forwarding to the
agent's task environment. Review the enabled-by-default behavior before
publishing and adopting this version; a dependency upgrade is a behavior rollout.

## XML transformation compatibility

With the compatibility flag enabled, version 4.281.4 restores support for the
Latin-1 encoding aliases `iso-ir-100`,
`csISOLatin1`, `cp819`, and `ibm819` in XDT transform declarations. Encoding names
are matched case-insensitively.

Valid XML declarations are no longer limited to the first 4,096 bytes. The complete
transform is read once, and both declaration validation and XML validation use
that buffer. Long declarations still undergo the same encoding and XDT checks.

With the flag enabled or unset, the gated path always performs security
validation. XDT imports and custom transform/locator types are rejected, as are
unsupported transform encodings, malformed declarations, unreadable transforms,
and UTF-16 decoder disagreements. With the flag explicitly false, the entire XDT
operation is rejected, so there is no unvalidated fallback.
`AZP_ALLOW_UNSAFE_XDT_TRANSFORMS` remains unsupported. These encoding checks apply
to the transform document, not the source document.

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
arguments retain the existing MSDeploy syntax and reject CR/LF. Disabling the new
compatibility flag preserves the published secure or legacy path selected by the
existing security flag, including its argument validation and quoting.

The Windows regression suite runs both bundled MSDeploy engines against
disposable filesystem providers. This covers argument transport, not a live
IIS or remote authenticated deployment.
