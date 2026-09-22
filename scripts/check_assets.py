#!/usr/bin/env python3
"""Verify bundled dependencies. Restore only mismatching files with --download."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'assets.lock.json').read_text())
    errors = []
    for asset in manifest['assets']:
        path = (ROOT / asset['path']).resolve()
        if ROOT not in path.parents:
            raise SystemExit('Invalid path in asset manifest.')
        valid = path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == asset['sha256']
        if not valid and args.download:
            try:
                print('Restoring', asset['path'])
                with urllib.request.urlopen(asset['url'], timeout=90) as response:
                    data = response.read()
                if hashlib.sha256(data).hexdigest() != asset['sha256']:
                    raise ValueError('Downloaded file does not match the pinned SHA-256.')
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(path.suffix + '.download')
                temporary.write_bytes(data)
                temporary.replace(path)
                valid = True
            except Exception as error:
                print('Could not restore:', error)
        print(('OK ' if valid else 'MISSING / CHANGED '), asset['path'])
        if not valid:
            errors.append(asset['path'])
    if errors:
        raise SystemExit('Asset check failed. Use --download to restore the pinned files.')
    print('All bundled assets verified.')


if __name__ == '__main__':
    main()
