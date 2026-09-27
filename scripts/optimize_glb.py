"""Shrink embedded GLB textures for the web: images larger than MAX are resized and stored as JPEG.

Usage: python scripts/optimize_glb.py <source.glb> <output.glb>
Only opaque (RGB) images are converted; the source file is never modified.
"""
import io
import json
import struct
import sys

from PIL import Image

MAX = 2048
QUALITY = 90


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF' and version == 2, 'not a glTF 2 binary'
    json_len = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len
    bin_len = struct.unpack('<I', data[bin_start:bin_start + 4])[0]
    blob = data[bin_start + 8:bin_start + 8 + bin_len]
    return doc, blob


def write_glb(path, doc, blob):
    body = json.dumps(doc, separators=(',', ':')).encode('utf8')
    body += b' ' * (-len(body) % 4)
    blob += b'\0' * (-len(blob) % 4)
    total = 12 + 8 + len(body) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(body), b'JSON') + body)
        f.write(struct.pack('<I4s', len(blob), b'BIN\0') + blob)


def main(src, dst):
    doc, blob = read_glb(src)
    views = [blob[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in doc['bufferViews']]
    for image in doc.get('images', []):
        index = image['bufferView']
        picture = Image.open(io.BytesIO(views[index]))
        if 'A' in picture.getbands() or max(picture.size) <= MAX:
            continue
        scale = MAX / max(picture.size)
        picture = picture.convert('RGB').resize((round(picture.width * scale), round(picture.height * scale)), Image.LANCZOS)
        out = io.BytesIO()
        picture.save(out, 'JPEG', quality=QUALITY, optimize=True)
        views[index] = out.getvalue()
        image['mimeType'] = 'image/jpeg'
    # Re-pack buffer views with 4-byte alignment.
    packed = bytearray()
    for view, content in zip(doc['bufferViews'], views):
        packed += b'\0' * (-len(packed) % 4)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(content)
        packed += content
    doc['buffers'][0]['byteLength'] = len(packed)
    write_glb(dst, doc, bytes(packed))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
