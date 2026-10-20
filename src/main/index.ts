import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { AutoGraderDatabase } from './database'
import { GradingWorker } from './grading'
import { ProviderStore } from './providerStore'
import { createServer } from './server'
import { writeScoresWorkbook } from './spreadsheetExport'
import type { FastifyInstance } from 'fastify'
import type {
  SelectedPdfFile,
  ServiceConnection,
  SpreadsheetExportResult,
  SpreadsheetExportScope
} from '../shared/contracts'

let database: AutoGraderDatabase | undefined
let service: FastifyInstance | undefined
let connection: ServiceConnection | undefined

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
  const gradingWorker = new GradingWorker(database, providerStore)
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
