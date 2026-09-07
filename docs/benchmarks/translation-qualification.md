# Translation qualification harness

The repository now includes a dependency-free, offline qualification harness:

```powershell
npm.cmd run translation:qualification -- --mode offline --manifest "F:\path\cases.json" --output "F:\path\report" --variant candidate --runs 3
```

Without `--output`, or with `--dry-run`, the harness prints only the bounded
plan and opaque input digests. It never sends source text, references, API keys,
or filenames to a provider. The default mode is `offline`; live qualification
fails closed until an explicitly approved adapter, workload and cost preflight
are supplied with `--mode live`.

Each report record follows schema v1 and records the case identity, variant,
prompt revision, request/recovery counters, lost or unexpected cue counts, and
the pending human semantic review state. Offline records are contract evidence
only: they exercise manifest validation and resource accounting, not translation
naturalness, TTS quality, rendered media, or universal language support.

The checked-in fixture covers cross-script negation, numeric representation,
Arabic digits/RTL, and a malformed continuation. Expected labels are review
labels, not semantic gold. A target-language speaker must review any live pilot
reference before it can be used for an acceptance decision.

The initial live pilot, when separately authorized, should compare baseline and
candidate on the same clips and model profile. Report sample count, p95 latency,
recovery calls, severe omissions, numbers/names/negation fidelity, naturalness,
TTS and final video artifacts independently. Do not infer a speedup or all-
language guarantee from the offline suite or a passing mock.
