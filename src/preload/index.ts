import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    checkPM: () => ipcRenderer.invoke('check-pm'),
    getSoftware: () => ipcRenderer.invoke('get-software'),
    getInventory: () => ipcRenderer.invoke('get-inventory'),
    exportManifest: (softwareIds: string[]) => ipcRenderer.invoke('export-manifest', softwareIds),
    importManifest: () => ipcRenderer.invoke('import-manifest'),
    setDesiredState: (softwareIds: string[]) => ipcRenderer.send('set-desired-state', softwareIds),
    installSoftware: (softwareId: string) => ipcRenderer.send('install-software', softwareId),
    uninstallSoftware: (softwareId: string) => ipcRenderer.send('uninstall-software', softwareId),
    cancelInstallation: (softwareId: string) => ipcRenderer.send('cancel-installation', softwareId),
    stopAllTasks: () => ipcRenderer.send('stop-all-tasks'),
    submitInstallInput: (id: string, input: string) => ipcRenderer.invoke('submit-install-input', { id, input }),
    onInstallInputRequest: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data)
        ipcRenderer.on('install-input-request', subscription)
        return () => ipcRenderer.removeListener('install-input-request', subscription)
    },
    onInstallLog: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data)
        ipcRenderer.on('install-log', subscription)
        return () => ipcRenderer.removeListener('install-log', subscription)
    },
    onInstallSuccess: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data)
        ipcRenderer.on('install-success', subscription)
        return () => ipcRenderer.removeListener('install-success', subscription)
    },
    onInstallError: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data)
        ipcRenderer.on('install-error', subscription)
        return () => ipcRenderer.removeListener('install-error', subscription)
    },
    onInstallProgress: (callback: (data: any) => void) => {
        const subscription = (_event: any, data: any) => callback(data)
        ipcRenderer.on('install-progress', subscription)
        return () => ipcRenderer.removeListener('install-progress', subscription)
    },
    retryInstallation: (id: string) => ipcRenderer.invoke('retry-installation', id),
    getSystemDetails: () => ipcRenderer.invoke('get-system-details'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getUIState: () => ipcRenderer.invoke('get-ui-state'),
    saveUIState: (sidebarWidth: number, isCollapsed: boolean, viewMode?: string) =>
        ipcRenderer.invoke('save-ui-state', sidebarWidth, isCollapsed, viewMode),
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore
    window.electron = electronAPI
    // @ts-ignore
    window.api = api
}
