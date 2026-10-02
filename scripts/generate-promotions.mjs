import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('public/assets/promotions/source');
await mkdir(outputDir, { recursive: true });

const shared = 'premium minimalist Russian advertising photography, contemporary Russia, elegant realistic commercial photography, clean warm light grey background, restrained small red and yellow accents inspired by CESAR SATELLITE, crisp studio daylight, ample negative space, horizontal composition, no text, no letters, no numbers, no logos, no watermark, no flags, no foreign signage, no futuristic interface';

const jobs = [
  ['two-objects', null, 'https://d8j0ntlcm91z4.cloudfront.net/user_3JfwazlNIDJVsVInUUbbAcZXJNk/hf_20261002_055430_557cbddd-634d-43ab-8c33-33cc3b1e85e0.png'],
  ['refer-friend', 'Two well-dressed Russian friends in their thirties greeting each other in a refined modern Moscow apartment lobby, one showing a discreet home security mobile app to the other, warm trustworthy recommendation moment'],
  ['reactivation', 'A returning Russian homeowner opening the door of a carefully protected contemporary apartment after time away, discreet alarm control panel softly illuminated, feeling of renewed safety and welcome'],
  ['prepayment', 'Premium contemporary Russian home interior with a refined paper calendar, bank card and discreet security keypad arranged as an elegant still life, visual metaphor for confident advance planning'],
  ['equipment-discount', 'A beautifully arranged modular home security kit on a light stone surface: central hub, motion detector, door sensor and extra compact sensors, premium product advertising composition'],
  ['same-day-install', 'Professional Russian security technician in neat neutral uniform arriving at a contemporary apartment door with a compact equipment case, same-day service, polished commercial scene'],
  ['three-cameras', 'Three discreet modern security cameras protecting a refined Russian suburban house from three complementary angles, elegant architecture, clear sense of complete video coverage'],
  ['competitor-estimate', 'Premium minimal desk scene in a contemporary Russian office with two clean unbranded service proposals side by side, one visibly simpler and more advantageous through composition only, no readable text'],
  ['repair-certificate', 'Freshly renovated premium Russian apartment interior with tasteful neutral furniture, a pristine unbranded gift envelope on a stone console, celebratory but restrained'],
  ['easy-move', 'Stylish Russian family moving into a bright contemporary apartment, a small neatly packed security equipment box moving with them, calm effortless relocation'],
  ['first-month-free', 'Protected contemporary Russian apartment with discreet alarm keypad and a refined gift ribbon motif suggesting a complimentary first month, airy premium commercial composition'],
  ['switch-free', 'Professional security technician connecting existing compatible sensors in a modern Russian apartment, old neutral control device beside a new discreet hub, clean seamless transition'],
  ['safe-box', 'Compact premium matte dark safe-box presented on a light stone pedestal in an elegant modern Russian interior, high-end product photography, secure and refined'],
  ['rental-zero', 'A premium modular security kit visually serving three contemporary Russian properties in one seamless composition: city apartment, suburban cottage and small stylish street-level shop']
];

function generate(prompt) {
  const raw = execFileSync('higgsfield', [
    'generate', 'create', 'nano_banana_2_lite',
    '--prompt', `${prompt}. ${shared}`,
    '--aspect_ratio', '16:9', '--resolution', '1k', '--thinking', 'MINIMAL',
    '--wait', '--wait-timeout', '20m', '--json'
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const result = JSON.parse(raw);
  if (!result[0]?.result_url) throw new Error('Higgsfield did not return result_url');
  return result[0].result_url;
}

for (const [name, prompt, existingUrl] of jobs) {
  process.stdout.write(`Generating ${name}... `);
  const url = existingUrl || generate(prompt);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${name}: ${response.status}`);
  await writeFile(path.join(outputDir, `${name}.png`), Buffer.from(await response.arrayBuffer()));
  process.stdout.write('done\n');
}
