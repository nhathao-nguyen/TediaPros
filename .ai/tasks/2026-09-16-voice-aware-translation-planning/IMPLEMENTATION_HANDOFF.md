# Implementation handoff — VOICE-TEXT-PLAN-20260916

- Ngày: 2026-09-16
- Trạng thái: bounded vertical slice đã triển khai và kiểm chứng offline/local.
- Phạm vi không bao gồm Gateway repo bên ngoài, provider thật, A/B/held-out calibration hoặc packaged/installed acceptance.

## Đã triển khai

1. Source-repair không còn đếm một chữ số hai lần khi vừa là protected token vừa bị lấy lại từ lexical number branch; repeated occurrences vẫn độc lập.
2. Parser `cue-lines-v1` yêu cầu exact cue IDs, reject duplicate/missing/unknown/context/prose/fence/control output và phân biệt truncated response.
3. Gemini Gateway hỗ trợ `outputMode: 'cue-lines-v1'` ở chế độ opt-in: bỏ `response_format` chỉ ở mode này, yêu cầu server echo `gateway_metadata.text_output_contract`, parse strict rồi canonicalize về `{items}` nội bộ. JSON legacy vẫn là mặc định.
4. Voice measurement service dùng profile key hiện hữu và schema versioned, lưu atomic/bounded/dedup; chỉ lưu text hash/features, không lưu raw text/audio/path trong profile. Metric được gắn nhãn `estimated-spoken-units-per-second`, là proxy advisory, không phải acoustic syllables/calibration.
5. Voice tab (Edge-TTS/local/clone) và AutoShort ghi sample theo provenance phù hợp; AutoShort tạo voice hint bounded cho Gemini Gateway khi profile đủ dữ liệu và locale khớp. Speed khác 1x không vào baseline.
6. Typed IPC `tts:getVoiceProfile` trả summary UI-safe (`cold`/`advisory`/`qualified`, sample counts, P10/median/P90, uncertainty reasons). Voice tab hiển thị summary và giữ unavailable/cold path.

## Bằng chứng local

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs voice-measurements.test gemini-gateway-prompts.test gemini-gateway-text-output.test translation-labeled-response.test gemini-gateway-contract.test gemini-gateway-draft-resume.test gemini-gateway-long-context.test autoshort-content-quality.test content-quality-numerals.test dubbing-duration-profile.test
cmd.exe /c "npm.cmd run test:local-runtime > NUL 2>&1"
git diff --check -- src/main/dubbing/voiceMeasurements.ts src/main/tts.ts src/main/index.ts src/preload/index.ts src/shared/types.ts src/renderer/src/components/Voice.tsx tests/voice-measurements.test.ts
```

Kết quả: typecheck node/web PASS; 10 suite mục tiêu PASS (voice 3, prompt 6, text output 2, labeled parser 5, Gateway contract 17, draft/resume 4, long-context 2, content quality 35, numerals 22, duration profile 8); full `test:local-runtime` PASS, exit code 0. Một số test platform/FFmpeg có điều kiện được skip khi `TEDIAPROS_TEST_FFMPEG` chưa set. Đây là fixture/mocked/local evidence, không phải live claim.

## Ranh giới còn mở

- Cần server Gateway thật hỗ trợ capability/text pass-through và route/metadata contract trước khi bật mode mới trong production.
- Chưa có A/B paired corpus/audio để kết luận prompt/hints cải thiện chất lượng; giữ hai lượt draft + independent review.
- Voice rate hiện là spoken-unit proxy; chưa held-out calibration, không dùng để gọi “tốc độ âm học/số âm tiết trên giây”.
- Chưa chạy full `npm.cmd run test:local-runtime`, audio/video render, build/package/install hoặc UI manual acceptance.
- Các dirty/untracked changes ngoài phạm vi vẫn được giữ nguyên.

## Rollback an toàn

- Không chọn `outputMode: 'cue-lines-v1'` thì Gateway tiếp tục JSON legacy.
- Không có profile/hint thì prompt giữ cold path và AutoShort vẫn chạy theo predictor/measured-first hiện tại.
- Xóa/tắt namespace voice-measurements chỉ ảnh hưởng advisory data; không xóa accepted audio, source, checkpoint hoặc cache hiện hữu.
