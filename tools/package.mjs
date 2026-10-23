// Makes the files the stores take, in web-ext-artifacts/:
//   semantic-highlighter-<version>-firefox.zip   the add-on, for addons.mozilla.org
//   semantic-highlighter-<version>-chrome.zip    the extension, for the Chrome Web Store
//   semantic-highlighter-<version>-source.zip    the committed source, which AMO asks for
// Run `npm run build` first. Works the same in bash, PowerShell and cmd.

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const out = 'web-ext-artifacts';
await mkdir(out, { recursive: true });

for (const browser of ['firefox', 'chrome']) {
  const manifest = JSON.parse(await readFile(`dist/${browser}/manifest.json`, 'utf8'));
  if (manifest.version !== version) {
    throw new Error(`dist/${browser} is version ${manifest.version}, package.json says ${version}: run npm run build`);
  }
}

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) console.warn('Warning: uncommitted changes are not in the source zip, which is made from the last commit.');

const name = (kind) => `semantic-highlighter-${version}-${kind}.zip`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
for (const browser of ['firefox', 'chrome']) {
  await rm(`${out}/${name(browser)}`, { force: true });
  execFileSync(npx, ['web-ext', 'build', '--source-dir', `dist/${browser}`, '--artifacts-dir', out,
    '--filename', name(browser), '--overwrite-dest'], { stdio: 'inherit', shell: process.platform === 'win32' });
}
execFileSync('git', ['archive', '--format=zip', `--output=${out}/${name('source')}`, 'HEAD'], { stdio: 'inherit' });
console.log(`\n${['firefox', 'chrome', 'source'].map((k) => `${out}/${name(k)}`).join('\n')}`);
