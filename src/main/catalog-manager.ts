import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'

const CATALOG_CACHE_PATH = path.join(app.getPath('userData'), 'catalog_cache.json')

export const syncRemoteCatalog = async (): Promise<void> => {
    console.log('Syncing remote catalog...')
    // Simulated sync logic
    console.log('Catalog sync logic initialized (Simulated).')
}

export const loadCatalog = async (initialConfig: any): Promise<any> => {
    try {
        const cachedContent = await fs.readFile(CATALOG_CACHE_PATH, 'utf-8')
        const cached = JSON.parse(cachedContent)

        const initialArr = initialConfig.software || initialConfig
        const cachedArr = cached.software || cached

        const initialCount = initialArr.length
        const cachedCount = cachedArr.length

        if (initialCount > cachedCount) {
            // Filter out password-required software
            const filtered = initialArr.filter((s: any) => !s.requiresPassword)
            return { software: filtered }
        }

        // Also filter cached content just in case
        const filteredCached = cachedArr.filter((s: any) => !s.requiresPassword)
        return { software: filteredCached }
    } catch (err: any) {
        // Filter fallback too
        const initialArr = initialConfig.software || initialConfig
        const filtered = initialArr.filter((s: any) => !s.requiresPassword)
        return { software: filtered }
    }
}
