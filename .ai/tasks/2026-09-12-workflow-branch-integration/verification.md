# Verification record — 2026-09-12

This is an observation record, not a raw terminal transcript.

- `npm.cmd run typecheck`: exit 0; node and web both completed successfully on the current working tree, package 0.1.26.
- Six targeted suites: exit 0; 74 tests passed, 0 failed. Raw output: `baseline-tests.log`.
- `git merge-tree --write-tree --name-only HEAD 1d61ef7`: exit 1, five expected content conflicts. Simulation only; raw output: `merge-tree.txt`.
- Remote `refs/heads/fix/workflow-capcut-youtube` observed at `1d61ef744384208382de3903b73b2953d45553ab` with both fetch and ls-remote.
- HEAD remains `cd7d86552fb40ce10656346e52cdea914a39bac0`, branch main; old merge `645a9ea` ancestry check exit 0.
- The 27 pre-existing dirty tracked files match their captured SHA-256 values. See `dirty-tracked-sha256.txt` and `final-state.json`.
- Source catalog counts: 35 voices, 14 language codes, 17 locales.
- No source edits, package installation, live synthesis, build, merge, commit or push performed by this task.
