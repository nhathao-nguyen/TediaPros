# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import os
import sys
from PyInstaller.utils.hooks import collect_all

SPEC_DIR = Path(SPECPATH).resolve()
sys.path.insert(0, str(SPEC_DIR))
from ocr_models import resolve_ocr_models
# The build must fail if preparation was skipped or model bytes drifted.
model_paths = resolve_ocr_models(os.environ.get('TEDIAPROS_OCR_MODELS_DIR'))
datas = []
binaries = []
hiddenimports = ['visual_timeline', 'ocr_models']
for _m in ('rapidocr_onnxruntime', 'onnxruntime', 'cv2'):
    tmp_ret = collect_all(_m)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# Only the qualified v3/v2 models are used. Do not bundle RapidOCR 1.4.4's
# unused v4 weights and accidentally change model selection in a later build.
datas = [(source, target) for source, target in datas if not str(source).lower().endswith('.onnx')]
datas += [(path, 'models') for path in model_paths.values()]
license_path = Path(next(iter(model_paths.values()))).parent / 'MODEL-LICENSE.txt'
if not license_path.is_file():
    raise RuntimeError('Prepared OCR model license is missing')
datas.append((str(license_path), 'models'))


a = Analysis(
    [str(SPEC_DIR / 'engine.py')],
    pathex=[str(SPEC_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
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
    name='ocr-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
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
    upx=False,
    upx_exclude=[],
    name='ocr-engine',
)
