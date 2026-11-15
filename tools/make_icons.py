# 產生 PWA 圖示：深藍底＋評分單＋紅筆勾勾
import os
from PIL import Image, ImageDraw
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(out, exist_ok=True)

def draw(size, pad):
    s = 4 * size
    im = Image.new('RGB', (s, s), '#1F2A44')
    d = ImageDraw.Draw(im)
    x0, x1 = pad * s, (1 - pad) * s
    w = x1 - x0
    # 紙
    d.rounded_rectangle([x0 + w * .16, x0 + w * .08, x0 + w * .84, x0 + w * .92], radius=w * .05, fill='#FBF8F0')
    d.line([x0 + w * .27, x0 + w * .1, x0 + w * .27, x0 + w * .9], fill='#C8102E', width=int(w * .012))
    # 三列分數格
    for i, filled in enumerate([4, 5, 3]):
        y = x0 + w * (.26 + i * .2)
        d.line([x0 + w * .32, y + w * .07, x0 + w * .78, y + w * .07], fill='#D9D2BF', width=int(w * .01))
        for k in range(5):
            cx = x0 + w * (.36 + k * .09)
            box = [cx - w * .03, y - w * .03, cx + w * .03, y + w * .03]
            if k < filled: d.ellipse(box, fill='#1F2A44')
            else: d.ellipse(box, outline='#9AA0B0', width=int(w * .01))
    # 紅筆勾勾
    pts = [(x0 + w * .5, x0 + w * .74), (x0 + w * .6, x0 + w * .84), (x0 + w * .86, x0 + w * .56)]
    d.line(pts, fill='#C8102E', width=int(w * .07), joint='curve')
    return im.resize((size, size), Image.LANCZOS)

draw(192, .06).save(os.path.join(out, 'icon-192.png'))
draw(512, .06).save(os.path.join(out, 'icon-512.png'))
draw(512, .2).save(os.path.join(out, 'icon-maskable-512.png'))
print('ok')
