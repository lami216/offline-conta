import assert from 'node:assert/strict';
import test from 'node:test';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import profileModule from '../desktop/store-profile.cjs';
import {storeBuildConfig} from '../scripts/store-build-config.mjs';
const {resolveStoreProfile}=profileModule;
const identity={identityName:'Example.AlKarna',publisher:'CN=12345678-1234-1234-1234-123456789abc',publisherDisplayName:'Individual Publisher',displayName:'App',packageFamilyName:'Example.AlKarna_abcdefghijklm'};

test('normal installers and development retain their existing profile selection',()=>{
  assert.equal(resolveStoreProfile({isPackaged:true,metadata:{},appData:tmpdir()}),null);
  assert.equal(resolveStoreProfile({isPackaged:false,metadata:{alkarnaStore:true},appData:tmpdir()}),null);
  assert.throws(()=>resolveStoreProfile({isPackaged:true,metadata:{alkarnaStore:true},appData:tmpdir()}),/Invalid/);
});

test('Store writes cannot change fixture data or activation from a legacy installation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'alkarna-store-profile-'));
  try {
    const config=storeBuildConfig(identity,'1.0.0');
    const profile=resolveStoreProfile({isPackaged:true,metadata:config.extraMetadata,appData:root});
    assert.equal(profile.appUserModelId,`${identity.packageFamilyName}!AlKarnaOffline`);
    assert.equal(profile.licenseEnvironment.ALKARNA_LICENSE_DISABLE_REGISTRY,'1');
    const oldData=join(root,'الكرنه','data','alkarna.sqlite'),oldState=join(root,'PayZone','AlKarna-Licensing','state-v2.json');
    for(const file of [oldData,oldState]){await mkdir(dirname(file),{recursive:true});await writeFile(file,'untouched fixture');}
    const storeData=join(profile.userData,'data','alkarna.sqlite'),storeState=profile.licenseEnvironment.ALKARNA_LICENSE_STATE_PATH;
    for(const file of [storeData,storeState]){await assert.rejects(readFile(file),{code:'ENOENT'});await mkdir(dirname(file),{recursive:true});await writeFile(file,'store-only fixture');}
    for(const file of [oldData,oldState])assert.equal(await readFile(file,'utf8'),'untouched fixture');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('Store manifest configuration preserves identity and reserves version revision for Microsoft',()=>{
  const config=storeBuildConfig(identity,'1.0.0');
  for(const key of ['identityName','publisher','publisherDisplayName','displayName'])assert.equal(config.appx[key],identity[key]);
  assert.deepEqual(config.appx.languages,['ar','fr']);
  assert.deepEqual(config.appx.capabilities,['runFullTrust']);
  assert.equal(config.appx.setBuildNumber,false);
  assert.equal(config.win.signExecutable,false);
  assert.throws(()=>storeBuildConfig(identity,'0.1.9'),/nonzero/);
  assert.throws(()=>storeBuildConfig(identity,'1.2.65536'),/65535/);
  assert.throws(()=>storeBuildConfig({...identity,packageFamilyName:'Another_abcdefghijklm'},'1.0.0'),/exact Partner/);
});
