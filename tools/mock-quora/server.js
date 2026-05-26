const http = require('http')

const HOST = process.env.MB_MOCK_QUORA_HOST || '127.0.0.1'
const PORT = Number.parseInt(process.env.MB_MOCK_QUORA_PORT || '8765', 10) || 8765

const posts = [
    {
        author: 'David Brower',
        timestamp: 'Seed',
        title: 'Draft Design: Shared Mute-Block Publication and Import',
        body: [
            'This seed post exists so harnesses can find a Quora-like post card.',
            '',
            'The real discussion draft lives in MB Development; this local copy is only a fixture.'
        ].join('\n')
    }
]

function buildSharedJournalBody(origin) {
    return [
        'Mute-Block shared moderation journal for 2026-05-18.',
        '',
        'This post lists Mute-Block profile and Space-classification changes I made today so other Mute-Block users may review or import them.',
        '',
        'MBLOCK:BEGIN v=1',
        JSON.stringify({
        schema: 'com.muteblock.eventJournal',
        schema_version: 1,
        document_id: 'mbj:mock:2026-05-18:001',
        publisher: {
            quora_profile: 'quora-profile:Mock-Publisher',
            atproto_did: null,
            display_name: 'Mock Publisher'
        },
        transport: {
            kind: 'mock-quora-space-post',
            space: `${origin}/space/shared-blocks`
        },
        events: [
            {
                event_id: 'mock-event-1',
                type: 'profile.block.add',
                subject: 'quora-profile:Some-User',
                occurred_at: '2026-05-18T00:00:00Z',
                provenance: {
                    kind: 'space-post',
                    space: `${origin}/space/muteblockdevelopment`
                }
            },
            {
                event_id: 'mock-event-2',
                type: 'space.classification.set',
                space: `${origin}/space/muteblockdevelopment`,
                classification: {
                    category: 'asset',
                    mode: 'reviewed'
                },
                occurred_at: '2026-05-18T00:01:00Z'
            }
        ]
        }, null, 2),
        'MBLOCK:END'
    ].join('\n')
}

function escapeHtml(value = '') {
    return `${value}`.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]))
}

function send(response, status, body, headers = {}) {
    response.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...headers
    })
    response.end(body)
}

function sendJson(response, value) {
    response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
    })
    response.end(JSON.stringify(value, null, 2))
}

function layout(title, body, options = {}) {
    const meta = []
    if(options.mockQuoraKind) {
        meta.push(`<meta name="mute-block-mock-quora" content="${escapeHtml(options.mockQuoraKind)}">`)
    }
    if(options.spaceUrl) {
        meta.push(`<meta name="mute-block-space-url" content="${escapeHtml(options.spaceUrl)}">`)
    }
    if(options.spaceSlug) {
        meta.push(`<meta name="mute-block-space-slug" content="${escapeHtml(options.spaceSlug)}">`)
    }
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${meta.join('\n  ')}
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; }
    body { margin: 0; background: #f7f7f8; color: #222; }
    header { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid #ddd; padding: 10px 18px; display: flex; gap: 16px; align-items: center; }
    header a { color: #555; text-decoration: none; font-weight: 600; }
    main { max-width: 900px; margin: 24px auto; padding: 0 16px 48px; }
    .space-card, .post-card, .composer-card { background: #fff; border: 1px solid #ddd; border-radius: 6px; margin: 14px 0; padding: 16px; }
    .space-title { margin: 0 0 6px; font-size: 28px; }
    .space-subtitle { color: #666; margin: 0 0 14px; }
    .button-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, .button-link { border: 1px solid #c9c9cf; background: #fff; border-radius: 18px; padding: 7px 12px; cursor: pointer; font: inherit; color: #333; }
    button:hover, .button-link:hover { background: #f0f0f2; }
    .mb-ext_space-category-btn--active { border-color: #8f1d1d; color: #8f1d1d; font-weight: 700; }
    .puppeteer_test_tribe_composer { color: #777; background: #f4f4f5; border: 1px solid #ddd; border-radius: 6px; padding: 13px 16px; margin-top: 12px; cursor: text; }
    .post-author { font-weight: 700; }
    .post_timestamp { color: #666; text-decoration: none; margin-left: 8px; }
    .post-body { white-space: pre-wrap; line-height: 1.42; }
    textarea { width: 100%; min-height: 260px; box-sizing: border-box; font: 14px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <header>
    <strong>Mock Quora</strong>
    <a href="/space/muteblockdevelopment">MB Development</a>
    <a href="/space/shared-blocks">Shared Blocks</a>
    <a href="/composer">Composer</a>
  </header>
  <main>${body}</main>
</body>
</html>`
}

function renderSpace({slug, name, description, seedPosts}) {
    const postHtml = seedPosts.map((post, index) => renderPost(post, index)).join('\n')
    const body = `<section class="space-card" data-mock-space="${escapeHtml(slug)}">
  <h1 class="space-title">${escapeHtml(name)}</h1>
  <p class="space-subtitle">${escapeHtml(description)}</p>
  <div class="button-row" aria-label="Mute-Block category controls">
    <button class="mb-ext_space-category-btn" data-category="asset">Asset</button>
    <button class="mb-ext_space-category-btn mb-ext_space-category-btn--active" data-category="neutral">Neutral</button>
    <button class="mb-ext_space-category-btn" data-category="target">Target</button>
  </div>
  <div class="puppeteer_test_tribe_composer" role="button" tabindex="0" onclick="location.href='/composer?space=${encodeURIComponent(slug)}'">
    Post in ${escapeHtml(name)}...
  </div>
</section>
<section aria-label="Posts">
${postHtml}
</section>`
    return layout(name, body, {
        mockQuoraKind: 'space',
        spaceSlug: slug,
        spaceUrl: `https://${slug}.quora.com/`
    })
}

function renderPost(post, index) {
    const title = post.title ? `<h2>${escapeHtml(post.title)}</h2>` : ''
    return `<article class="post-card" data-post-index="${index}">
  <div><span class="post-author">${escapeHtml(post.author)}</span><a class="post_timestamp" href="#post-${index}">${escapeHtml(post.timestamp)}</a></div>
  ${title}
  <div class="post-body">${escapeHtml(post.body)}</div>
  <div class="button-row" style="margin-top: 12px">
    <button aria-label="Upvote">Upvote</button>
    <button aria-label="Comment">Comment</button>
    <button aria-label="Share">Share</button>
  </div>
</article>`
}

function composerPage(url) {
    const space = url.searchParams.get('space') || 'muteblockdevelopment'
    return layout('Mock Composer', `<section class="composer-card">
  <h1>Create Post</h1>
  <p class="muted">Posting here writes to this mock server's in-memory post list only.</p>
  <label for="post-body">Post body</label>
  <textarea id="post-body" class="mock-composer-body" autofocus></textarea>
  <div class="button-row" style="margin-top: 12px">
    <button class="puppeteer_test_modal_submit" id="post-button" type="button">Post</button>
    <a class="button-link" href="/space/${encodeURIComponent(space)}">Cancel</a>
  </div>
</section>
<script>
document.getElementById('post-button').addEventListener('click', async () => {
  const body = document.getElementById('post-body').value;
  const response = await fetch('/api/posts', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({space: ${JSON.stringify(space)}, body})
  });
  const result = await response.json();
  location.href = result.url;
});
</script>`)
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let data = ''
        request.setEncoding('utf8')
        request.on('data', chunk => {
            data += chunk
            if(data.length > 1024 * 1024) {
                reject(new Error('request body too large'))
                request.destroy()
            }
        })
        request.on('end', () => resolve(data))
        request.on('error', reject)
    })
}

async function handleRequest(request, response) {
    const url = new URL(request.url, `http://${HOST}:${PORT}`)
    const origin = `http://${request.headers.host || `${HOST}:${PORT}`}`

    if(request.method === 'GET' && url.pathname === '/') {
        response.writeHead(302, {location: '/space/muteblockdevelopment'})
        response.end()
        return
    }

    if(request.method === 'GET' && url.pathname === '/space/muteblockdevelopment') {
        send(response, 200, renderSpace({
            slug: 'muteblockdevelopment',
            name: 'Mute Block Development',
            description: 'A place to talk development of the Mute Block browser extension.',
            seedPosts: posts
        }))
        return
    }

    if(request.method === 'GET' && url.pathname === '/space/shared-blocks') {
        send(response, 200, renderSpace({
            slug: 'shared-blocks',
            name: "Mock Shared Mute-Blocks",
            description: 'Rendered shared moderation posts for parser and import tests.',
            seedPosts: [{
                author: 'Mock Publisher',
                timestamp: 'Fixture',
                title: 'Mute-Block shared moderation journal for 2026-05-18',
                body: buildSharedJournalBody(origin)
            }]
        }))
        return
    }

    if(request.method === 'GET' && url.pathname === '/composer') {
        send(response, 200, composerPage(url))
        return
    }

    if(request.method === 'GET' && url.pathname === '/api/posts') {
        sendJson(response, {posts})
        return
    }

    if(request.method === 'POST' && url.pathname === '/api/posts') {
        const raw = await readBody(request)
        const input = JSON.parse(raw || '{}')
        const body = `${input.body || ''}`.trim()
        if(!body) {
            response.writeHead(400, {'content-type': 'application/json'})
            response.end(JSON.stringify({error: 'empty body'}))
            return
        }
        posts.unshift({
            author: 'Harness User',
            timestamp: 'Just now',
            title: body.split(/\n/).find(Boolean)?.slice(0, 120) || 'Untitled mock post',
            body
        })
        const space = `${input.space || 'muteblockdevelopment'}`.replace(/[^a-z0-9-]/ig, '') || 'muteblockdevelopment'
        sendJson(response, {ok: true, url: `/space/${space}`})
        return
    }

    send(response, 404, layout('Not Found', `<section class="post-card"><h1>Not Found</h1><p>${escapeHtml(url.pathname)}</p></section>`))
}

const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
        response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'})
        response.end(error.stack || error.message)
    })
})

server.listen(PORT, HOST, () => {
    console.log(`Mock Quora listening on http://${HOST}:${PORT}/`)
})
