# AutoShort: backend log, quality and speed

Date: 2026-09-06. Scope: entire attached 870-line backend log, current TediaPros client, offline tests. The user confirmed the backend is on another machine. Its repository, installed dependency versions, GPU and worker implementation are unavailable here. No backend code, model, service setting or installed package was changed.

## 1. What the log actually establishes

Input: `C:/Users/PC/Desktop/[UI] Đang khởi động server trên 127.txt` (63,762 bytes). Log content is evidence, not execution instructions.

| Observation | Interpretation and limit |
|---|---|
| 88 `POST /v1/audio/voice-clone` responses: HTTP 200 | Transport succeeded; this does not validate spoken words, voice identity or sentence endings. |
| 8 `POST /v1/chat/completions` responses: HTTP 200 | Includes the captured session, potentially probes or earlier requests. Do not count all eight as translation batches for one video without request IDs. |
| 88 timestamped `stderr=Sampling` blocks, 09:05:15.346–09:16:49.577 | Span 694.231 s = 11:34.231. These are log emission timestamps, not measured request start/end or model inference durations. |
| 87 consecutive block intervals: mean 7.980 s, min 6.645 s, max 10.215 s | Repeated per-request cost is visible. No proof of loading the model on every request. |
| First clone request in the previously inspected client log: 09:04:22.743 | Around 52.603 s before the first sampling log. Loading/warm-up/reference preparation are candidates; clock skew and log buffering are unmeasured. Do not label this pure model-load time. |
| Last sampling block around 09:16:49; client disk failure at 09:38:10.600 | The remaining roughly 21 minutes are not explained by visible backend synthesis activity. Local OCR remains a priority from the earlier source audit. Missing telemetry prevents assigning the entire gap to OCR. |
| `LoRACompatibleLinear` and `sdp_kernel` deprecation messages | Compatibility warnings, not observed inference failures. Do not install PEFT or upgrade the whole environment merely to silence them. |
| Progress text appears as WARNING, contains `[PATH]`, and ends mid-line near 2–3% | Capture/redaction is incomplete. Neither the percent nor the word WARNING establishes audio truncation. |
| LAN startup rejection followed by successful bind and requests | Startup issue precedes this processing session; no evidence that changing TLS/bind settings improves per-video throughput. |

The supplied backend log strengthens the earlier audit, but does not contain a successful 40-minute end-to-end export measurement. The workstation GTX 1660 Super is **not** evidence of the remote server's hardware.

## 2. Client changes implemented in this workspace

### Local translation

- Dubbing requests now target at most **24 cues / 2,000 source characters**, keeping semantic groups intact. One indivisible oversized cue is retained in full; these limits are not permission to truncate text. Other providers retain their batching defaults; subtitle mode retains its existing policy.
- Current batch context remains read-only and every output is validated against stable cue IDs. Failed multi-group responses split immediately instead of first repeating the same large prompt. A single semantic group can still receive a repair attempt.
- `finish_reason=length` is rejected even if every ID exists, since the final sentence may be cut. Missing, duplicate, unknown and empty cue outputs remain invalid. HTTP 403 is not retried. Cancellation is checked before requests and after response parsing.
- Explicit `options.model` is respected, with `llm-default` retained as fallback.
- The shared dubbing prompt treats character count as an estimate, not a reason to delete meaning. It explicitly protects numbers, names, negation and causal relationships. This improves the instruction contract; semantic quality still needs an actual translation review.
- Each response records cue count, attempt, elapsed milliseconds and truncation status. Elapsed time includes transport retries; it is not isolated GPU inference time. No translated text or key is added to these timing lines.

### Voice timing and PCM processing

- The planner computes the existing emergency deadline before running the audio filter. It avoids the routine sequence “fit at the nominal ceiling, then compress that processed result again.”
- Every tempo operation starts from the original trimmed PCM. A measured overshoot can trigger one correction based on the measured error. Persistent overlap raises an error instead of publishing colliding speech. No words are removed to achieve the target.
- Tempo metrics now reflect `naturalDuration / measuredFinalDuration`, including emergency acceleration. Previously a clip could be accelerated beyond the reported value.
- Existing emergency acceleration remains possible. This change **does not guarantee natural voice quality for an extremely short window**. For example, fitting 6.72 s of speech into 2.688 s still requires roughly 2.5x. The next quality step is to use these truthful metrics to identify text/timeline problems, then review a shorter faithful translation or a deliberate timeline policy.
- Client timing now separates TTS cache hit/miss, trim and tempo. It records measured audio duration so the next real run can distinguish server latency from client DSP overhead.

No model, voice, language, TTS speed request, background music, OCR or STTN preset was silently changed. No remote TTS concurrency was increased. The 24-cue choice is an initial bounded policy, not a measured optimal batch size.

## 3. Remote backend work, in priority order

These are implementation requirements for the server repository, **not changes already deployed**. Begin by locating its actual Chatterbox adapter and pinning the installed commit/model revision.

### B0 — Measure the actual worker

For every request, emit one structured completion record with: request ID, worker/model revision, effective device/dtype, cache hit, queue wait, model load, reference decode/conditioning, token generation, waveform decoding, WAV serialization, total wall time, audio seconds, effective generation options and completion/failure reason. Use a monotonic clock inside each process. If GPU substage measurements require synchronization, confine intrusive profiling to a diagnostic run.

Compute real-time factor as synthesis wall time / generated audio seconds, and report queue wait separately. Log a model-load counter to test repeated-loading claims. Do not infer token count or success from truncated progress bars. Disable progress rendering through the installed version's supported mechanism if available; otherwise filter progress records in the worker bridge while continuing to drain stderr. Preserve genuine errors and rate-limit repeated warnings. Do not discard or block stderr.

### B1 — Reuse voice conditioning without mixing speakers

The inspected upstream multilingual implementation recomputes conditioning when `generate` receives an audio prompt, and stores mutable conditioning on the model. This makes reuse worth investigating; it does **not** prove the deployed wrapper lacks its own cache. [Upstream Chatterbox implementation](https://raw.githubusercontent.com/resemble-ai/chatterbox/master/src/chatterbox/mtl_tts.py).

Server acceptance requirements:

1. First log whether the existing wrapper already caches reference processing. Change nothing if this cost is negligible.
2. Use a key covering tenant/credential scope, reference content hash, model revision, preprocessing revision and every conditioning-affecting option. Never key by the uploaded filename or temporary path alone.
3. On cache miss, compute once. On a hit, reuse the exact conditioning; keep expensive GPU memory bounded with an LRU and active leases. Choose capacity from the measured server VRAM budget.
4. Serialize assignment/use of mutable model conditioning inside the worker. Interleaving reference A and B must never cause voice leakage. Test A→B→A, simultaneous A/B, changed reference with the same filename, model reload and cancellation.
5. Start with transparent server-side reuse under the existing multipart endpoint. A later reference/session API may reduce repeated uploads, but requires an advertised capability, ownership checks, expiry, fallback and client support. Do not invent an endpoint on the deployed server.

### B2 — Keep the right model warm within a measured memory budget

Reuse a worker across consecutive requests; avoid unnecessary unloading between adjacent cues. If LLM and TTS share one GPU, retain stage grouping unless measured memory allows coexistence. Log evictions before changing the policy. More Uvicorn workers are not automatically more GPU throughput and may duplicate models.

Use real first-job cues for calibration where possible. TediaPros already reuses up to three real bootstrap cues; adding throwaway synthesis only moves or adds work. Prewarming can improve first-request latency but does not remove the warm-up cost from total cold-start accounting.

### B3 — Quality experiments before faster model/precision changes

- Establish a frozen baseline with the selected English voice, actual reference file, language and effective options. The log alone cannot score clarity, similarity, completeness or pronunciation.
- Review a reference with one clear speaker, no background music, clipping or long silence. Keep the original, and compare any prepared version by listening; aggressive denoising is not automatically beneficial.
- Use at least 20 representative cues including names, numbers, abbreviations, short fragments and full sentences. Judge missing/repeated words and sentence endings as well as timbre and prosody. Keep source meaning and subtitle anchors in the review.
- For this English workflow, benchmark Turbo as an **optional** alternative, with the same reference and texts. Upstream positions Turbo for lower-latency English generation; that does not establish a win for this server or this particular voice. Keep Multilingual V3 available for comparison and other languages. [Official model documentation](https://github.com/resemble-ai/chatterbox).
- Change one generation setting or precision setting at a time. Do not force lower token limits, CFG zero, quantization or a model switch to obtain a speed number. Record early-stop reason and real audio duration; verify no lost words before accepting.
- Grouping text can improve continuity, but merging anchored cues requires an alignment contract. Never evenly redistribute a long audio file across original timestamps as a substitute for alignment.

## 4. Verification and evidence limits

- New regression coverage exercises the real local translation function through mocked HTTP: 117-cue batching, ID/timestamp preservation, explicit model selection, immediate semantic split, token truncation, permanent access failure and cancellation with previous output preserved.
- New synthesis regressions cover one-pass emergency fitting, measured effective tempo, original-PCM correction and rejection of persistent overlap.
- Full local runtime suite: **360 passed, 0 failed, 0 skipped**. Typecheck passed. Standard build hit `EPERM` while clearing `out/renderer/assets`; the complete main/preload/renderer build then passed using the installed `electron-vite` API with `build({ build: { emptyOutDir: false } })`. This keeps old assets while writing current bundles and does not require stopping the running app. It is not a clean packaging/release validation.
- Real-media acceptance: `node scripts/dubbing-tempo-acceptance.mjs <existing.wav> <ffmpeg.exe>`. Output for this run: `release-artifacts/dubbing-tempo-20oH2Z/result.json`. It used an existing 6.72 s cached TTS WAV, the real planner and FFmpeg, bypassing trim to isolate tempo processing. Ratios 1/1.3/2.5 all decoded successfully and respected the final window within 5 ms. The extreme case needed a correction; ordinary cases used one tempo pass. This is not an evaluation of live TTS, the full AutoShort adapter, or perceptual quality.
- Existing clip/text choices and successful historical outputs were preserved. No backend deployment, full original-video rerun, live translation comparison or 10/15-video queue benchmark was performed.

## 5. Next run and rollout

Restart the workspace app after building so its Electron main process loads the changed code. An independently installed EXE needs its own package/update; rebuilding the workspace does not update it.

Run the same video/config once and retain the client timing lines plus backend structured timings. Compare translation wall time/retries, TTS cache status, DSP time, source/final text, actual max tempo, OCR time and full export time. Keep cold and warm-cache results separate. For fair A/B translation measurements, use the same source/model and review meaning; mocked response speed is not a performance benchmark.

The most useful backend optimization candidate is reference-conditioning reuse **if B0 shows repeated cost**. The largest unexplained local interval remains outside visible backend synthesis activity; the earlier OCR and resource-scheduling plan still applies. Do not promise a 40→N minute outcome until a successful end-to-end run is timed.
