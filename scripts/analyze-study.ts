import { openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeSyntheticStudy, MAX_ANALYST_BYTES } from '../src/server/study/analysis.js';

export function runStudyAnalysis(args:string[]){
  if(args.length!==2||args[0]!=='--fixture'||extname(args[1]!)!=='.csv')throw new Error('Synthetic --fixture CSV required');
  const fd=openSync(resolve(args[1]!),'r');
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>MAX_ANALYST_BYTES)throw new Error('Bounded synthetic CSV file required');return analyzeSyntheticStudy(readFileSync(fd,'utf8'));}
  finally{closeSync(fd);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{process.stdout.write(JSON.stringify({event:'synthetic_study_analysis',...runStudyAnalysis(process.argv.slice(2))})+'\n');}
  catch{process.stderr.write(JSON.stringify({event:'synthetic_study_analysis_failed',reason:'Conforming bounded synthetic analyst CSV required. Human study and live provider NOT RUN.'})+'\n');process.exitCode=1;}
}
