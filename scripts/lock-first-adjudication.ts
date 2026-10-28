import { StudyService } from '../src/server/study/service.js';
import { openResearchDatabase, assertCliRun, receipt, cliError } from '../src/server/study/cli.js';
let db:ReturnType<typeof openResearchDatabase>|undefined;
try {const args=process.argv.slice(2),fixture=args[0]==='--fixture';if(fixture)args.shift();if(args.length!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args[0]!))throw new Error('usage');db=openResearchDatabase(fixture);assertCliRun(db,args[0]!,fixture);receipt({status:'locked',...new StudyService(db).lockFirst(args[0]!)});}catch(error){cliError(error);}finally{db?.close();}
