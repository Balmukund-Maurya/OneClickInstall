import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getPlatform, checkPackageManager, checkSoftwareInventory, getSystemDetails } from './os-utils'
import { cancelInstallation, handleProcessInput, cleanupAllPartialDownloads } from './executor'
import { syncRemoteCatalog, loadCatalog } from './catalog-manager'
import { exportManifest, importManifest } from './bundle-manager'
import { logAuditEvent } from './audit-logger'
import { initUpdater } from './updater'
import { agent } from './agent'
import { taskManager } from './queue'
import initialSoftwareConfig from '../shared/software.json'
import { CommandOptions } from './executor'

let currentCatalog: any = initialSoftwareConfig.software
// Store task options for retry capability
const taskOptionsMap = new Map<string, { options: CommandOptions, webContents: any }>()

function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        show: false,
        autoHideMenuBar: true,
        ...(process.platform === 'linux' ? { icon } : {}),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
        // Initialize auto-updates
        initUpdater(mainWindow.webContents)
        // Start background agent
        agent.start()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    // Load the remote URL for development or the local html file for production.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
    // 1. Attempt to sync remote catalog
    await syncRemoteCatalog()

    // 2. Load the best catalog (cached or initial)
    const catalog = await loadCatalog(initialSoftwareConfig)
    currentCatalog = catalog.software || catalog

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.oneclickinstall')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    // IPC handlers
    ipcMain.handle('get-platform', () => getPlatform())
    ipcMain.handle('check-pm', async () => {
        const platform = getPlatform()
        return await checkPackageManager(platform)
    })
    ipcMain.handle('get-software', () => currentCatalog)

    ipcMain.handle('get-inventory', async () => {
        const platform = getPlatform()
        const pm = await checkPackageManager(platform)
        if (pm === 'none') return {}

        return await checkSoftwareInventory(platform, pm, currentCatalog)
    })

    ipcMain.handle('get-system-details', () => {
        return getSystemDetails()
    })

    ipcMain.handle('get-app-version', () => app.getVersion())

    ipcMain.handle('get-ui-state', async () => {
        const { getUIState } = await import('./store-manager')
        return getUIState()
    })

    ipcMain.handle('save-ui-state', async (_, sidebarWidth: number, isCollapsed: boolean, viewMode?: string, theme?: string) => {
        const { saveUIState } = await import('./store-manager')
        saveUIState(sidebarWidth, isCollapsed, viewMode, theme)
    })

    ipcMain.handle('export-manifest', async (_, softwareIds: string[]) => {
        const win = BrowserWindow.getFocusedWindow()
        if (win) return await exportManifest(win, softwareIds)
        return false
    })

    ipcMain.handle('import-manifest', async () => {
        const win = BrowserWindow.getFocusedWindow()
        if (win) return await importManifest(win)
        return null
    })

    ipcMain.on('set-desired-state', (_, softwareIds: string[]) => {
        agent.updateDesiredState(softwareIds)
    })

    ipcMain.handle('submit-install-input', (event, { id, input }) => {
        handleProcessInput(id, input, event.sender)
    })

    ipcMain.on('cancel-installation', (event, softwareId) => {
        console.log('Cancel requested for:', softwareId)
        const software = currentCatalog.find((s: any) => s.id === softwareId)
        cancelInstallation(softwareId, event.sender)
        logAuditEvent('install_cancel', softwareId, software?.name || softwareId)
    })

    ipcMain.on('stop-all-tasks', (event) => {
        taskManager.clearQueue()
        agent.stop() // Stop the background reconciliation agent

        // Clean up all partial downloads
        cleanupAllPartialDownloads(event.sender)
    })

    ipcMain.on('install-software', async (event, softwareId) => {
        const platform = getPlatform()
        const software = currentCatalog.find((s: any) => s.id === softwareId)

        if (!software) {
            event.sender.send('install-error', { id: softwareId, error: 'Software not found in catalog' })
            return
        }

        const commandConfig = software.platforms[platform]
        if (!commandConfig) {
            event.sender.send('install-error', { id: softwareId, error: `Platform ${platform} not supported for ${software.name}` })
            return
        }

        const parseSize = (sizeStr?: string): number | undefined => {
            if (!sizeStr) return undefined
            const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(MB|GB|KB)/i)
            if (!match) return undefined
            const val = parseFloat(match[1])
            const unit = match[2].toUpperCase()
            if (unit === 'GB') return val * 1024 * 1024 * 1024
            if (unit === 'MB') return val * 1024 * 1024
            if (unit === 'KB') return val * 1024
            return undefined
        }

        const taskOptions: CommandOptions = {
            id: software.id,
            name: software.name,
            manager: commandConfig.pm,
            args: commandConfig.args,
            action: 'install',
            size: parseSize(software.size)
        }

        // Store for potential retry
        taskOptionsMap.set(software.id, { options: taskOptions, webContents: event.sender })

        taskManager.addTask(taskOptions, event.sender)
    })

    ipcMain.on('uninstall-software', async (event, softwareId) => {
        const platform = getPlatform()
        const software = currentCatalog.find((s: any) => s.id === softwareId)

        if (!software) {
            event.sender.send('install-error', { id: softwareId, error: 'Software not found in catalog' })
            return
        }

        const commandConfig = software.platforms[platform]
        if (!commandConfig || !commandConfig.uninstallArgs) {
            event.sender.send('install-error', { id: softwareId, error: `Uninstallation not supported for ${software.name} on ${platform}` })
            return
        }

        taskManager.addTask({
            id: software.id,
            name: software.name,
            manager: commandConfig.pm,
            args: commandConfig.uninstallArgs,
            action: 'uninstall'
        }, event.sender)
    })

    // Auto-retry handler (triggered by executor when 60s true stall detected)
    ipcMain.on('request-retry', (_event, { id }) => {
        console.log(`[IPC] Auto-retry request received for ${id}`)
        const taskData = taskOptionsMap.get(id)
        if (taskData) {
            taskManager.retryTask(id, taskData.webContents)
            // Re-add the task to queue
            taskManager.addTask(taskData.options, taskData.webContents)
        }
    })

    // Manual retry handler (triggered by user clicking retry button)
    ipcMain.handle('retry-installation', async (_, softwareId: string) => {
        console.log(`[IPC] Manual retry requested for ${softwareId}`)
        const taskData = taskOptionsMap.get(softwareId)
        if (taskData) {
            // Manual retry resets the retry counter
            taskManager.retryTask(softwareId, taskData.webContents)
            taskManager.addTask(taskData.options, taskData.webContents)
            return { success: true }
        }
        return { success: false, error: 'Task not found' }
    })

    // Clear retry count handler (prevents memory leak)
    ipcMain.on('clear-retry-count', (_, data: { id: string }) => {
        // Signal to taskManager to clean up retry count for this software
        // This prevents the retryCountMap from growing indefinitely
        taskManager.clearRetryCount(data.id)
    })

    createWindow()

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Graceful Shutdown for Dev (SIGINT / Ctrl+C)
process.on('SIGINT', () => {
    console.log('Received SIGINT. Cleaning up...')
    agent.stop()
    taskManager.clearQueue()
    // Force kill any remaining child processes from executor
    import('./executor').then(({ stopAllTasks }) => {
        stopAllTasks()
        process.exit(0)
    })
})
