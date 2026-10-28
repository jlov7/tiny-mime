import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const root=realpathSync(resolve('dist/client'));
const catalogue=JSON.parse(readFileSync(resolve('src/server/targets/meanings.json'),'utf8'));
const targets:string[]=[];
const collect=(value:unknown)=>{if(value&&typeof value==='object'){for(const [key,item]of Object.entries(value)){if(key==='target'&&typeof item==='string')targets.push(item);else collect(item);}}};collect(catalogue);
const files:{path:string;sha256:string;bytes:number}[]=[],findings:{path:string;rule:string}[]=[];
const scan=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=resolve(directory,entry.name),rel=relative(root,realpathSync(path));if(rel.startsWith('../')||isAbsolute(rel))throw new Error('ASSET_PATH_ESCAPE');
  if(entry.isDirectory()){scan(path);continue;}if(!statSync(path).isFile())throw new Error('UNEXPECTED_ASSET');
  const bytes=readFileSync(path),text=bytes.toString('utf8');files.push({path:rel,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  const rules:[string,RegExp][]=[['source_map',/\.map$/],['source_map_reference',/sourceMappingURL\s*=/],['meaning_id',/\bTM(?:0[1-9]|1[0-2])(?:\.meaning\.1)?\b/],['server_material',/scene-meaning-contracts|first-act-manifest|src\/server\/targets|src\/server\/scores|probe-ledger|probe-outputs|provider-config(?:\.example)?\.json|director-template-v1/],['provider_secret_or_configuration',/OPENAI_API_KEY|TM_MODEL_ID|TM_RUNTIME_ENABLED|TM_PROBE_ENABLED|Authorization\s*:\s*['"]Bearer|sk-proj-[A-Za-z0-9_-]+/]];
  for(const [rule,pattern]of rules)if(pattern.test(rule==='source_map'?rel:text))findings.push({path:rel,rule});
  for(const target of targets)if(text.includes(target)||text.includes(JSON.stringify(target).slice(1,-1)))findings.push({path:rel,rule:'target_phrase'});
}};
try{scan(root);if(!files.length)throw new Error('NO_CLIENT_ASSETS');console.log(JSON.stringify({status:findings.length?'FAIL':'PASS',files,findings},null,2));if(findings.length)process.exitCode=1;}catch(error){console.error(JSON.stringify({status:'FAIL',error:String(error)}));process.exitCode=1;}
