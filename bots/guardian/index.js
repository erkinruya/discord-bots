/**
 * BOT 2: GUARDIAN - Anti-Nuke & Anti-Raid Kalkanı
 * Kısa sürede gerçekleşen tehlikeli işlemleri algılar:
 * - Toplu kanal silme/oluşturma
 * - Toplu ban/kick
 * - Raid (çok sayıda yeni üye girişi)
 * Tehdit tespit edildiğinde sorumlu kişiyi de-role eder ve sunucuyu kilitler.
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
require('dotenv').config();

const log = createLogger('GUARDIAN');
const db = getDatabase('guardian');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
    ]
});

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id      TEXT PRIMARY KEY,
        log_channel   TEXT,
        owner_role_id TEXT
    );
`);

// --- Action Tracking ---
// Tracks rapid actions per-user per-guild
const actionTracker = new Map();
const NUKE_THRESHOLDS = {
    channelDelete: { limit: 3, window: 10_000 },  // 3 deletions in 10s
    channelCreate: { limit: 5, window: 10_000 },
    ban: { limit: 3, window: 10_000 },
    kick: { limit: 5, window: 15_000 },
};

function trackAction(guildId, userId, action) {
    const key = `${guildId}-${userId}-${action}`;
    const now = Date.now();
    const threshold = NUKE_THRESHOLDS[action];
    if (!threshold) return false;

    const times = (actionTracker.get(key) || []).filter(t => now - t < threshold.window);
    times.push(now);
    actionTracker.set(key, times);

    return times.length >= threshold.limit;
}

async function handleNuke(guild, executorId, reason) {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);

    log.warn(`NUKE DETECTED in ${guild.name} by ${executorId}. Reason: ${reason}`);

    // 1. Try to fetch the executor member
    const executor = await guild.members.fetch(executorId).catch(() => null);

    // 2. Remove all roles from the executor (except @everyone)
    if (executor && !executor.user.bot) {
        const roles = executor.roles.cache.filter(r => r.id !== guild.id);
        await executor.roles.remove(roles).catch(() => { });
        log.warn(`Stripped all roles from ${executor.user.tag}`);
    }

    // 3. Alert in log channel
    if (config?.log_channel) {
        const logChannel = guild.channels.cache.get(config.log_channel);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🔴 GUARDIAN - Nuke Girişimi Tespit Edildi!')
                .setColor('#ff0000')
                .addFields(
                    { name: 'Saldırgan', value: executor ? `${executor.user.tag} (<@${executorId}>)` : `ID: ${executorId}`, inline: true },
                    { name: 'Sebep', value: reason, inline: true },
                    { name: 'Yapılan İşlem', value: 'Tüm roller alındı.' }
                )
                .setTimestamp();
            logChannel.send({ embeds: [embed] });
        }
    }
}

// --- Raid Detection ---
const joinTracker = new Map(); // guildId -> [timestamps]
const RAID_JOIN_LIMIT = 8;
const RAID_WINDOW = 10_000; // 10 seconds

async function handleRaid(guild) {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);
    log.warn(`RAID DETECTED in ${guild.name}`);

    if (config?.log_channel) {
        const logChannel = guild.channels.cache.get(config.log_channel);
        const embed = new EmbedBuilder()
            .setTitle('🛑 GUARDIAN - Raid Tespit Edildi!')
            .setColor('#ff0000')
            .setDescription(`Son ${RAID_WINDOW / 1000} saniyede ${RAID_JOIN_LIMIT}+ yeni üye katıldı!\nModeratörler lütfen kontrol edin.`)
            .setTimestamp();
        logChannel?.send({ embeds: [embed] });
    }
}

// --- Events ---
client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🛡️ Sunucuyu Koruyor' }] });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;

    const args = message.content.slice('!guard '.length).trim().split(' ');
    if (!message.content.startsWith('!guard')) return;
    const cmd = args[0];

    if (cmd === 'setup') {
        const channelId = message.mentions.channels.first()?.id;
        if (!channelId) return message.reply('Lütfen log kanalı etiketleyin: `!guard setup #kanal`');
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel) VALUES (?, ?)').run(message.guild.id, channelId);
        return message.reply(`✅ Koruma sistemi aktif. Log kanalı: <#${channelId}>`);
    }
});

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
    const executor = audit?.entries?.first()?.executor;
    if (!executor || executor.id === client.user.id) return;

    if (trackAction(channel.guild.id, executor.id, 'channelDelete')) {
        await handleNuke(channel.guild, executor.id, 'Hızlı kanal silme (Anti-Nuke)');
    }
});

client.on('guildMemberRemove', async (member) => {
    if (!member.guild) return;
    const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
    const executor = audit?.entries?.first()?.executor;
    if (!executor || executor.id === client.user.id) return;

    if (trackAction(member.guild.id, executor.id, 'ban')) {
        await handleNuke(member.guild, executor.id, 'Toplu ban (Anti-Nuke)');
    }
});

client.on('guildMemberAdd', async (member) => {
    const guildId = member.guild.id;
    const now = Date.now();
    const times = (joinTracker.get(guildId) || []).filter(t => now - t < RAID_WINDOW);
    times.push(now);
    joinTracker.set(guildId, times);

    if (times.length >= RAID_JOIN_LIMIT) {
        joinTracker.set(guildId, []); // Reset
        await handleRaid(member.guild);
    }
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
