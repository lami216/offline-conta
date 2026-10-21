export function storeBuildConfig(identity,version) {
  if(!/^[1-9]\d*\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version||'')||version.split('.').some(part=>Number(part)>65535))throw new Error('Store version requires a nonzero major and three components <= 65535.');
  for(const field of ['identityName','publisher','publisherDisplayName','displayName','packageFamilyName'])if(typeof identity?.[field]!=='string'||!identity[field].trim()||/[\r\n\u0000]/.test(identity[field]))throw new Error(`Missing Store identity field: ${field}`);
  if(!/^[A-Za-z0-9.-]{3,50}$/.test(identity.identityName)||!/^CN=.+/.test(identity.publisher)||!identity.packageFamilyName.startsWith(`${identity.identityName}_`)||!/^[-A-Za-z0-9.]+_[a-z0-9]{13}$/.test(identity.packageFamilyName))throw new Error('Use exact Partner Center identity values.');
  return {
    appId:'mr.alkarna.store',executableName:'AlKarnaOffline',
    directories:{output:'dist/store'},
    extraMetadata:{version,alkarnaStore:true,alkarnaStoreAppId:`${identity.packageFamilyName}!AlKarnaOffline`},
    win:{target:[{target:'appx',arch:['x64']}],signExecutable:false},
    appx:{...Object.fromEntries(['identityName','publisher','publisherDisplayName','displayName'].map(key=>[key,identity[key]])),
      applicationId:'AlKarnaOffline',languages:['ar','fr'],capabilities:['runFullTrust'],
      minVersion:'10.0.19041.0',maxVersionTested:'10.0.19041.0',setBuildNumber:false,
      artifactName:'AlKarna-Store-${version}-x64.msix',
    },
  };
}
