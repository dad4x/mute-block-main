function normalizeRuntimeMessageAction(request = {}) {
    return `${request?.action || ''}`.trim()
}

function describeRuntimeMessage(request = {}) {
    const action = normalizeRuntimeMessageAction(request)
    return action || 'unknown'
}

module.exports = {
    describeRuntimeMessage,
    normalizeRuntimeMessageAction
}
