# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

SPEC_DIR = Path(SPECPATH).resolve().parent
MODEL_DIR = SPEC_DIR / 'dia-models'
datas = [(str(MODEL_DIR), 'dia-models')] if MODEL_DIR.exists() else []
binaries = []
hiddenimports = []

for _m in ('tokenizers', 'huggingface_hub', 'faster_whisper', 'ctranslate2', 'av', 'onnxruntime', 'sherpa_onnx'):
    _r = collect_all(_m)
    datas += _r[0]; binaries += _r[1]; hiddenimports += _r[2]

a = Analysis(
    [str(SPEC_DIR / 'engine.py')],
    pathex=[str(SPEC_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(SPEC_DIR / 'rthook_whisper.py')],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='whisper-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='whisper-engine',
)
