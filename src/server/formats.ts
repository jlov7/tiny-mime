import type { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';

export default function addFormats(ajv: Ajv2020) {
  for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
}
