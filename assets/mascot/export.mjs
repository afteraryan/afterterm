// Writes the still images of the mascot from mascot.js, so the files never drift from the code.
//
//   node assets/mascot/export.mjs
//
// Writes into assets/mascot/stills/: mascot.svg (neutral, transparent), mascot-tile.svg
// (on its pink tile) and one SVG per emotion. Run it again after changing mascot.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const Mascot = createRequire(import.meta.url)('./mascot.js');
const out = path.join(here, 'stills');
fs.mkdirSync(out, { recursive: true });

const write = (name, svg) => { fs.writeFileSync(path.join(out, name), svg + '\n'); console.log('stills/' + name); };
const mouthFor = { happy: 'smile', sad: 'frown' };
write('mascot.svg', Mascot.svg({ size: 512 }));
write('mascot-tile.svg', Mascot.svg({ size: 512, background: 'tile' }));
for (const mood of Mascot.MOODS) write(`mood-${mood}.svg`, Mascot.svg({ size: 512, mood, mouth: mouthFor[mood] }));
