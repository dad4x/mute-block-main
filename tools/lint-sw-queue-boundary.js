#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const swPath = path.join(repoRoot, 'shared/js/sw.js')
const handlerPath = path.join(repoRoot, 'shared/js/swQueueMachineHandlers.js')

const restrictedSwCalls = [
    'recoverPendingTabActionFromCoordinatorQueue',
    'recoverQueuedAuthorityLiveTabAfterMaterializationFailure',
    'recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout',
    'requeueDurableActiveCoordinatorItemWithoutActor',
    'releaseQueuedTabRuntimeIfAuthorityNotActive',
    'restoreQueuedTabRuntimeFromActiveAuthorityForSender',
    'mutateCoordinatorKeyOnlyItemTerminalize',
    'applyCoordinatorRowEvents',
    'clearProfileNukeState',
    'confirmSpaceFeedProfilesBlocked',
    'recordCoordinatorJobProgress',
    'markQueuedProfileResolutionUnresolved',
    'recoverExhaustedRolledBackQueuedCoordinatorItem',
    'enqueueCoordinatorItemsStorageLocked',
    'recordOwnedBlockedSweepTerminal',
    'removePendingSpaceFeedEntries',
    'removePendingSpaceFeedUrls',
    'settleTerminalCoordinatorItems',
    'settleExhaustedRolledBackQueuedCoordinatorItemsForExecutor',
    'terminalizeExhaustedRolledBackQueuedCoordinatorItem',
    'terminalizeActiveCoordinatorNonProfileLanding',
    'terminalizeActiveCoordinatorProfileRedirectMismatch',
    'terminalizeDurableActiveCoordinatorItemFromTerminalProgress',
    'terminalizeQueuedAuthorityEnqueueFailureCoordinatorItems'
]

const handlerRequiredCapabilities = [
    ...restrictedSwCalls.filter(name => ![
        'mutateCoordinatorKeyOnlyItemTerminalize',
        'terminalizeExhaustedRolledBackQueuedCoordinatorItem',
        'terminalizeActiveCoordinatorNonProfileLanding',
        'terminalizeActiveCoordinatorProfileRedirectMismatch',
        'terminalizeDurableActiveCoordinatorItemFromTerminalProgress',
        'terminalizeQueuedAuthorityEnqueueFailureCoordinatorItems'
    ].includes(name)),
    'mutateCoordinatorKeyOnlyItemTerminate',
    'terminateExhaustedRolledBackQueuedCoordinatorItem',
    'terminateActiveCoordinatorNonProfileLanding',
    'terminateActiveCoordinatorProfileRedirectMismatch',
    'terminateDurableActiveCoordinatorItemFromTerminalProgress',
    'terminateQueuedAuthorityEnqueueFailureCoordinatorItems'
]

const projectionDispatchCalls = new Set([
    'mutateCoordinatorKeyOnlyItemTerminalize',
    'mutateCoordinatorQueuedTabActiveTransition',
    'mutateCoordinatorQueuedTabOpenRollback'
])

const handlerRestrictedIdentifiers = [
    'queuedTabActions',
    'activeQueuedTabs',
    'pendingTabActions',
    'queuedTabMetadata',
    'getQueuedTabActionKey',
    'incrementQueueWakeupMetric'
]

const allowedSwMutatorCallers = new Map([
    ['mutateCoordinatorStoredWorkPause', new Set(['mutateCoordinatorPauseStateSet'])],
    ['requeueDurableActiveCoordinatorItemWithoutActor', new Set(['mutateCoordinatorActiveWithoutRuntimeActorReconcile'])],
    ['terminalizeActiveCoordinatorNonProfileLanding', new Set(['mutateCoordinatorActiveNonProfileLandingTerminalize'])],
    ['terminalizeActiveCoordinatorProfileRedirectMismatch', new Set(['mutateCoordinatorActiveProfileRedirectMismatchTerminalize'])],
    ['terminalizeDurableActiveCoordinatorItemFromTerminalProgress', new Set(['mutateCoordinatorActiveFromTerminalProgress'])]
])

const allowedSwRestrictedCallers = new Map([
    ['recordCoordinatorJobProgressRecords', new Set(['applyCoordinatorRowEvents'])],
    ['recoverExhaustedRolledBackQueuedCoordinatorItems', new Set(['recoverExhaustedRolledBackQueuedCoordinatorItem'])]
])

function readLines(filePath) {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
}

function isFunctionDefinition(line, name) {
    return new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`).test(line)
}

function isProjectionDispatchAllowance(line, name) {
    return projectionDispatchCalls.has(name) &&
        new RegExp(`\\breturn\\s+${name}\\s*\\(\\s*operation\\s*\\)`).test(line)
}

function findRestrictedSwCalls() {
    const lines = readLines(swPath)
    const failures = []
    let currentFunction = ''
    for(let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        // Comment-only lines describe calls; they are not calls.
        if(/^\s*\/\//.test(line)) continue
        const functionMatch = line.match(/\b(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/)
        if(functionMatch) currentFunction = functionMatch[1]
        for(const name of restrictedSwCalls.concat(Array.from(projectionDispatchCalls))) {
            if(!new RegExp(`\\b${name}\\s*\\(`).test(line)) continue
            if(isFunctionDefinition(line, name)) continue
            if(isProjectionDispatchAllowance(line, name)) continue
            const allowedRestrictedCallees = allowedSwRestrictedCallers.get(currentFunction)
            if(allowedRestrictedCallees?.has(name)) continue
            failures.push({
                file: path.relative(repoRoot, swPath),
                line: index + 1,
                name,
                text: line.trim()
            })
        }
        const mutatorMatch = line.match(/\b(mutateCoordinator[A-Za-z0-9_]+)\s*\(/)
        if(mutatorMatch) {
            const name = mutatorMatch[1]
            if(isFunctionDefinition(line, name)) continue
            const allowedCallees = allowedSwMutatorCallers.get(currentFunction)
            if(allowedCallees?.has(name)) continue
            failures.push({
                file: path.relative(repoRoot, swPath),
                line: index + 1,
                name,
                text: line.trim()
            })
        }
    }
    return failures
}

function findMissingHandlerCalls() {
    const source = fs.readFileSync(handlerPath, 'utf8')
    return handlerRequiredCapabilities.filter(name =>
        !new RegExp(`\\b${name}\\s*\\(`).test(source)
    )
}

function findRestrictedHandlerIdentifiers() {
    const lines = readLines(handlerPath)
    const failures = []
    for(let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        for(const name of handlerRestrictedIdentifiers) {
            if(!new RegExp(`\\b${name}\\b`).test(line)) continue
            failures.push({
                file: path.relative(repoRoot, handlerPath),
                line: index + 1,
                name,
                text: line.trim()
            })
        }
    }
    return failures
}

const failures = findRestrictedSwCalls()
const missingHandlerCalls = findMissingHandlerCalls()
const handlerIdentifierFailures = findRestrictedHandlerIdentifiers()

if(failures.length || missingHandlerCalls.length || handlerIdentifierFailures.length) {
    for(const failure of failures) {
        console.error(`${failure.file}:${failure.line}: direct queue-machine helper call outside allowed boundary: ${failure.name}`)
        console.error(`  ${failure.text}`)
    }
    for(const failure of handlerIdentifierFailures) {
        console.error(`${failure.file}:${failure.line}: queue-machine handler accesses volatile/projection internals directly: ${failure.name}`)
        console.error(`  ${failure.text}`)
    }
    for(const name of missingHandlerCalls) {
        console.error(`${path.relative(repoRoot, handlerPath)}: missing queue-machine handler call for ${name}`)
    }
    process.exitCode = 1
}
