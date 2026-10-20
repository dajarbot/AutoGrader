import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderStatus, SaveProviderInput } from '../shared/contracts'

export const OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_MODEL = 'mistral:latest'

export class ProviderStore {
  constructor(private readonly path: string) {}

  async status(): Promise<ProviderStatus> {
    const model = await this.model()
    try {
      const models = await this.models()
      return { provider: 'ollama', model, configured: models.includes(model), models }
    } catch {
      return { provider: 'ollama', model, configured: false, models: [] }
    }
  }

  async models(): Promise<string[]> {
    try {
      const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { models: Array<{ name: string }> }
      return payload.models.map((model) => model.name)
    } catch {
      throw new Error('Cannot reach local Ollama. Open Ollama or run "ollama serve", then try again.')
    }
  }

  async save(input: SaveProviderInput): Promise<ProviderStatus> {
    const model = input.model.trim()
    if (!(await this.models()).includes(model)) {
      throw new Error('Choose an installed Ollama model. Run "ollama list" to see available models.')
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ provider: 'ollama', model }), { mode: 0o600 })
    await rename(temporaryPath, this.path)
    return this.status()
  }

  async model(): Promise<string> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      return parsed.provider === 'ollama' && typeof parsed.model === 'string' && parsed.model.trim()
        ? parsed.model : DEFAULT_MODEL
    } catch {
      return DEFAULT_MODEL
    }
  }
}
