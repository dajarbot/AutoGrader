// Reproducible direct-scoring comparison using the frozen official calibration inputs.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const thinking=process.argv.includes('--thinking');
const settings={temperature:0,num_ctx:thinking?16384:8192,num_predict:thinking?8192:2048,think:thinking};
const root=thinking?'output/telpas/reasoning-comparison':'output/telpas/model-comparison';await mkdir(root,{recursive:true});
const runtime=resolve('tmp/model-comparison-runtime');await mkdir(runtime,{recursive:true});
for(const file of ['src/main/grading.ts','src/main/providerStore.ts','src/shared/rubricValidation.ts']){
 const code=stripTypeScriptTypes(await readFile(file,'utf8'),{mode:'transform'}).replace(/from ['"]\.\.?\/([^'"]+)['"]/g,(_,p)=>`from './${basename(p)}.mjs'`);
 await writeFile(resolve(runtime,basename(file,'.ts')+'.mjs'),code);
}
const {buildOllamaRequest,validateAndNormalizeResult}=await import(pathToFileURL(resolve(runtime,'grading.mjs')));
const source=JSON.parse(await readFile('output/telpas/multi-question-calibration.json','utf8'));
const examples=source.rows.filter(r=>!r.references);if(examples.length!==115||new Set(examples.map(r=>r.id)).size!==115)throw Error('Unexpected evaluation set');
const api=async(path,body)=>{const r=await fetch('http://127.0.0.1:11434/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error(`Ollama ${r.status}: ${await r.text()}`);return r.json();};
const models=process.argv.slice(2).filter(a=>a!=='--thinking');if(!models.length)models.push('mistral:latest','gemma4:latest','qwen3.5:9b');
for(const model of models){
 const tag=(await api('tags')).models.find(t=>t.name===model);if(!tag)throw Error('Model not installed: '+model);
 const info=await api('show',{model});const output=`${root}/${model.replaceAll(':','-')}.json`;
 let data;try{data=JSON.parse(await readFile(output,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const datasetHash=createHash('sha256').update(JSON.stringify(examples.map(r=>({id:r.id,responseText:r.responseText,assignmentMaterial:r.assignmentMaterial,expected:r.expected})))).digest('hex');
 if(data&&(data.metadata.model.digest!==tag.digest||data.metadata.datasetHash!==datasetHash||JSON.stringify(data.metadata.settings)!==JSON.stringify(settings)))throw Error('Resume metadata mismatch');
 data??={metadata:{startedAt:new Date().toISOString(),model:tag,modelInfo:info,ollamaVersion:await api('version'),datasetHash,rubric:source.metadata.rubric,excludedIds:source.metadata.excludedIds,settings,mode:thinking?'reasoning':'direct',reasoningNote:thinking?'Thinking enabled; context 16384 and output allowance 8192 to accommodate reasoning. Compared against prior direct runs with context 8192 and output allowance 2048; this is a configuration comparison, not an isolated thinking-toggle experiment.':undefined,method:'115 identical official examples previously held out from the demonstration bank. No reference examples; temperature 0; explicit thinking control recorded in settings. Text descriptions of stimuli, not images. Official scores withheld from requests. Grade 6 represents band 6–7 and grade 8 represents 8–9. General scoring notes were developed from these guides; not a fully independent benchmark. One request per example, failures retained, no accuracy-driven retries.'},rows:[]};
 await writeFile(output,JSON.stringify(data,null,2));
 // Warm up without any official example or scoring labels; exclude load time from timed trials.
 if(data.rows.length<examples.length){await api('chat',{model,messages:[{role:'user',content:'Reply with OK.'}],think:false,stream:false,options:{num_ctx:settings.num_ctx,num_predict:32}});data.metadata.loadedModels=await api('ps');}
 for(const example of examples){if(data.rows.some(r=>r.id===example.id))continue;
 const request=buildOllamaRequest({attemptId:'eval',submissionId:example.id,modelName:model,grade:example.grade,assignmentMaterial:example.assignmentMaterial,responseText:example.responseText,rubric:source.metadata.rubric});
 if(thinking&&!info.capabilities?.includes('thinking'))throw Error('Thinking not supported');
 if(info.capabilities?.includes('thinking'))request.think=thinking;
 request.options.num_ctx=settings.num_ctx;request.options.num_predict=settings.num_predict;
 const row={id:example.id,grade:example.grade,band:example.band,question:example.question,page:example.page,expected:example.expected,total:example.total,responseText:example.responseText,request,requestHash:createHash('sha256').update(JSON.stringify(request)).digest('hex')};const started=Date.now();
 try{const p=await api('chat',request);row.usage={promptTokens:p.prompt_eval_count,outputTokens:p.eval_count,totalDurationNs:p.total_duration,loadDurationNs:p.load_duration,doneReason:p.done_reason};row.rawContent=p.message?.content;row.thinkingCharacters=p.message?.thinking?.length??0;if(p.error||p.done_reason==='length')throw Error(p.error||'Output truncated');row.result=validateAndNormalizeResult(JSON.parse(p.message.content),source.metadata.rubric);}catch(e){row.error=String(e);}
 row.elapsedMs=Date.now()-started;data.rows.push(row);await writeFile(output,JSON.stringify(data,null,2));console.log(`${model} ${data.rows.length}/115 ${example.id}: official ${row.total}, model ${row.result?.totalScore??row.error}, ${(row.elapsedMs/1000).toFixed(1)}s`);
 }
 data.metadata.completedAt=new Date().toISOString();await writeFile(output,JSON.stringify(data,null,2));await api('generate',{model,keep_alive:0});
}
console.log('Comparison finished.');
