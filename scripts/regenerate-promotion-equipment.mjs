import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('public/assets/promotions/source');
const referenceDir = path.resolve('public/assets/promotions/references');

const shared = 'Preserve the original premium minimalist Russian advertising style, warm light grey palette, natural daylight, restrained red and yellow accents, horizontal 16:9 composition, realistic materials, no added text, no watermark. The first image is the composition to edit. Match the referenced CESAR SATELLITE equipment exactly in silhouette, proportions, color, controls and camera housing; do not invent substitute hardware.';

const jobs = [
  {
    name: 'refer-friend',
    refs: [],
    prompt: 'Keep the two women, their clothing, apartment lobby, framing and lighting. Correct only the smartphone interaction: the woman in navy holds one normal upright smartphone naturally between them, with the screen facing both women and visibly oriented toward their eyes, never backwards or mirrored. Both women look at the screen. Realistic hands and fingers.'
  },
  {
    name: 'equipment-discount',
    refs: ['security-kit.png', 'keypad.webp', 'motion-sensor.webp', 'open-sensor.webp'],
    prompt: 'Keep the elegant stone pedestal product layout. Replace every generic device with the exact referenced CESAR SATELLITE security kit: matching control panel, keypad, motion sensor and door-opening sensor, arranged as a coherent premium product family.'
  },
  {
    name: 'prepayment',
    refs: ['keypad.webp'],
    prompt: 'Keep the calendar, bank card and refined still-life composition. Replace the generic wall device with an exact copy of the white CESAR SATELLITE keypad in the reference: white vertical body, twelve raised round grey numeric buttons, small speaker holes at top left and a black base. Do not make a black touchscreen keypad.'
  },
  {
    name: 'reactivation',
    refs: ['keypad.webp', 'wireless-keypad.webp'],
    prompt: 'Keep the returning homeowner, doorway, camera angle and warm interior. Replace the generic illuminated wall panel with the exact referenced CESAR SATELLITE keypad, mounted realistically at hand height.'
  },
  {
    name: 'first-month-free',
    refs: ['keypad.webp', 'wireless-keypad.webp'],
    prompt: 'Keep the minimal gift-ribbon concept and interior. Use the exact referenced white CESAR SATELLITE keypad. Add only a thin tasteful red-and-gold ribbon tied below it; no gift tag, no card, no text, no letters, no numbers beyond the real keypad buttons.'
  },
  {
    name: 'switch-free',
    input: 'switch-free-generation-base.png',
    output: 'switch-free.png',
    refs: ['motion-sensor.webp', 'keypad.webp'],
    prompt: 'Preserve the installer, stepladder, room, pose and framing from the first image. Add the exact referenced CESAR SATELLITE motion sensor as a physically small, realistic wall-mounted device directly beneath the technician’s raised fingertips at the high wall-and-ceiling corner. Add the exact referenced CESAR SATELLITE keypad securely mounted on the same wall near the technician at realistic chest and hand height. Both devices must have believable real-world scale, perspective, contact shadows and wall attachment: no oversized products, no floating cutouts, no sticker appearance, no extra devices, no holes, no exposed wires, no text and no logos.'
  },
  {
    name: 'rental-zero',
    input: 'rental-zero-generation-base.png',
    output: 'rental-zero.png',
    refs: ['security-kit.png'],
    prompt: 'Create a polished premium minimalist Russian home-security advertising scene using the complete referenced CESAR SATELLITE security kit. Show the full kit clearly and faithfully as one coherent hero product group, large and prominent, grounded on a tasteful architectural stone or warm studio surface in a refined modern interior. Use premium natural light, restrained warm grey materials, depth and a believable grounded shadow. Preserve the kit’s recognizable device shapes, count, proportions and arrangement. No houses, no people, no text, no price, no logo overlay, no floating tiny cutout, no invented equipment.'
  },
  {
    name: 'three-cameras',
    refs: ['camera-v5.webp', 'camera-v4.webp', 'camera-v10.webp', 'camera-v11.webp'],
    prompt: 'Keep the refined Russian suburban house and three-angle coverage concept. Replace every generic camera with three accurately shaped referenced CESAR SATELLITE cameras, discreetly mounted at the facade, entrance and eaves, all realistic in scale and aimed at different coverage zones.'
  },
  {
    name: 'safe-box',
    refs: ['safe-box.webp'],
    prompt: 'Keep the premium stone pedestal and elegant interior. This is NOT a floor safe. Replace it with an exact enlarged product portrait of the compact black wall-mounted key safe-box from the reference: small vertical rectangular metal key cabinet, numeric push-button lock at the top, hinged front door shown slightly open, one house key visible inside. Preserve the referenced proportions and housing exactly.'
  }
];

function generate(job) {
  const args = [
    'generate', 'create', 'nano_banana_2_lite',
    '--prompt', `${job.prompt} ${shared}`,
    '--image', path.join(sourceDir, job.input ?? `${job.name}.png`)
  ];
  for (const ref of job.refs) args.push('--image', path.join(referenceDir, ref));
  args.push('--aspect_ratio', '16:9', '--resolution', '1k', '--thinking', 'MINIMAL', '--wait', '--wait-timeout', '20m', '--json');

  const raw = execFileSync('higgsfield', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const result = JSON.parse(raw);
  if (!result[0]?.result_url) throw new Error(`Higgsfield did not return result_url for ${job.name}`);
  return result[0].result_url;
}

const requested = new Set(process.argv.slice(2));
for (const job of jobs.filter((item) => requested.size === 0 || requested.has(item.name))) {
  process.stdout.write(`Regenerating ${job.name}... `);
  const url = generate(job);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${job.name}: ${response.status}`);
  const outputPath = path.join(sourceDir, job.output ?? `${job.name}.png`);
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  execFileSync('python3', [
    '-c',
    'from PIL import Image, ImageOps; import sys; p=sys.argv[1]; im=Image.open(p).convert("RGB"); ImageOps.fit(im, (1280, 720), method=Image.Resampling.LANCZOS).save(p)',
    outputPath
  ]);
  process.stdout.write('done\n');
}
