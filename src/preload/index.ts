import { contextBridge, ipcRenderer } from 'electron'
import type {
  SelectedPdfFile,
  ServiceConnection,
  SpreadsheetExportResult,
  SpreadsheetExportScope,
  TeacherReviewImportResult
} from '../shared/contracts'

const desktopApi = {
  getServiceConnection: (): Promise<ServiceConnection> => ipcRenderer.invoke('service:connection'),
  choosePdfFiles: (): Promise<SelectedPdfFile[]> => ipcRenderer.invoke('files:choose-pdfs'),
  exportScores: (assignmentId: string, scope: SpreadsheetExportScope): Promise<SpreadsheetExportResult> =>
    ipcRenderer.invoke('files:export-scores', assignmentId, scope),
  importTeacherReviews: (assignmentId: string): Promise<TeacherReviewImportResult> =>
    ipcRenderer.invoke('files:import-teacher-reviews', assignmentId)
}

contextBridge.exposeInMainWorld('autoGrader', desktopApi)

export type DesktopApi = typeof desktopApi
