"""Generate 'RG' app icons in the ram-gear.com primary teal #2E7386 (site --rg-accent-hover) with a #9FD3E1 underline."""
import os
from PIL import Image, ImageDraw, ImageFont
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAVY = (0x2E, 0x73, 0x86); FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def icon(size, maskable=False, rounded=False):
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if rounded: d.rounded_rectangle([0, 0, s-1, s-1], radius=int(s*0.18), fill=NAVY)
    else: d.rectangle([0, 0, s, s], fill=NAVY)
    scale = 0.36 if maskable else 0.46
    f = ImageFont.truetype(FONT, int(s*scale))
    bb = d.textbbox((0, 0), "RG", font=f); w, h = bb[2]-bb[0], bb[3]-bb[1]
    d.text(((s-w)/2-bb[0], (s-h)/2-bb[1]-s*0.02), "RG", font=f, fill="white")
    lw = int(s*0.022); y = int((s+h)/2 + s*0.06)
    d.rectangle([int((s-w)/2), y, int((s+w)/2), y+lw], fill=(0x9F, 0xD3, 0xE1))
    return im.resize((size, size), Image.LANCZOS)
os.makedirs(f"{APP}/icons", exist_ok=True)
icon(192).save(f"{APP}/icons/icon-192.png"); icon(512).save(f"{APP}/icons/icon-512.png")
icon(512, maskable=True).save(f"{APP}/icons/icon-maskable-512.png")
icon(180).convert("RGB").save(f"{APP}/icons/apple-touch-icon.png")
icon(64, rounded=True).save(f"{APP}/icons/favicon-64.png")
print("ok")
