// The progress bar at the bottom of a queue page. The space page and the dashboard both build it here, so they look and lay out the same.
// Values are set by the caller through setProgress; this file only builds and styles the bar.
const { BRAND_RED } = require('./colorTokens')
const { setMuteBlockHelp } = require('./muteBlockHelp')

function createQueueProgressBar(options = {}) {
    const barId = options.barId || 'mb-queue-progress'
    const darkMode = options.darkMode === true
    // Interactive bars (the dashboard) take clicks on their logo button. The page bar never takes clicks, so it never blocks the page beneath it.
    const interactive = options.interactive === true
    const barBackground = darkMode ? 'rgba(32, 32, 35, 0.92)' : 'rgba(255, 255, 255, 0.92)'
    const textColor = darkMode ? '#e8e8ea' : '#1c1c1e'
    const trackBackground = darkMode ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)'
    const borderColor = darkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'

    const bar = document.createElement('div')
    bar.id = barId
    bar.style.position = 'fixed'
    bar.style.left = '0'
    bar.style.right = '0'
    bar.style.bottom = '0'
    bar.style.zIndex = '999999'
    bar.style.display = 'flex'
    bar.style.alignItems = 'center'
    bar.style.gap = '10px'
    bar.style.padding = '5px 12px'
    bar.style.background = barBackground
    bar.style.borderTop = `1px solid ${borderColor}`
    bar.style.color = textColor
    bar.style.fontSize = '12px'
    bar.style.fontFamily = 'system-ui, -apple-system, sans-serif'
    bar.style.pointerEvents = interactive ? 'auto' : 'none'

    const brand = document.createElement('div')
    brand.style.display = 'flex'
    brand.style.alignItems = 'center'
    brand.style.gap = '6px'
    brand.style.flexShrink = '0'

    const logo = document.createElement('img')
    logo.src = options.iconSrc || ''
    logo.alt = ''
    logo.width = 16
    logo.height = 16
    logo.style.display = 'block'

    if(typeof options.onLogoClick === 'function') {
        const logoButton = document.createElement('button')
        logoButton.type = 'button'
        setMuteBlockHelp(logoButton, options.logoTitle || 'Open the dashboard')
        logoButton.style.background = 'none'
        logoButton.style.border = 'none'
        logoButton.style.padding = '0'
        logoButton.style.lineHeight = '0'
        logoButton.style.cursor = 'pointer'
        logoButton.append(logo)
        logoButton.addEventListener('click', options.onLogoClick)
        brand.append(logoButton)
    }
    else {
        brand.append(logo)
    }

    const label = document.createElement('div')
    label.textContent = 'Progress'
    label.style.fontWeight = '600'
    label.style.whiteSpace = 'nowrap'
    brand.append(label)

    const track = document.createElement('div')
    track.style.flex = '1'
    track.style.height = '6px'
    track.style.borderRadius = '3px'
    track.style.background = trackBackground
    track.style.overflow = 'hidden'

    const fill = document.createElement('div')
    fill.className = `${barId}-fill`
    fill.style.height = '100%'
    fill.style.width = '0%'
    fill.style.background = BRAND_RED
    fill.style.transition = 'width 200ms ease'
    track.appendChild(fill)

    const count = document.createElement('div')
    count.className = `${barId}-count`
    count.style.whiteSpace = 'nowrap'

    bar.append(brand, track, count)

    return {
        bar,
        setProgress(percent, text) {
            fill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`
            count.textContent = `${text ?? ''}`
        }
    }
}

module.exports = {
    createQueueProgressBar
}
