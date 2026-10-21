/* eslint-disable @typescript-eslint/no-require-imports */
const {join}=require('node:path');

function resolveStoreProfile({isPackaged,metadata,appData}) {
  // This marker is sealed inside app.asar. A launch argument or environment
  // variable must not select a different profile for an existing EXE install.
  if(!isPackaged||metadata.alkarnaStore===undefined)return null;
  if(metadata.alkarnaStore!==true||typeof metadata.alkarnaStoreAppId!=='string'||!/^[-A-Za-z0-9.]+_[a-z0-9]{13}![A-Za-z][A-Za-z0-9]*$/.test(metadata.alkarnaStoreAppId))throw new Error('Invalid packaged Store profile');
  const userData=join(appData,'AlKarna-Store');
  return Object.freeze({userData,appUserModelId:metadata.alkarnaStoreAppId,licenseEnvironment:{
    ALKARNA_LICENSE_STATE_PATH:join(userData,'licensing','state-v2.json'),
    ALKARNA_LICENSE_DISABLE_REGISTRY:'1',
  }});
}

module.exports={resolveStoreProfile};
