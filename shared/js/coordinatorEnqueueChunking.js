// Shared chunk size for a large coordinator-items enqueue, used by both
// content.js (the poster, which owns splitting a large batch into separate
// enqueue-coordinator-items messages -- see live-batch-fixes worklist
// 2026-09-19 items 3/4) and sw.js (which keeps its own internal chunking as
// a defensive backstop for any request that arrives oversized despite that,
// e.g. a future caller that doesn't chunk before posting -- see
// COORDINATOR_ENQUEUE_CHUNK_THRESHOLD's comment in sw.js for why that
// backstop exists independent of the fairness concern this file addresses).
// One shared constant so the two sides can't drift apart on what "one
// chunk" means.
module.exports = {
    COORDINATOR_ENQUEUE_CHUNK_SIZE: 50
}
