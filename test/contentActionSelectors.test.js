const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)

    const braceStart = source.indexOf('{', start + signature.length)
    assert.notEqual(braceStart, -1, `missing body for ${signature}`)

    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(start, index + 1)
        }
    }

    throw new Error(`unterminated ${signature}`)
}

function extractConst(source, name) {
    const matcher = new RegExp(`^const ${name} = .+$`, 'm')
    const match = source.match(matcher)
    assert.ok(match, `missing ${name}`)
    return match[0]
}

class TestElement {
    constructor(tagName, options = {}) {
        this.tagName = tagName.toUpperCase()
        this.children = []
        this.parentElement = null
        this.attributes = {...(options.attributes || {})}
        this.className = options.className || ''
        this.id = options.id || ''
        this.ownText = options.text || ''
        this.style = {
            display: options.display || 'block',
            visibility: options.visibility || 'visible',
            position: options.position || 'static',
            zIndex: options.zIndex || '0'
        }
        this.rect = options.rect || {left: 0, top: 0, width: 120, height: 36}
        this.dataset = options.dataset || {}
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name)
        }
    }

    append(...children) {
        for(const child of children) {
            child.parentElement = this
            this.children.push(child)
        }
        return this
    }

    get textContent() {
        return [this.ownText, ...this.children.map(child => child.textContent)]
            .filter(Boolean)
            .join(' ')
    }

    get innerText() {
        return this.textContent
    }

    getAttribute(name) {
        if(name === 'class') return this.className
        if(name === 'id') return this.id
        return this.attributes[name] || null
    }

    getBoundingClientRect() {
        return this.rect
    }

    contains(element) {
        if(element === this) return true
        return this.children.some(child => child.contains(element))
    }

    closest(selector) {
        let current = this
        while(current) {
            if(current.matches(selector)) return current
            current = current.parentElement
        }
        return null
    }

    matches(selector) {
        return selector
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
            .some(part => matchesSimpleSelector(this, part))
    }

    querySelectorAll(selector) {
        const selectors = selector.split(',').map(part => part.trim()).filter(Boolean)
        const results = []

        const visit = element => {
            for(const child of element.children) {
                if(selectors.some(part => matchesSimpleSelector(child, part))) {
                    results.push(child)
                }
                visit(child)
            }
        }

        visit(this)
        return results
    }
}

class TestDocument extends TestElement {
    constructor() {
        super('#document')
        this.body = new TestElement('body')
        this.append(this.body)
    }
}

function matchesSimpleSelector(element, selector) {
    if(selector === '*') return true
    if(selector.startsWith('.')) {
        return element.className.split(/\s+/).includes(selector.slice(1))
    }

    const tagMatch = selector.match(/^[a-z]+/i)
    if(tagMatch && element.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) {
        return false
    }

    const attrMatches = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)]
    for(const match of attrMatches) {
        const value = element.getAttribute(match[1])
        if(match[2] === undefined) {
            if(value === null) return false
        }
        else if(value !== match[2]) {
            return false
        }
    }

    return !!tagMatch || attrMatches.length > 0
}

function makeButton(text, options = {}) {
    return new TestElement('button', {
        text,
        className: options.className || '',
        attributes: options.attributes || {},
        rect: options.rect || {left: 20, top: 40, width: 100, height: 30}
    })
}

function makeDialog(text, buttons = []) {
    const dialog = new TestElement('div', {
        text,
        attributes: {'role': 'dialog', 'aria-modal': 'true'},
        position: 'fixed',
        zIndex: '100',
        rect: {left: 10, top: 10, width: 420, height: 240}
    })
    dialog.append(...buttons)
    return dialog
}

function loadSelectorHarness(document) {
    const source = readRepoFile('shared/js/content.js')
    const parts = [
        'const MAX_ELEMENT_TEXT_CHARS = 4096',
        extractConst(source, 'UNMUTE_ACTION_REGEX'),
        extractConst(source, 'UNBLOCK_ACTION_REGEX'),
        extractConst(source, 'UNMUTE_CONTEXT_REGEX'),
        extractConst(source, 'UNBLOCK_CONTEXT_REGEX'),
        extractFunction(source, "function compactElementText(text = '', maxChars = MAX_ELEMENT_TEXT_CHARS)"),
        extractFunction(source, 'function getElementText(element)'),
        extractFunction(source, 'function isVisible(element)'),
        extractFunction(source, 'function getOverlayRoots(includeDialogs = true)'),
        extractFunction(source, 'function getActionCandidateLabel(candidate)'),
        extractFunction(source, 'function matchesActionLabel(matcher, label)'),
        extractFunction(source, 'function isUnmuteActionLabel(label)'),
        extractFunction(source, 'function isMuteActionLabel(label)'),
        extractFunction(source, 'function isUnblockActionLabel(label)'),
        extractFunction(source, 'function isBlockActionLabel(label)'),
        extractFunction(source, 'function hasUnmuteActionText(text)'),
        extractFunction(source, 'function hasUnblockActionText(text)'),
        extractFunction(source, 'function isMuteConfirmButtonLabel(label)'),
        extractFunction(source, 'function isBlockConfirmButtonLabel(label)'),
        extractFunction(source, 'function isUnmuteConfirmButtonLabel(label)'),
        extractFunction(source, 'function isUnblockConfirmButtonLabel(label)'),
        extractFunction(source, 'function getActionDebugLabel(element)'),
        extractFunction(source, 'function shouldIgnoreActionCandidate(candidate)'),
        extractFunction(source, 'function getVisibleActionButtons(root)'),
        extractFunction(source, 'function isMuteConfirmContextText(text)'),
        extractFunction(source, 'function isBlockConfirmContextText(text)'),
        extractFunction(source, 'function getBestActionContext(candidate)'),
        extractFunction(source, "function getConfirmationKindMismatchReason(element, confirmationKind = '')"),
        extractFunction(source, 'function scoreActionCandidate(candidate, preferredRegex = null, rootText = \'\')'),
        extractFunction(source, 'function getDialogRoots()'),
        extractFunction(source, 'function getDialogPrimaryAction(dialogRoots, preferredRegex = null, acceptsButton = null)'),
        extractFunction(source, 'function getContextualDialogPrimaryAction(dialogRoots, preferredRegex, acceptsContext, acceptsButton = null)'),
        extractFunction(source, 'function getMuteConfirmContainer()'),
        extractFunction(source, 'function getMuteConfirmCandidates()'),
        extractFunction(source, 'function getMuteConfirmAction()'),
        extractFunction(source, 'function getBlockConfirmContainer()'),
        extractFunction(source, 'function getBlockConfirmCandidates()'),
        extractFunction(source, 'function getBlockConfirmAction()'),
        extractFunction(source, 'function isUnblockConfirmContextText(text)'),
        extractFunction(source, 'function getUnblockConfirmContainer()'),
        extractFunction(source, 'function getUnblockConfirmAction()'),
        extractFunction(source, 'function getUnmuteConfirmAction()'),
        extractFunction(source, 'function getUnmuteConfirmContainer()'),
        extractFunction(source, 'function isUnmuteConfirmContextText(text)'),
        extractFunction(source, 'function getUnmuteConfirmCandidates()'),
        extractFunction(source, 'function getInPageConfirmPairAction(preferredRegex)'),
        `globalThis.harness = {
            isMuteActionLabel,
            isUnmuteActionLabel,
            isBlockActionLabel,
            isUnblockActionLabel,
            isMuteConfirmContextText,
            isBlockConfirmContextText,
            isUnblockConfirmContextText,
            isUnmuteConfirmContextText,
            isMuteConfirmButtonLabel,
            isBlockConfirmButtonLabel,
            isUnmuteConfirmButtonLabel,
            isUnblockConfirmButtonLabel,
            getConfirmationKindMismatchReason,
            getMuteConfirmAction,
            getBlockConfirmAction,
            getUnmuteConfirmAction,
            getUnblockConfirmAction
        }`
    ]

    const context = {
        document,
        getComputedStyle(element) {
            return element?.style || {display: 'block', visibility: 'visible', position: 'static', zIndex: '0'}
        }
    }

    vm.createContext(context)
    vm.runInContext(parts.join('\n\n'), context, {filename: 'content-action-selector-harness.js'})
    return context.harness
}

test('normal action labels reject inverse labels', () => {
    const harness = loadSelectorHarness(new TestDocument())

    assert.equal(harness.isBlockActionLabel('Block'), true)
    assert.equal(harness.isBlockActionLabel('Unblock'), false)
    assert.equal(harness.isBlockActionLabel('Confirm unblock'), false)
    assert.equal(harness.isMuteActionLabel('Mute'), true)
    assert.equal(harness.isMuteActionLabel('Unmute'), false)
    assert.equal(harness.isMuteActionLabel('Confirm unmute'), false)
})

test('block confirmation context rejects unblock dialogs', () => {
    const harness = loadSelectorHarness(new TestDocument())

    assert.equal(
        harness.isBlockConfirmContextText('Block this profile? Cancel Block'),
        true
    )
    assert.equal(
        harness.isBlockConfirmContextText('Unblock this profile? You blocked this profile before. Cancel Unblock'),
        false
    )
    assert.equal(
        harness.isMuteConfirmContextText('Unmute this profile? You muted this profile before. Cancel Unmute'),
        false
    )
})

test('block confirmation selector does not select unblock confirmation buttons', () => {
    const document = new TestDocument()
    const cancel = makeButton('Cancel', {rect: {left: 20, top: 200, width: 80, height: 30}})
    const unblock = makeButton('Unblock', {
        className: 'puppeteer_test_modal_submit',
        rect: {left: 300, top: 200, width: 100, height: 30}
    })
    document.body.append(makeDialog(
        'Unblock this profile? You blocked this profile before.',
        [cancel, unblock]
    ))

    const harness = loadSelectorHarness(document)

    assert.equal(harness.getBlockConfirmAction(), null)
    assert.equal(harness.getUnblockConfirmAction(), unblock)
    assert.equal(harness.getConfirmationKindMismatchReason(unblock, 'block'), 'inverse-unblock-confirmation')
})

test('block confirmation selector still selects real block confirmation buttons', () => {
    const document = new TestDocument()
    const cancel = makeButton('Cancel', {rect: {left: 20, top: 200, width: 80, height: 30}})
    const block = makeButton('Block', {
        className: 'puppeteer_test_modal_submit',
        rect: {left: 300, top: 200, width: 100, height: 30}
    })
    document.body.append(makeDialog(
        'Block this profile? You will no longer see each other.',
        [cancel, block]
    ))

    const harness = loadSelectorHarness(document)

    assert.equal(harness.getBlockConfirmAction(), block)
    assert.equal(harness.getUnblockConfirmAction(), null)
})

test('mute confirmation selector does not select unmute confirmation buttons', () => {
    const document = new TestDocument()
    const cancel = makeButton('Cancel', {rect: {left: 20, top: 200, width: 80, height: 30}})
    const unmute = makeButton('Unmute', {
        className: 'puppeteer_test_modal_submit',
        rect: {left: 300, top: 200, width: 100, height: 30}
    })
    document.body.append(makeDialog(
        'Unmute this profile? You muted this profile before.',
        [cancel, unmute]
    ))

    const harness = loadSelectorHarness(document)

    assert.equal(harness.getMuteConfirmAction(), null)
    assert.equal(harness.getUnmuteConfirmAction(), unmute)
})

test('mute confirmation selector still selects real mute confirmation buttons', () => {
    const document = new TestDocument()
    const cancel = makeButton('Cancel', {rect: {left: 20, top: 200, width: 80, height: 30}})
    const confirm = makeButton('Confirm', {
        className: 'puppeteer_test_modal_submit',
        rect: {left: 300, top: 200, width: 100, height: 30}
    })
    document.body.append(makeDialog(
        'Muting this person means their answers will be hidden.',
        [cancel, confirm]
    ))

    const harness = loadSelectorHarness(document)

    assert.equal(harness.getMuteConfirmAction(), confirm)
    assert.equal(harness.getUnmuteConfirmAction(), null)
})
