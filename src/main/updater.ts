import { autoUpdater } from 'electron-updater'
import { WebContents } from 'electron'

export const initUpdater = (webContents: WebContents): void => {
    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...')
    })

    autoUpdater.on('update-available', (info) => {
        webContents.send('install-log', { id: 'system', text: `Update available: ${info.version}\n`, type: 'info' })
    })

    autoUpdater.on('update-not-available', () => {
        console.log('Update not available.')
    })

    autoUpdater.on('error', (err) => {
        console.error('Error in auto-updater:', err)
    })

    autoUpdater.on('download-progress', (progressObj) => {
        let logMsg = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`
        console.log(logMsg)
    })

    autoUpdater.on('update-downloaded', () => {
        webContents.send('install-log', { id: 'system', text: 'Update downloaded. Restart the app to apply.\n', type: 'info' })
    })

    autoUpdater.checkForUpdatesAndNotify()
}
