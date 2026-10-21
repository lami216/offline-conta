import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,resolve} from 'node:path';
import {storeBuildConfig} from './store-build-config.mjs';

if(process.platform!=='win32')throw new Error('MSIX packaging requires Windows.');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const identity=JSON.parse(await readFile('build/store-identity.json','utf8'));
const config=storeBuildConfig(identity,pkg.storeVersion);
await readFile('desktop-dist/app/server.js');
await readFile('desktop-dist/shell/package.json');
process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
const {build,Platform,Arch}=await import('electron-builder');
const {default:sharp}=await import('sharp');
await mkdir('build/appx',{recursive:true});
for(const [file,width,height] of [['StoreLogo.png',50,50],['Square150x150Logo.png',150,150],['Square44x44Logo.png',44,44],['Wide310x150Logo.png',310,150]])await sharp('public/alkarna-logo.png').resize(width,height,{fit:'contain',background:'#ffffff'}).png().toFile(`build/appx/${file}`);
// Explicit API targets prevent the inherited production NSIS configuration
// from creating another installer with the existing customer identity.
const files=await build({config,targets:Platform.WINDOWS.createTarget('appx',Arch.x64),publish:'never'});
if(files.length!==1||!files[0].endsWith('.msix'))throw new Error('Expected exactly one Store MSIX output.');
const sha256=createHash('sha256').update(await readFile(files[0])).digest('hex');
await writeFile(`${files[0]}.sha256`,`${sha256} *${basename(files[0])}\n`);
await writeFile(resolve(config.directories.output,'BUILD-INFO.json'),JSON.stringify({
  sourceRepository:'lami216/offline-conta',sourceBaseBuild:836,sourceBaseCommit:'d85ca436446b48e975ace9461eda6a9365f686ec',
  sourceCommit:process.env.GITHUB_SHA||null,sourceVersion:pkg.version,packageVersion:`${pkg.storeVersion}.0`,
  storeIdentity:identity,file:basename(files[0]),sha256,
  note:'Unsigned Partner Center input. Device-bound free manual activation remains enforced. Microsoft signing and certification are pending. Existing EXE data and activation are not imported automatically.',
},null,2)+'\n');
