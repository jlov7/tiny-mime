import { describe, expect, it } from 'vitest';
import { manifestSchema, runFixtureCorpus, containedPath } from '../../scripts/verify-fixtures.js';
const results=runFixtureCorpus();
describe('closed acceptance manifest consumes actual fixture inputs',()=>{
  for(const result of results) it(result.id,()=>expect(result.passed,JSON.stringify(result.actual)).toBe(true));
  it('rejects unknown kinds, expectations and properties',()=>{
    const c={id:'bad',kind:'motion',inputPath:'fixtures/x',sha256:'0'.repeat(64),expected:'valid',requirementIds:['P01'],testPath:'tests/unit/fixtures.test.ts'};
    expect(()=>manifestSchema.parse({version:1,cases:[c]})).toThrow();
    expect(()=>manifestSchema.parse({version:1,cases:[{...c,kind:'unknown'}]})).toThrow();
    expect(()=>manifestSchema.parse({version:1,cases:[{...c,expected:'samples_match',extra:true}]})).toThrow();
  });
  it('rejects absolute and escaping paths',()=>{
    expect(()=>containedPath(process.cwd(),'/etc/hosts')).toThrow('PATH_ESCAPE');
    expect(()=>containedPath(process.cwd(),'../../../..')).toThrow('PATH_ESCAPE');
  });
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadManifest, assertConsumption } from '../../scripts/verify-fixtures.js';
it('rejects missing, escaped, changed-hash and duplicate fixture inputs',()=>{
  mkdirSync('.scratch',{recursive:true});const root=mkdtempSync(resolve('.scratch','manifest-test-'));
  try{
    cpSync('fixtures',resolve(root,'fixtures'),{recursive:true});mkdirSync(resolve(root,'tests/unit'),{recursive:true});writeFileSync(resolve(root,'tests/unit/fixtures.test.ts'),'');
    const sourcePath='Tiny_Mime_Review_Source_Pack/supplements/technical-test-fixtures-v1.json';mkdirSync(resolve(root,'Tiny_Mime_Review_Source_Pack/supplements'),{recursive:true});cpSync(sourcePath,resolve(root,sourcePath));
    for(const fixture of loadManifest().cases){mkdirSync(dirname(resolve(root,fixture.inputPath)),{recursive:true});cpSync(fixture.inputPath,resolve(root,fixture.inputPath));}
    const manifest=loadManifest(root),c=manifest.cases[0];expect(manifest.cases).toHaveLength(69);
    const write=(cases:unknown[])=>writeFileSync(resolve(root,'fixtures/manifest.json'),JSON.stringify({version:1,cases}));
    write(manifest.cases.slice(1));expect(()=>loadManifest(root)).toThrow('MANIFEST_HASH_MISMATCH');
    write([...manifest.cases,c]);expect(()=>loadManifest(root)).toThrow('MANIFEST_HASH_MISMATCH');
    cpSync('fixtures/manifest.json',resolve(root,'fixtures/manifest.json'));writeFileSync(resolve(root,c.inputPath),'changed');expect(()=>loadManifest(root)).toThrow('HASH_MISMATCH');
    rmSync(resolve(root,c.inputPath));expect(()=>loadManifest(root)).toThrow();
  }finally{rmSync(root,{recursive:true});}
});
it('requires exactly one actual passing test assertion per manifest case',()=>{
  expect(()=>assertConsumption([{id:'case'}],[])).toThrow('UNCONSUMED_TEST');
  expect(()=>assertConsumption([{id:'case'}],[{title:'case',status:'failed'}])).toThrow('UNCONSUMED_TEST');
  expect(()=>assertConsumption([{id:'case'}],[{title:'case',status:'passed'},{title:'case',status:'passed'}])).toThrow('UNCONSUMED_TEST');
  expect(()=>assertConsumption([{id:'case'}],[{title:'case',status:'passed'},{title:'case',status:'skipped'}])).toThrow('UNCONSUMED_TEST');
});
