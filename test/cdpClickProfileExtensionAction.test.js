const assert = require('node:assert/strict')

const {
    getClickExtensionActionPageFunction
} = require('../tools/cdp/click-profile-extension-action')

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

function makeButton({text = '', aria = '', title = ''} = {}) {
    return {
        innerText: text,
        textContent: text,
        clicked: false,
        getAttribute(name) {
            if(name === 'aria-label') return aria
            if(name === 'title') return title
            return ''
        },
        getBoundingClientRect() {
            return {width: 100, height: 20}
        },
        click() {
            this.clicked = true
        }
    }
}

function withFakePage(buttons, fn) {
    const previous = {
        document: global.document,
        window: global.window,
        location: global.location
    }
    global.document = {
        title: 'Synthetic Profile',
        visibilityState: 'visible',
        querySelectorAll() {
            return buttons
        }
    }
    global.window = {
        getComputedStyle() {
            return {
                visibility: 'visible',
                display: 'block',
                opacity: '1'
            }
        }
    }
    global.location = {
        href: 'https://www.quora.com/profile/Synthetic'
    }

    try {
        return fn()
    }
    finally {
        global.document = previous.document
        global.window = previous.window
        global.location = previous.location
    }
}

test('close-after click helper matches aria-label text', () => {
    const closeAfter = makeButton({
        text: 'Mute Block Close',
        aria: 'Mute Block extension: Mute and block this profile, then close the tab'
    })
    const plain = makeButton({
        text: 'Mute Block',
        aria: 'Mute Block extension: Mute and block this profile'
    })

    const result = withFakePage([plain, closeAfter], () =>
        getClickExtensionActionPageFunction()(true)
    )

    assert.equal(result.clicked, true)
    assert.equal(result.button.index, 1)
    assert.equal(closeAfter.clicked, true)
    assert.equal(plain.clicked, false)
    assert.equal(result.button.aria, 'Mute Block extension: Mute and block this profile, then close the tab')
})

test('close-after click helper falls back to close-tab button for already blocked profile', () => {
    const closeTab = makeButton({
        text: 'Close tab',
        aria: 'Mute Block extension: Close this tab'
    })
    const unblock = makeButton({
        text: 'Unblock',
        aria: 'Mute Block extension: Unblock and unmute this profile. This is also called a pardon.'
    })

    const result = withFakePage([unblock, closeTab], () =>
        getClickExtensionActionPageFunction()(true)
    )

    assert.equal(result.clicked, true)
    assert.equal(result.button.index, 1)
    assert.equal(closeTab.clicked, true)
    assert.equal(unblock.clicked, false)
    assert.equal(result.button.aria, 'Mute Block extension: Close this tab')
})
