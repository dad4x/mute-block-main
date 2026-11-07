// A question link inside an answer card is not a question row (31 Oct): the card is a post and has its own controls. A question card in the
// feed, with no card around it, still is. isInsideSpaceFeedPostCard is read out of content.js and run on a fake DOM.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'js', 'content.js'), 'utf8')

function extractFunction(text, header) {
    const start = text.indexOf(header)
    if (start < 0) throw new Error(`missing ${header}`)
    let depth = 0
    let opened = false
    for (let i = text.indexOf(') {', start) + 2; i < text.length; i += 1) {
        if (text[i] === '{') { depth += 1; opened = true }
        if (text[i] === '}') { depth -= 1; if (opened && depth === 0) return text.slice(start, i + 1) }
    }
    throw new Error(`unterminated ${header}`)
}

function fakeNode(tag, attrs = {}, children = []) {
    const node = {tagName: tag, attrs, children, parentElement: null, isTimestamp: !!attrs.timestamp}
    for (const child of children) child.parentElement = node
    const descendants = current => current.children.flatMap(child => [child, ...descendants(child)])
    node.querySelectorAll = selector => {
        const all = descendants(node)
        if (selector.includes('post_timestamp')) return all.filter(n => n.isTimestamp)
        return []
    }
    return node
}

const context = vm.createContext({document: {body: null}})
vm.runInContext(extractFunction(source, 'function isInsideSpaceFeedPostCard(link) {'), context)
const inCard = link => vm.runInContext('isInsideSpaceFeedPostCard(link)', Object.assign(context, {link}))

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

test('a question link in a post card (one timestamp, the card) is not a question row', () => {
    const timestamp = fakeNode('a', {timestamp: true})
    const titleLink = fakeNode('a', {href: 'https://x.quora.com/Where-can-I-get-SEO-backlinks'})
    const footerLink = fakeNode('a', {href: 'https://x.quora.com/Where-can-I-get-SEO-backlinks'})
    const body = fakeNode('div', {}, [titleLink])
    const footer = fakeNode('div', {}, [footerLink])
    const card = fakeNode('div', {}, [fakeNode('div', {}, [timestamp]), body, footer])
    fakeNode('div', {}, [card])
    assert.equal(inCard(titleLink), true)
    assert.equal(inCard(footerLink), true)
})

test('a question card in a feed (several posts around it) is still a question row', () => {
    const postA = fakeNode('div', {}, [fakeNode('a', {timestamp: true})])
    const postB = fakeNode('div', {}, [fakeNode('a', {timestamp: true})])
    const questionLink = fakeNode('a', {href: 'https://x.quora.com/Some-question'})
    const questionCard = fakeNode('div', {}, [fakeNode('div', {}, [questionLink])])
    const feed = fakeNode('div', {}, [postA, questionCard, postB])
    fakeNode('div', {}, [feed])
    assert.equal(inCard(questionLink), false)
})

console.log('spaceFeedAnswerCardQuestion: all tests passed')
