import os
import wave
import numpy as np
from protocol import EngineError

try:
    import soundfile as sf
except ImportError:
    sf = None

def read_pcm_wav(path: str) -> np.ndarray:
    if not os.path.exists(path):
        raise EngineError("invalid_audio", f"File not found: {path}", False)

    if sf is not None:
        try:
            samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
            if sample_rate != 44100 or samples.shape[1] != 2 or samples.shape[0] == 0:
                raise EngineError("invalid_audio", "Expected stereo 44.1 kHz WAV.", False)
            if not np.isfinite(samples).all():
                raise EngineError("invalid_audio", "Input contains non-finite samples.", False)
            return samples
        except Exception as e:
            if isinstance(e, EngineError):
                raise e
            # Fall through to wave module

    try:
        with wave.open(path, "rb") as wf:
            sample_rate = wf.getframerate()
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()
            if sample_rate != 44100 or channels != 2 or n_frames == 0 or sampwidth != 2:
                raise EngineError("invalid_audio", "Expected stereo 44.1 kHz 16-bit WAV.", False)
            raw = wf.readframes(n_frames)
            samples = np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768.0
            if not np.isfinite(samples).all():
                raise EngineError("invalid_audio", "Input contains non-finite samples.", False)
            return samples
    except Exception as e:
        if isinstance(e, EngineError):
            raise e
        raise EngineError("invalid_audio", f"Failed to read WAV: {e}", False)

def write_pcm_wav(path: str, samples: np.ndarray) -> None:
    if samples.ndim != 2 or samples.shape[1] != 2 or not np.isfinite(samples).all():
        raise EngineError("non_finite_output", "Output samples are invalid.", False)

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

    if sf is not None:
        try:
            sf.write(path, samples, 44100, subtype="PCM_16", format="WAV")
            return
        except Exception:
            pass  # Fall through to wave

    clamped = np.clip(samples, -1.0, 1.0)
    int_samples = (clamped * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        wf.writeframes(int_samples.tobytes())
