"""public/img 아래 PNG를 WebP로 바꾼다(장면 1536px 이하, 품질 82, 투명 유지). 원본 PNG는 지운다.
사용: python scripts/to_webp.py"""
import pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent / "public" / "img"
for p in sorted(root.rglob("*.png")):
    im = Image.open(p)
    im.thumbnail((1536, 1536))
    im.save(p.with_suffix(".webp"), "WEBP", quality=82, method=6)
    p.unlink()
    print(p.relative_to(root))
