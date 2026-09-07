# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

SPEC_DIR = Path(SPECPATH).resolve()
a = Analysis(
    [str(SPEC_DIR / 'engine.py')], pathex=[str(SPEC_DIR)],
    binaries=[], datas=[(str(SPEC_DIR / 'LICENSE-STTN'), 'licenses')],
    hiddenimports=['video', 'masking', 'inference', 'network'],
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=['torchvision', 'torchaudio', 'matplotlib', 'pandas', 'IPython', 'pytest', 'tensorboard'],
    noarchive=False, optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='sttn-engine',
          debug=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='sttn-engine')
