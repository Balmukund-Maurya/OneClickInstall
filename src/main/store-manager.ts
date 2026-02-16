import { randomBytes } from 'crypto'

interface StoreSchema {
    ui: {
        sidebarWidth: number
        isCollapsed: boolean
        viewMode: string
        theme: string
    }
    audit: {
        secret: string
    }
}

let storeInstance: any = null

const getStore = async () => {
    if (!storeInstance) {
        const Store = (await import('electron-store')).default
        storeInstance = new Store<StoreSchema>({
            defaults: {
                ui: {
                    sidebarWidth: 280,
                    isCollapsed: false,
                    viewMode: 'grid',
                    theme: 'dark'
                }
            }
        })
    }
    return storeInstance
}

export const getUIState = async () => {
    const store = await getStore()
    return {
        sidebarWidth: store.get('ui.sidebarWidth', 280) as number,
        isCollapsed: store.get('ui.isCollapsed', false) as boolean,
        viewMode: store.get('ui.viewMode', 'grid') as string,
        theme: store.get('ui.theme', 'dark') as string
    }
}

export const saveUIState = async (sidebarWidth: number, isCollapsed: boolean, viewMode?: string, theme?: string) => {
    const store = await getStore()
    store.set('ui.sidebarWidth', sidebarWidth)
    store.set('ui.isCollapsed', isCollapsed)
    if (viewMode) store.set('ui.viewMode', viewMode)
    if (theme) store.set('ui.theme', theme)
}

export const getAuditSecret = async (): Promise<string> => {
    const store = await getStore()
    let secret = store.get('audit.secret') as string | undefined
    if (!secret) {
        // Generate new secret on first run
        secret = randomBytes(32).toString('base64')
        store.set('audit.secret', secret)
        console.log('Generated new audit secret')
    }
    return secret
}
