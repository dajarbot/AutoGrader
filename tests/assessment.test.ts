import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAssessmentPages } from '../src/shared/parseStudentText'
import { octoberQuestions, octoberSharedNotes, questionMaterial } from '../src/shared/assessment'
import { AutoGraderDatabase } from '../src/main/database'
import { TELPAS_RUBRIC_KEY, telpasRubric } from '../src/shared/telpasRubric'
import { validateAndNormalizeResult } from '../src/main/grading'
import { assessmentSummaryRows } from '../src/shared/assessmentExport'
import { buildScoresWorkbook } from '../src/main/spreadsheetExport'
import { createServer } from '../src/main/server'
import type { ProviderStore } from '../src/main/providerStore'
import type { GradingWorker } from '../src/main/grading'
const page=(num:number,text:string)=>({num,text})
const pages=[page(1,'Student Name: Alex Example\nStudent ID: 1234567\nCR Item # 1 - Possible Points: 12\nStudent Response\nPeople are planting vegetables and helping their neighbors.'),page(2,'The plants provide fresh food and a place to work together.\nQuestion 2\nStudent Response\nTwo friends were sitting in a park when they found a lost dog.'),page(3,'They called its owner and everyone was happy.\nPage 3 of 4'),page(4,'Student Name: Taylor Example\nStudent ID: 7654321\nCommunity Garden\nStudent Response\nA garden can grow food for the entire neighborhood.')]
const score=(n:number)=>validateAndNormalizeResult({criteria:telpasRubric.criteria.map(c=>({key:c.key,score:n,comment:'Response evidence.'})),overallComment:'More detail would help.'},telpasRubric)

describe('two-question extraction',()=>{
 it('keeps question continuation text and students separate, creating a review slot for missing Q2',()=>{
  const answers=parseAssessmentPages(pages,octoberQuestions)
  expect(answers).toHaveLength(4)
  expect(answers[0]).toMatchObject({questionKey:'q1',studentIndex:1,pageNumber:1,pageEndNumber:2,issues:[]})
  expect(answers[0]!.responseText).toContain('fresh food')
  expect(answers[0]!.responseText).not.toContain('lost dog')
  expect(answers[1]).toMatchObject({questionKey:'q2',studentIndex:1,pageNumber:2,pageEndNumber:3,issues:[]})
  expect(answers[1]!.responseText).toContain('called its owner')
  expect(answers[2]!.studentId).toBe('7654321')
  expect(answers[3]!.responseText).toBe('')
  expect(answers[3]!.issues.join(' ')).toContain('was not identified')
 })
 it('never assigns an unlabeled multi-question response based on page position',()=>{
  const answers=parseAssessmentPages([page(1,'Student Name: Alex Example\nStudent ID: 1234567\nStudent Response\nThis answer has no question label.')],octoberQuestions)
  expect(answers.every(a=>a.responseText===''&&a.issues.length>0)).toBe(true)
  expect(answers[0]!.rawText).toContain('no question label')
 })
 it('preserves single-question behavior and uses the actual student grade in notes',()=>{
  expect(parseAssessmentPages(pages.slice(0,1),[{key:'q1',title:'Task'}])[0]!.responseText).toContain('planting')
  const assignment={questionText:'',questions:octoberQuestions,sharedScoringNotes:octoberSharedNotes}
  const q1=questionMaterial(assignment,{questionKey:'q1',grade:6}),q2=questionMaterial(assignment,{questionKey:'q2',grade:8})
  expect(q1).toContain('grade 6–7 guide');expect(q1).toContain('COMMUNITY GARDEN');expect(q1).not.toContain('LOST DOG')
  expect(q2).toContain('grade 8–9 guide');expect(q2).toContain('LOST DOG');expect(q2).not.toContain('COMMUNITY GARDEN')
 })
})

describe.skipIf(!process.versions.electron)('two-question persistence, review, and exports',()=>{
 let db:AutoGraderDatabase
 afterEach(()=>db?.close())
 function setup(){
  db=new AutoGraderDatabase(':memory:')
  const template=db.listTemplates().find(t=>t.templateKey===TELPAS_RUBRIC_KEY)!
  const assignment=db.createAssignment({name:'October test',grade:6,questionText:'Two tasks',questions:octoberQuestions,sharedScoringNotes:octoberSharedNotes,templateVersionId:template.id})
  const root=db.addImportedSubmission({assignmentId:assignment.id,sourcePath:'packet.pdf',sourceFileName:'packet.pdf',contentHash:'packet',grade:6}).submission
  db.replaceDocumentExtraction({rootSubmissionId:root.id,students:parseAssessmentPages(pages,octoberQuestions).map(a=>({...a,reviewedText:a.responseText,status:a.issues.length?'extraction_problem':'extracted',issueMessage:a.issues.join(' ')||null}))})
  return {assignment,template,root}
 }
 it('stores two answers per student, gates missing work, and scores/approves each independently',()=>{
  const {assignment}=setup();const answers=db.listSubmissions(assignment.id)
  expect(answers).toHaveLength(4);expect(new Set(answers.map(a=>a.studentIndex)).size).toBe(2)
  expect(db.acceptCleanExtractions(assignment.id)).toBe(3)
  expect(db.enqueueAllReadySubmissions(assignment.id,'mistral:latest')).toBe(3)
  let item;while((item=db.claimNextGradingAttempt())){expect(item.assignmentMaterial).toContain('GRADE 6 GUIDANCE');db.completeGradingAttempt(item.attemptId,score(3))}
  const first=answers.find(a=>a.studentIndex===1&&a.questionKey==='q1')!,second=answers.find(a=>a.studentIndex===1&&a.questionKey==='q2')!
  expect(db.getNextDraftScore(assignment.id,second.id)!.submission.questionKey).toBe('q2')
  db.approveDraftScore(first.id,score(3));expect(db.getSubmission(second.id)!.status).toBe('draft_scored')
  expect(()=>db.approveSubmissionExtraction({id:first.id,studentName:'Alex',studentId:'1234567',grade:6,reviewedText:'Changed'})).toThrow('unscored')
  const approved=db.exportScoreData(assignment.id,'approved');expect(approved.rows).toHaveLength(1)
  expect(assessmentSummaryRows(approved).find(r=>r.studentId==='1234567')!.combinedTotal).toBeNull()
  const all=db.exportScoreData(assignment.id,'all_scored');const summary=assessmentSummaryRows(all)
  expect(summary.find(r=>r.studentId==='1234567')).toMatchObject({combinedTotal:18,completion:'Includes AI draft'})
  expect(summary.find(r=>r.studentId==='7654321')!.combinedTotal).toBeNull()
  const workbook=buildScoresWorkbook(all);expect(workbook.worksheets[0]!.name).toBe('Student summary');expect(workbook.getWorksheet('Scores')!.rowCount).toBe(4)
  db.approveDraftScore(second.id,score(2));expect(assessmentSummaryRows(db.exportScoreData(assignment.id,'approved')).find(r=>r.studentId==='1234567')).toMatchObject({combinedTotal:15,completion:'Both approved'})
 })
 it('copies question snapshots and answer keys into new rubric runs without changing earlier approvals',()=>{
  const {assignment,template}=setup();db.acceptCleanExtractions(assignment.id);db.enqueueReadySubmissions(assignment.id,'mistral:latest');const item=db.claimNextGradingAttempt()!;db.completeGradingAttempt(item.attemptId,score(3));db.approveDraftScore(item.submissionId,score(3))
  const draft=db.createRubricDraft({sourceId:template.id});db.publishRubricDraft(draft.id)
  const copy=db.selectGradingRubric(assignment.id,draft.id)
  expect(copy.createdNewRun).toBe(true);expect(copy.assignment.questions).toEqual(octoberQuestions)
  expect(db.listSubmissions(copy.assignment.id).map(s=>s.questionKey).sort()).toEqual(['q1','q1','q2','q2'])
  expect(db.getSubmission(item.submissionId)!.status).toBe('approved')
 })
 it('records missing/unreadable without sending them to the model and rejects duplicate summary answers',async()=>{
  const {assignment}=setup();const missing=db.listSubmissions(assignment.id).find(s=>s.studentIndex===2&&s.questionKey==='q2')!
  const server=createServer(db,'test','unused',{} as ProviderStore,{} as GradingWorker)
  try{
   const response=await server.inject({method:'PUT',url:`/api/submissions/${missing.id}/extraction`,headers:{'x-autograder-token':'test'},payload:{studentName:'Taylor Example',studentId:'7654321',grade:6,reviewedText:'',responseDisposition:'missing'}})
   expect(response.statusCode).toBe(200);expect(response.json().status).toBe('extraction_problem')
   expect(db.acceptCleanExtractions(assignment.id)).toBe(3)
   expect(db.enqueueAllReadySubmissions(assignment.id,'mistral:latest')).toBe(3)
   let item;while((item=db.claimNextGradingAttempt()))db.completeGradingAttempt(item.attemptId,score(2))
   const data=db.exportScoreData(assignment.id,'all_scored');expect(assessmentSummaryRows(data).find(r=>r.studentId==='7654321')!.q2_status).toBe('Missing')
   data.submissions!.push({...data.submissions![0]!,id:'duplicate'})
   expect(assessmentSummaryRows(data).some(r=>Object.values(r).includes('Duplicate answers — review required')&&r.combinedTotal===null)).toBe(true)
  }finally{await server.close()}
 })
 it('migrates existing single-question records and approvals without changing them',()=>{
  mkdirSync('tmp',{recursive:true});const path=`tmp/migration-${randomUUID()}.sqlite`
  db=new AutoGraderDatabase(path)
  const template=db.listTemplates()[0]!
  const assignment=db.createAssignment({name:'Existing work',grade:8,questionText:'Existing prompt',templateVersionId:template.id})
  const submission=db.addImportedSubmission({assignmentId:assignment.id,sourcePath:'old.pdf',sourceFileName:'old.pdf',contentHash:'old',grade:8}).submission
  db.approveSubmissionExtraction({id:submission.id,studentName:'Existing Student',studentId:'1234567',grade:8,reviewedText:'Original response.'})
  db.enqueueReadySubmissions(assignment.id,'mistral:latest');const item=db.claimNextGradingAttempt()!
  const result=validateAndNormalizeResult({criteria:template.rubric.criteria.map(c=>({key:c.key,score:1,comment:'Original comment.'})),overallComment:'Original feedback.'},template.rubric)
  db.completeGradingAttempt(item.attemptId,result);db.approveDraftScore(submission.id,result)
  db.db.exec(`DROP INDEX idx_submissions_source_student; ALTER TABLE submissions DROP COLUMN question_key; ALTER TABLE submissions DROP COLUMN response_disposition; ALTER TABLE assignments DROP COLUMN questions_json; ALTER TABLE assignments DROP COLUMN shared_scoring_notes;`)
  db.close();db=new AutoGraderDatabase(path)
  expect(db.getSubmission(submission.id)).toMatchObject({questionKey:'q1',status:'approved',reviewedText:'Original response.'})
  expect(db.getAssignment(assignment.id)!.questionText).toBe('Existing prompt')
  expect(db.exportScoreData(assignment.id,'approved').rows[0]!.result).toEqual(result)
  db.close();db=undefined as unknown as AutoGraderDatabase
  for(const suffix of ['', '-wal', '-shm'])rmSync(path+suffix,{force:true})
 })
 it('propagates grades across unscored sibling answers and preserves marked-missing work on re-extraction',async()=>{
  const {assignment}=setup();const answers=db.listSubmissions(assignment.id);const q1=answers.find(s=>s.studentIndex===1&&s.questionKey==='q1')!
  db.approveSubmissionExtraction({id:q1.id,studentName:'Alex Example',studentId:'1234567',grade:7,reviewedText:q1.reviewedText!})
  expect(db.listSubmissions(assignment.id).filter(s=>s.studentIndex===1).every(s=>s.grade===7)).toBe(true)
  const q2=db.listSubmissions(assignment.id).find(s=>s.studentIndex===2&&s.questionKey==='q2')!
  db.approveSubmissionExtraction({id:q2.id,studentName:'Taylor Example',studentId:'7654321',grade:6,reviewedText:'',responseDisposition:'unreadable'})
  const server=createServer(db,'test','unused',{} as ProviderStore,{} as GradingWorker)
  try {
   const r=await server.inject({method:'POST',url:`/api/assignments/${assignment.id}/submissions/extract`,headers:{'x-autograder-token':'test'},payload:{}})
   expect(r.statusCode).toBe(200);expect(r.json().extracted).toBe(0)
   expect(db.getSubmission(q2.id)!.responseDisposition).toBe('unreadable')
  }finally{await server.close()}
 })

})
