/**
 * Shared Event Bus - Botlar arası iletişim sistemi
 * File-based event queue ile IPC sağlar.
 * 
 * Kullanım:
 *   const eventBus = require('../../shared/eventbus');
 *   eventBus.emit('toxicity_alert', { userId: '123', score: 8, guild: '456' });
 *   eventBus.on('toxicity_alert', (data) => { ... });
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const EVENT_DIR = path.join(__dirname, '..', 'data', 'events');
const POLL_INTERVAL = 2000; // Check for new events every 2 seconds

class SharedEventBus extends EventEmitter {
    constructor() {
        super();
        this.botName = 'unknown';
        this._polling = false;
        this._processedFiles = new Set();

        if (!fs.existsSync(EVENT_DIR)) {
            fs.mkdirSync(EVENT_DIR, { recursive: true });
        }
    }

    /**
     * Initialize the event bus for a specific bot
     * @param {string} botName - Name of the bot using this bus
     */
    init(botName) {
        this.botName = botName;
        this.startPolling();
        return this;
    }

    /**
     * Emit an event to the shared bus (file-based)
     * Other bots will pick this up on their next poll
     */
    broadcast(eventName, data = {}) {
        const event = {
            type: eventName,
            source: this.botName,
            data,
            timestamp: Date.now(),
        };

        const filename = `${Date.now()}_${this.botName}_${eventName}.json`;
        const filepath = path.join(EVENT_DIR, filename);

        try {
            fs.writeFileSync(filepath, JSON.stringify(event, null, 2));
        } catch (err) {
            console.error(`[EventBus] Failed to write event: ${err.message}`);
        }
    }

    /**
     * Start polling for new events from other bots
     */
    startPolling() {
        if (this._polling) return;
        this._polling = true;

        this._interval = setInterval(() => {
            try {
                if (!fs.existsSync(EVENT_DIR)) return;
                const files = fs.readdirSync(EVENT_DIR).filter(f => f.endsWith('.json'));

                for (const file of files) {
                    if (this._processedFiles.has(file)) continue;
                    this._processedFiles.add(file);

                    const filepath = path.join(EVENT_DIR, file);
                    try {
                        const raw = fs.readFileSync(filepath, 'utf-8');
                        const event = JSON.parse(raw);

                        // Don't process own events
                        if (event.source === this.botName) continue;

                        // Emit locally so listeners can handle it
                        this.emit(event.type, event.data, event.source);

                        // Clean up old events (older than 5 minutes)
                        if (Date.now() - event.timestamp > 5 * 60 * 1000) {
                            fs.unlinkSync(filepath);
                            this._processedFiles.delete(file);
                        }
                    } catch (err) {
                        // File might be partially written, skip
                    }
                }

                // Periodic cleanup of processed file tracker
                if (this._processedFiles.size > 1000) {
                    this._processedFiles.clear();
                }
            } catch (err) {
                // Silently handle polling errors
            }
        }, POLL_INTERVAL);
    }

    stopPolling() {
        this._polling = false;
        if (this._interval) clearInterval(this._interval);
    }
}

// Singleton instance
module.exports = new SharedEventBus();
