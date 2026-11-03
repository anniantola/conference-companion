#!/usr/bin/env node
// Shared attendee deployment boundary. Conference repositories supply data and
// branding; this repository supplies the executable application and contracts.
import {access, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export const engineRoot = fileURLToPath(new URL('..', import.meta.url));
export const attendeeFiles = [
  'index.html', 'app.js', 'bootstrap.js', 'styles.css', 'service-worker.js',
  'src/package-store.js', 'src/calendar.js', 'src/validation.js',
  'src/backup.js', 'src/zip.js', 'src/qrcode.js', 'src/safe-url.js',
  'src/publications.js', 'src/friend-contact.js', 'src/friend-directory.js', 'src/friend-activities.js', 'src/friend-gallery.js', 'src/avatars.js',
  'src/model.js', 'src/user-store.js', 'src/json-schema.js',
  'src/vcard.js', 'src/migrations.js',
  'src/vendor/qr-scanner/qr-scanner.min.js',
  'src/vendor/qr-scanner/qr-scanner-worker.min.js',
  'src/vendor/qr-scanner/LICENSE',
  'src/vendor/qrcode-generator/qrcode.js',
  'src/vendor/qrcode-generator/LICENSE', 'tools/deployment.mjs'
];

const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => access(path).then(() => true, () => false);

export async function validateDeployment(deploymentRoot) {
  const root = resolve(deploymentRoot);
  for (const path of ['app.js', 'bootstrap.js', 'index.html', 'styles.css', 'service-worker.js', 'src', 'schemas', 'assets/fonts', 'tools/schema-check.mjs', 'tools/validate-conference.mjs']) {
    if (await exists(join(root, path))) throw new Error(`Deployment repository still contains duplicated engine source: ${path}`);
  }
  for (const tool of ['schema-check', 'validate-conference']) {
    execFileSync(process.execPath, [join(engineRoot, 'tools', `${tool}.mjs`), join(root, 'conference')], {cwd: root, stdio: 'inherit'});
  }
  const manifest = JSON.parse(await readFile(join(root, 'conference/conference-manifest.json'), 'utf8'));
  for (const file of manifest.files || []) {
    const bytes = await readFile(join(root, 'conference', file));
    if (manifest.checksums?.[file] !== sha256(bytes)) throw new Error(`Conference checksum mismatch: ${file}`);
  }
  return manifest;
}

export async function stageDeployment(deploymentRoot, outputRoot) {
  const root = resolve(deploymentRoot), output = resolve(outputRoot);
  if (output !== join(root, '_site')) throw new Error('Output must be the deployment repository _site directory');
  await validateDeployment(root);
  const conference = JSON.parse(await readFile(join(root, 'conference/conference.json'), 'utf8'));
  const branding = JSON.parse(await readFile(join(root, 'conference/branding.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  if (!['./', '.'].includes(manifest.id) || !['./', '.'].includes(manifest.start_url) || !['./', '.'].includes(manifest.scope)) throw new Error('Install manifest must use deployment-relative identity and scope');
  await rm(output, {recursive: true, force: true});
  await mkdir(output, {recursive: true});
  for (const path of attendeeFiles) {
    const target = join(output, path);
    await mkdir(dirname(target), {recursive: true});
    await cp(join(engineRoot, path), target);
  }
  for (const path of ['assets/fonts', 'assets/avatars', 'schemas']) await cp(join(engineRoot, path), join(output, path), {recursive: true});
  await cp(join(root, 'conference'), join(output, 'conference'), {recursive: true});
  for (const path of ['manifest.webmanifest', 'share-preview.svg', '.nojekyll']) {
    if (await exists(join(root, path))) await cp(join(root, path), join(output, path));
  }
  for (const size of [180, 192, 512]) {
    const name = `icon-${size}.png`, local = join(root, name);
    await cp(await exists(local) ? local : join(engineRoot, name), join(output, name));
  }
  const description = `Conference companion for ${conference.name}`;
  const tags = `  <meta property="og:type" content="website">\n  <meta property="og:title" content="${escapeHtml(conference.name)}">\n  <meta property="og:description" content="${escapeHtml(description)}">\n  <meta property="og:image" content="share-preview.svg">\n  <meta name="twitter:card" content="summary_large_image">\n`;
  const html = await readFile(join(engineRoot, 'index.html'), 'utf8');
  if (!html.includes('</head>')) throw new Error('Engine index has no head element');
  await writeFile(join(output, 'index.html'), html.replace('</head>', `${tags}</head>`));
  if (!(await exists(join(output, 'share-preview.svg')))) {
    const title = escapeHtml(conference.shortName || conference.name);
    const color = /^#[0-9a-f]{6}$/i.test(branding.primary) ? branding.primary : '#000000';
    await writeFile(join(output, 'share-preview.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${color}"/><text x="80" y="320" font-size="76" fill="white">${title}</text></svg>`);
  }
  await verifyStagedDeployment(root, output);
  return output;
}

export async function verifyStagedDeployment(deploymentRoot, outputRoot) {
  const root = resolve(deploymentRoot), output = resolve(outputRoot);
  for (const path of attendeeFiles.filter(path => path !== 'index.html')) {
    if (sha256(await readFile(join(output, path))) !== sha256(await readFile(join(engineRoot, path)))) throw new Error(`Staged engine differs from canonical source: ${path}`);
  }
  for(const name of await readdir(join(engineRoot,'assets/avatars'))){
    const path=`assets/avatars/${name}`;
    if(sha256(await readFile(join(output,path)))!==sha256(await readFile(join(engineRoot,path))))throw new Error(`Staged avatar differs from canonical source: ${path}`);
  }
  for (const path of ['conference/conference-manifest.json', 'conference/conference.json', 'conference/programme.json', 'conference/people.json', 'conference/locations.json', 'conference/branding.json', 'manifest.webmanifest', 'share-preview.svg', '.nojekyll']) {
    if (!(await exists(join(output, path)))) throw new Error(`Staged deployment is missing ${path}`);
  }
  if ((await readdir(join(output, 'src'))).includes('builder') || await exists(join(output, 'builder.html'))) throw new Error('Builder files leaked into attendee deployment');
  const html = await readFile(join(output, 'index.html'), 'utf8');
  const conference = JSON.parse(await readFile(join(root, 'conference/conference.json'), 'utf8'));
  if (!html.includes(`content="${escapeHtml(conference.name)}"`)) throw new Error('Staged page has wrong conference metadata');
  const webManifest = JSON.parse(await readFile(join(output, 'manifest.webmanifest'), 'utf8'));
  for (const icon of webManifest.icons || []) if (!(await exists(join(output, icon.src.replace(/^\.\//, ''))))) throw new Error(`Staged icon is missing: ${icon.src}`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , action, deployment = '.', output = '_site'] = process.argv;
  if (action === 'check') await validateDeployment(deployment);
  else if (action === 'stage') {const site = await stageDeployment(deployment, output); console.log(`Staged attendee deployment: ${site}`);}
  else throw new Error('Usage: node tools/deployment-engine.mjs check|stage [deployment-root] [output-root]');
}
