import { StudyService } from '../src/server/study/service.js';
import { validateContract, validateFreeze, type RatingImport, type StudyRun, type ProtocolFreeze, type StudyApprovalEvidence, type StudyScene } from '../src/server/study/contracts.js';
import { initializeResearchDatabase, openResearchDatabase, assertCliRun, readRatingFile, receipt, cliError } from '../src/server/study/cli.js';
let db:ReturnType<typeof openResearchDatabase>|undefined;
try {
  const args=process.argv.slice(2),fixture=args[0]==='--fixture';if(fixture)args.shift();
  if(!fixture&&args[0]==='--freeze'&&args.length===5){
    const manifest=readRatingFile(args[1]!) as StudyRun,binding=readRatingFile(args[2]!) as ProtocolFreeze,evidence=readRatingFile(args[3]!) as StudyApprovalEvidence,categories=readRatingFile(args[4]!) as Record<string,'physical'|'social'>;
    validateContract('run',manifest);validateFreeze(binding,evidence);
    const sceneBankModule='../src/server/operator/sceneBank.js';const {listScenes}=await import(sceneBankModule);
    const catalogue:StudyScene[]=listScenes().map((scene:{id:string;meaning:Record<string,unknown>;scoreHash:string;score:unknown;authorship:{authoringMethod:StudyScene['authoringMethod'];humanReview:StudyScene['humanReview']}})=>{if(!['physical','social'].includes(categories[scene.id]!))throw new Error('categories');return {sceneId:scene.id,meaning:scene.meaning,rubric:scene.meaning.targetRubric,scoreHash:scene.scoreHash,score:scene.score,category:categories[scene.id]!,authoringMethod:scene.authorship.authoringMethod,humanReview:scene.authorship.humanReview};});
    db=initializeResearchDatabase();
    receipt({status:'frozen',...new StudyService(db,{catalogue}).freezeRun(manifest,binding,evidence)});
  }else{
    db=openResearchDatabase(fixture);
    if(!fixture&&args[0]==='--read-run'&&args.length===2){assertCliRun(db,args[1]!);const result=new StudyService(db).readRun(args[1]!);receipt({status:'readback',...result});}
    else if(args.length===1&&!args[0]!.startsWith('--')){const input=readRatingFile(args[0]!) as RatingImport;validateContract('ratings',input);assertCliRun(db,input.studyRunId,fixture);receipt({status:'imported',...new StudyService(db).importRatings(input)});}
    else throw new Error('usage');
  }
}catch(error){cliError(error);}finally{db?.close();}
