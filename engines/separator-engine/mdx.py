import numpy as np
from protocol import EngineError

def provider_chain(requested: str, available: list[str]) -> list[str]:
    if requested == "auto":
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider"]
        return ["CPUExecutionProvider"]
    elif requested == "directml":
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider"]
        raise EngineError("provider_unavailable", "DirectML provider is not available.", False)
    elif requested == "cpu":
        return ["CPUExecutionProvider"]
    else:
        raise EngineError("invalid_provider", f"Unsupported provider: {requested}", False)

def overlap_starts(total: int, segment: int, overlap: float) -> list[int]:
    if total <= segment:
        return [0]
    step = int(segment * (1.0 - overlap))
    if step <= 0:
        step = 1
    starts = list(range(0, total - segment + 1, step))
    if starts[-1] + segment < total:
        starts.append(total - segment)
    return starts

def complementary_stem(mixture: np.ndarray, primary: np.ndarray) -> np.ndarray:
    if not np.isfinite(mixture).all() or not np.isfinite(primary).all():
        raise EngineError("non_finite_output", "Input to complementary stem contains non-finite samples.", False)
    secondary = mixture - primary
    if not np.isfinite(secondary).all():
        raise EngineError("non_finite_output", "Complementary stem is invalid.", False)
    return secondary

def stft_window_hann(length: int) -> np.ndarray:
    return np.hanning(length).astype(np.float32)

def create_session(model_path: str, provider: str):
    import onnxruntime as ort
    available = ort.get_available_providers()
    providers = provider_chain(provider, available)
    options = ort.SessionOptions()
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.enable_mem_pattern = False
    session = ort.InferenceSession(model_path, sess_options=options, providers=providers)
    active_provider = session.get_providers()[0]
    canonical_provider = "directml" if "dml" in active_provider.lower() else "cpu"
    return session, canonical_provider

def run_mdx_inference(
    session,
    audio: np.ndarray,
    mdx_meta: dict,
    overlap: float,
    on_progress=None
) -> np.ndarray:
    """
    Minimal MDX inference using pure NumPy STFT and ONNX Runtime.
    audio: float32 array of shape (N, 2)
    mdx_meta: dict with nFft, hopLength, dimF, dimT, segmentSamples
    """
    n_fft = int(mdx_meta.get("nFft", 6144))
    hop_length = int(mdx_meta.get("hopLength", 1024))
    dim_f = int(mdx_meta.get("dimF", 3072))
    dim_t = int(mdx_meta.get("dimT", 256))
    segment_samples = int(mdx_meta.get("segmentSamples", dim_t * hop_length))

    total_samples = len(audio)
    starts = overlap_starts(total_samples, segment_samples, overlap)
    output_audio = np.zeros_like(audio, dtype=np.float32)
    weight_accum = np.zeros((total_samples, 1), dtype=np.float32)

    window = np.hanning(segment_samples).astype(np.float32)[:, None]
    input_name = session.get_inputs()[0].name

    for idx, start in enumerate(starts):
        end = min(start + segment_samples, total_samples)
        chunk = np.zeros((segment_samples, 2), dtype=np.float32)
        actual_len = end - start
        chunk[:actual_len] = audio[start:end]

        # STFT on channels
        # chunk shape: (segment_samples, 2) -> transpose to (2, segment_samples)
        # We prepare the model input tensor
        # MDX models typically expect (1, 2, dim_f, dim_t) or similar
        input_shape = session.get_inputs()[0].shape
        # Check model input dimension
        if len(input_shape) == 4:
            # Frequency domain model: (batch=1, channels=2, freq, time)
            # Compute STFT
            spec_complex = []
            for ch in range(2):
                frames = []
                for t_idx in range(0, segment_samples - n_fft + 1, hop_length):
                    frame = chunk[t_idx : t_idx + n_fft, ch] * np.hanning(n_fft)
                    fft_res = np.fft.rfft(frame, n=n_fft)
                    frames.append(fft_res[:dim_f])
                spec_complex.append(np.stack(frames, axis=-1)) # (dim_f, dim_t)
            spec_arr = np.stack(spec_complex, axis=0)[None, ...] # (1, 2, dim_f, dim_t)
            spec_real = np.abs(spec_arr).astype(np.float32)

            res = session.run(None, {input_name: spec_real})[0]
            # Invert back to audio
            # res shape (1, 2, dim_f, dim_t)
            chunk_out = np.zeros((segment_samples, 2), dtype=np.float32)
            # Reconstruct with original phase
            for ch in range(2):
                mag = res[0, ch]
                phase = np.angle(spec_complex[ch])
                recon_spec = mag * np.exp(1j * phase)
                rec_audio = np.zeros(segment_samples, dtype=np.float32)
                rec_weights = np.zeros(segment_samples, dtype=np.float32)
                fft_pad = np.zeros(n_fft // 2 + 1, dtype=np.complex64)
                for t_idx, f_idx in enumerate(range(0, segment_samples - n_fft + 1, hop_length)):
                    fft_pad[:dim_f] = recon_spec[:, t_idx]
                    time_frame = np.fft.irfft(fft_pad, n=n_fft) * np.hanning(n_fft)
                    rec_audio[f_idx : f_idx + n_fft] += time_frame
                    rec_weights[f_idx : f_idx + n_fft] += np.hanning(n_fft) ** 2
                valid_mask = rec_weights > 1e-6
                rec_audio[valid_mask] /= rec_weights[valid_mask]
                chunk_out[:, ch] = rec_audio
        else:
            # Time-domain model: (1, 2, segment_samples)
            inp = chunk.T[None, :, :].astype(np.float32)
            res = session.run(None, {input_name: inp})[0]
            chunk_out = res[0].T

        output_audio[start:end] += (chunk_out[:actual_len] * window[:actual_len])
        weight_accum[start:end] += window[:actual_len]

        if on_progress:
            percent = int(((idx + 1) / len(starts)) * 100)
            on_progress(percent)

    valid = weight_accum > 1e-6
    output_audio[valid[:, 0]] /= weight_accum[valid[:, 0]]
    if not np.isfinite(output_audio).all():
        raise EngineError("non_finite_output", "MDX inference generated non-finite samples.", False)

    return output_audio
