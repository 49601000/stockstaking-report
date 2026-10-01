import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const configUrl = new URL('../../config/samples.local.json', import.meta.url);
const publicConfigUrl = new URL('../../config/samples.json', import.meta.url);
export const samples = JSON.parse(readFileSync(existsSync(configUrl) ? configUrl : publicConfigUrl));
export const samplePath = sample => fileURLToPath(new URL('../../' + sample.path, import.meta.url));
export const readSample = name => {
  const sample = samples.find(file => file.name === name);
  if (!sample) throw Error(`Unknown sample: ${name}`);
  return readFileSync(samplePath(sample));
};
