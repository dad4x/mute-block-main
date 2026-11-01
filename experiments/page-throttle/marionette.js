'use strict'

// Minimal Marionette client. Frames are "<byte length>:<json>" over TCP.
// Requests are [0, id, command, params]; responses are [1, id, error, result].
const net = require('node:net')

class Marionette {
    constructor(port) {
        this.port = port
        this.buffer = Buffer.alloc(0)
        this.nextId = 0
        this.pending = new Map()
        this.greetingWaiter = null
    }

    connect(timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + timeoutMs
            const attempt = () => {
                const socket = net.createConnection({host: '127.0.0.1', port: this.port})
                socket.on('connect', () => {
                    this.socket = socket
                    socket.on('data', chunk => this.onData(chunk))
                    this.greetingWaiter = resolve
                })
                socket.on('error', () => {
                    if(Date.now() > deadline) reject(new Error('Marionette did not accept a connection'))
                    else setTimeout(attempt, 300)
                })
            }
            attempt()
        })
    }

    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk])
        while(true) {
            const colon = this.buffer.indexOf(0x3a)
            if(colon < 0) return
            const length = Number.parseInt(this.buffer.slice(0, colon).toString('utf8'), 10)
            if(!Number.isFinite(length) || this.buffer.length < colon + 1 + length) return
            const frame = JSON.parse(this.buffer.slice(colon + 1, colon + 1 + length).toString('utf8'))
            this.buffer = this.buffer.slice(colon + 1 + length)
            this.onFrame(frame)
        }
    }

    onFrame(frame) {
        if(!Array.isArray(frame)) {
            if(this.greetingWaiter) {
                const resolve = this.greetingWaiter
                this.greetingWaiter = null
                resolve(frame)
            }
            return
        }
        const [type, id, error, result] = frame
        if(type !== 1) return
        const waiter = this.pending.get(id)
        if(!waiter) return
        this.pending.delete(id)
        if(error) waiter.reject(new Error(`${error.error}: ${error.message}`))
        else waiter.resolve(result)
    }

    send(command, params = {}) {
        const id = ++this.nextId
        const payload = JSON.stringify([0, id, command, params])
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject})
            this.socket.write(`${Buffer.byteLength(payload)}:${payload}`)
        })
    }

    close() {
        this.socket?.destroy()
    }
}

module.exports = {Marionette}
