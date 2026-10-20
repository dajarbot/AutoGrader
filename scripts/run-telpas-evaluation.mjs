// Run with: node scripts/run-telpas-evaluation.mjs [model]
// Uses the actual app request builder and validator. Official labels/comments
// are never sent to the model. The input examples are extracted from the guide.
import { stripTypeScriptTypes } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const work = resolve('tmp/telpas-evaluation-runtime')
await mkdir(work, { recursive: true })
for (const file of ['src/main/grading.ts', 'src/main/providerStore.ts', 'src/shared/rubricValidation.ts', 'src/shared/telpasRubric.ts']) {
  const source = await readFile(file, 'utf8')
  const result = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/from ['"]\.\.?\/([^'"]+)['"]/g, (_, name) => `from './${basename(name)}.mjs'`)
  await writeFile(resolve(work, basename(file, '.ts') + '.mjs'), result)
}
const { buildOllamaRequest, validateAndNormalizeResult } = await import(pathToFileURL(resolve(work, 'grading.mjs')))
const { telpasRubric } = await import(pathToFileURL(resolve(work, 'telpasRubric.mjs')))
const model = process.argv[2] || 'mistral:latest'
const examples = JSON.parse(await readFile('output/telpas/examples.json', 'utf8'))
const prompts = {
  18: 'Think about the foods you most like to eat.\nWhat are five of your favorite foods? Why do you like these foods?\nWould you rather have to eat only these five foods every day for a month or not eat any of these five foods for a month? Explain your decision.',
  28: 'Stimulus: A line graph titled "Number of Vehicles in the United States (millions)". The x-axis is Year (2016, 2017, 2018, 2019). The y-axis is Number of Vehicles (millions), with labeled ticks from 264 to 280 in increments of 2. Red points connected by straight red lines are labeled: 2016: 268.8; 2017: 272.5; 2018: 273.6; 2019: 276.5.\nDescribe this line graph. What conclusions can you make from the data shown?\nIn which year did the number of vehicles in the United States grow the most? How do you know?\nBased on this graph, explain two things you think will happen in the next five years.'
}
const metadata = { model, startedAt: new Date().toISOString(), source: '2025 TELPAS grades 8–9 writing scoring guide, pages 11–41 and 43–73', gradeContext: 8, graph: 'Text transcription visually verified against page 42', prompts, rubric: telpasRubric, labelsWithheld: true, examplesUsedAsFewShot: false, rubricHash: createHash('sha256').update(JSON.stringify(telpasRubric)).digest('hex') }
const output = `output/telpas/${model.replace(/[^a-z0-9-]/gi, '-')}-results.json`
const rows = []
await writeFile(output, JSON.stringify({ metadata, rows }, null, 2))
for (const example of examples) {
  const started = Date.now()
  const request = buildOllamaRequest({ attemptId: 'evaluation', submissionId: example.id, modelName: model, grade: 8, assignmentMaterial: prompts[example.question], responseText: example.responseText, rubric: telpasRubric })
  try {
    const response = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(600000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    const payload = await response.json()
    if (payload.error || payload.done_reason === 'length') throw new Error(payload.error || 'Output limit reached')
    const result = validateAndNormalizeResult(JSON.parse(payload.message.content), telpasRubric)
    rows.push({ ...example, result, elapsedMs: Date.now() - started, promptEvalCount: payload.prompt_eval_count, evalCount: payload.eval_count })
    console.log(`${rows.length}/${examples.length} ${example.id}: official ${example.total}; model ${result.totalScore}; ${((Date.now()-started)/1000).toFixed(1)}s`)
  } catch (error) {
    rows.push({ ...example, error: String(error), elapsedMs: Date.now() - started })
    console.log(`${rows.length}/${examples.length} ${example.id}: ERROR ${error}`)
  }
  await writeFile(output, JSON.stringify({ metadata, rows }, null, 2))
}
metadata.completedAt = new Date().toISOString()
await writeFile(output, JSON.stringify({ metadata, rows }, null, 2))
console.log(`Complete: ${output}`)
