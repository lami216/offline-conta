import {spawnSync} from 'node:child_process';
import {readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output=path.resolve('desktop-access-proof/secure-storage.json');await mkdir(path.dirname(output),{recursive:true});await rm(output,{force:true});
const executable=path.resolve('node_modules/electron/dist/electron.exe');
const env={...process.env,ALKARNA_ACCESS_PROOF_FILE:output};delete env.ELECTRON_RUN_AS_NODE;
const child=spawnSync(executable,['--disable-gpu',path.resolve('scripts/test-desktop-access-secure.cjs')],{env,encoding:'utf8',windowsHide:true,timeout:45000});
if(child.error)throw child.error;assert.equal(child.status,0,child.stderr||'Electron access test failed');const proof=JSON.parse(await readFile(output,'utf8'));assert.equal(proof.passed,true);console.log(JSON.stringify(proof));
