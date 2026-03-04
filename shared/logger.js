/**
 * Shared Logger - All bots use this for consistent log formatting.
 * Usage: const logger = require('../../shared/logger')('BotName');
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = { DEBUG: '\x1b[36m', INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', RESET: '\x1b[0m' };

function createLogger(botName) {
    const level = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

    function log(lvl, ...messages) {
        if (LOG_LEVELS[lvl] < level) return;
        const ts = new Date().toISOString();
        const color = COLORS[lvl] || '';
        console.log(`${color}[${ts}] [${botName}] [${lvl}]${COLORS.RESET}`, ...messages);
    }

    return {
        debug: (...m) => log('DEBUG', ...m),
        info: (...m) => log('INFO', ...m),
        warn: (...m) => log('WARN', ...m),
        error: (...m) => log('ERROR', ...m),
    };
}

module.exports = createLogger;
