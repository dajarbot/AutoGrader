const teacherFilePattern = /^(.+?)_42_F-/i

export function teacherNameFromSourceFile(sourceFileName: string): string {
  const fileName = sourceFileName.split(/[\\/]/).pop() ?? sourceFileName
  const match = fileName.match(teacherFilePattern)
  if (!match?.[1]) return ''

  const normalized = match[1]
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')

  return normalized.replace(/(^|[\s'-])([a-z])/g, (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`)
}
