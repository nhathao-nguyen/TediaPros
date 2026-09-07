"""Optional local STTN worker. Version command intentionally imports no ML libs."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

PROTOCOL = 'sttn-engine/1'
VERSION = '1.1.1'


def emit(event):
    event['protocol'] = PROTOCOL
    print(json.dumps(event, ensure_ascii=True, allow_nan=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', action='store_true')
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--model')
    parser.add_argument('--provider', choices=['auto', 'cuda', 'cpu'], default='auto')
    parser.add_argument('--request')
    args = parser.parse_args()
    if args.version:
        emit({'type': 'version', 'engine': 'sttn', 'version': VERSION,
              'features': ['cpu', 'cuda', 'timed-mask', 'ffv1', 'preview']})
        return 0
    try:
        if args.probe:
            if not args.model or not Path(args.model).is_file():
                emit({'type': 'error', 'code': 'model_missing', 'message': 'Chua co model STTN.'})
                return 1
            from inference import SttnModel
            model = SttnModel(args.model, args.provider)
            model.probe()
            emit({'type': 'probe', 'ready': True, 'provider': model.provider,
                  'engine': 'sttn', 'version': VERSION})
            return 0
        if not args.run or not args.request:
            raise ValueError('Expected --run --request or --probe')
        request_path = Path(args.request)
        if request_path.stat().st_size > 64*1024:
            raise ValueError('Request too large')
        request = json.loads(request_path.read_text(encoding='utf-8-sig'))
        output = Path(request['outputPath']).resolve()
        source = Path(request['inputPath']).resolve()
        if source == output or output.exists() or not source.is_file():
            raise ValueError('Output must be new and different from input')
        for key in ['timelinePath', 'modelPath', 'ffmpegPath', 'ffprobePath']:
            if not Path(request[key]).is_file():
                raise ValueError('Missing file: ' + key)
        if request.get('provider', 'auto') not in ['auto', 'cuda', 'cpu']:
            raise ValueError('Invalid provider')
        max_frames = request.get('maxFrames', 12)
        if not isinstance(max_frames, int) or not 5 <= max_frames <= 24:
            raise ValueError('Invalid maxFrames')
        preview = request.get('previewSeconds')
        if preview is not None and (not isinstance(preview, (int, float)) or not 0 < preview <= 10):
            raise ValueError('Invalid preview duration')
        from video import remove_subtitles
        started = time.perf_counter()
        result = remove_subtitles(request, emit)
        emit({'type': 'done', 'outputPath': str(output), 'elapsedMs': round((time.perf_counter()-started)*1000), **result})
        return 0
    except (ValueError, KeyError, FileNotFoundError) as error:
        emit({'type': 'error', 'code': 'invalid_request', 'message': str(error)})
    except Exception as error:
        message = str(error)
        code = 'out_of_memory' if 'out of memory' in message.lower() else 'inference_failed'
        emit({'type': 'error', 'code': code, 'message': message[-2000:]})
    return 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    os.environ.setdefault('OMP_NUM_THREADS', '4')
    raise SystemExit(main())
