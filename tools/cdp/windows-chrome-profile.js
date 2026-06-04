#!/usr/bin/env node

const {spawnSync} = require('child_process')

const DEFAULT_REMOTE_PORT = 9224
const DEFAULT_LOCAL_PORT = 9224
const DEFAULT_START_URL = 'about:blank'

function parseArgs(argv) {
    const options = {
        ssh: process.env.MB_WINDOWS_SSH || '',
        remotePort: DEFAULT_REMOTE_PORT,
        localPort: DEFAULT_LOCAL_PORT,
        killPorts: [],
        stop: true,
        newProfile: false,
        profileDir: '',
        profileLabel: 'mb-disposable',
        extensionDir: process.env.MB_WINDOWS_EXTENSION_DIR || '',
        startUrl: DEFAULT_START_URL,
        dryRun: false
    }

    for(let index = 2; index < argv.length; index += 1) {
        const arg = argv[index]
        const readValue = fallback => {
            const next = argv[index + 1]
            if(next && !next.startsWith('--')) {
                index += 1
                return next
            }
            return fallback
        }

        if(arg === '--ssh') options.ssh = readValue(options.ssh)
        else if(arg.startsWith('--ssh=')) options.ssh = arg.slice('--ssh='.length)
        else if(arg === '--remote-port') options.remotePort = parsePort(readValue(`${options.remotePort}`), options.remotePort)
        else if(arg.startsWith('--remote-port=')) options.remotePort = parsePort(arg.slice('--remote-port='.length), options.remotePort)
        else if(arg === '--local-port') options.localPort = parsePort(readValue(`${options.localPort}`), options.localPort)
        else if(arg.startsWith('--local-port=')) options.localPort = parsePort(arg.slice('--local-port='.length), options.localPort)
        else if(arg === '--kill-port') options.killPorts.push(parsePort(readValue(''), 0))
        else if(arg.startsWith('--kill-port=')) options.killPorts.push(parsePort(arg.slice('--kill-port='.length), 0))
        else if(arg === '--no-stop') options.stop = false
        else if(arg === '--new-profile') options.newProfile = true
        else if(arg === '--profile-dir') options.profileDir = readValue(options.profileDir)
        else if(arg.startsWith('--profile-dir=')) options.profileDir = arg.slice('--profile-dir='.length)
        else if(arg === '--profile-label') options.profileLabel = readValue(options.profileLabel)
        else if(arg.startsWith('--profile-label=')) options.profileLabel = arg.slice('--profile-label='.length)
        else if(arg === '--extension-dir') options.extensionDir = readValue(options.extensionDir)
        else if(arg.startsWith('--extension-dir=')) options.extensionDir = arg.slice('--extension-dir='.length)
        else if(arg === '--start-url') options.startUrl = readValue(options.startUrl)
        else if(arg.startsWith('--start-url=')) options.startUrl = arg.slice('--start-url='.length)
        else if(arg === '--dry-run') options.dryRun = true
        else if(arg === '--help' || arg === '-h') {
            printUsage()
            process.exit(0)
        }
        else throw new Error(`unknown argument: ${arg}`)
    }

    if(!options.ssh) throw new Error('--ssh USER@WINDOWS_HOST is required, or set MB_WINDOWS_SSH')
    if(options.newProfile && options.profileDir) throw new Error('--new-profile and --profile-dir are mutually exclusive')
    if(!options.newProfile && !options.profileDir) options.newProfile = true

    options.killPorts = dedupeNumbers([options.remotePort, ...options.killPorts].filter(Boolean))
    return options
}

function parsePort(value, fallback) {
    const port = Number.parseInt(`${value || ''}`, 10)
    if(Number.isInteger(port) && port > 0 && port < 65536) return port
    return fallback
}

function dedupeNumbers(values) {
    return Array.from(new Set(values))
}

function printUsage() {
    console.log([
        'Usage:',
        '  node tools/cdp/windows-chrome-profile.js --ssh USER@WINDOWS_HOST --remote-port 9224 --new-profile',
        '  node tools/cdp/windows-chrome-profile.js --ssh USER@WINDOWS_HOST --remote-port 9224 --profile-dir "C:\\\\Users\\\\DBROWER\\\\AppData\\\\Local\\\\Temp\\\\mb-profile"',
        '',
        'Options:',
        '  --ssh USER@WINDOWS_HOST              Required unless MB_WINDOWS_SSH is set.',
        '  --remote-port 9224                  Windows Chrome DevTools port.',
        '  --local-port 9224                   Local port to show in the tunnel command.',
        '  --kill-port PORT                    Also kill a Chrome/debug listener on this Windows port. Repeatable.',
        '  --no-stop                           Do not stop existing listeners before launch.',
        '  --new-profile                       Create a new disposable Windows profile under %LOCALAPPDATA%\\Temp.',
        '  --profile-dir WINDOWS_PATH          Reuse an existing Windows user-data-dir.',
        '  --profile-label NAME                Prefix for generated disposable profile names.',
        '  --extension-dir WINDOWS_PATH        Optional unpacked extension directory to load in the profile.',
        '  --start-url URL                     Initial URL. Default: about:blank.',
        '  --dry-run                           Print remote commands without running ssh.',
        '',
        'Notes:',
        '  The tunnel is intentionally separate. After launch, run the printed ssh -N -L command.',
        '  A new disposable profile will need a fresh Quora login before authenticated tests.'
    ].join('\n'))
}

function cmdEscapeValue(value = '') {
    const text = `${value}`
    if(/["\r\n]/.test(text)) throw new Error(`unsupported character in Windows command value: ${text}`)
    return text
}

function bashDoubleQuote(value = '') {
    return `"${`${value}`.replace(/(["\\$`])/g, '\\$1')}"`
}

function cmdRemote(command) {
    return `cmd.exe /d /s /c ${bashDoubleQuote(command)}`
}

function runRemote(options, command, label) {
    const remoteCommand = cmdRemote(command)
    if(options.dryRun) {
        return {
            label,
            remoteCommand,
            status: 0,
            stdout: '',
            stderr: ''
        }
    }

    const result = spawnSync('ssh', [options.ssh, remoteCommand], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    })
    if(result.error) throw result.error
    if(result.status !== 0) {
        const error = new Error(`${label} failed with exit ${result.status}: ${result.stderr || result.stdout}`)
        error.result = result
        throw error
    }
    return {
        label,
        remoteCommand,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    }
}

function killPortCommand(port) {
    return [
        `echo Stopping listeners on 127.0.0.1:${port}`,
        `for /f "tokens=5" %P in ('netstat -ano ^| findstr /R /C:":${port} .*LISTENING"') do taskkill /F /PID %P`,
        'exit /b 0'
    ].join(' & ')
}

function startChromeCommand(options) {
    const profileLabel = cmdEscapeValue(options.profileLabel).replace(/[^A-Za-z0-9_.-]/g, '-')
    const startUrl = cmdEscapeValue(options.startUrl || DEFAULT_START_URL)
    const extensionArgs = options.extensionDir
        ? ` --load-extension="${cmdEscapeValue(options.extensionDir)}"`
        : ''
    const profileSetup = options.newProfile
        ? [
            `set "P=%LOCALAPPDATA%\\Temp\\${profileLabel}-%RANDOM%-%RANDOM%"`,
            'mkdir "%P%"'
        ]
        : [`set "P=${cmdEscapeValue(options.profileDir)}"`]

    return [
        'set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
        'if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
        'if not exist "%CHROME%" (echo Chrome not found & exit /b 2)',
        ...profileSetup,
        `echo Chrome profile: %P%`,
        `start "" "%CHROME%" --user-data-dir="%P%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=${options.remotePort} --no-first-run --no-default-browser-check --disable-background-mode${extensionArgs} --new-window "${startUrl}"`
    ].join(' && ')
}

function tunnelCommand(options) {
    return `ssh -N -L ${options.localPort}:127.0.0.1:${options.remotePort} ${options.ssh}`
}

function main() {
    const options = parseArgs(process.argv)
    const commands = []

    if(options.stop) {
        for(const port of options.killPorts) {
            commands.push(runRemote(options, killPortCommand(port), `stop-port-${port}`))
        }
    }
    commands.push(runRemote(options, startChromeCommand(options), 'start-chrome'))

    const output = {
        ok: true,
        dryRun: options.dryRun,
        ssh: options.ssh,
        remotePort: options.remotePort,
        localPort: options.localPort,
        profileMode: options.newProfile ? 'new-disposable' : 'existing',
        profileDir: options.newProfile ? '' : options.profileDir,
        extensionDir: options.extensionDir || '',
        startUrl: options.startUrl,
        killedPorts: options.stop ? options.killPorts : [],
        commands,
        tunnelCommand: tunnelCommand(options),
        cdpVersionUrl: `http://127.0.0.1:${options.localPort}/json/version`,
        notes: options.newProfile
            ? ['New disposable profile launched. Quora will require a fresh login before authenticated tests.']
            : []
    }
    console.log(JSON.stringify(output, null, 2))
}

try {
    main()
}
catch(error) {
    console.error(JSON.stringify({ok: false, error: error.message, stack: error.stack}, null, 2))
    process.exit(1)
}
