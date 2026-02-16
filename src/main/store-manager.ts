import { randomBytes } from 'crypto'

interface StoreSchema {
    ui: {
        sidebarWidth: number
        isCollapsed: boolean
        viewMode: string
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
                    isCollapsed: false
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
        viewMode: store.get('ui.viewMode', 'grid') as string
    }
}

export const saveUIState = async (sidebarWidth: number, isCollapsed: boolean, viewMode?: string) => {
    const store = await getStore()
    store.set('ui.sidebarWidth', sidebarWidth)
    store.set('ui.isCollapsed', isCollapsed)
    if (viewMode) {
        store.set('ui.viewMode', viewMode)
    }
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
