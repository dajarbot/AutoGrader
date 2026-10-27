import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { AutoGraderDatabase } from './database'
import { GradingWorker } from './grading'
import { ProviderStore } from './providerStore'
import { createServer } from './server'
import { writeScoresWorkbook } from './spreadsheetExport'
import { readTeacherReviewWorkbook } from './teacherReviewImport'
import type { FastifyInstance } from 'fastify'
import type {
  SelectedPdfFile,
  ServiceConnection,
  SpreadsheetExportResult,
  SpreadsheetExportScope,
  TeacherReviewImportCounts,
  TeacherReviewImportResult
} from '../shared/contracts'

let database: AutoGraderDatabase | undefined
let service: FastifyInstance | undefined
let connection: ServiceConnection | undefined

function emptyTeacherReviewCounts(): TeacherReviewImportCounts {
  return {
    reviewed: 0,
    accepted: 0,
    corrected: 0,
    needsFollowUp: 0,
    unscorable: 0,
    extractionProblems: 0,
    untouched: 0,
    invalid: 0,
    conflicts: 0,
    duplicates: 0
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f2ed',
    title: 'AutoGrader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function startLocalService(): Promise<void> {
  database = new AutoGraderDatabase(join(app.getPath('userData'), 'autograder.sqlite'))
  const providerStore = new ProviderStore(join(app.getPath('userData'), 'secure', 'grading-provider.json'))
  const gradingWorker = new GradingWorker(database)
  const token = randomBytes(32).toString('hex')
  service = createServer(
    database,
    token,
    join(app.getPath('userData'), 'workspace-files'),
    providerStore,
    gradingWorker
  )
  const address = await service.listen({ host: '127.0.0.1', port: 0 })
  connection = { baseUrl: address, token }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.autograder.desktop')
  ipcMain.handle('service:connection', () => connection)
  ipcMain.handle('files:choose-pdfs', async (): Promise<SelectedPdfFile[]> => {
    const result = await dialog.showOpenDialog({
      title: 'Import student response PDFs',
      buttonLabel: 'Import PDFs',
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async (path) => {
      const details = await stat(path)
      return { path, name: path.split(/[\\/]/).pop() ?? path, size: details.size }
    }))
  })
  ipcMain.handle('files:export-scores', async (
    _event,
    assignmentId: string,
    scope: SpreadsheetExportScope
  ): Promise<SpreadsheetExportResult> => {
    if (!database) throw new Error('The local workspace is not ready.')
    if (scope !== 'approved' && scope !== 'all_scored') throw new Error('Unknown spreadsheet export type.')
    const data = database.exportScoreData(assignmentId, scope)
    if (!data.rows.length) {
      throw new Error(scope === 'approved'
        ? 'Approve at least one score before exporting approved results.'
        : 'No scored responses are available to export yet.')
    }
    const safeName = data.assignmentName
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'assignment'
    const label = scope === 'approved' ? 'approved-results' : 'all-scored-with-drafts'
    const result = await dialog.showSaveDialog({
      title: 'Export scores spreadsheet',
      buttonLabel: 'Export spreadsheet',
      defaultPath: join(app.getPath('documents'), `${safeName}-${label}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { cancelled: true, rowCount: 0 }
    await writeScoresWorkbook(data, result.filePath)
    return { cancelled: false, filePath: result.filePath, rowCount: data.rows.length }
  })
  ipcMain.handle('files:import-teacher-reviews', async (
    _event,
    assignmentId: string
  ): Promise<TeacherReviewImportResult> => {
    if (!database) throw new Error('The local workspace is not ready.')
    const selected = await dialog.showOpenDialog({
      title: 'Import completed teacher review workbook',
      buttonLabel: 'Review workbook',
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      properties: ['openFile']
    })
    if (selected.canceled || !selected.filePaths[0]) {
      return { ...emptyTeacherReviewCounts(), cancelled: true, applied: false }
    }

    const filePath = selected.filePaths[0]
    const fileName = basename(filePath)
    const workbookHash = createHash('sha256').update(await readFile(filePath)).digest('hex')
    if (database.hasTeacherReviewImport(workbookHash)) {
      const counts = emptyTeacherReviewCounts()
      counts.duplicates = 1
      await dialog.showMessageBox({
        type: 'info',
        title: 'Workbook already imported',
        message: 'No changes were made.',
        detail: `${fileName} has already been imported into this workspace.`
      })
      return {
        ...counts,
        cancelled: false,
        applied: false,
        fileName,
        message: 'This workbook was already imported. No changes were made.'
      }
    }

    const preview = await readTeacherReviewWorkbook(
      filePath,
      assignmentId,
      database.teacherReviewImportContext(assignmentId)
    )
    if (preview.issues.length) {
      const issueDetails = preview.issues.slice(0, 8)
        .map((issue) => `${issue.rowNumber ? `Row ${issue.rowNumber}: ` : ''}${issue.message}`)
        .join('\n')
      const more = preview.issues.length > 8 ? `\n…and ${preview.issues.length - 8} more issue(s).` : ''
      await dialog.showMessageBox({
        type: 'error',
        title: 'Teacher review workbook needs correction',
        message: 'No changes were made.',
        detail: `${issueDetails}${more}`
      })
      return {
        ...preview.counts,
        cancelled: false,
        applied: false,
        fileName,
        message: 'Fix the listed workbook issues, then import it again.'
      }
    }
    if (!preview.rows.length) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'No completed reviews found',
        message: 'No changes were made.',
        detail: 'Choose a review decision and enter reviewer initials for each row you want to import.'
      })
      return {
        ...preview.counts,
        cancelled: false,
        applied: false,
        fileName,
        message: 'The workbook did not contain any completed review rows.'
      }
    }

    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: 'Apply teacher reviews?',
      message: `Apply ${preview.counts.reviewed} reviewed row${preview.counts.reviewed === 1 ? '' : 's'} from ${fileName}?`,
      detail: [
        `Accept AI: ${preview.counts.accepted}`,
        `Corrected: ${preview.counts.corrected}`,
        `Needs follow-up: ${preview.counts.needsFollowUp}`,
        `Unscorable: ${preview.counts.unscorable}`,
        `Extraction problem: ${preview.counts.extractionProblems}`,
        `Untouched rows: ${preview.counts.untouched}`
      ].join('\n'),
      buttons: ['Apply reviews', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (confirmation.response !== 0) {
      return { ...preview.counts, cancelled: true, applied: false, fileName }
    }

    const counts = database.applyTeacherReviewImport(preview, fileName, workbookHash)
    return {
      ...counts,
      cancelled: false,
      applied: true,
      fileName,
      message: `Applied ${counts.reviewed - counts.duplicates} teacher review${counts.reviewed - counts.duplicates === 1 ? '' : 's'}.`,
      summary: database.gradingQueueSummary(assignmentId)
    }
  })

  await startLocalService()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (service) void service.close()
  database?.close()
})
