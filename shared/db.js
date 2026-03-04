/**
 * Shared SQLite Database - All bots can use their own isolated database,
 * but using the same helper pattern ensures consistency.
 * Usage: const db = require('../../shared/db')('sentiguard');
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');

function getDatabase(botName) {
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
    const dbPath = path.join(DB_DIR, `${botName}.db`);
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // Better concurrent performance
    db.pragma('foreign_keys = ON');
    return db;
}

module.exports = getDatabase;
