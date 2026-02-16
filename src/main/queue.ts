import { WebContents } from 'electron'
import { CommandOptions, executeCommand, stopAllTasks } from './executor'
import { getFreeDiskSpace } from './os-utils'

interface Task {
    options: CommandOptions
    webContents: WebContents
    retryCount?: number  // Track retry attempts
}

export class TaskManager {
    private queue: Task[] = []
    private isRunning = false
    private retryCountMap = new Map<string, number>()  // Persist retry counts

    addTask(options: CommandOptions, webContents: WebContents) {
        this.queue.push({ options, webContents })

        // Sort: Smallest First (Undefined size treated as Infinity)
        this.queue.sort((a, b) => {
            const sizeA = a.options.size ?? Number.MAX_SAFE_INTEGER
            const sizeB = b.options.size ?? Number.MAX_SAFE_INTEGER
            return sizeA - sizeB
        })

        this.processQueue()
    }

    private async processQueue() {
        if (this.isRunning) return
        if (this.queue.length === 0) return

        this.isRunning = true
        const task = this.queue.slice(0, 1)[0] // Peek first

        if (task) {
            // Pre-flight check: Disk Space
            if (task.options.action === 'install') { // Only care for install
                const freeBytes = await getFreeDiskSpace()
                const MIN_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB safety margin

                if (freeBytes > 0 && freeBytes < MIN_BYTES) {
                    const gb = (freeBytes / 1024 / 1024 / 1024).toFixed(2)
                    task.webContents.send('install-error', {
                        id: task.options.id,
                        error: `Insufficient Disk Space. You have ${gb} GB free, but 2 GB is required for safe installation.`
                    })
                    // Remove from queue and skip
                    this.queue.shift()
                    this.isRunning = false
                    this.processQueue()
                    return
                }
            }

            // ... Proceed
            this.queue.shift() // Actually remove now

            try {
                await executeCommand(task.options, task.webContents)
            } catch (error) {
                console.error('Task failed:', error)
                // Continue queue even if one fails
            }
        }

        this.isRunning = false
        this.processQueue()
    }

    retryTask(taskId: string, webContents: WebContents) {
        console.log(`[TaskManager] Retry requested for ${taskId}`)

        // Get current retry count
        const currentRetries = this.retryCountMap.get(taskId) || 0

        // Check max retries
        if (currentRetries >= 3) {
            console.log(`[TaskManager] Max retries (3) exceeded for ${taskId}`)
            webContents.send('install-error', {
                id: taskId,
                error: 'Download failed after 3 automatic retry attempts. Please check your network connection and try again manually.'
            })
            return
        }

        // Increment retry count
        this.retryCountMap.set(taskId, currentRetries + 1)

        // Find the task config (we need it to retry)
        // Since task was removed from queue, we need to reconstruct it
        // The webContents will have sent the original options
        webContents.send('install-log', {
            id: taskId,
            text: `Auto-retry attempt ${currentRetries + 1}/3...`,
            type: 'info',
            replace: false
        })

        // The task will be re-added via the request-retry event handler in index.ts
    }

    clearRetryCount(taskId: string) {
        this.retryCountMap.delete(taskId)
    }

    clearQueue() {
        this.queue = []
        this.isRunning = false
        stopAllTasks()
    }
}

export const taskManager = new TaskManager()
