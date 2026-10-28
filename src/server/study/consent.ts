import { createHmac, randomBytes } from 'node:crypto';
export function withdrawalCode():string { const bytes=randomBytes(16);const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=alphabet[(value<<(5-bits))&31];return out; }
export function withdrawalLookup(code:string,key:string):string{return createHmac('sha256',key).update(code).digest('hex');}
