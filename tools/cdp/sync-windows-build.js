#!/usr/bin/env node

const {spawnSync} = require('child_process')
const fs = require('fs')
const path = require('path')

const {
    DEFAULT_REMOTE_CHROME_DEV_PATH,
    getOption,
    runMain
} = require('./lib/cdp')

const repoRoot = path.resolve(__dirname, '..', '..')
const defaultSshTarget = 'DBROWER-X40-J+DBROWER@127.0.0.1'
const sshArgs = [
    '-F', '/home/dbrower/.ssh/config',
    '-p', '10022',
    '-o', 'BatchMode=yes'
]
const scpArgs = [
    '-F', '/home/dbrower/.ssh/config',
    '-P', '10022',
    '-o', 'BatchMode=yes'
]

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        ...options
    })
    return {
        command,
        args,
        status: result.status,
        signal: result.signal,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        ok: result.status === 0
    }
}

function summarizeCommand(result) {
    return {
        command: [result.command, ...result.args].join(' '),
        status: result.status,
        signal: result.signal || '',
        stdout: result.stdout.trim().slice(-4000),
        stderr: result.stderr.trim().slice(-4000)
    }
}

function readManifestVersion(sourceDir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'))
    return manifest.version || ''
}

function toCygwinPath(value = '') {
    const text = `${value || ''}`
    const drive = text.match(/^([A-Za-z]):[\\/](.*)$/)
    if(drive) return `/cygdrive/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`
    return text.replace(/\\/g, '/')
}

runMain(async () => {
    const sourceName = getOption('source', 'chrome-dev')
    const sourceDir = path.resolve(repoRoot, sourceName)
    const remotePath = getOption('remote-path', DEFAULT_REMOTE_CHROME_DEV_PATH)
    const remoteShellPath = toCygwinPath(remotePath)
    const sshTarget = getOption('ssh-target', defaultSshTarget)
    const skipBuildDev = process.argv.includes('--skip-build-dev')
    const allowScpFallback = process.argv.includes('--allow-scp-fallback')

    if(!skipBuildDev) {
        const build = run(process.execPath, ['tools/build-chrome-dev.js'])
        if(!build.ok) {
            console.log(JSON.stringify({ok: false, step: 'build-chrome-dev', build: summarizeCommand(build)}, null, 2))
            process.exitCode = 1
            return
        }
    }

    if(!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
        throw new Error(`${sourceDir} is missing manifest.json`)
    }

    const version = readManifestVersion(sourceDir)
    const preflight = run('ssh', [
        ...sshArgs,
        sshTarget,
        `mkdir -p ${remoteShellPath}`
    ])
    if(!preflight.ok) {
        console.log(JSON.stringify({
            ok: false,
            step: 'ssh-preflight',
            sourceDir,
            remotePath,
            remoteShellPath,
            version,
            preflight: summarizeCommand(preflight)
        }, null, 2))
        process.exitCode = 1
        return
    }

    const rsync = run('timeout', [
        '60',
        'rsync',
        '-azc',
        '--delete',
        '-e',
        `ssh ${sshArgs.join(' ')}`,
        `${sourceDir}/`,
        `${sshTarget}:${remoteShellPath}/`
    ])

    let fallback = null
    if(!rsync.ok && allowScpFallback) {
        fallback = run('timeout', [
            '120',
            'scp',
            ...scpArgs,
            '-r',
            `${sourceDir}/.`,
            `${sshTarget}:${remoteShellPath}/`
        ])
    }

    const copied = rsync.ok || fallback?.ok === true
    const verify = copied
        ? run('ssh', [
            ...sshArgs,
            sshTarget,
            `cd ${remoteShellPath} && node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('manifest.json','utf8')); console.log(JSON.stringify({version:m.version,name:m.name,keyPresent:Object.prototype.hasOwnProperty.call(m,'key')}))"`
        ])
        : null

    console.log(JSON.stringify({
        ok: copied && verify?.ok === true,
        sourceDir,
        remotePath,
        remoteShellPath,
        version,
        preflight: summarizeCommand(preflight),
        rsync: summarizeCommand(rsync),
        scpFallbackEnabled: allowScpFallback,
        fallback: fallback ? summarizeCommand(fallback) : null,
        verify: verify ? summarizeCommand(verify) : null
    }, null, 2))
    if(!(copied && verify?.ok === true)) process.exitCode = 1
})
