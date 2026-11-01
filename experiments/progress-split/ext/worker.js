// Dedicated worker started by the page. 'echo' returns the payload size it got;
// 'busy' runs synchronous CPU work for a fixed time, to test whether that work
// delays storage calls made from the page.
function busyFor(ms) {
    const sample = {values: Array.from({length: 2000}, (_, index) => ({index, text: `value-${index}`}))}
    const started = performance.now()
    let checksum = 0
    while(performance.now() - started < ms) {
        checksum += JSON.parse(JSON.stringify(sample)).values.length
    }
    return checksum
}

self.onmessage = (event) => {
    const {id, op} = event.data
    if(op === 'echo') {
        self.postMessage({id, bytes: event.data.payload.length})
    }
    else if(op === 'busy') {
        busyFor(event.data.ms)
        self.postMessage({id, done: true})
    }
}
