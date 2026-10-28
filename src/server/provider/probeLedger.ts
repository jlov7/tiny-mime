import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from '../formats.js';
import schema from './probe-ledger-v1.schema.json' with { type: 'json' };
import { providerVersions, type AttemptRecord, type GenerateContext } from '../provider.js';
const ajv = new Ajv2020({strict:false}); addFormats(ajv); const valid=ajv.compile(schema);
export class ProbeLedger {
  readonly ledgerPath: string;
  private readonly expiresWallMs: number;
  constructor(private readonly directory: string, private readonly probeRunId: string, manifest: unknown, private readonly nowWall: () => number = Date.now) {
    mkdirSync(directory,{recursive:true,mode:0o700}); chmodSync(directory,0o700);
    this.purge();
    this.expiresWallMs=nowWall()+7*86400000;
    this.ledgerPath=join(directory,`${probeRunId}.jsonl`);
    writeFileSync(join(directory,`${probeRunId}.manifest.json`),JSON.stringify({manifest,manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),createdAt:new Date(nowWall()).toISOString(),retentionDays:7}),{flag:'wx',mode:0o600});
    writeFileSync(this.ledgerPath,'',{flag:'wx',mode:0o600});
  }
  private purge() {
    for (const file of readdirSync(this.directory)) {
      if (!/^[0-9a-f-]{36}\.manifest\.json$/.test(file)) continue;
      const path=join(this.directory,file);
      // Purge on startup and before each write. Failed purge is a hard failure.
      const manifest=JSON.parse(readFileSync(path,'utf8')) as {createdAt?:string};
      const created=Date.parse(manifest.createdAt ?? '');
      if (!Number.isFinite(created)) throw new Error('Probe retention timestamp invalid');
      if (this.nowWall()-created >= 7*86400000) {
        const ledger=path.replace(/\.manifest\.json$/,'.jsonl');
        if (existsSync(ledger)) unlinkSync(ledger);
        unlinkSync(path);
      }
    }
  }
  append(context:GenerateContext,caseId:string,record:AttemptRecord,priceSnapshotId:string,source:'runtime_generated'|'mock_fixture'='runtime_generated') {
    this.purge();
    if (this.nowWall()>=this.expiresWallMs) throw new Error('Probe raw retention expired');
    const result=record.result;
    const entry={version:1,probeRunId:this.probeRunId,caseId,attempt:record.attempt,source,generationProfile:context.generationProfile,modelId:result?.model ?? record.compiled.body.model,requestBodyJson:record.compiled.bodyJson,responseBodyBase64:result?.responseBytes ? Buffer.from(result.responseBytes).toString('base64') : null,providerRequestId:result?.providerRequestId ?? null,startedAt:record.startedAt,elapsedMs:record.elapsedMs,termination:record.termination,validationErrors:record.validationErrors,scoreHash:record.scoreHash,inputTokens:result?.inputTokens ?? null,outputTokens:result?.outputTokens ?? null,reservedMicroUsd:record.reservation.reservedMicroUsd,actualMicroUsd:source==='mock_fixture' ? 0 : record.actualMicroUsd,costStatus:source==='mock_fixture' ? 'mock_zero' : record.actualMicroUsd===null ? 'reserved_unknown' : 'known',promptVersion:providerVersions.promptVersion,schemaHash:providerVersions.schemaHash,meaningId:context.sceneMeaning.meaningId,contactPolicy:'noncontact-v1',priceSnapshotId};
    if (!valid(entry)) throw new Error('Probe diagnostic record rejected');
    appendFileSync(this.ledgerPath,JSON.stringify(entry)+'\n',{mode:0o600});
  }
}
