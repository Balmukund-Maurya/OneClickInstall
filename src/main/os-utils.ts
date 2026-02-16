import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execAsync = promisify(exec)

export type Platform = 'win32' | 'darwin'
export type PackageManager = 'brew' | 'winget' | 'none'

export const getPlatform = (): Platform => {
    const platform = os.platform()
    if (platform !== 'win32' && platform !== 'darwin') {
        throw new Error(`Unsupported platform: ${platform}`)
    }
    return platform
}

const fs = require('fs')
const path = require('path')

export const checkPackageManager = async (platform: Platform): Promise<PackageManager> => {
    if (platform === 'darwin') {
        const brewPaths = [
            '/opt/homebrew/bin/brew', // Apple Silicon
            '/usr/local/bin/brew',    // Intel
            '/usr/bin/brew',          // Standard
            '/bin/brew'
        ]


        for (const p of brewPaths) {
            if (fs.existsSync(p)) {
                // Path found
                // Fix PATH for subsequent commands
                const binDir = path.dirname(p)
                if (!process.env.PATH?.includes(binDir)) {
                    process.env.PATH = `${binDir}:${process.env.PATH || ''}`
                }
                break
            }
        }

        try {
            await execAsync('brew --version')
            return 'brew' // PATH is now fixed, so 'brew' command works
        } catch (e) {
            console.error('Brew check failed:', e)
            return 'none'
        }
    } else if (platform === 'win32') {
        try {
            await execAsync('winget --version')
            return 'winget'
        } catch {
            return 'none'
        }
    }
    return 'none'
}

export const getPlatformLabel = (platform: Platform): string => {
    return platform === 'darwin' ? 'macOS' : 'Windows'
}

/**
 * Efficiently checks inventory for all software items at once.
 */
export const checkSoftwareInventory = async (
    platform: Platform,
    pm: PackageManager,
    softwareList: any[]
): Promise<Record<string, boolean>> => {
    const inventory: Record<string, boolean> = {}
    let installedList: string[] = []

    // 1. Batch fetch from Package Manager
    if (pm !== 'none') {
        try {
            if (platform === 'darwin') {
                const { stdout: casks } = await execAsync('brew list --cask').catch(() => ({ stdout: '' }))
                const { stdout: formulae } = await execAsync('brew list').catch(() => ({ stdout: '' }))
                installedList = [...casks.split('\n'), ...formulae.split('\n')].map(s => s.trim().toLowerCase())
            } else if (platform === 'win32') {
                const { stdout } = await execAsync('winget list').catch(() => ({ stdout: '' }))
                installedList = stdout.toLowerCase().split('\n').map(s => s.trim())
            }
        } catch (error) {
            console.error('Failed to batch list packages:', error)
        }
    }

    // 2. Map inventory
    const fs = require('fs')
    for (const software of softwareList) {
        const platformConfig = software.platforms?.[platform]

        // Extraction of search terms
        // Extraction of search terms passed - using direct strict matching now

        // Add platform-specific IDs from args (e.g., Microsoft.VisualStudioCode)


        // Check PM list
        const isPmInstalled = installedList.some(item => {
            const lowerItem = item.toLowerCase()

            // 1. Column-based ID Match (Robust for winget/tables)
            // Split by whitespace to find exact ID match in any column
            const columns = lowerItem.split(/\s+/)
            if (columns.includes(software.id.toLowerCase())) return true

            // 2. Strict Argument ID Match (if available)
            if (platformConfig?.args) {
                // Check explicit --id argument
                const idIndex = platformConfig.args.indexOf('--id')
                if (idIndex !== -1 && platformConfig.args[idIndex + 1]) {
                    if (columns.includes(platformConfig.args[idIndex + 1].toLowerCase())) return true
                }

                // Check last argument (common for brew install <package>)
                const brewId = platformConfig.args[platformConfig.args.length - 1]
                if (brewId && !brewId.startsWith('-')) {
                    if (columns.includes(brewId.toLowerCase())) return true
                    // Handle versioned formulae (e.g. python@3.11 matching python)
                    if (lowerItem.startsWith(brewId.toLowerCase() + '@')) return true
                }
            }

            return false
        })

        if (isPmInstalled) {
            inventory[software.id] = true
            continue
        }

        // System Fallbacks (For manual installs)
        if (platform === 'darwin') {
            const nameVariations = [
                software.name,
                software.id, // Check ID as well (e.g. 'vlc')
                software.name.replace(' ', '') // Compact name
            ]

            if (software.name.includes('VS Code')) {
                nameVariations.push('Visual Studio Code')
            }
            if (software.name.includes('PyCharm')) {
                nameVariations.push('PyCharm CE')
                nameVariations.push('PyCharm Community Edition')
            }

            const found = nameVariations.some(variant => {
                // Handle case-insensitive naming by checking existence generally, 
                // but usually /Applications/Name.app is standard.
                const appPath = `/Applications/${variant}.app`
                const userAppPath = `${os.homedir()}/Applications/${variant}.app`
                return fs.existsSync(appPath) || fs.existsSync(userAppPath)
            })

            if (found) {
                inventory[software.id] = true
                continue
            }
        }

        inventory[software.id] = false
    }

    return inventory
}

/**
 * Checks if a specific software package is already installed.
 * Used for targeted checks (single item).
 */
export const checkSoftwareInstalled = async (platform: string, pm: string, id: string, name: string): Promise<boolean> => {
    try {
        const fs = require('fs')

        // 1. Check Package Manager (Primary)
        if (pm !== 'none') {
            try {
                if (platform === 'darwin') {
                    // Optimized for single check
                    const { stdout } = await execAsync(`${pm} list ${id}`).catch(() => ({ stdout: '' }))
                    if (stdout.includes(id)) return true
                } else if (platform === 'win32') {
                    const { stdout } = await execAsync(`${pm} list --id ${id}`).catch(() => ({ stdout: '' }))
                    if (stdout.includes(id)) return true
                }
            } catch (err) {
                // Silently ignore read errors - not critical
            }
        }

        // 2. System Fallback
        if (platform === 'darwin') {
            if (fs.existsSync(`/Applications/${name}.app`)) return true
        }

        return false
    } catch (error) {
        return false
    }
}

export const getFreeDiskSpace = async (): Promise<number> => {
    // Returns free space in bytes
    const platform = process.platform

    if (platform === 'darwin' || platform === 'linux') {
        // Use df -k / (returns 1KB blocks)
        try {
            const { stdout } = await execAsync('df -k /')
            const lines = stdout.trim().split('\n')
            if (lines.length < 2) return 0

            // Format: Filesystem 1024-blocks Used Available Capacity ...
            const parts = lines[1].split(/\s+/)
            const availableK = parseInt(parts[3], 10)
            return availableK * 1024
        } catch (e) {
            console.error('Failed to check disk space:', e)
            return 0
        }
    } else if (platform === 'win32') {
        // Use wmic logicaldisk get size,freespace,caption
        try {
            const { stdout } = await execAsync('wmic logicaldisk get freespace,caption')
            const lines = stdout.trim().split('\n')
            // Find line with C:
            for (const line of lines) {
                if (line.includes('C:')) {
                    // FreeSpace is usually first if alphabetical? No, wait.
                    // On my machine: "FreeSpace       Size"
                    // Actually let's just parse numbers.
                    const match = line.match(/(\d+)/)
                    if (match) return parseInt(match[1], 10)
                }
            }
            return 0
        } catch (e) {
            console.error('Failed to check disk space:', e)
            return 0
        }
    }
    return 0
}
/**
 * Returns detailed system information.
 */
export const getSystemDetails = () => {
    const cpus = os.cpus()
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown Limit'
    const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)
    const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2)

    return {
        hostname: os.hostname(),
        platform: os.type() + ' ' + os.release(),
        arch: os.arch(),
        cpuModel,
        cpuCores: cpus.length,
        totalMemory: `${totalMem} GB`,
        freeMemory: `${freeMem} GB`,
        uptime: `${(os.uptime() / 3600).toFixed(1)} Hours`
    }
}
