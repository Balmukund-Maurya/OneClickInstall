import { WebContents } from 'electron'
import { ChildProcess } from 'child_process'

export const parseProgress = (data: string): { percent: number, speed: string } | null => {
    // Match generic column structure:
    // Group 1: % Received (2nd column, but closely matches 1st)
    const pctMatch = data.match(/^\s*(\d{1,3})\s+/)
    let percent = 0
    let speed = ''

    if (pctMatch) {
        percent = parseFloat(pctMatch[1])
    } else {
        // Fallback: Match "hash style" bars (e.g. "##### 100.0%")
        const hashMatch = data.match(/#+\s+(\d+(?:\.\d+)?)%/)
        if (hashMatch) {
            percent = parseFloat(hashMatch[1])
        }
    }

    // Match Speed (Current Speed is last column)
    // Pattern: number+unit, or 0, or -
    const tokens = data.trim().split(/\s+/)
    let rawSpeed = ''

    if (tokens.length >= 8) {
        const lastToken = tokens[tokens.length - 1]
        // Verify it looks like a speed (number, maybe unit, or -/0)
        if (/^[\d.]+[kKMG]?$/.test(lastToken) || lastToken === '-' || lastToken === '0') {
            rawSpeed = lastToken
        }
    }

    // Fallback: regex for standard units
    if (!rawSpeed) {
        const speedUnitMatch = data.match(/(\d+(?:\.\d+)?)([kKMG])(?:\s|$)/g)
        if (speedUnitMatch && speedUnitMatch.length > 0) {
            rawSpeed = speedUnitMatch[speedUnitMatch.length - 1]
        }
    }

    if (rawSpeed) {
        if (rawSpeed === '-' || rawSpeed === '0') {
            speed = '0 KB/s'
        } else {
            speed = rawSpeed.replace('k', ' KB/s').replace('M', ' MB/s').replace('G', ' GB/s')
            // If no replacement happened and it looks like a number, assume bytes
            if (speed === rawSpeed && /^[\d.]+$/.test(speed)) speed += ' B/s'
        }
    }

    if (percent > 0) {
        return { percent, speed }
    }
    return null
}

export const createStallCheck = (
    id: string,
    name: string,
    childProcess: ChildProcess,
    webContents: WebContents,
    getState: () => { lastDataTime: number, lastProgressLogTime: number, currentPhase: string, lastPercent?: number },
    updateLastProgressLogTime: () => void,
    onTimeout?: () => void
) => {
    return setInterval(() => {
        const { lastDataTime, lastProgressLogTime, currentPhase, lastPercent } = getState()
        const timeSinceLastData = Date.now() - lastDataTime
        const timeSinceLastProgress = Date.now() - lastProgressLogTime

        // 1. UI Feedback for Stalls (Every 5s of silence)
        // Warn if stalled for > 5s, up to 5 minutes
        if (currentPhase === 'downloading' && timeSinceLastProgress > 5000 && timeSinceLastProgress < 300000) {

            // Reconstruct the bar to show stalled state
            const percent = lastPercent || 0
            const barWidth = 30
            const filled = Math.round((percent / 100) * barWidth)
            const empty = barWidth - filled
            const bar = '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']'

            webContents.send('install-log', {
                id,
                text: `Downloading: ${bar} ${percent.toFixed(1)}% (Stalled - Network Issue)`,
                type: 'warning',
                replace: true
            })
        }

        // 2. Hard Timeout (5 minutes no data)
        if (timeSinceLastData > 300000 && currentPhase === 'downloading') {
            if (onTimeout) {
                onTimeout()
            } else {
                // Fallback for legacy calls
                webContents.send('install-log', { id, text: `\nDownload stalled for 5m. Forcing retry...\n`, type: 'error' })
                if (childProcess && !childProcess.killed) {
                    childProcess.kill('SIGKILL')
                }
            }
        }

        // 3. General "Taking a while" warnings
        if (timeSinceLastData > 45000 && currentPhase !== 'downloading') {
            let stallMessage = `... Operation in progress (${currentPhase}). Taking longer than expected...\n`
            if (currentPhase === 'installing') stallMessage = `... ${name} is installing. This can take a few minutes.\n`

            if (Date.now() - lastProgressLogTime > 10000) {
                webContents.send('install-log', { id, text: stallMessage, type: 'info' })
                updateLastProgressLogTime()
            }
        }
    }, 5000)
}
