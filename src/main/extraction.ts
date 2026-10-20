import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'
import { parseStudentText, type ParsedStudentText } from '../shared/parseStudentText'

export interface ExtractedStudentPage extends ParsedStudentText {
  rawText: string
  pageNumber: number
}

export async function extractStudentPdf(path: string): Promise<ExtractedStudentPage[]> {
  const data = await readFile(path)
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText()
    return result.pages
      .map((page) => {
        const rawText = page.text.trim()
        return { ...parseStudentText(rawText), rawText, pageNumber: page.num }
      })
      .filter((page) => page.rawText || page.responseText)
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
