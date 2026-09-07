"""Package an explicitly built optional Windows runtime; never publishes assets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from engine import VERSION


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    root, output = Path(args.input_dir).resolve(), Path(args.output_dir).resolve()
    if not (root/'sttn-engine.exe').is_file():
        raise ValueError('Input must contain built sttn-engine.exe')
    if output.exists() or output.is_relative_to(root):
        raise ValueError('Output must be a new directory outside runtime input')
    files = sorted(p for p in root.rglob('*') if p.is_file())
    if any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('Runtime may not contain symbolic links')
    output.mkdir(parents=True)
    archive = output/'tediapros-sttn-engine-win32-x64.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as bundle:
        for path in files:
            bundle.write(path, path.relative_to(root).as_posix())
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest = {'schemaVersion': 1, 'runtimeVersion': 'sttn-local-'+VERSION, 'platform': 'win32', 'arch': 'x64',
                'assets': {'sttn-engine': {'version': VERSION, 'platform': 'win32', 'arch': 'x64',
                  'asset': archive.name, 'sha256': digest, 'bytes': archive.stat().st_size,
                  'entrypoint': 'sttn-engine.exe', 'protocol': 'sttn-engine/1',
                  'capabilities': ['cpu', 'cuda', 'timed-mask', 'ffv1', 'preview'],
                  'files': [p.relative_to(root).as_posix() for p in files]}},
                'provenance': {'generatedBy': 'engines/sttn-engine/package_runtime.py',
                               'publication': 'local-only', 'unpackedBytes': sum(p.stat().st_size for p in files)}}
    (output/'runtime-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'outputDir': str(output), 'bytes': archive.stat().st_size, 'sha256': digest,
                      'unpackedBytes': manifest['provenance']['unpackedBytes']}), flush=True)


if __name__ == '__main__':
    main()
