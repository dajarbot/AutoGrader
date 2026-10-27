// Paired calibration on examples excluded from the official demonstration bank.
import { stripTypeScriptTypes } from 'node:module'
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { resolve,basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const work=resolve('tmp/multi-eval-runtime');await mkdir(work,{recursive:true})
for(const file of ['src/main/grading.ts','src/main/providerStore.ts','src/shared/rubricValidation.ts','src/shared/telpasRubric.ts','src/shared/assessment.ts','src/shared/telpasReferences.ts']) {
 const code=stripTypeScriptTypes(await readFile(file,'utf8'),{mode:'transform'}).replace(/from ['"]\.\.?\/([^'"]+)['"]/g,(_,name)=>`from './${basename(name)}.mjs'`)
 await writeFile(resolve(work,basename(file,'.ts')+'.mjs'),code)
}
const {buildOllamaRequest,validateAndNormalizeResult}=await import(pathToFileURL(resolve(work,'grading.mjs')))
const {telpasRubric}=await import(pathToFileURL(resolve(work,'telpasRubric.mjs')))
const {questionMaterial,octoberQuestions,octoberSharedNotes}=await import(pathToFileURL(resolve(work,'assessment.mjs')))
const {telpasReferences}=await import(pathToFileURL(resolve(work,'telpasReferences.mjs')))
const prompts=JSON.parse(await readFile('output/telpas/reference-prompts.json','utf8'))
const all=[...JSON.parse(await readFile('output/telpas/grade67-examples.json','utf8')).map(r=>({...r,grade:6,band:'6–7'})),...JSON.parse(await readFile('output/telpas/examples.json','utf8')).map(r=>({...r,grade:8,band:'8–9'}))]
const excluded=new Set(telpasReferences.map(r=>r.id));const examples=all.filter(r=>!excluded.has(r.id))
const metadata={model:process.argv[2]||'mistral:latest',startedAt:new Date().toISOString(),excludedIds:[...excluded],rubric:telpasRubric,prompts,gradeNote:'Grade 6 represents the 6–7 band; grade 8 represents 8–9. Individual student grades are not supplied by the guides.',method:'Paired single runs on all non-demonstration examples. Same application question material, notes, request builder and validation for both modes. Target labels and annotations withheld. Reference examples are excluded from both evaluation modes. New garden/park prompts have no teacher-scored reference answers yet.'}
metadata.modelInfo=await (await fetch('http://127.0.0.1:11434/api/tags')).json()
const rows=[];const output='output/telpas/multi-question-calibration.json'
await writeFile(output,JSON.stringify({metadata,rows},null,2))
for(const example of examples) for(const references of [false,true]) {
 const genre=example.question===36?'narrative':'expository'
 const question={...structuredClone(octoberQuestions[genre==='narrative'?1:0]),key:'q1',title:`Official guide question ${example.question}`,prompt:prompts[example.question],stimulusDescription:'',stimulusAsset:undefined,scoringNotes:'Apply the genre and all parts of the supplied official prompt. Do not add task-specific requirements.',referenceExamples:references}
 const material=questionMaterial({questionText:question.prompt,questions:[question],sharedScoringNotes:octoberSharedNotes},{questionKey:'q1',grade:example.grade})
 const request=buildOllamaRequest({attemptId:'eval',submissionId:example.id,modelName:metadata.model,grade:example.grade,assignmentMaterial:material,responseText:example.responseText,rubric:telpasRubric})
 const row={...example,genre,references,requestHash:createHash('sha256').update(JSON.stringify(request)).digest('hex'),assignmentMaterial:material};const started=Date.now()
 try {
  const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(600000)})
  if(!response.ok)throw new Error(`HTTP ${response.status}`)
  const p=await response.json();if(p.error||p.done_reason==='length')throw new Error(p.error||'Output truncated')
  row.result=validateAndNormalizeResult(JSON.parse(p.message.content),telpasRubric);row.promptEvalCount=p.prompt_eval_count
 }catch(error){row.error=String(error)}
 row.elapsedMs=Date.now()-started;rows.push(row)
 console.log(`${rows.length}/${examples.length*2} ${example.id} refs=${references}: official ${example.total} model ${row.result?.totalScore??row.error}`)
 await writeFile(output,JSON.stringify({metadata,rows},null,2))
}
metadata.completedAt=new Date().toISOString();await writeFile(output,JSON.stringify({metadata,rows},null,2));console.log('Complete: '+output)
