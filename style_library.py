"""Read-only style catalogs from the Anima Style Explorer and Stylebook custom nodes installed next to this one."""
import importlib
import importlib.util
import json
from pathlib import Path
import re
import sys

from PIL import Image

custom_nodes = Path(__file__).resolve().parent.parent
anima_root = custom_nodes / 'comfyui-anima-style-nodes'
stylebook_root = custom_nodes / 'comfyui-stylebook'
preview_roots = {'animadex': anima_root / 'js' / 'images' / 'animadex', 'stylebook': stylebook_root / 'js' / 'previews'}
animadex_kinds = {'artist', 'character'}
preview_types = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}
_animadex = {'mtime': None, 'items': []}
_stylebook = {}


def _file_stem(value):
    # Same naming as the Anima Style Explorer image cache.
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', str(value or '').strip()).strip('._') or 'preview'


def _animadex_items():
    path = anima_root / 'data' / 'animadex_index.json'
    if not path.exists():
        raise FileNotFoundError(2, 'Install the Anima Style Explorer custom node and download the Animadex index', str(path))
    mtime = path.stat().st_mtime
    if _animadex['mtime'] != mtime:
        items = []
        for item in json.loads(path.read_text(encoding='utf-8')):
            kind = str(item.get('source_kind') or '').lower()
            if kind not in animadex_kinds or not item.get('tag'):
                continue
            thumb = str(item.get('thumb_url') or item.get('img_url') or '')
            suffix = Path(thumb.split('?')[0]).suffix.lower()
            cached = Path(kind) / f"{_file_stem(item.get('id') or item.get('slug') or item.get('tag'))}{suffix if suffix in preview_types else '.webp'}"
            items.append({'kind': kind, 'tag': item['tag'], 'name': item.get('name') or item['tag'], 'works': item.get('works') or 0,
                          'copyright': item.get('copyright_name') or '', 'tags': item.get('tags') or [], 'thumb': thumb, 'cached': cached.as_posix(),
                          'search': f"{item['tag']} {item.get('name') or ''} {item.get('copyright') or ''}".lower()})
        _animadex.update(mtime=mtime, items=items)
    return _animadex['items']


def animadex(kind, query='', offset=0, limit=60):
    if kind not in animadex_kinds:
        raise ValueError(f'Unknown Animadex list: {kind}')
    terms = query.lower().split()
    matches = [item for item in _animadex_items() if item['kind'] == kind and all(term in item['search'] for term in terms)]
    page = []
    for item in matches[offset:offset + limit]:
        local = (preview_roots['animadex'] / item['cached']).exists()
        page.append({key: item[key] for key in ('tag', 'name', 'works', 'copyright', 'tags')} | {'thumb': item['thumb'], 'local': item['cached'] if local else ''})
    return {'items': page, 'total': len(matches)}


def stylebook():
    if not stylebook_root.exists():
        raise FileNotFoundError(2, 'Install the Stylebook custom node', str(stylebook_root))
    if not _stylebook:
        # Stylebook's data package also merges user_styles.json; load it under a private name so it does not touch the node's own modules.
        name = 'manga_maker_stylebook_data'
        spec = importlib.util.spec_from_file_location(name, stylebook_root / 'data' / '__init__.py', submodule_search_locations=[str(stylebook_root / 'data')])
        sys.modules[name] = importlib.util.module_from_spec(spec); spec.loader.exec_module(sys.modules[name])
        styles = importlib.import_module(f'{name}.styles').STYLES
        index = json.loads((preview_roots['stylebook'] / 'index.json').read_text(encoding='utf-8'))['categories']
        atlases = {}
        for category, entry in index.items():
            if (preview_roots['stylebook'] / entry['atlas']).exists():
                with Image.open(preview_roots['stylebook'] / entry['atlas']) as image:
                    atlases[category] = {'atlas': entry['atlas'], 'size': image.size, 'tiles': entry['tiles']}
        categories = {}
        for style in sorted(styles.values(), key=lambda style: style['label'].lower()):
            atlas = atlases.get(style['category'], {})
            tile = atlas.get('tiles', {}).get(style['id'])
            categories.setdefault(style['category'], []).append({key: style.get(key, '') for key in ('id', 'label', 'tags', 'prose', 'negative')}
                                                                 | {'aliases': style.get('aliases', []), 'preview': {'atlas': atlas['atlas'], 'size': atlas['size'], **tile} if tile else None})
        _stylebook['categories'] = categories
    return _stylebook
