#!/usr/bin/env python3
"""Stamp a content hash onto CSS and JS links in the HTML pages.

GitHub Pages serves assets with `cache-control: max-age=600`, so for ten
minutes after a deploy a browser can pair freshly-changed HTML with a stale
stylesheet — which is how a new sponsor logo ended up rendering at full size
in a 70px slot. A hash in the query string gives each version its own URL, so
changed assets are always fetched and unchanged ones stay cached.

Run before committing whenever a file in assets/css or assets/js changed:

    python3 scripts/version-assets.py
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSET_PATTERN = re.compile(r'(?P<attr>href|src)="(?P<path>assets/(?:css|js)/[\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')

def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:8]

hashes, changed = {}, []
for page in sorted(ROOT.glob('*.html')):
    text = page.read_text()

    def stamp(match):
        path = match.group('path')
        if path not in hashes:
            file = ROOT / path
            if not file.exists():
                sys.exit(f'✖ {page.name} references {path}, which does not exist')
            hashes[path] = digest(path)
        return f'{match.group("attr")}="{path}?v={hashes[path]}"'

    stamped = ASSET_PATTERN.sub(stamp, text)
    if stamped != text:
        page.write_text(stamped)
        changed.append(page.name)

for path, h in sorted(hashes.items()):
    print(f'{path}?v={h}')
print(f'\n{len(changed)} page(s) restamped' + (f': {", ".join(changed)}' if changed else ''))
