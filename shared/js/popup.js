const browser = require('webextension-polyfill')
const defaults = require('./defaults')

addEventListener('load', init)

async function init() {
    const manifest = browser.runtime.getManifest()
    const settings = await browser.storage.local.get(defaults)

    document.getElementById('appName').textContent = manifest.name
    document.getElementById('appVersion').textContent = `v${manifest.version}`
    document.getElementById('closePopup').addEventListener('click', () => window.close())

    const form = document.getElementById('settingsForm')
    const status = document.getElementById('status')

    const fopDelay = document.getElementById('fopDelay')
    const flipToAnswers = document.getElementById('flipToAnswers')
    const fopFlipDelay = document.getElementById('fopFlipDelay')
    const profilesPerBatch = document.getElementById('profilesPerBatch')

    fopDelay.value = settings.fopDelay
    flipToAnswers.checked = settings.flipToAnswers
    fopFlipDelay.value = settings.fopFlipDelay
    profilesPerBatch.value = settings.profilesPerBatch

    form.addEventListener('submit', async event => {
        event.preventDefault()

        const nextSettings = {
            fopDelay: fopDelay.valueAsNumber,
            flipToAnswers: flipToAnswers.checked,
            fopFlipDelay: fopFlipDelay.valueAsNumber,
            profilesPerBatch: profilesPerBatch.valueAsNumber
        }

        await browser.storage.local.set(nextSettings)
        showStatus(status, 'Settings saved.')
    })

    form.addEventListener('reset', async () => {
        await browser.storage.local.set(defaults)

        fopDelay.value = defaults.fopDelay
        flipToAnswers.checked = defaults.flipToAnswers
        fopFlipDelay.value = defaults.fopFlipDelay
        profilesPerBatch.value = defaults.profilesPerBatch

        showStatus(status, 'Settings reset.')
    })
}

function showStatus(element, message) {
    element.textContent = message
    element.hidden = false

    clearTimeout(showStatus.timeoutId)
    showStatus.timeoutId = setTimeout(() => {
        element.hidden = true
        element.textContent = ''
    }, 1200)
}
