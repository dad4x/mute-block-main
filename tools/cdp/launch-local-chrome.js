#!/usr/bin/env node
'use strict'

// npm scripts run through cmd.exe on Windows, which can't execute a .sh
// file, and neither Git for Windows' nor Cygwin's bash is guaranteed to be
// on the system PATH. This wrapper finds a working bash the same way every
// other tool in this directory is already invoked (`node tools/cdp/*.js`)
// and hands off to the real script.

const {spawnSync} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const scriptPath = path.join(__dirname, 'launch-local-chrome.sh')

const bashCandidates = [
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\cygwin64\\bin\\bash.exe'
]

function resolveBash() {
    for(const candidate of bashCandidates) {
        if(candidate === 'bash') {
            const probe = spawnSync(candidate, ['--version'], {stdio: 'ignore'})
            if(!probe.error) return candidate
            continue
        }
        if(fs.existsSync(candidate)) return candidate
    }
    return null
}

const bash = resolveBash()
if(!bash) {
    console.error(`could not find a bash interpreter (checked PATH, Git for Windows, Cygwin) to run ${scriptPath}`)
    process.exit(1)
}

const result = spawnSync(bash, [scriptPath, ...process.argv.slice(2)], {stdio: 'inherit'})
process.exit(result.status === null ? 1 : result.status)
