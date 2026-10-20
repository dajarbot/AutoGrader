export interface ParsedStudentText {
  studentName: string | null
  studentId: string | null
  responseText: string
  issues: string[]
  foundResponseMarker: boolean
}

const footerPatterns = [
  /^page\s+\d+\s+(?:of\s+)?\d+$/i,
  /^(?:printed|generated|submitted)\s*(?:on|at|:)/i,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}.*)?$/i,
  /^(?:https?:\/\/|www\.)/i,
  /^\d{2}-\d{2}_[A-Za-z0-9 _-]+$/
]

export function parseStudentText(fullText: string): ParsedStudentText {
  const lines = String(fullText || '').replace(/\r/g, '').split('\n')
  const markerIndex = lines.findIndex((line) => /^\s*student\s+response\b/i.test(line))
  const identity = parseIdentity(lines.slice(0, Math.min(30, markerIndex < 0 ? 30 : markerIndex)))
  let responseLines: string[] = []
  let foundResponseMarker = false

  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index]!.match(/^\s*student\s+response\s*:?\s*(.*)$/i)
    if (!marker) continue
    foundResponseMarker = true
    if (marker[1]) responseLines.push(marker[1])
    responseLines.push(...lines.slice(index + 1))
    break
  }

  if (!foundResponseMarker) {
    const headerIndexes = lines.slice(0, 30)
      .map((line, index) => isIdentityLine(line) ? index : -1)
      .filter((index) => index >= 0)
    const lastHeaderIndex = headerIndexes.at(-1) ?? -1
    responseLines = lines.slice(lastHeaderIndex + 1)
  }

  const responseText = cleanResponse(responseLines)
  const issues: string[] = []
  if (!identity.studentName) issues.push('Student name was not found in the document header.')
  if (!identity.studentId) issues.push('Student ID was not found in the document header.')
  if (!foundResponseMarker) issues.push('The “Student Response” marker was not found; review the extracted boundary.')
  if (!responseText) issues.push('No student response text was extracted.')
  else if (responseText.length < 20) issues.push('The extracted response is unusually short.')

  return {
    studentName: identity.studentName,
    studentId: identity.studentId,
    responseText,
    issues,
    foundResponseMarker
  }
}

function parseIdentity(lines: string[]): { studentName: string | null; studentId: string | null } {
  const text = lines.join('\n')
  const labeledName = text.match(/(?:student\s*name|name)\s*:\s*([^\n]+)/i)?.[1]?.trim()
  const labeledId = text.match(/(?:student\s*id|id|student\s*#|student\s*number)\s*:\s*([A-Za-z]?\d{5,15})/i)?.[1]?.trim()
  if (labeledName || labeledId) return { studentName: labeledName || null, studentId: labeledId || null }

  for (const line of lines) {
    const match = line.trim().match(/^(.+?)\s*-\s*([A-Za-z]?\d{5,15})\b/)
    if (match) return { studentName: match[1]!.trim(), studentId: match[2]!.trim() }
  }
  return { studentName: null, studentId: null }
}

function isIdentityLine(line: string): boolean {
  return /(?:student\s*name|^name|^student)\s*:/i.test(line) ||
    /(?:student\s*id|^id|student\s*#|student\s*number)\s*:/i.test(line) ||
    /^(.+?)\s*-\s*([A-Za-z]?\d{5,15})\b/.test(line.trim())
}

function cleanResponse(input: string[]): string {
  const lines = [...input]
  while (lines.length && !lines[0]!.trim()) lines.shift()
  while (lines.length && !lines.at(-1)!.trim()) lines.pop()

  const copyrightIndex = lines.findIndex((line) => /(?:©|copyright\b)/i.test(line))
  if (copyrightIndex >= 0) lines.splice(copyrightIndex)
  while (lines.length && footerPatterns.some((pattern) => pattern.test(lines.at(-1)!.trim()))) lines.pop()

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface ParsedStudentPages extends ParsedStudentText {
  rawText: string
  pageNumber: number
  pageEndNumber: number
}

// Strip report furniture per page, before joining: otherwise the first copyright
// footer would discard the rest of a student's multi-page response.
function cleanPage(text: string): string {
  return text.split('\n').filter((line) =>
    !footerPatterns.some((pattern) => pattern.test(line.trim())) &&
    !/^page\s+\d+\s+of\s+\d+\b/i.test(line.trim()) &&
    !/^\s*(?:©|copyright\b)/i.test(line)
  ).join('\n').trim()
}

export function parseStudentPages(pages: Array<{ text: string; num: number }>): ParsedStudentPages[] {
  const groups: Array<{ texts: string[]; raw: string[]; start: number; end: number; name: string | null; id: string | null }> = []
  for (const page of pages) {
    const cleaned = cleanPage(page.text)
    if (!cleaned) {
      const previous = groups.at(-1)
      if (previous) { previous.end = page.num; previous.raw.push(page.text) }
      continue
    }
    // Identity belongs to the header, not quoted content in the response.
    const header = cleaned.split('\n').slice(0, 5)
    const boundary = header.findIndex((line) => /^\s*(?:student\s+response|CR Item\s*#)/i.test(line))
    const identity = parseIdentity(boundary < 0 ? header : header.slice(0, boundary))
    const previous = groups.at(-1)
    const hasIdentity = Boolean(identity.studentName || identity.studentId)
    const sameStudent = previous && (identity.studentId
      ? identity.studentId === previous.id
      : identity.studentName === previous.name)
    if (!previous || (hasIdentity && !sameStudent)) {
      groups.push({ texts: [cleaned], raw: [page.text], start: page.num, end: page.num,
        name: identity.studentName, id: identity.studentId })
    } else {
      // Repeated headers on continuation pages are not student writing.
      const continuation = cleaned.split('\n').filter((line, index) =>
        !(hasIdentity && index < 5 && isIdentityLine(line)) &&
        !/^\s*CR Item\s*#.*Possible Points:/i.test(line) &&
        !/^\s*student\s+response\s*:?\s*$/i.test(line)
      ).join('\n')
      // Keep the first response marker even when it is on a later page.
      const alreadyStarted = previous.texts.some((text) => /^\s*student\s+response\s*:?.*$/im.test(text))
      previous.texts.push(alreadyStarted ? continuation : cleaned)
      previous.raw.push(page.text)
      previous.end = page.num
    }
  }
  return groups.map((group) => {
    const parsed = parseStudentText(group.texts.join('\n\n'))
    // Never interpret an item heading as an answer when the marker is absent.
    if (!parsed.foundResponseMarker) {
      parsed.responseText = parsed.responseText.split('\n').filter((line) => !/^\s*CR Item\s*#.*Possible Points:/i.test(line)).join('\n').trim()
      if (!parsed.responseText && !parsed.issues.includes('No student response text was extracted.')) parsed.issues.push('No student response text was extracted.')
    }
    return { ...parsed, rawText: group.raw.join('\n\n'), pageNumber: group.start, pageEndNumber: group.end }
  })
}
