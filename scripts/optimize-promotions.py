from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


root = Path("public/assets/promotions")
source = root / "source"
helper_files = {"switch-free-background.png", "two-objects-base.png"}
files = sorted(file for file in source.glob("*.png") if file.name not in helper_files)
assert len(files) == 14, f"Expected 14 images, found {len(files)}"

for file in files:
    image = Image.open(file).convert("RGB")
    image = ImageOps.fit(image, (1280, 720), method=Image.Resampling.LANCZOS)
    image.save(root / f"{file.stem}.webp", "WEBP", quality=84, method=6)

thumbs = []
for file in files:
    image = Image.open(file).convert("RGB")
    image = ImageOps.fit(image, (320, 180), method=Image.Resampling.LANCZOS)
    card = Image.new("RGB", (320, 210), "white")
    card.paste(image, (0, 0))
    ImageDraw.Draw(card).text((8, 188), file.stem, fill="#141519")
    thumbs.append(card)

sheet = Image.new("RGB", (1280, 840), "#eef1f5")
for index, thumb in enumerate(thumbs):
    sheet.paste(thumb, ((index % 4) * 320, (index // 4) * 210))
sheet.save("/tmp/promotions-contact-sheet.jpg", quality=90)

print(f"optimized {len(files)}")
for file in sorted(root.glob("*.webp")):
    print(file.name, file.stat().st_size)
