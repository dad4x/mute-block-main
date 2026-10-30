'use strict'

// Firefox background event page idle check. Reads the background boot id, waits
// idle, then reads it again. A changed id means the event page unloaded while idle
// and was restarted by the next message. Uses the extension page as the message
// sender. Never touches the user's Firefox.
//
//   node experiments/design-probes/run-firefox-idle.js [idleSeconds]

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {Marionette} = require('../page-throttle/marionette')

const FIREFOX_BIN = process.env.SPIKE_FIREFOX_BIN || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext-firefox')
const PROFILE_DIR = path.join(ROOT, `.profile-firefox-idle-${Date.now()}`)
const IDLE_SECONDS = Number(process.argv[2] || 90)
const MARIONETTE_PORT = 2950 + (Date.now() % 40)

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function unwrap(response) {
    return response && typeof response === 'object' && 'value' in response ? response.value : response
}

async function main() {
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    fs.writeFileSync(path.join(PROFILE_DIR, 'user.js'), [
        `user_pref("marionette.port", ${MARIONETTE_PORT});`,
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.aboutwelcome.enabled", false);',
        'user_pref("datareporting.policy.dismissedNotification", true);',
        'user_pref("browser.startup.homepage_welcome_url", "about:blank");',
        ''
    ].join('\n'))
    spawn(FIREFOX_BIN, ['-marionette', '-remote-allow-system-access', '-profile', PROFILE_DIR, '-no-remote', 'about:blank'], {
        detached: true,
        stdio: 'ignore'
    }).unref()
    const marionette = new Marionette(MARIONETTE_PORT)
    await marionette.connect()
    const result = {idleSeconds: IDLE_SECONDS}
    try {
        await marionette.send('WebDriver:NewSession', {capabilities: {}})
        await marionette.send('WebDriver:SetTimeouts', {script: 300000, pageLoad: 60000})
        const addonId = unwrap(await marionette.send('Addon:Install', {path: EXT_DIR, temporary: true}))
        await marionette.send('Marionette:SetContext', {value: 'chrome'})
        const uuid = unwrap(await marionette.send('WebDriver:ExecuteScript', {
            script: 'const policy = WebExtensionPolicy.getByID(arguments[0]); return policy ? policy.mozExtensionHostname : null',
            args: [addonId]
        }))
        await marionette.send('Marionette:SetContext', {value: 'content'})
        const created = await marionette.send('WebDriver:NewWindow', {type: 'tab'})
        await marionette.send('WebDriver:SwitchToWindow', {handle: created.handle, focus: true})
        await marionette.send('WebDriver:Navigate', {url: `moz-extension://${uuid}/page.html?role=viewer`})
        const readBoot = async () => {
            const deadline = Date.now() + 15000
            while(Date.now() < deadline) {
                try {
                    const value = unwrap(await marionette.send('WebDriver:ExecuteAsyncScript', {
                        script: 'const done = arguments[arguments.length - 1]; window.spike.swState().then(done)',
                        args: []
                    }))
                    if(value?.bootId) return value
                }
                catch {}
                await sleep(300)
            }
            return null
        }
        const before = await readBoot()
        result.bootIdBefore = before?.bootId ?? null
        await sleep(IDLE_SECONDS * 1000)
        const after = await readBoot()
        result.bootIdAfterIdle = after?.bootId ?? null
        result.restartedWhileIdle = result.bootIdBefore !== null && result.bootIdBefore !== result.bootIdAfterIdle
        console.log(JSON.stringify(result, null, 2))
    }
    finally {
        try {
            await marionette.send('Marionette:Quit', {flags: ['eForceQuit']})
        }
        catch {}
        marionette.close()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
