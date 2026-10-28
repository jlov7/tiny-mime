import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
export function auditStatus(child: { error?: Error; signal: string | null; status: number | null; stdout: string }, findings: string[]) {
  let audit;try{audit=JSON.parse(child.stdout);}catch{audit=null;}
  const counts=audit?.metadata?.vulnerabilities;
  const unavailable=!!child.error||child.signal!==null||!audit||audit.error||!counts||!['info','low','moderate','high','critical','total'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)||![0,1].includes(child.status??-1);
  const vulnerable=!unavailable&&Object.values(audit.metadata.vulnerabilities).some(n=>typeof n==='number'&&n>0);
  return { status: unavailable?'UNAVAILABLE':findings.length||vulnerable?'FAIL':'PASS', audit };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const directory=resolve('artifacts/verification/dependency-audits',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());mkdirSync(directory,{recursive:true});
const startedAt=new Date().toISOString();
const retain=(result:Record<string,unknown>)=>{writeFileSync(resolve(directory,'receipt.json'),JSON.stringify({command:'npm audit --json',startedAt,finishedAt:new Date().toISOString(),result},null,2)+'\n');console.log(JSON.stringify({...result,receipt:resolve(directory,'receipt.json')},null,2));};
const findings:string[]=[];
try{
  const pkg=JSON.parse(readFileSync('package.json','utf8')),lock=JSON.parse(readFileSync('package-lock.json','utf8')),manifest=JSON.parse(readFileSync('toolchain-manifest.json','utf8'));
  const declared={...pkg.dependencies,...pkg.devDependencies},lockedRoot={...lock.packages[''].dependencies,...lock.packages[''].devDependencies};
  if(JSON.stringify(Object.entries(declared).sort())!==JSON.stringify(Object.entries(lockedRoot).sort()))findings.push('ROOT_LOCK_MISMATCH');
  for(const [name,version]of Object.entries(declared)){
    if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))findings.push('UNPINNED '+name);
    if(lock.packages['node_modules/'+name]?.version!==version)findings.push('LOCK_VERSION '+name);
    const entry=manifest.packages.find((p:{name:string})=>p.name===name);
    if(!entry||entry.version!==version||!entry.license||!entry.source||!entry.registry||!entry.purpose||!entry.advisoryReview)findings.push('MANIFEST_METADATA '+name);
  }
  for(const entry of manifest.packages)if(!(entry.name in declared))findings.push('UNDECLARED_MANIFEST '+entry.name);
  for(const [name,enabled]of Object.entries(pkg.allowScripts??{}))if(enabled!==true||!['better-sqlite3@13.0.3','esbuild@0.28.2'].includes(name))findings.push('UNAPPROVED_INSTALL_SCRIPT '+name);
  const child=spawnSync('npm',['audit','--json'],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000,env:{...Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]])),npm_config_userconfig:'/dev/null',npm_config_globalconfig:resolve('scripts/npm-global.npmrc'),npm_config_registry:'https://registry.npmjs.org'}});
  const {status,audit}=auditStatus(child,findings);
  retain({status,node:process.version,findings,auditExitCode:child.status,signal:child.signal,audit:audit??{error:child.error?.message??'INVALID_AUDIT_JSON',stderr:child.stderr}});if(status!=='PASS')process.exitCode=1;
}catch(error){retain({status:'FAIL',error:String(error)});process.exitCode=1;}

}
