import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { createHmac } from 'crypto'
import { getAuditSecret } from './store-manager'

interface AuditEvent {
    timestamp: string
    eventId: string
    action: 'install_start' | 'install_success' | 'install_fail' | 'install_cancel' | 'uninstall_start' | 'uninstall_success' | 'uninstall_fail'
    softwareId: string
    softwareName: string
    platform: string
    user: string
    details?: any
}

interface SignedLogEntry {
    event: AuditEvent
    signature: string
}

const getAuditLogPath = () => {
    const logDir = path.join(app.getPath('userData'), 'logs')
    return path.join(logDir, 'audit.jsonl')
}

const signEvent = async (event: AuditEvent): Promise<string> => {
    const secret = await getAuditSecret()
    return createHmac('sha256', secret).update(JSON.stringify(event)).digest('base64')
}

export const logAuditEvent = async (
    action: AuditEvent['action'],
    softwareId: string,
    softwareName: string,
    details?: any
): Promise<void> => {
    try {
        const event: AuditEvent = {
            timestamp: new Date().toISOString(),
            eventId: Math.random().toString(36).substring(2, 15),
            action,
            softwareId,
            softwareName,
            platform: process.platform,
            user: app.getPath('home').split(path.sep).pop() || 'unknown',
            details
        }

        const entry: SignedLogEntry = {
            event,
            signature: await signEvent(event)
        }

        const logPath = getAuditLogPath()
        const logDir = path.dirname(logPath)

        try {
            await fs.access(logDir)
        } catch {
            await fs.mkdir(logDir, { recursive: true })
        }

        await fs.appendFile(logPath, JSON.stringify(entry) + '\n')
        console.log(`Audit Log stored: ${action} for ${softwareName}`)
    } catch (error) {
        console.error('Failed to write audit log:', error)
    }
}
