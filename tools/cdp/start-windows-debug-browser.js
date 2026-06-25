#!/usr/bin/env node

const {spawnSync} = require('child_process')

const DEFAULT_SSH_ARGS = [
    '-F', '/home/dbrower/.ssh/config',
    '-p', '10022',
    '-o', 'BatchMode=yes',
    'DBROWER-X40-J+DBROWER@127.0.0.1'
]
const DEFAULT_PROFILE_DIR = 'C:\\Users\\DBROWER\\AppData\\Local\\Temp\\mb-chrome-debug'
const DEFAULT_EXTENSION_DIR = 'C:\\Users\\DBROWER\\Documents\\src\\mute-block-main\\chrome-dev'
const DEFAULT_CMD_PATH = '/cygdrive/c/Users/DBROWER/AppData/Local/Temp/mb-launch-debug.cmd'
const DEFAULT_WINDOWS_CMD_PATH = 'C:\\Users\\DBROWER\\AppData\\Local\\Temp\\mb-launch-debug.cmd'

function parseArgs(argv) {
    const options = {
        remotePort: 9222,
        profileDir: DEFAULT_PROFILE_DIR,
        extensionDir: DEFAULT_EXTENSION_DIR,
        startUrl: 'chrome://extensions/',
        taskName: 'MBChromeDebug',
        stopProfileChrome: true
    }
    for(let index = 2; index < argv.length; index += 1) {
        const arg = argv[index]
        const readValue = () => {
            const value = argv[index + 1]
            if(!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`)
            index += 1
            return value
        }
        if(arg === '--remote-port') options.remotePort = Number.parseInt(readValue(), 10) || options.remotePort
        else if(arg.startsWith('--remote-port=')) options.remotePort = Number.parseInt(arg.slice('--remote-port='.length), 10) || options.remotePort
        else if(arg === '--profile-dir') options.profileDir = readValue()
        else if(arg.startsWith('--profile-dir=')) options.profileDir = arg.slice('--profile-dir='.length)
        else if(arg === '--extension-dir') options.extensionDir = readValue()
        else if(arg.startsWith('--extension-dir=')) options.extensionDir = arg.slice('--extension-dir='.length)
        else if(arg === '--start-url') options.startUrl = readValue()
        else if(arg.startsWith('--start-url=')) options.startUrl = arg.slice('--start-url='.length)
        else if(arg === '--task-name') options.taskName = readValue()
        else if(arg.startsWith('--task-name=')) options.taskName = arg.slice('--task-name='.length)
        else if(arg === '--no-stop-profile-chrome') options.stopProfileChrome = false
        else if(arg === '--help' || arg === '-h') {
            console.log([
                'Usage:',
                '  node tools/cdp/start-windows-debug-browser.js [--remote-port 9222]',
                '',
                'Starts the existing Windows debug Chrome profile in the visible console session',
                'through an interactive scheduled task, with the dev unpacked extension loaded.'
            ].join('\n'))
            process.exit(0)
        }
        else throw new Error(`unknown argument: ${arg}`)
    }
    return options
}

function runSsh(command, input = '') {
    const result = spawnSync('ssh', [...DEFAULT_SSH_ARGS, command], {
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'pipe']
    })
    if(result.error) throw result.error
    return {
        status: result.status,
        signal: result.signal || '',
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    }
}

function quoteCmd(value = '') {
    return `"${`${value}`.replace(/"/g, '""')}"`
}

function buildCmd(options) {
    return [
        '@echo off',
        'set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
        'if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
        'if not exist "%CHROME%" (echo Chrome not found & exit /b 2)',
        `start "" "%CHROME%" --user-data-dir=${quoteCmd(options.profileDir)} --remote-debugging-address=127.0.0.1 --remote-debugging-port=${options.remotePort} --no-first-run --no-default-browser-check --disable-background-mode --load-extension=${quoteCmd(options.extensionDir)} --new-window ${quoteCmd(options.startUrl)}`
    ].join('\r\n') + '\r\n'
}

function main() {
    const options = parseArgs(process.argv)
    const commands = []
    commands.push({
        label: 'write-launch-cmd',
        ...runSsh(`cat > ${DEFAULT_CMD_PATH}`, buildCmd(options))
    })
    if(commands[0].status !== 0) throw new Error(`write launch cmd failed: ${commands[0].stderr || commands[0].stdout}`)

    if(options.stopProfileChrome) {
        const escapedProfile = options.profileDir.replace(/\\/g, '\\\\')
        commands.push({
            label: 'stop-profile-chrome',
            ...runSsh(`cmd.exe /d /s /c "wmic process where \\"name='chrome.exe' and commandline like '%${escapedProfile}%'\\" call terminate >nul 2>nul & exit /b 0"`)
        })
    }

    const taskCommand = [
        `schtasks /Create /TN ${quoteCmd(options.taskName)} /SC ONCE /ST 23:59 /TR ${quoteCmd(DEFAULT_WINDOWS_CMD_PATH)} /F /IT`,
        `schtasks /Run /TN ${quoteCmd(options.taskName)}`
    ].join(' && ')
    commands.push({
        label: 'run-visible-task',
        ...runSsh(`cmd.exe /d /s /c ${quoteCmd(taskCommand)}`)
    })
    if(commands[commands.length - 1].status !== 0) {
        throw new Error(`scheduled task launch failed: ${commands[commands.length - 1].stderr || commands[commands.length - 1].stdout}`)
    }

    console.log(JSON.stringify({
        ok: true,
        remotePort: options.remotePort,
        localPort: 9223,
        profileDir: options.profileDir,
        extensionDir: options.extensionDir,
        startUrl: options.startUrl,
        taskName: options.taskName,
        cdpVersionUrl: 'http://127.0.0.1:9223/json/version',
        cdpProbeCommand: "timeout 10 curl --noproxy '*' -sS http://127.0.0.1:9223/json/version",
        notes: [
            "Use curl --noproxy '*' for manual CDP probes; plain curl may hang behind proxy configuration."
        ],
        commands
    }, null, 2))
}

try {
    main()
}
catch(error) {
    console.error(JSON.stringify({ok: false, error: error.message, stack: error.stack}, null, 2))
    process.exit(1)
}
