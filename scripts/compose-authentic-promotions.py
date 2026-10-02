from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


ROOT = Path("public/assets/promotions")
SOURCE = ROOT / "source"
REFERENCES = ROOT / "references"
SIZE = (1280, 720)


def contain_rgba(image, width, height):
    layer = image.convert("RGBA")
    layer.thumbnail((width, height), Image.Resampling.LANCZOS)
    return layer


def paste_with_shadow(canvas, layer, xy, blur=14, offset=(8, 10), opacity=72):
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    alpha = layer.getchannel("A").point(lambda value: value * opacity // 255)
    shadow_layer = Image.new("RGBA", layer.size, (28, 25, 22, 0))
    shadow_layer.putalpha(alpha)
    shadow.alpha_composite(shadow_layer, (xy[0] + offset[0], xy[1] + offset[1]))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(layer, xy)


def compose_two_objects():
    canvas = Image.open(SOURCE / "two-objects-base.png").convert("RGB")
    canvas = ImageOps.fit(canvas, SIZE, method=Image.Resampling.LANCZOS).convert("RGBA")
    sticker = contain_rgba(Image.open(REFERENCES / "security-sticker.webp"), 165, 165)
    paste_with_shadow(canvas, sticker, (1000, 70), blur=10, offset=(5, 7), opacity=52)
    canvas.convert("RGB").save(SOURCE / "two-objects.png", quality=95)


if __name__ == "__main__":
    compose_two_objects()
    print("composed approved two-objects sticker image")
