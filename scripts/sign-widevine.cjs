'use strict';
const { spawnSync } = require('node:child_process');
module.exports = async ({ appOutDir }) => {
  // EVS credentials stay outside the repository and are supplied by the builder's environment.
  if(process.env.PIXEL_VMP_SIGN!=='1'){
    console.warn('Widevine: unsigned development package. Production Spotify streaming is not verified in this package.');
    return;
  }
  const python=process.env.PIXEL_VMP_PYTHON||'python';
  for(const command of ['sign-pkg','verify-pkg']){
    const result=spawnSync(python,['-m','castlabs_evs.vmp','--no-ask',command,appOutDir],{stdio:'inherit',windowsHide:true,env:process.env});
    if(result.error||result.status!==0)throw new Error('Widevine signing/verification failed; portable release was not produced.');
  }
};
