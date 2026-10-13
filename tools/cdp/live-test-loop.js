#!/usr/bin/env node

const {spawnSync} = require('child_process')
const path = require('path')

const {
    DEFAULT_CHROME_DEV_PATH,
    getOption,
    runMain
} = require('./lib/cdp')

const repoRoot = path.resolve(__dirname, '..', '..')

function hasFlag(name) {
    return process.argv.includes(`--${name}`)
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 30 * 1024 * 1024,
        ...options
    })
    return {
        command,
        args,
        status: result.status,
        signal: result.signal || '',
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        ok: result.status === 0
    }
}

function summarize(result) {
    return {
        command: [result.command, ...result.args].join(' '),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout.trim().slice(-6000),
        stderr: result.stderr.trim().slice(-6000)
    }
}

function parseJsonTail(text = '') {
    const start = text.lastIndexOf('\n{')
    const candidate = start >= 0 ? text.slice(start + 1) : text
    try {
        return JSON.parse(candidate)
    }
    catch {
        return null
    }
}

runMain(async () => {
    const phase = getOption('phase', '')
    const extensionPath = getOption('extension-path', DEFAULT_CHROME_DEV_PATH)
    const skipProd = hasFlag('skip-prod')
    const skipReload = hasFlag('skip-reload')
    const skipTabReset = hasFlag('skip-tab-reset')
    const allowWorkProducing = hasFlag('allow-work-producing')
    const phaseArgsText = getOption('phase-args', '')
    const phaseArgs = phaseArgsText ? phaseArgsText.split(/\s+/).filter(Boolean) : []
    const steps = []

    if(!skipProd) {
        const prod = run('npm', ['run', 'prod'])
        steps.push({name: 'prod', result: summarize(prod)})
        if(!prod.ok) {
            console.log(JSON.stringify({ok: false, failedStep: 'prod', steps}, null, 2))
            process.exitCode = 1
            return
        }
    }

    const buildDev = run(process.execPath, ['tools/build-chrome-dev.js'])
    steps.push({name: 'build-chrome-dev', result: summarize(buildDev)})
    if(!buildDev.ok) {
        console.log(JSON.stringify({ok: false, failedStep: 'build-chrome-dev', steps}, null, 2))
        process.exitCode = 1
        return
    }

    let extensionId = 'auto'
    if(!skipReload) {
        const reload = run(process.execPath, [
            'tools/cdp/reload-chrome-dev.js',
            '--extension-id',
            'auto',
            '--extension-path',
            extensionPath
        ])
        const data = parseJsonTail(reload.stdout)
        if(data?.extensionId) extensionId = data.extensionId
        steps.push({name: 'reload-chrome-dev', result: summarize(reload), data})
        if(!reload.ok) {
            console.log(JSON.stringify({ok: false, failedStep: 'reload-chrome-dev', steps}, null, 2))
            process.exitCode = 1
            return
        }
    }

    if(!skipTabReset) {
        const resetTabs = run(process.execPath, [
            'tools/cdp/reset-chrome-dev-tabs.js',
            '--extension-id',
            extensionId,
            '--extension-path',
            extensionPath
        ])
        steps.push({name: 'reset-chrome-dev-tabs', result: summarize(resetTabs), data: parseJsonTail(resetTabs.stdout)})
        if(!resetTabs.ok) {
            console.log(JSON.stringify({ok: false, failedStep: 'reset-chrome-dev-tabs', extensionId, steps}, null, 2))
            process.exitCode = 1
            return
        }
    }

    if(phase) {
        const args = [
            'tools/cdp/upgrade-regression/run.js',
            '--extension-id',
            extensionId,
            '--extension-path',
            extensionPath,
            '--phase',
            phase,
            ...phaseArgs
        ]
        if(allowWorkProducing) args.push('--allow-work-producing')
        const phaseRun = run(process.execPath, args)
        steps.push({name: 'phase', result: summarize(phaseRun), data: parseJsonTail(phaseRun.stdout)})
        if(!phaseRun.ok) {
            console.log(JSON.stringify({ok: false, failedStep: 'phase', extensionId, steps}, null, 2))
            process.exitCode = 1
            return
        }
    }

    console.log(JSON.stringify({
        ok: true,
        extensionId,
        extensionPath,
        phase: phase || '',
        steps
    }, null, 2))
})
