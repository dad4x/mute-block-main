const {spawn} = require('child_process')

const HOST = process.env.MB_MOCK_QUORA_HOST || '127.0.0.1'
const PORT = process.env.MB_MOCK_QUORA_SMOKE_PORT || '18765'
const BASE_URL = `http://${HOST}:${PORT}`

function waitForServer(child) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('mock server did not start in time')), 5000)

        child.stdout.on('data', chunk => {
            const text = chunk.toString()
            process.stdout.write(text)
            if(text.includes('Mock Quora listening')) {
                clearTimeout(timeout)
                resolve()
            }
        })

        child.stderr.on('data', chunk => process.stderr.write(chunk))
        child.on('exit', code => {
            clearTimeout(timeout)
            reject(new Error(`mock server exited early with code ${code}`))
        })
    })
}

async function fetchText(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, options)
    const text = await response.text()
    if(!response.ok) {
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 200)}`)
    }
    return text
}

function assertContains(text, needle, label) {
    if(!text.includes(needle)) throw new Error(`${label} missing ${needle}`)
}

function extractMeta(text, name) {
    const pattern = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i')
    return text.match(pattern)?.[1] || ''
}

function assertMeta(text, name, expected, label) {
    const actual = extractMeta(text, name)
    if(actual !== expected) {
        throw new Error(`${label} meta ${name} expected ${expected}, got ${actual || '<missing>'}`)
    }
}

async function main() {
    const child = spawn(process.execPath, ['tools/mock-quora/server.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            MB_MOCK_QUORA_HOST: HOST,
            MB_MOCK_QUORA_PORT: PORT
        },
        stdio: ['ignore', 'pipe', 'pipe']
    })

    try {
        await waitForServer(child)

        const space = await fetchText('/space/muteblockdevelopment')
        assertMeta(space, 'mute-block-mock-quora', 'space', 'development space')
        assertMeta(space, 'mute-block-space-url', 'https://muteblockdevelopment.quora.com/', 'development space')
        assertMeta(space, 'mute-block-space-slug', 'muteblockdevelopment', 'development space')
        assertContains(space, 'Post in Mute Block Development', 'development space')
        assertContains(space, 'mb-ext_space-category-btn--active', 'development space')
        assertContains(space, 'post_timestamp', 'development space')

        const shared = await fetchText('/space/shared-blocks')
        assertMeta(shared, 'mute-block-mock-quora', 'space', 'shared blocks')
        assertMeta(shared, 'mute-block-space-url', 'https://shared-blocks.quora.com/', 'shared blocks')
        assertMeta(shared, 'mute-block-space-slug', 'shared-blocks', 'shared blocks')
        assertContains(shared, 'MBLOCK:BEGIN v=1', 'shared blocks')
        assertContains(shared, 'mbj:mock:2026-05-18:001', 'shared blocks')

        await fetchText('/api/posts', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                body: [
                    'Harness posted mock journal',
                    '',
                    'MBLOCK:BEGIN v=1',
                    '{"schema":"com.muteblock.eventJournal","document_id":"mbj:mock:smoke"}',
                    'MBLOCK:END'
                ].join('\n')
            })
        })

        const afterPost = await fetchText('/space/muteblockdevelopment')
        assertContains(afterPost, 'Harness posted mock journal', 'posted development space')
        assertContains(afterPost, 'Just now', 'posted development space')

        console.log(JSON.stringify({
            ok: true,
            baseUrl: BASE_URL,
            checked: [
                '/space/muteblockdevelopment',
                '/space/shared-blocks',
                '/api/posts'
            ]
        }, null, 2))
    }
    finally {
        child.kill()
    }
}

main().catch(error => {
    console.error(JSON.stringify({
        error: error.message || String(error),
        stack: error.stack || ''
    }, null, 2))
    process.exit(1)
})
