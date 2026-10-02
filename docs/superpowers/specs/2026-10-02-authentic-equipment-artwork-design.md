# Authentic CESAR SATELLITE equipment artwork

## Goal

Correct three promotion images so that all visible CESAR SATELLITE equipment and the security sticker match the official website exactly while retaining the existing premium minimalist campaign style.

## Source assets

Use the official product cutouts from `https://www.csat.ru/flat/`:

- full Hikvision security kit;
- motion sensor;
- keypad;
- window and door security sticker.

Official product pixels must not be redrawn, reshaped, relabelled, mirrored, or passed through a generative model. Generated imagery may be used only for the surrounding room, people, lighting, and shadows.

## Promotion corrections

### Equipment switch

Replace the current floor-level installation scene. Show a technician working from a stepladder and installing the authentic motion sensor high in a wall corner. Place the authentic keypad at a normal chest-level operating height. Composite the official cutouts into the scene and add only realistic contact shadows and color integration around them.

### Equipment rental for zero rubles

Remove the three-property miniature scene. Show the complete authentic security kit centered on a warm light-grey premium background. Keep the full kit visible, unobstructed, and unchanged.

### Two properties

Keep the existing apartment-and-house image. Add the authentic CESAR SATELLITE security sticker in the upper-right negative-space area indicated in the review screenshot. Keep it legible and proportionate without covering either property.

## Output constraints

- Preserve 16:9 image dimensions and existing filenames.
- Keep the light premium CESAR SATELLITE campaign treatment.
- Do not add invented equipment, fake controls, or generated branding.
- Verify desktop cards, mobile cards, public reports, and print/PDF rendering.
- Update the production Netlify deployment after tests and visual review pass.

## Verification

- Compare each composited product silhouette and markings against its official source cutout.
- Render a contact sheet for visual review.
- Run the promotions test suite and JavaScript syntax checks.
- Verify the three updated cards on the production Netlify URL.
