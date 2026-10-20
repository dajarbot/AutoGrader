import { safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderStatus, SaveProviderInput } from '../shared/contracts'

interface StoredProviderConfig {
  provider: 'gemini'
  model: string
  encryptedApiKey?: string
}

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const RETIRED_MODELS = new Set(['gemini-2.5-flash-lite'])

export class ProviderStore {
  constructor(private readonly path: string) {}

  async status(): Promise<ProviderStatus> {
    const stored = await this.read()
    return {
      provider: 'gemini',
      model: stored.model,
      configured: Boolean(stored.encryptedApiKey && safeStorage.isEncryptionAvailable()),
      secureStorageAvailable: safeStorage.isEncryptionAvailable()
    }
  }

  async save(input: SaveProviderInput): Promise<ProviderStatus> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this computer.')
    }

    const current = await this.read()
    const next: StoredProviderConfig = {
      provider: 'gemini',
      model: input.model.trim(),
      encryptedApiKey: current.encryptedApiKey
    }
    if (input.apiKey?.trim()) {
      next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64')
    }
    if (!next.encryptedApiKey) throw new Error('Enter a Gemini API key.')

    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    await writeFile(temporaryPath, JSON.stringify(next), { mode: 0o600 })
    await rename(temporaryPath, this.path)
    return this.status()
  }

  async apiKey(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null
    const stored = await this.read()
    if (!stored.encryptedApiKey) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'))
    } catch {
      return null
    }
  }

  async model(): Promise<string> {
    return (await this.read()).model
  }

  private async read(): Promise<StoredProviderConfig> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredProviderConfig>
      return {
        provider: 'gemini',
        model: typeof parsed.model === 'string' && parsed.model.trim() && !RETIRED_MODELS.has(parsed.model)
          ? parsed.model
          : DEFAULT_MODEL,
        encryptedApiKey: typeof parsed.encryptedApiKey === 'string' ? parsed.encryptedApiKey : undefined
      }
    } catch {
      return { provider: 'gemini', model: DEFAULT_MODEL }
    }
  }
}
