const {
    isQueueMachineEventType,
    normalizeQueueMachineEventType
} = require('./swQueueMachineEvents')

function createQueueMachineEventDispatcher(handlers = {}) {
    const normalizedHandlers = {}
    for(const [type, handler] of Object.entries(handlers || {})) {
        const normalizedType = normalizeQueueMachineEventType(type)
        if(!normalizedType || typeof handler !== 'function') continue
        normalizedHandlers[normalizedType] = handler
    }

    return async function dispatchQueueMachineEvent(event = {}, operation = {}) {
        const type = normalizeQueueMachineEventType(event?.type || '')
        if(!isQueueMachineEventType(type)) {
            return {
                changed: false,
                reason: 'unsupported-queue-machine-event',
                eventType: type
            }
        }

        const handler = normalizedHandlers[type]
        if(!handler) {
            return {
                changed: false,
                reason: 'unhandled-queue-machine-event',
                eventType: type
            }
        }

        return handler({
            ...(event || {}),
            type
        }, operation || {})
    }
}

module.exports = {
    createQueueMachineEventDispatcher
}
