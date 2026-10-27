import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'
import { parseAssessmentPages, type ParsedStudentText } from '../shared/parseStudentText'

export interface ExtractedStudentPage extends ParsedStudentText {
  questionKey?: string
  studentIndex?: number
  responseDisposition?: 'response' | 'missing'
  rawText: string
  pageNumber: number
  pageEndNumber: number
}

export async function extractStudentPdf(path: string, questions: Array<{ key: string; title: string }> = [{ key: 'q1', title: 'Question 1' }]): Promise<ExtractedStudentPage[]> {
  const data = await readFile(path)
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText()
    return parseAssessmentPages(result.pages, questions)
  } finally {
    await parser.destroy()
  }
}

export async function renderPdfPage(path: string, pageNumber: number): Promise<{
  dataUrl: string
  width: number
  height: number
}> {
  const data = await readFile(path)
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getScreenshot({
      partial: [pageNumber],
      desiredWidth: 1100,
      imageDataUrl: true,
      imageBuffer: false
    })
    const page = result.pages[0]
    if (!page?.dataUrl) throw new Error(`Page ${pageNumber} could not be rendered.`)
    return { dataUrl: page.dataUrl, width: page.width, height: page.height }
  } finally {
    await parser.destroy()
  }
}
