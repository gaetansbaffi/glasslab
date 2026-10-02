/*
 * Glass Lab — tests : application installable (service worker). Un fichier listé mais absent fait
 * échouer l'installation de la nouvelle version : les téléphones resteraient sur l'ancienne.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, section } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

section('Application installable (PWA)');

test('service worker : il liste exactement les fichiers du jeu (mise à jour possible, jeu complet hors ligne)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = sw.match(/const FILES = \[([\s\S]*?)\];/);
  assert(m, 'liste FILES introuvable dans sw.js');
  const listed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  for (const f of listed) if (f !== './') assert(fs.existsSync(path.join(ROOT, f)), 'fichier listé mais absent : ' + f);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const modules = walk(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => './' + path.relative(ROOT, f).split(path.sep).join('/'));
  for (const f of modules) assert(listed.includes(f), 'module du jeu absent de la liste : ' + f);
  for (const f of ['./', './index.html', './style.css', './manifest.webmanifest']) assert(listed.includes(f), 'absent de la liste : ' + f);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons || []) assert(listed.includes('./' + icon.src.replace(/^\.\//, '')), 'icône absente de la liste : ' + icon.src);
  assert(new Set(listed).size === listed.length, 'fichier listé deux fois');
});
