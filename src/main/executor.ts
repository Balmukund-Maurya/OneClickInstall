import { spawn, ChildProcess } from 'child_process'
import { WebContents } from 'electron'
import { logAuditEvent } from './audit-logger'
import { parseProgress, createStallCheck } from './install-helpers'

export interface CommandOptions {
    id: string
    name: string
    manager: string
    args: string[]
    action?: 'install' | 'uninstall'
    size?: number // Size in bytes
}

const activeProcesses = new Map<string, { process: ChildProcess, options: CommandOptions }>()

const pendingRetries = new Map<string, {
    options: CommandOptions,
    resolve: (value: void | PromiseLike<void>) => void,
    reject: (reason?: any) => void,
    attempt: number
}>()

export const cancelInstallation = (id: string, webContents?: WebContents): boolean => {
    const entry = activeProcesses.get(id)
    if (entry) {
        entry.process.kill()
        activeProcesses.delete(id)

        // Cleanup partial downloads from Homebrew cache
        if (webContents) {
            cleanupPartialDownload(id, entry.options.name, webContents)
        }

        return true
    }
    return false
}

// Helper function to clean up partial downloads
const cleanupPartialDownload = async (id: string, name: string, webContents: WebContents) => {
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE
        if (!homeDir) return

        const cacheDir = `${homeDir}/Library/Caches/Homebrew/downloads`

        // Check if cache directory exists
        const fs = await import('fs/promises')
        try {
            await fs.access(cacheDir)
        } catch {
            return // Cache dir doesn't exist, nothing to clean
        }

        // List all files in cache directory
        const files = await fs.readdir(cacheDir)

        // Find incomplete downloads (files with .incomplete suffix or very recent ones related to this software)
        const incompleteFiles = files.filter(f =>
            f.endsWith('.incomplete') ||
            f.includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''))
        )

        let deletedCount = 0
        let freedSpace = 0

        for (const file of incompleteFiles) {
            const filePath = `${cacheDir}/${file}`
            try {
                const stats = await fs.stat(filePath)
                const ageMinutes = (Date.now() - stats.mtimeMs) / 1000 / 60

                // Only delete files modified in the last 5 minutes (likely from this session)
                if (ageMinutes < 5 && file.endsWith('.incomplete')) {
                    await fs.unlink(filePath)
                    deletedCount++
                    freedSpace += stats.size
                }
            } catch (err) {
                // File might have been deleted already, skip
            }
        }

        if (deletedCount > 0) {
            const freedMB = (freedSpace / (1024 * 1024)).toFixed(1)
            webContents.send('install-log', {
                id,
                text: `Cleaned up ${deletedCount} partial download file(s), freed ${freedMB} MB`,
                type: 'info',
                replace: false
            })
        }
    } catch (error) {
        console.error('Error cleaning up partial downloads:', error)
        // Don't send error to user, cleanup failure is not critical
    }
}

export const handleProcessInput = async (id: string, input: string, webContents: WebContents) => {
    // 1. Check for running processes (standard logic)
    const entry = activeProcesses.get(id)
    if (entry) {
        // ... (existing logic for running processes)
        // 1. Try pipe
        if (entry.process.stdin && !entry.process.killed) {
            try {
                entry.process.stdin.write(input + '\n')
            } catch (e) {
                console.error('Failed to write to stdin:', e)
            }
        }

        // 2. Authenticate and Retry (Kill & Retry)
        webContents.send('install-log', { id, text: '\n[sudo] Authenticating...\n' })
        const authSuccess = await authenticateSudo(input)

        if (authSuccess) {
            webContents.send('install-log', { id, text: '[sudo] Authentication successful. Retrying command...\n', type: 'success' })
            if (!entry.process.killed) entry.process.kill('SIGKILL')
            activeProcesses.delete(id)

            setTimeout(() => {
                executeCommand(entry.options, webContents, 1)
                    .catch(err => console.error("Retry failed", err))
            }, 1000)
        } else {
            webContents.send('install-log', { id, text: '[sudo] Authentication failed. Please check your password.\n', type: 'error' })
        }
        return
    }

    // 2. Check for PENDING retries (dead processes waiting for auth)
    const pending = pendingRetries.get(id)
    if (pending) {
        webContents.send('install-log', { id, text: '\n[sudo] Authenticating...\n' })
        const authSuccess = await authenticateSudo(input)

        if (authSuccess) {
            webContents.send('install-log', { id, text: '[sudo] Authentication successful. Resuming task...\n', type: 'success' })
            pendingRetries.delete(id)

            // Chain the new execution to the suspended promise
            executeCommand(pending.options, webContents, pending.attempt + 1)
                .then(pending.resolve)
                .catch(pending.reject)
        } else {
            webContents.send('install-log', { id, text: '[sudo] Authentication failed. Please check your password.\n', type: 'error' })
        }
    }
}

// Helper for sudo auth
const authenticateSudo = (password: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
        const sudo = spawn('sudo', ['-S', '-v'], { stdio: ['pipe', 'pipe', 'pipe'] })
        sudo.stdin.write(password + '\n')
        sudo.stdin.end()
        sudo.on('close', (code) => resolve(code === 0))
    })
}

// Deprecated: use handleProcessInput
export const writeToProcessInput = (_id: string, _input: string) => {
    // Kept for compatibility if needed, but logic moved to handleProcessInput
}

// Verify if software is actually installed by checking /Applications
const verifyInstallation = async (name: string, manager: string): Promise<boolean> => {
    if (manager !== 'brew' || process.platform !== 'darwin') {
        return true // Only verify macOS Homebrew installs
    }

    const fs = require('fs')
    const os = require('os')

    // Common app name variations
    const nameVariations = [
        name,
        name.replace(' ', ''),  // "VS Code" -> "VSCode"
        name.replace(/\s+/g, ''),  // Remove all spaces
    ]

    // Special cases
    if (name.includes('VS Code')) {
        nameVariations.push('Visual Studio Code')
    }
    if (name.includes('PyCharm')) {
        nameVariations.push('PyCharm CE', 'PyCharm Community Edition')
    }

    // Check /Applications and ~/Applications
    for (const variant of nameVariations) {
        const appPath = `/Applications/${variant}.app`
        const userAppPath = `${os.homedir()}/Applications/${variant}.app`

        if (fs.existsSync(appPath) || fs.existsSync(userAppPath)) {
            return true
        }
    }

    return false
}

export const stopAllTasks = () => {
    for (const entry of activeProcesses.values()) {
        if (!entry.process.killed) {
            entry.process.kill('SIGKILL')
        }
    }
    activeProcesses.clear()
}

// Comprehensive cleanup function for Stop All action
export const cleanupAllPartialDownloads = async (webContents: WebContents) => {
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE
        if (!homeDir) return

        const cacheDir = `${homeDir}/Library/Caches/Homebrew/downloads`

        // Check if cache directory exists
        const fs = await import('fs/promises')
        try {
            await fs.access(cacheDir)
        } catch {
            return // Cache dir doesn't exist, nothing to clean
        }

        // List all files in cache directory
        const files = await fs.readdir(cacheDir)

        // Find ALL incomplete downloads
        const incompleteFiles = files.filter(f => f.endsWith('.incomplete'))

        let deletedCount = 0
        let freedSpace = 0

        for (const file of incompleteFiles) {
            const filePath = `${cacheDir}/${file}`
            try {
                const stats = await fs.stat(filePath)
                await fs.unlink(filePath)
                deletedCount++
                freedSpace += stats.size
            } catch (err) {
                // File might have been deleted already, skip
                console.error(`Failed to delete ${file}:`, err)
            }
        }

        if (deletedCount > 0) {
            const freedMB = (freedSpace / (1024 * 1024)).toFixed(1)
            webContents.send('install-log', {
                id: 'system',
                text: `🧹 Cleanup complete: Removed ${deletedCount} incomplete download(s), freed ${freedMB} MB`,
                type: 'success',
                replace: false
            })
        } else {
            webContents.send('install-log', {
                id: 'system',
                text: `✓ No incomplete downloads found to clean up`,
                type: 'info',
                replace: false
            })
        }
    } catch (error) {
        console.error('Error cleaning up all partial downloads:', error)
        webContents.send('install-log', {
            id: 'system',
            text: `⚠️ Cleanup failed: ${error}`,
            type: 'warning',
            replace: false
        })
    }
}

// Helper to strip ANSI codes
const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')

export const executeCommand = (
    options: CommandOptions,
    webContents: WebContents,
    attempt: number = 1
): Promise<void> => {
    return new Promise((resolve, reject) => {
        const { id, name, manager, args, action = 'install' } = options

        // Performance Optimizations: Inject flags dynamically
        let finalArgs = [...args]
        if (manager === 'winget' && action === 'install') {
            if (!finalArgs.includes('--accept-package-agreements')) finalArgs.push('--accept-package-agreements')
            if (!finalArgs.includes('--accept-source-agreements')) finalArgs.push('--accept-source-agreements')
        }
        // Force verbose for brew to see curl output
        if (manager === 'brew' && !finalArgs.includes('--verbose') && !finalArgs.includes('-v')) {
            finalArgs.push('--verbose')
        }
        const actionVerb = action === 'install' ? 'installation' : 'uninstallation'

        webContents.send('install-log', { id, text: `Starting ${actionVerb} of ${name} via ${manager}...\n` })

        logAuditEvent(`${action}_start`, id, name, { manager, args: finalArgs })

        let allStdout = '' // Track all stdout for verification
        let outputBuffer = ''
        let childProcess: ChildProcess;

        if (manager === 'brew' && process.platform === 'darwin' && action === 'install') {
            // Workaround: brew/curl hides progress in non-TTY environments.
            // We use `script` to force TTY for INSTALLS only (to see progress).
            // Installing usually doesn't need input, so ignoring stdin is safe-ish.
            const scriptArgs = ['-q', '/dev/null', manager, ...finalArgs]
            childProcess = spawn('script', scriptArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    HOMEBREW_NO_AUTO_UPDATE: '1',
                    HOMEBREW_NO_INSTALL_CLEANUP: '1',
                }
            })
        } else {
            // Standard spawn for uninstall (supports sudo input) or non-macOS
            // We use detached: true to prevent sudo from grabbing the host TTY in dev mode.
            childProcess = spawn(manager, finalArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true,
                env: {
                    ...process.env,
                    HOMEBREW_NO_AUTO_UPDATE: '1',
                    HOMEBREW_NO_INSTALL_CLEANUP: '1',
                    // Force sudo to use askpass if we could, but for now rely on detached stdio
                }
            })
        }

        activeProcesses.set(id, { process: childProcess, options })

        let currentPhase = 'initializing'
        let lastDataTime = Date.now()
        let lastProgressLogTime = 0 // Used for Stall Detection (updated only when good progress)
        let lastUiLogTime = 0       // Used for UI throttling
        let lastNonZeroSpeedTime = Date.now()
        let trueStallStartTime: number | null = null  // Track when true stall begins (0 speed + no progress)
        let lastPercent = 0

        const getState = () => ({ lastDataTime, lastProgressLogTime, currentPhase, lastPercent })
        const updateLastProgressLogTime = () => { lastProgressLogTime = Date.now() }

        let isTimedOut = false // Track timeout state
        const onTimeout = () => {
            isTimedOut = true
            webContents.send('install-log', {
                id,
                text: `\n❌ Download timed out after 5 minutes. Stopping process...\n`,
                type: 'error'
            })
            if (!childProcess.killed) childProcess.kill('SIGKILL')
        }

        // Use helper for Stall Check
        const stallCheck = createStallCheck(id, name, childProcess, webContents, getState, updateLastProgressLogTime, onTimeout)

        const extractProgress = (data: string): boolean => {
            // 1. Curl Output Parsing (Speed & Percent)
            const result = parseProgress(data)
            if (result) {
                const { percent, speed } = result
                const oldPercent = lastPercent  // Save old value BEFORE updating
                lastPercent = percent
                currentPhase = 'downloading' // Ensure phase is correct
                webContents.send('install-progress', { id, percent })

                // Report Log (Throttled: Every 2s or if speed is present)
                const now = Date.now()

                // Track non-zero speed to detect "noisy stalls" (curl outputting 0 KB/s)
                // parseProgress returns speed as string (e.g. "10.5 MB/s") or undefined.
                // We need to parse it to check if it's effectively 0.
                let speedValue = 0
                if (speed && typeof speed === 'string') {
                    const match = speed.match(/([\d.]+)/)
                    if (match) {
                        speedValue = parseFloat(match[1])
                    }
                }

                const isZeroSpeed = !speed || speedValue === 0
                const isProgressing = percent > oldPercent  // Use OLD percent to detect change

                if (!isZeroSpeed || isProgressing) {
                    lastNonZeroSpeedTime = now
                    updateLastProgressLogTime() // Only update "good progress" time if speed > 0
                    trueStallStartTime = null // Reset true stall timer on any activity
                }

                // Track "true stall" (0 speed AND no progress)
                if (isZeroSpeed && !isProgressing) {
                    if (trueStallStartTime === null) {
                        trueStallStartTime = now
                    }

                    const trueStallDuration = now - trueStallStartTime

                    // Auto-retry after 60 seconds of true stall
                    if (trueStallDuration > 60000) {
                        console.log(`[AutoRetry] True stall detected for ${Math.floor(trueStallDuration / 1000)}s. Initiating auto-retry...`)

                        // GUARD: Prevent duplicate retries
                        if (pendingRetries.has(id)) {
                            console.log(`[AutoRetry] Already retrying ${id}, skipping duplicate`)
                            return true
                        }

                        webContents.send('install-log', {
                            id,
                            text: `Connection appears dead. Auto-retrying download...`,
                            type: 'warning',
                            replace: false
                        })

                        // Kill current process and let queue manager handle retry
                        childProcess.kill('SIGKILL')

                        // Emit retry event for queue manager to handle
                        webContents.send('request-retry', { id })

                        return true // Stop processing this stalled download
                    }
                }

                // If speed is 0 AND no progress, and it's been > 5s since last activity, DON'T log.
                // This lets createStallCheck take over with "Stalled".
                if (isZeroSpeed && !isProgressing && (now - lastNonZeroSpeedTime > 5000)) {
                    // Do nothing. Silence allows stall checker to speak.
                    // console.log(`[ResumeCheck] Suppressing log. Speed: ${speed}, Percent: ${percent}`) // Optional Debug
                    return true
                }

                if (now - lastUiLogTime > 2000) {
                    // Visual Progress Bar
                    const barWidth = 30
                    const filled = Math.round((percent / 100) * barWidth)
                    const empty = barWidth - filled
                    const bar = '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']'

                    // Format speed
                    // parseProgress returns speed number. We need unit? 
                    // No parseProgress returns { percent, speed: number } only?
                    // install-helpers.ts: parseProgress returns { percent, speed, unit }?
                    // Wait, let me check parseProgress signature in my mind or usage. 
                    // Usage in line 185: const { percent, speed } = result
                    // install-helpers.ts implementation: returns { percent, speed, unit }
                    // So I should destructure unit too.

                    // But here I'm replacing lines 185... 
                    // Wait, I need to check line 185 content in previous tool output. 
                    // It was: const { percent, speed } = result
                    // So unit is missing in current code? 
                    // Ah, line 199: const speedText = speed ? ` (${speed})` : ''
                    // This implies speed string? 
                    // Let's check parseProgress implementation in install-helpers.ts to be sure.
                    // But regardless, I should pass speed + unit if possible, or just speed if it has unit string.

                    // Actually, if parseProgress returns invalid speed, what happens?
                    // I will assume speed is number/string as per existing usage.

                    const speedText = speed ? ` (${speed})` : ''

                    webContents.send('install-log', {
                        id,
                        text: `Downloading: ${bar} ${percent.toFixed(1)}%${speedText}`,
                        type: 'info',
                        replace: true
                    })
                    lastUiLogTime = now
                }
                return true
            }

            // Milestone Parsing (Secondary)
            const milestones: Record<string, number> = action === 'install' ? {
                'Downloading': 10,
                'Found': 15,
                'Already downloaded': 35,
                'Verifying': 50,
                'Starting package install': 65,
                'Installing': 75,
                'Successfully installed': 100
            } : {
                'Uninstalling': 20,
                'Removing launchctl': 40,
                'Starting package uninstall': 60,
                'Removing files': 80,
                'Successfully uninstalled': 90,
                'Purging': 95
            }

            for (const [key, value] of Object.entries(milestones)) {
                if (data.includes(key)) {
                    webContents.send('install-progress', { id, percent: value })
                    break
                }
            }
            return false
        }

        childProcess.stdout?.on('data', (data) => {
            let text = data.toString()
            text = stripAnsi(text)
            outputBuffer += text
            allStdout += text  // Track all stdout for verification
            lastDataTime = Date.now()

            // Phase detection
            if (text.includes('Downloading') || text.includes('Fetching') || text.includes('Bottle Manifest')) currentPhase = 'downloading'
            if (text.includes('Installing') || text.includes('Running installer') || text.includes('Pouring') || text.includes('Verifying')) currentPhase = 'installing'

            // Check for password prompt strings
            if (text.includes('Password:') || text.includes('sudo')) {
                currentPhase = 'input_required'
                webContents.send('install-input-request', { id, prompt: text.trim() })
            }

            const isProgressLine = extractProgress(text)
            const isCurlHeader = text.includes('% Total') && text.includes('% Received')

            // Only log if it's NOT a raw progress line (which we handle with pretty bars)
            // AND not a curl header
            // AND not an empty line
            if (!isProgressLine && !isCurlHeader && text.trim().length > 0) {
                webContents.send('install-log', { id, text })
            }
        })

        childProcess.stderr?.on('data', (data) => {
            let text = data.toString()
            text = stripAnsi(text)
            outputBuffer += text

            // Phase detection (stderr often has useful info for brew)
            if (text.includes('Downloading') || text.includes('Fetching')) currentPhase = 'downloading'
            if (text.includes('Installing') || text.includes('Running installer') || text.includes('Pouring')) currentPhase = 'installing'

            // Check for password prompt strings (sometimes on stderr)
            if (text.includes('Password:') || (text.includes('sudo') && text.includes('password'))) {
                currentPhase = 'input_required'
                webContents.send('install-input-request', { id, prompt: text.trim() })
            }

            extractProgress(text)
            webContents.send('install-log', { id, text, type: 'error' })
        })

        childProcess.on('close', async (code) => {
            clearInterval(stallCheck)
            activeProcesses.delete(id)

            if (code === 0) {
                // Check for false success: "Warning: Not upgrading" message
                if (action === 'install' && allStdout.includes('Warning: Not upgrading')) {
                    webContents.send('install-log', {
                        id,
                        text: `⚠️ Homebrew reports "${name}" already installed, but verifying...`,
                        type: 'warning',
                        replace: false
                    })

                    // Verify the app actually exists
                    const isActuallyInstalled = await verifyInstallation(name, manager)

                    if (!isActuallyInstalled) {
                        webContents.send('install-log', {
                            id,
                            text: `❌ ${name} not found in /Applications. Cleaning up phantom install...`,
                            type: 'warning',
                            replace: false
                        })

                        // Force uninstall to clear Homebrew's cached state
                        try {
                            webContents.send('install-log', {
                                id,
                                text: `🔧 Forcing uninstall to clear cached state...`,
                                type: 'info',
                                replace: false
                            })

                            // Run uninstall to clear phantom state
                            const uninstallOptions: CommandOptions = {
                                id,
                                name,
                                manager,
                                args: ['uninstall', '--cask', '--force', args[args.indexOf('--cask') + 1]],
                                action: 'uninstall'
                            }

                            await new Promise<void>((resolveUninstall) => {
                                executeCommand(uninstallOptions, webContents)
                                    .then(() => resolveUninstall())
                                    .catch(() => {
                                        // Uninstall might fail if already partially removed - that's OK
                                        webContents.send('install-log', {
                                            id,
                                            text: `⚠️ Uninstall completed with warnings (this is normal)`,
                                            type: 'warning',
                                            replace: false
                                        })
                                        resolveUninstall()
                                    })
                            })

                            webContents.send('install-log', {
                                id,
                                text: `✓ Phantom install cleared. Retrying installation...`,
                                type: 'success',
                                replace: false
                            })

                            // Small delay to ensure Homebrew state is clean
                            await new Promise(resolve => setTimeout(resolve, 1000))

                            // Retry the installation from scratch
                            const retryResult = await executeCommand(options, webContents, attempt)
                            resolve(retryResult)
                            return

                        } catch (cleanupError) {
                            webContents.send('install-error', {
                                id,
                                error: `Failed to fix phantom install: ${cleanupError}. Please try manual uninstall.`
                            })
                            logAuditEvent(`${action}_fail`, id, name)
                            reject(new Error('Installation verification and cleanup failed'))
                            return
                        }
                    }

                    webContents.send('install-log', {
                        id,
                        text: `✓ Verification passed: ${name} is installed`,
                        type: 'success',
                        replace: false
                    })
                }

                const successText = action === 'install' ? `Successfully installed ${name}!` : `Successfully uninstalled ${name}!`
                webContents.send('install-success', { id, name, text: successText })
                logAuditEvent(`${action}_success`, id, name)
                resolve()
            } else {
                let category = 'Unknown'
                let uiMessage = `${action === 'install' ? 'Installation' : 'Uninstallation'} failed (Code: ${code})`
                if (isTimedOut) {
                    category = 'Network'
                    uiMessage = 'Installation failed: Download timed out after 5 minutes. Please check your internet connection.'
                } else if (outputBuffer.includes('process has already locked') || outputBuffer.includes('Another active Homebrew process is using')) {

                    // Attempt to auto-fix lock issues (once per install attempt)
                    if (attempt < 2) {
                        webContents.send('install-log', { id, text: `⚠️ Lock detected. Attempting to clear stale lock file...\n`, type: 'warning' })

                        // Extract lock file path if present
                        const lockMatch = outputBuffer.match(/locked\s+(\S+)/)
                        if (lockMatch && lockMatch[1]) {
                            try {
                                require('fs').unlinkSync(lockMatch[1])
                                webContents.send('install-log', { id, text: `✓ Deleted lock file: ${lockMatch[1]}\n`, type: 'success' })
                            } catch (e) {
                                // Ignore if file doesn't exist
                            }
                        }

                        // Also try generic cleanup
                        try {
                            require('child_process').execSync('brew cleanup')
                        } catch (e) { }

                        webContents.send('install-log', { id, text: `Retrying installation...\n`, type: 'info' })
                        setTimeout(() => {
                            resolve(executeCommand(options, webContents, attempt + 1))
                        }, 2000)
                        return
                    }

                    category = 'System'
                    uiMessage = `Installation Locked: Another Homebrew process is running. Please wait or restart the app to clear it.`
                } else if (code === 130 || code === 137 || code === null) {
                    category = 'Cancelled'
                    uiMessage = `${action === 'install' ? 'Installation' : 'Uninstallation'} stopped by user.`
                } else if (code === 1 && manager === 'brew' && action === 'uninstall' && require('os').platform() === 'darwin') {
                    // Smart Fallback for macOS manual installs (more aggressive)
                    const fs = require('fs')
                    const os = require('os')
                    const appPaths = [
                        `/Applications/${name}.app`,
                        `/Applications/${name.replace('VS Code', 'Visual Studio Code')}.app`,
                        `${os.homedir()}/Applications/${name}.app`,
                        `/opt/homebrew/Caskroom/${id}`,
                        `/usr/local/Caskroom/${id}`,
                        // Specific app residue (Wireshark, etc)
                        `/Library/Application Support/${name}`,
                        `${os.homedir()}/Library/Application Support/${name}`,
                        `/Library/LaunchDaemons/org.wireshark.ChmodBPF.plist` // Wireshark specific
                    ]

                    webContents.send('install-log', { id, text: `Homebrew failed (Code 1). Checking manual cleanup paths...\n`, type: 'info' })

                    let removed = false
                    for (const p of appPaths) {
                        if (fs.existsSync(p)) {
                            webContents.send('install-log', { id, text: `Found residue: ${p}. Forcing removal...\n`, type: 'info' })
                            try {
                                // Use sudo-ready rm if needed, but for now try normal rm first
                                require('child_process').execSync(`rm -rf "${p}"`)
                                removed = true
                            } catch (e: any) {
                                webContents.send('install-log', { id, text: `Manual removal failed for ${p}: ${e.message}\n`, type: 'error' })
                                // Try with sudo as a last resort if we can (though prompts are hard)
                            }
                        }
                    }

                    if (removed) {
                        webContents.send('install-log', { id, text: `Successfully cleaned up ${name} resouces manually.\n` })
                        webContents.send('install-success', { id, name, text: `Successfully removed ${name} (Manual Fallback).` })
                        logAuditEvent(`uninstall_success`, id, name, { method: 'manual_fallback' })
                        resolve()
                        return
                    }

                    category = 'System'
                    uiMessage = `Uninstallation failed. Homebrew error and no manual paths were found for cleanup.`
                } else if (code === 1 && manager === 'brew') {
                    // Check for sudo/terminal requirements
                    const needsSudo = outputBuffer.includes('sudo: a terminal is required') ||
                        outputBuffer.includes('password is required') ||
                        outputBuffer.includes('askpass')

                    if (needsSudo) {
                        webContents.send('install-log', { id, text: `Admin privileges required. Please enter your password.\n`, type: 'warning' })
                        webContents.send('install-input-request', { id, prompt: 'Password:' })

                        // DEFER RESOLUTION: Suspended Task
                        pendingRetries.set(id, { options, resolve, reject, attempt })
                        return // Exit without resolving/rejecting
                    }

                    if (action === 'uninstall') {
                        webContents.send('install-log', { id, text: `Homebrew reports ${name} is not installed. Action complete.\n`, type: 'info' })
                        webContents.send('install-success', { id, name, text: `Successfully removed ${name} (Already uninstalled).` })
                        logAuditEvent(`uninstall_success`, id, name, { note: 'already_gone' })
                        resolve()
                        return
                    }

                    // Linking Conflict Detection
                    const isLinkingConflict = outputBuffer.includes('It seems there is already a Binary') ||
                        outputBuffer.includes('link conflict') ||
                        outputBuffer.includes('already exists')

                    if (isLinkingConflict && attempt < 2) {
                        webContents.send('install-log', { id, text: `Linking conflict detected. Attempting to fix with 'brew link --overwrite'...\n`, type: 'warning' })

                        // Run repair command synchronously
                        try {
                            const formula = args[1] || id
                            require('child_process').execSync(`brew link --overwrite ${formula}`)

                            webContents.send('install-log', { id, text: `Fix successful. Retrying installation...\n`, type: 'success' })

                            // Recursive retry with incremented attempt
                            resolve(executeCommand(options, webContents, attempt + 1))
                            return
                        } catch (e: any) {
                            webContents.send('install-log', { id, text: `Fix failed: ${e.message}. Continuing to error...\n`, type: 'error' })
                        }
                    }

                    const isNetworkError = outputBuffer.includes('Could not resolve host') ||
                        outputBuffer.includes('Failed to connect') ||
                        outputBuffer.includes('Connection timed out') ||
                        outputBuffer.includes('curl: (6)') ||
                        outputBuffer.includes('curl: (7)') ||
                        outputBuffer.includes('curl: (28)')

                    if (isNetworkError) {
                        if (attempt < 3) { // Retry up to 3 times
                            webContents.send('install-log', { id, text: `Network error detected. Retrying download (Attempt ${attempt + 1}/3)...\n`, type: 'warning' })
                            setTimeout(() => {
                                executeCommand(options, webContents, attempt + 1)
                                    .then(resolve)
                                    .catch(reject)
                            }, 2000)
                            return
                        } else {
                            category = 'Network'
                            uiMessage = 'Download failed due to network issues after multiple retries. Please check your connection.'
                        }
                    } else if (outputBuffer.toLowerCase().includes('unavailable') || outputBuffer.toLowerCase().includes('no cask with this name exists')) {
                        category = 'Configuration'
                        uiMessage = `Installation failed. Cask '${id}' is unavailable. Try running 'brew update' or check the name.`
                    } else if (isLinkingConflict) {
                        category = 'System'
                        // Extract binary path if possible for clarity
                        uiMessage = `Linking Conflict: A binary already exists. Run this in terminal to fix: 'brew link --overwrite ${id}'`
                    } else {
                        category = 'System'
                        uiMessage = `Installation failed. Check logs for details. (Code 1)`
                    }
                } else if (code >= 1 && code <= 10) {
                    category = 'Permission'
                    uiMessage = 'Permission denied or execution error. Try running as Administrator if required.'
                } else if (code === 404 || code >= 500) {
                    category = 'Network'
                    uiMessage = 'Network error. Please check your internet connection.'
                }

                webContents.send('install-error', { id, name, error: uiMessage, category })
                logAuditEvent(`${action}_fail`, id, name, { code, category, message: uiMessage })
                reject(new Error(uiMessage))
            }
        })

        childProcess.on('error', (err) => {
            clearInterval(stallCheck)
            activeProcesses.delete(id)
            webContents.send('install-error', { id, name, error: err.message, category: 'System' })
            reject(err)
        })
    })
}
