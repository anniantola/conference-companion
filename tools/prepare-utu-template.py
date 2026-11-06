#!/usr/bin/env python3
"""Extract the reusable University of Turku master/layout/theme package.

Reads the source template directly from Downloads and excludes sample slides,
notes, and unrelated presentation content. The output ZIP is stored (uncompressed)
so the browser's small ZIP reader can safely consume it offline.
"""
from pathlib import Path
from urllib.parse import unquote
import posixpath
import re
import sys
import json
import xml.etree.ElementTree as ET
import zipfile

SOURCE = Path('/home/asanto/Downloads/utu-powerpoint-pohja-en(1).pptx')
OUTPUT = Path('assets/utu-template.zip')
REL_NS = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'


def rels_name(part):
    parent, name = posixpath.split(part)
    return posixpath.join(parent, '_rels', name + '.rels')


def resolve(source_part, target):
    if target.startswith('/'):
        return target.lstrip('/')
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), unquote(target)))


def main():
    if not SOURCE.is_file():
        raise SystemExit(f'Missing original template: {SOURCE}')
    with zipfile.ZipFile(SOURCE) as source:
        names = set(source.namelist())
        kept = {'[Content_Types].xml', 'ppt/slideMasters/slideMaster1.xml',
                'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/theme/theme1.xml'}
        presentation_xml = source.read('ppt/presentation.xml').decode('utf-8')
        embedded_match = re.search(r'<p:embeddedFontLst\b.*?</p:embeddedFontLst>', presentation_xml)
        if not embedded_match:
            raise SystemExit('The source template has no embedded font list')
        presentation_rels = ET.fromstring(source.read('ppt/_rels/presentation.xml.rels'))
        font_rels = {rel.attrib['Id']: rel.attrib['Target'] for rel in presentation_rels.findall('r:Relationship', REL_NS)
                     if rel.attrib.get('Type', '').endswith('/font')}
        if not font_rels:
            raise SystemExit('The source template has no embedded font relationships')
        for target in font_rels.values():
            kept.add(resolve('ppt/presentation.xml', target))
        kept.update(n for n in names if re.fullmatch(r'ppt/slideLayouts/slideLayout\d+\.xml', n))
        kept.update(n for n in names if re.fullmatch(r'ppt/slideLayouts/_rels/slideLayout\d+\.xml\.rels', n))

        # Keep only the local parts actually referenced by the master and layouts.
        pending = [n for n in kept if n.endswith('.xml') and '/_rels/' not in n and n != '[Content_Types].xml']
        while pending:
            part = pending.pop()
            rel_part = rels_name(part)
            if rel_part not in names:
                continue
            kept.add(rel_part)
            root = ET.fromstring(source.read(rel_part))
            for rel in root.findall('r:Relationship', REL_NS):
                if rel.attrib.get('TargetMode') == 'External':
                    continue
                target = resolve(part, rel.attrib['Target'])
                if target in names and target not in kept:
                    kept.add(target)
                    if target.endswith('.xml') and '/slide' not in target:
                        pending.append(target)

        # The package content types are reduced to retained parts and image/font defaults.
        types = ET.fromstring(source.read('[Content_Types].xml'))
        for child in list(types):
            if child.tag == f'{{{CT_NS}}}Override':
                if child.attrib['PartName'].lstrip('/') not in kept:
                    types.remove(child)
        ET.register_namespace('', CT_NS)
        content_types = ET.tostring(types, encoding='utf-8', xml_declaration=True)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(OUTPUT, 'w', compression=zipfile.ZIP_STORED) as out:
            for name in sorted(kept):
                data = content_types if name == '[Content_Types].xml' else source.read(name)
                out.writestr(name, data, compress_type=zipfile.ZIP_STORED)
            out.writestr('template/embeddedFontLst.xml', embedded_match.group(0), compress_type=zipfile.ZIP_STORED)
            out.writestr('template/fontRels.json', json.dumps(font_rels, separators=(',', ':')), compress_type=zipfile.ZIP_STORED)
    print(f'Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes, {len(kept)} parts)')


if __name__ == '__main__':
    main()
