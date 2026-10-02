from collections import deque
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


def remove_edge_white(image, threshold=242):
    """Make only edge-connected near-white pixels transparent."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    visited = bytearray(width * height)
    queue = deque()

    def is_background(x, y):
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= threshold and max(red, green, blue) - min(red, green, blue) <= 12

    for x in range(width):
        if is_background(x, 0):
            queue.append((x, 0))
        if is_background(x, height - 1):
            queue.append((x, height - 1))
    for y in range(height):
        if is_background(0, y):
            queue.append((0, y))
        if is_background(width - 1, y):
            queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index] or not is_background(x, y):
            continue
        visited[index] = 1
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    return rgba


def paste_with_shadow(canvas, layer, xy, blur=14, offset=(8, 10), opacity=72):
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    alpha = layer.getchannel("A").point(lambda value: value * opacity // 255)
    shadow_layer = Image.new("RGBA", layer.size, (28, 25, 22, 0))
    shadow_layer.putalpha(alpha)
    shadow.alpha_composite(shadow_layer, (xy[0] + offset[0], xy[1] + offset[1]))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(layer, xy)


def compose_switch_free():
    background = Image.open(SOURCE / "switch-free-background.png").convert("RGB")
    canvas = ImageOps.fit(background, SIZE, method=Image.Resampling.LANCZOS).convert("RGBA")
    sensor = contain_rgba(remove_edge_white(Image.open(REFERENCES / "motion-sensor.webp")), 90, 90)
    keypad = contain_rgba(remove_edge_white(Image.open(REFERENCES / "keypad.webp")), 170, 170)
    paste_with_shadow(canvas, sensor, (770, 46), blur=8, offset=(4, 5), opacity=48)
    paste_with_shadow(canvas, keypad, (1000, 300), blur=10, offset=(6, 7), opacity=58)
    canvas.convert("RGB").save(SOURCE / "switch-free.png", quality=95)


def compose_rental_zero():
    canvas = Image.new("RGBA", SIZE, "#e7e1d8")
    kit = Image.open(REFERENCES / "security-kit.png").convert("RGBA")
    kit = kit.crop(kit.getbbox())
    kit = contain_rgba(kit, 940, 500)
    xy = ((SIZE[0] - kit.width) // 2, (SIZE[1] - kit.height) // 2 - 6)
    paste_with_shadow(canvas, kit, xy, blur=22, offset=(14, 18), opacity=62)
    canvas.convert("RGB").save(SOURCE / "rental-zero.png", quality=95)


def compose_two_objects():
    canvas = Image.open(SOURCE / "two-objects-base.png").convert("RGB")
    canvas = ImageOps.fit(canvas, SIZE, method=Image.Resampling.LANCZOS).convert("RGBA")
    sticker = contain_rgba(Image.open(REFERENCES / "security-sticker.webp"), 165, 165)
    paste_with_shadow(canvas, sticker, (1000, 70), blur=10, offset=(5, 7), opacity=52)
    canvas.convert("RGB").save(SOURCE / "two-objects.png", quality=95)


if __name__ == "__main__":
    compose_switch_free()
    compose_rental_zero()
    compose_two_objects()
    print("composed switch-free, rental-zero, and two-objects")
