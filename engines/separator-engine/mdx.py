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
    MDX inference using pure NumPy STFT and ONNX Runtime.
    audio: float32 array of shape (N, 2)
    mdx_meta: dict with nFft, hopLength, dimF, dimT, segmentSamples
    """
    n_fft = int(mdx_meta.get("nFft", 6144))
    hop_length = int(mdx_meta.get("hopLength", 1024))
    dim_f = int(mdx_meta.get("dimF", 3072))
    dim_t = int(mdx_meta.get("dimT", 256))

    input_name = session.get_inputs()[0].name
    input_shape = session.get_inputs()[0].shape

    chunk_size = hop_length * (dim_t - 1)
    trim = n_fft // 2
    gen_size = chunk_size - 2 * trim

    total_samples = len(audio)
    mix = audio.T.astype(np.float32)

    pad = gen_size + trim - (mix.shape[-1] % gen_size)
    padded_mix = np.pad(mix, ((0, 0), (trim, pad)), mode='constant')

    step = int((1.0 - overlap) * chunk_size)
    if step <= 0:
        step = 1

    result = np.zeros_like(padded_mix, dtype=np.float32)
    divider = np.zeros_like(padded_mix, dtype=np.float32)
    hann_window = 0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(n_fft) / n_fft)).astype(np.float32)
    pad_center = n_fft // 2

    total_chunks = (padded_mix.shape[-1] + step - 1) // step
    chunk_idx = 0

    for i in range(0, padded_mix.shape[-1], step):
        chunk_idx += 1
        start = i
        end = min(i + chunk_size, padded_mix.shape[-1])
        actual_len = end - start

        chunk = np.zeros((2, chunk_size), dtype=np.float32)
        chunk[:, :actual_len] = padded_mix[:, start:end]

        stft_padded = np.pad(chunk, ((0, 0), (pad_center, pad_center)), mode='reflect')
        frames_real, frames_imag = [], []
        for ch in range(2):
            ch_real, ch_imag = [], []
            for t in range(dim_t):
                st = t * hop_length
                segment = stft_padded[ch, st:st + n_fft] * hann_window
                fft_res = np.fft.rfft(segment, n=n_fft)[:dim_f]
                ch_real.append(fft_res.real.astype(np.float32))
                ch_imag.append(fft_res.imag.astype(np.float32))
            frames_real.append(np.stack(ch_real, axis=-1))
            frames_imag.append(np.stack(ch_imag, axis=-1))

        spec = np.stack([frames_real[0], frames_imag[0], frames_real[1], frames_imag[1]], axis=0)[None, ...]
        spec[:, :, :3, :] = 0.0
        pred = session.run(None, {input_name: spec})[0]

        num_bins = n_fft // 2 + 1
        pred_padded = np.pad(pred[0], ((0, 0), (0, num_bins - dim_f), (0, 0)))
        l_spec = pred_padded[0] + 1j * pred_padded[1]
        r_spec = pred_padded[2] + 1j * pred_padded[3]

        full_len = chunk_size + 2 * pad_center
        time_buf = np.zeros((2, full_len), dtype=np.float32)
        time_weights = np.zeros(full_len, dtype=np.float32)
        for t in range(dim_t):
            st = t * hop_length
            time_buf[0, st:st + n_fft] += np.fft.irfft(l_spec[:, t], n=n_fft) * hann_window
            time_buf[1, st:st + n_fft] += np.fft.irfft(r_spec[:, t], n=n_fft) * hann_window
            time_weights[st:st + n_fft] += hann_window ** 2

        valid_mask = time_weights > 1e-6
        time_buf[:, valid_mask] /= time_weights[valid_mask]
        chunk_out = time_buf[:, pad_center:pad_center + chunk_size]

        chunk_window = np.hanning(actual_len).astype(np.float32) if overlap > 0 else np.ones(actual_len, dtype=np.float32)
        result[:, start:end] += chunk_out[:, :actual_len] * chunk_window[None, :]
        divider[:, start:end] += chunk_window[None, :]

        if on_progress:
            percent = int((chunk_idx / total_chunks) * 100)
            on_progress(min(percent, 100))

    valid_div = divider > 1e-6
    result[valid_div] /= divider[valid_div]
    output_mix = result[:, trim:trim + total_samples]
    output_audio = output_mix.T.astype(np.float32)

    if not np.isfinite(output_audio).all():
        raise EngineError("non_finite_output", "MDX inference generated non-finite samples.", False)

    return output_audio
