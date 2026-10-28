import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import { parseTree, getNodeValue, type Node } from 'jsonc-parser';
import { StudyError } from './contracts.js';
import { openPrivateDb, prepareDataDir } from '../storage/db.js';
export function researchDatabasePath(fixture=false):string {const dir=process.env.TM_DATA_DIR??join(homedir(),'Library','Application Support','TinyMime');if(!isAbsolute(dir))throw new StudyError('INVALID_INPUT');return join(dir,fixture?'fixture-rehearsals.sqlite':'research.sqlite');}
export function initializeResearchDatabase():Database.Database {
  const dir=prepareDataDir(process.env.TM_DATA_DIR);return openPrivateDb(dir,'research.sqlite');
}
export function openResearchDatabase(fixture=false):Database.Database {
  const db=new Database(researchDatabasePath(fixture),{fileMustExist:true});
  try {if(fixture&&(db.prepare("SELECT id FROM study_runs WHERE json_extract(manifest,'$.status') IS NOT 'draft'").get()||db.prepare('SELECT id FROM study_sessions LIMIT 1').get()||db.prepare('SELECT id FROM study_rounds LIMIT 1').get()||db.prepare("SELECT id FROM study_coder_rows WHERE partition!='fixture' LIMIT 1").get()))throw new StudyError('FORBIDDEN');return db;}catch(error){db.close();throw error;}
}
export function assertCliRun(db:Database.Database,runId:string,fixture=false):void {
  const run=db.prepare('SELECT manifest FROM study_runs WHERE id=?').get(runId) as {manifest:string}|undefined;
  if(!run)throw new StudyError('NOT_FOUND');
  if(JSON.parse(run.manifest).status!==(fixture?'draft':'approved')||db.prepare(`SELECT id FROM ${fixture?'study':'fixture'}_sessions WHERE run_id=? LIMIT 1`).get(runId)||db.prepare('SELECT id FROM study_coder_rows WHERE run_id=? AND partition!=? LIMIT 1').get(runId,fixture?'fixture':'study'))throw new StudyError('FORBIDDEN');
}
export function readRatingFile(path:string):unknown {if(statSync(path).size>2*1024*1024)throw new StudyError('LIMITED');const raw=readFileSync(path);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new StudyError('INVALID_INPUT');}const errors:unknown[]=[];const tree=parseTree(text,errors as never,{allowTrailingComma:false,disallowComments:true});if(!tree||errors.length)throw new StudyError('INVALID_INPUT');function inspect(node:Node):void {if(node.type==='object'){const seen=new Set<string>();for(const property of node.children??[]){const key=String(property.children?.[0]?.value);if(seen.has(key)||['__proto__','constructor','prototype'].includes(key))throw new StudyError('INVALID_INPUT');seen.add(key);}}for(const child of node.children??[])inspect(child);}inspect(tree);return getNodeValue(tree);}
export function receipt(value:unknown):void {process.stdout.write(JSON.stringify(value)+'\n');}
export function cliError(error:unknown):void {receipt({status:'error',code:error instanceof StudyError?error.code:'UNAVAILABLE'});process.exitCode=1;}
