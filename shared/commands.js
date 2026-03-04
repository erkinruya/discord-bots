/**
 * Shared Slash Command Helper
 * Simplifies registering slash commands for each bot.
 * 
 * Usage:
 *   const { registerCommands } = require('../../shared/commands');
 *   registerCommands(client, commands);
 */

const { REST, Routes } = require('discord.js');

/**
 * Register slash commands globally for a bot
 * @param {string} token - Bot token
 * @param {string} clientId - Bot's client/application ID
 * @param {Array} commands - Array of SlashCommandBuilder instances
 */
async function registerCommands(token, clientId, commands) {
    const rest = new REST({ version: '10' }).setToken(token);
    const body = commands.map(c => c.toJSON());

    try {
        console.log(`[Commands] Registering ${body.length} slash command(s)...`);
        await rest.put(Routes.applicationCommands(clientId), { body });
        console.log(`[Commands] Successfully registered ${body.length} command(s).`);
    } catch (error) {
        console.error('[Commands] Failed to register commands:', error.message);
    }
}

module.exports = { registerCommands };
