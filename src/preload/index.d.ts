import { electronAPI } from '@electron-toolkit/preload'

declare global {
    interface Window {
        electron: typeof electronAPI
        api: {
            getPlatform: () => Promise<string>
            checkPM: () => Promise<string>
            getSoftware: () => Promise<any>
            getInventory: () => Promise<Record<string, boolean>>
            exportManifest: (softwareIds: string[]) => Promise<boolean>
            importManifest: () => Promise<string[] | null>
            setDesiredState: (softwareIds: string[]) => void
            installSoftware: (softwareId: string) => void
            uninstallSoftware: (softwareId: string) => void
            cancelInstallation: (softwareId: string) => void
            stopAllTasks: () => void
            submitInstallInput: (id: string, input: string) => Promise<void>
            onInstallLog: (callback: (data: any) => void) => () => void
            onInstallSuccess: (callback: (data: any) => void) => () => void
            onInstallError: (callback: (data: any) => void) => () => void
            onInstallProgress: (callback: (data: any) => void) => () => void
            onInstallInputRequest: (callback: (data: any) => void) => () => void
            retryInstallation: (id: string) => Promise<{ success: boolean; error?: string }>
            getSystemDetails: () => Promise<any>
            getAppVersion: () => Promise<string>
            getUIState: () => Promise<{ sidebarWidth: number; isCollapsed: boolean; viewMode: string; theme: string }>
            saveUIState: (sidebarWidth: number, isCollapsed: boolean, viewMode?: string, theme?: string) => Promise<void>
        }
    }
}
