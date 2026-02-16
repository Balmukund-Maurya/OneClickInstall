import { dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'

export const exportManifest = async (win: BrowserWindow, softwareIds: string[]): Promise<boolean> => {
    const { filePath } = await dialog.showSaveDialog(win, {
        title: 'Export Deployment Manifest',
        defaultPath: 'manifest.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (filePath) {
        await fs.writeFile(filePath, JSON.stringify(softwareIds, null, 2))
        return true
    }
    return false
}

export const importManifest = async (win: BrowserWindow): Promise<string[] | null> => {
    const { filePaths } = await dialog.showOpenDialog(win, {
        title: 'Import Deployment Manifest',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
    })

    if (filePaths && filePaths.length > 0) {
        const content = await fs.readFile(filePaths[0], 'utf-8')
        return JSON.parse(content)
    }
    return null
}
