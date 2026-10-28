import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSubscriptionDiagnostic, subscriptionTerminalSummary } from '../src/server/provider/subscriptionDiagnostic.js';
export { runSubscriptionDiagnostic, subscriptionTerminalSummary };
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  runSubscriptionDiagnostic(process.argv.slice(2),process.env,undefined,controller.signal).then(receipt=>{
    process.stdout.write(JSON.stringify(subscriptionTerminalSummary(receipt))+'\n');if(receipt.status!=='COMPLETE')process.exitCode=1;
  }).catch(()=>{
    process.stderr.write(JSON.stringify({event:'subscription_diagnostic_blocked',status:'NOT RUN',reason:'Bounded owner authorization, pinned native CLI and explicit native-agent boundary acceptance are required'})+'\n');process.exitCode=1;
  }).finally(()=>{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);});
}
