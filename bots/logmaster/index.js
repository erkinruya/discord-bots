/**
 * BOT 4: LOGMASTER - Detaylı Olay Kaydı ve Haftalık Rapor
 * Tüm önemli olayları (mesaj silme/düzenleme, rol değişimi, ses kanalı aktivitesi vb.) loglar.
 * Her Pazar otomatik haftalık rapor gönderir.
 */

const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
require('dotenv').config();

const log = createLogger('LOGMASTER');
const db = getDatabase('logmaster');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
    ]
});

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id    TEXT PRIMARY KEY,
        log_channel TEXT
    );
    CREATE TABLE IF NOT EXISTS event_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT,
        event_type TEXT,
        user_id    TEXT,
        detail     TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

function getConfig(guildId) {
    return db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
}

async function sendLog(guild, embed) {
    const config = getConfig(guild.id);
    if (!config?.log_channel) return;
    const ch = guild.channels.cache.get(config.log_channel);
    ch?.send({ embeds: [embed] }).catch(() => { });
}

function recordEvent(guildId, eventType, userId, detail) {
    db.prepare('INSERT INTO event_log (guild_id, event_type, user_id, detail) VALUES (?,?,?,?)').run(guildId, eventType, userId, detail);
}

// --- Events ---
client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '📋 Olayları Kaydediyor' }] });

    // Schedule weekly report every Sunday at 20:00
    scheduleWeeklyReport();
});

function scheduleWeeklyReport() {
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(20, 0, 0, 0);
    const msUntil = nextSunday - now;

    setTimeout(() => {
        client.guilds.cache.forEach(guild => sendWeeklyReport(guild));
        setInterval(() => {
            client.guilds.cache.forEach(guild => sendWeeklyReport(guild));
        }, 7 * 24 * 60 * 60 * 1000); // repeat weekly
    }, msUntil);

    log.info(`Weekly report scheduled in ${Math.floor(msUntil / 1000 / 60)} minutes.`);
}

async function sendWeeklyReport(guild) {
    const config = getConfig(guild.id);
    if (!config?.log_channel) return;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const events = db.prepare('SELECT event_type, COUNT(*) as count FROM event_log WHERE guild_id = ? AND created_at > ? GROUP BY event_type ORDER BY count DESC').all(guild.id, since);
    const topUsers = db.prepare('SELECT user_id, COUNT(*) as count FROM event_log WHERE guild_id = ? AND created_at > ? AND user_id IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 5').all(guild.id, since);

    const embed = new EmbedBuilder()
        .setTitle(`📊 Haftalık Sunucu Raporu - ${guild.name}`)
        .setColor('#0099ff')
        .setTimestamp()
        .addFields(
            { name: '📌 Olay Özeti (son 7 gün)', value: events.length > 0 ? events.map(e => `• **${e.event_type}**: ${e.count} kez`).join('\n') : 'Bu hafta kayıtlı olay yok.' },
            { name: '👥 En Aktif Kullanıcılar', value: topUsers.length > 0 ? topUsers.map((u, i) => `${i + 1}. <@${u.user_id}> - ${u.count} olay`).join('\n') : 'Veri yok.' }
        );

    const ch = guild.channels.cache.get(config.log_channel);
    ch?.send({ embeds: [embed] });
    log.info(`Weekly report sent for ${guild.name}`);
}

// Message Delete
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    recordEvent(message.guild.id, 'MESSAGE_DELETE', message.author?.id, message.content?.slice(0, 200));
    const embed = new EmbedBuilder()
        .setTitle('🗑️ Mesaj Silindi')
        .setColor('#ff4444')
        .addFields(
            { name: 'Kullanıcı', value: `${message.author?.tag || 'Bilinmiyor'} (<@${message.author?.id}>)`, inline: true },
            { name: 'Kanal', value: `<#${message.channel.id}>`, inline: true },
            { name: 'İçerik', value: message.content?.slice(0, 1000) || '*Metin yok (resim/embed)*' }
        )
        .setTimestamp();
    await sendLog(message.guild, embed);
});

// Message Edit
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
    recordEvent(newMsg.guild.id, 'MESSAGE_EDIT', newMsg.author?.id, `${oldMsg.content?.slice(0, 100)} -> ${newMsg.content?.slice(0, 100)}`);
    const embed = new EmbedBuilder()
        .setTitle('✏️ Mesaj Düzenlendi')
        .setColor('#ffaa00')
        .addFields(
            { name: 'Kullanıcı', value: `${newMsg.author?.tag} (<@${newMsg.author?.id}>)`, inline: true },
            { name: 'Kanal', value: `<#${newMsg.channel.id}>`, inline: true },
            { name: 'Eski İçerik', value: oldMsg.content?.slice(0, 500) || '—' },
            { name: 'Yeni İçerik', value: newMsg.content?.slice(0, 500) || '—' }
        )
        .setTimestamp();
    await sendLog(newMsg.guild, embed);
});

// Member Join/Leave
client.on('guildMemberAdd', async (member) => {
    recordEvent(member.guild.id, 'MEMBER_JOIN', member.id, null);
    const embed = new EmbedBuilder()
        .setTitle('📥 Yeni Üye Katıldı')
        .setColor('#00cc44')
        .setDescription(`${member.user.tag} sunucuya katıldı.\nHesap Tarihi: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();
    await sendLog(member.guild, embed);
});

client.on('guildMemberRemove', async (member) => {
    recordEvent(member.guild.id, 'MEMBER_LEAVE', member.id, null);
    const embed = new EmbedBuilder()
        .setTitle('📤 Üye Ayrıldı')
        .setColor('#ff6600')
        .setDescription(`${member.user.tag} sunucudan ayrıldı.`)
        .setTimestamp();
    await sendLog(member.guild, embed);
});

// Voice State
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild || !newState.member) return;
    const user = newState.member.user;
    let desc = null;

    if (!oldState.channelId && newState.channelId) desc = `<@${user.id}> **${newState.channel?.name}** kanalına girdi.`;
    else if (oldState.channelId && !newState.channelId) desc = `<@${user.id}> **${oldState.channel?.name}** kanalından ayrıldı.`;
    else if (oldState.channelId !== newState.channelId) desc = `<@${user.id}> **${oldState.channel?.name}** → **${newState.channel?.name}**`;
    if (!desc) return;

    recordEvent(newState.guild.id, 'VOICE_STATE', user.id, desc);
    const embed = new EmbedBuilder().setTitle('🔊 Ses Kanalı').setColor('#9b59b6').setDescription(desc).setTimestamp();
    await sendLog(newState.guild, embed);
});

// Setup command
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!log setup')) return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('Kullanım: `!log setup #log-kanalı`');
    db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel) VALUES (?, ?)').run(message.guild.id, ch.id);
    message.reply(`✅ Log kanalı <#${ch.id}> olarak ayarlandı.`);
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
