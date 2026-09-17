#!/usr/bin/env node

// Guards against the exact regression fixed 2026-09-17: two separate
// close-if-blocked confirmation paths (recordOwnedBlockedSweepTerminal,
// terminalizeActiveCoordinatorItemFromBlockedLiveTab's fallback) each
// independently hardcoded foundBlockedBeforeQueue: true / status:
// 'already-blocked', silently misclassifying blocks our own direct action
// caused as pre-existing and hiding them from the reallyBlocked tally.
// Both were fixed to derive the classification via the shared
// classifyBlockConfirmationFromItem helper instead. This check fails if
// either hardcoded literal reappears anywhere in sw.js outside that one
// function's own body -- the only place allowed to decide this.

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const swPath = path.join(repoRoot, 'shared/js/sw.js')
const classifierSignature = 'function classifyBlockConfirmationFromItem('

const restrictedPatterns = [
    /foundBlockedBeforeQueue:\s*true\b/,
    /status:\s*'already-blocked'/
]

function extractFunctionRange(source, signature) {
    const start = source.indexOf(signature)
    if(start === -1) return null

    const braceStart = source.indexOf('{', start + signature.length)
    if(braceStart === -1) return null

    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return {start, end: index + 1}
        }
    }
    return null
}

function findRestrictedClassificationLiterals() {
    const source = fs.readFileSync(swPath, 'utf8')
    const classifierRange = extractFunctionRange(source, classifierSignature)
    if(!classifierRange) {
        return [{
            file: path.relative(repoRoot, swPath),
            line: 0,
            text: `missing ${classifierSignature} -- this check can't tell restricted literals from the classifier's own body`
        }]
    }

    const lines = source.split('\n')
    let offset = 0
    const failures = []
    for(let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        const lineStart = offset
        const lineEnd = offset + line.length
        offset = lineEnd + 1

        const withinClassifier = lineStart >= classifierRange.start && lineEnd <= classifierRange.end
        if(!withinClassifier) {
            for(const pattern of restrictedPatterns) {
                if(pattern.test(line)) {
                    failures.push({
                        file: path.relative(repoRoot, swPath),
                        line: index + 1,
                        text: line.trim()
                    })
                }
            }
        }
    }
    return failures
}

const failures = findRestrictedClassificationLiterals()

if(failures.length) {
    for(const failure of failures) {
        console.error(`${failure.file}:${failure.line}: hardcoded block-confirmation classification outside classifyBlockConfirmationFromItem`)
        console.error(`  ${failure.text}`)
    }
    console.error('Derive this via classifyBlockConfirmationFromItem(item) instead of hardcoding it -- see the 2026-09-17 fix history for why the DOM-level willClose signal alone can\'t tell a directly-caused block from a pre-existing one.')
    process.exitCode = 1
}
