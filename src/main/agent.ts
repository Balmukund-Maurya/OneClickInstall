import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'

const DESIRED_STATE_PATH = path.join(app.getPath('userData'), 'desired_state.json')

class BackgroundAgent {

    private interval: NodeJS.Timeout | null = null

    async start() {
        console.log('Background Agent starting...')

        // Restore desired state from previous session
        try {
            const data = await fs.readFile(DESIRED_STATE_PATH, 'utf-8')
            const desiredIds = JSON.parse(data)
            if (Array.isArray(desiredIds) && desiredIds.length > 0) {
                console.log(`Agent: Restored ${desiredIds.length} desired software items from previous session`)
            }
        } catch {
            // File doesn't exist yet, that's OK (first run)
        }

        this.runReconciliation()
        this.interval = setInterval(() => this.runReconciliation(), 300000) // 5 mins
    }



    async updateDesiredState(softwareIds: string[]) {

        await fs.writeFile(DESIRED_STATE_PATH, JSON.stringify(softwareIds))
        this.runReconciliation()
    }

    private async runReconciliation() {
        console.log('Agent: Starting reconciliation loop...')
        // Real reconciliation would check current catalog and trigger installs
        // For now, it just logs
    }

    stop() {
        if (this.interval) clearInterval(this.interval)
    }
}

export const agent = new BackgroundAgent()
