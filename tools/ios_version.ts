// Sets the native iPhone/iPad app's version in its XcodeGen spec (native/ios/project.yml): the marketing
// version (what the App Store shows) is package.json's "version"; the build number is the count of
// commits on HEAD, which only grows, so every upload to App Store Connect gets a new one.
//   npm run ios:version            (npm run ios:upload runs it; commit the project.yml it changes)
//   npm run ios:version -- 42      (a build number of your own)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'native/ios/project.yml');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string };
const version = pkg.version;
if (!version || !/^\d+(\.\d+){0,2}$/.test(version)) {
  throw new Error(`package.json "version" must be like 1.2.3, not ${version}`);
}
const build =
  process.argv[2] ?? execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (!/^\d+$/.test(build)) throw new Error(`the build number must be a whole number, not ${build}`);

const project = fs
  .readFileSync(PROJECT, 'utf8')
  .replace(/^(\s*)MARKETING_VERSION: .*$/m, `$1MARKETING_VERSION: '${version}'`)
  .replace(/^(\s*)CURRENT_PROJECT_VERSION: .*$/m, `$1CURRENT_PROJECT_VERSION: '${build}'`);
if (!project.includes(`MARKETING_VERSION: '${version}'`) || !project.includes(`CURRENT_PROJECT_VERSION: '${build}'`)) {
  throw new Error(`${PROJECT} has no MARKETING_VERSION / CURRENT_PROJECT_VERSION to set`);
}
fs.writeFileSync(PROJECT, project);
console.log(`iOS app: version ${version}, build ${build}`);
