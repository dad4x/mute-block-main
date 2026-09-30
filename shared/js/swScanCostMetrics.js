// Lightweight instrumentation for measuring queue-scan costs per call site.
// Records call count and items scanned for each scan location to baseline
// coordinator-queue performance before structural optimizations.

function createScanCostMetrics(deps = {}) {
    const {
        incrementQueueWakeupMetric
    } = deps.handlers || {}

    function recordScanCost(location = '', itemsScanned = 0) {
        const normalizedLocation = `${location || ''}`.trim()
        if(!normalizedLocation || typeof normalizedLocation !== 'string') {
            return
        }

        if(typeof incrementQueueWakeupMetric !== 'function') {
            return
        }

        const scannedCount = Number(itemsScanned) || 0
        if(!Number.isFinite(scannedCount) || scannedCount < 0) {
            return
        }

        incrementQueueWakeupMetric(`scan.${normalizedLocation}.calls`)
        if(scannedCount > 0) {
            incrementQueueWakeupMetric(`scan.${normalizedLocation}.items`, scannedCount)
        }
    }

    return {
        recordScanCost
    }
}

module.exports = {
    createScanCostMetrics
}
