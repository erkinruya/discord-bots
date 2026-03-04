/**
 * BOT 4: LOGMASTER - Detaylı Olay Kaydı & Haftalık Rapor
 * ✅ Slash Commands
 * ✅ Snipe (son silinen mesajı göster)
 * ✅ Event Bus (Guardian/Sentiguard olaylarını logla)
 * ✅ Son 24 saat istatistik komutu
 */

const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
const eventBus = require('../../shared/eventbus');
const { registerCommands } = require('../../shared/commands');
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
    CREATE TABLE IF NOT EXISTS deleted_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT,
        channel_id TEXT,
        user_id    TEXT,
        username   TEXT,
        content    TEXT,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// --- Snipe Cache (in-memory for speed) ---
const snipeCache = new Map(); // channelId -> { author, content, timestamp, attachments }

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

// --- Slash Commands ---
const slashCommands = [
    new SlashCommandBuilder().setName('log-setup').setDescription('Log kanalını ayarla')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true)),
    new SlashCommandBuilder().setName('snipe').setDescription('Bu kanalda son silinen mesajı göster'),
    new SlashCommandBuilder().setName('log-stats').setDescription('Son 24 saatin olay özetini göster'),
    new SlashCommandBuilder().setName('log-report').setDescription('Manuel haftalık rapor oluştur'),
    new SlashCommandBuilder().setName('log-search').setDescription('Kullanıcının olay geçmişini ara')
        .addUserOption(o => o.setName('kullanici').setDescription('Hedef kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('log-help').setDescription('LogMaster komut listesi'),
];

// --- Event Bus ---
eventBus.init('logmaster');

eventBus.on('nuke_detected', (data, source) => {
    log.warn(`[EventBus] Nuke alert from ${source}: ${data.attackerTag} in guild ${data.guildId}`);
    const guild = client.guilds.cache.get(data.guildId);
    if (guild) {
        recordEvent(data.guildId, 'NUKE_DETECTED', data.attackerId, `${data.reason} (via ${source})`);
        sendLog(guild, new EmbedBuilder()
            .setTitle('🔴 [EventBus] Nuke Tespit Edildi!')
            .setColor('#ff0000')
            .setDescription(`Kaynak: **${source}**\nSaldırgan: <@${data.attackerId}>\nSebep: ${data.reason}`)
            .setTimestamp());
    }
});

eventBus.on('raid_detected', (data, source) => {
    const guild = client.guilds.cache.get(data.guildId);
    if (guild) {
        recordEvent(data.guildId, 'RAID_DETECTED', null, `${data.joinCount} joins (via ${source})`);
    }
});

eventBus.on('high_tension', (data, source) => {
    const guild = client.guilds.cache.get(data.guildId);
    if (guild) {
        recordEvent(data.guildId, 'HIGH_TENSION', null, `Channel: ${data.channelId}, Score: ${data.score} (via ${source})`);
    }
});

// --- Events ---
client.on('ready', async () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '📋 Olayları Kaydediyor' }] });
    scheduleWeeklyReport();

    if (process.env.CLIENT_ID) {
        await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, slashCommands);
    }
});

// --- Weekly Report ---
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
        }, 7 * 24 * 60 * 60 * 1000);
    }, msUntil);
    log.info(`Weekly report scheduled in ${Math.floor(msUntil / 1000 / 60)} minutes.`);
}

async function sendWeeklyReport(guild) {
    const config = getConfig(guild.id);
    if (!config?.log_channel) return;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const events = db.prepare('SELECT event_type, COUNT(*) as count FROM event_log WHERE guild_id = ? AND created_at > ? GROUP BY event_type ORDER BY count DESC').all(guild.id, since);
    const topUsers = db.prepare('SELECT user_id, COUNT(*) as count FROM event_log WHERE guild_id = ? AND created_at > ? AND user_id IS NOT NULL GROUP BY user_id ORDER BY count DESC LIMIT 5').all(guild.id, since);
    const totalEvents = events.reduce((sum, e) => sum + e.count, 0);

    const embed = new EmbedBuilder()
        .setTitle(`📊 Haftalık Sunucu Raporu`)
        .setColor('#0099ff')
        .setTimestamp()
        .addFields(
            { name: '📌 Toplam Olay', value: `${totalEvents}`, inline: true },
            { name: '📋 Olay Dağılımı', value: events.length > 0 ? events.map(e => `• **${e.event_type}**: ${e.count}`).join('\n') : 'Olay yok' },
            { name: '👥 En Aktif Kullanıcılar', value: topUsers.length > 0 ? topUsers.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.count} olay`).join('\n') : 'Veri yok' }
        );

    const ch = guild.channels.cache.get(config.log_channel);
    ch?.send({ embeds: [embed] });
    log.info(`Weekly report sent for ${guild.name}`);
}

// --- Slash Command Handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, channel, member } = interaction;

    if (commandName === 'log-setup') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const ch = interaction.options.getChannel('kanal');
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel) VALUES (?, ?)').run(guild.id, ch.id);
        return interaction.reply(`✅ Log kanalı <#${ch.id}> olarak ayarlandı.`);
    }

    if (commandName === 'snipe') {
        const cached = snipeCache.get(channel.id);
        if (!cached) return interaction.reply({ content: 'Bu kanalda yakın zamanda silinen mesaj yok.', ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Son Silinen Mesaj')
            .setColor('#ff4444')
            .addFields(
                { name: 'Kullanıcı', value: cached.author, inline: true },
                { name: 'Ne Zaman', value: `<t:${Math.floor(cached.timestamp / 1000)}:R>`, inline: true },
                { name: 'İçerik', value: cached.content?.slice(0, 1000) || '*Metin yok*' }
            )
            .setTimestamp(cached.timestamp);

        if (cached.attachments) embed.setImage(cached.attachments);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'log-stats') {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const events = db.prepare('SELECT event_type, COUNT(*) as count FROM event_log WHERE guild_id = ? AND created_at > ? GROUP BY event_type ORDER BY count DESC').all(guild.id, since);
        const total = events.reduce((s, e) => s + e.count, 0);

        const embed = new EmbedBuilder()
            .setTitle('📈 Son 24 Saat İstatistikleri')
            .setColor('#0099ff')
            .addFields(
                { name: 'Toplam Olay', value: `${total}`, inline: true },
                { name: 'Dağılım', value: events.length > 0 ? events.map(e => `• **${e.event_type}**: ${e.count}`).join('\n') : 'Olay yok' }
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'log-report') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        await sendWeeklyReport(guild);
        return interaction.reply({ content: '✅ Haftalık rapor log kanalına gönderildi.', ephemeral: true });
    }

    if (commandName === 'log-search') {
        const target = interaction.options.getUser('kullanici');
        const events = db.prepare('SELECT * FROM event_log WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10').all(guild.id, target.id);
        if (events.length === 0) return interaction.reply({ content: `${target.username} için olay kaydı yok.`, ephemeral: true });
        const embed = new EmbedBuilder().setTitle(`🔍 ${target.username} - Olay Geçmişi`).setColor('#0099ff')
            .setDescription(events.map((e, i) => `**${i + 1}. ${e.event_type}** — ${e.detail?.slice(0, 80) || '—'}\n   *${e.created_at}*`).join('\n'));
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'log-help') {
        const embed = new EmbedBuilder()
            .setTitle('📊 LogMaster - Komut Listesi')
            .setColor('#0099ff')
            .setDescription([
                '`/log-setup` — Log kanalını ayarla',
                '`/snipe` — Son silinen mesajı göster',
                '`/log-stats` — Son 24 saat istatistikleri',
                '`/log-report` — Manuel haftalık rapor',
                '`/log-search` — Kullanıcı olay geçmişi',
                '`/log-help` — Bu menü',
            ].join('\n'));
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// --- Message Delete (with Snipe) ---
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;

    // Save to snipe cache
    snipeCache.set(message.channel.id, {
        author: message.author?.tag || 'Bilinmiyor',
        content: message.content || '',
        timestamp: Date.now(),
        attachments: message.attachments?.first()?.url || null,
    });

    // Clear snipe after 5 minutes
    setTimeout(() => snipeCache.delete(message.channel.id), 5 * 60 * 1000);

    // Save to DB
    db.prepare('INSERT INTO deleted_messages (guild_id, channel_id, user_id, username, content) VALUES (?,?,?,?,?)').run(
        message.guild.id, message.channel.id, message.author?.id, message.author?.tag, message.content?.slice(0, 2000)
    );

    recordEvent(message.guild.id, 'MESSAGE_DELETE', message.author?.id, message.content?.slice(0, 200));

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Mesaj Silindi')
        .setColor('#ff4444')
        .addFields(
            { name: 'Kullanıcı', value: `${message.author?.tag || '?'} (<@${message.author?.id}>)`, inline: true },
            { name: 'Kanal', value: `<#${message.channel.id}>`, inline: true },
            { name: 'İçerik', value: message.content?.slice(0, 1000) || '*Metin yok*' }
        )
        .setTimestamp();
    await sendLog(message.guild, embed);
});

// --- Message Edit ---
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot || oldMsg.content === newMsg.content) return;
    recordEvent(newMsg.guild.id, 'MESSAGE_EDIT', newMsg.author?.id, `${oldMsg.content?.slice(0, 100)} → ${newMsg.content?.slice(0, 100)}`);
    const embed = new EmbedBuilder()
        .setTitle('✏️ Mesaj Düzenlendi')
        .setColor('#ffaa00')
        .addFields(
            { name: 'Kullanıcı', value: `${newMsg.author?.tag} (<@${newMsg.author?.id}>)`, inline: true },
            { name: 'Kanal', value: `<#${newMsg.channel.id}>`, inline: true },
            { name: 'Eski', value: oldMsg.content?.slice(0, 500) || '—' },
            { name: 'Yeni', value: newMsg.content?.slice(0, 500) || '—' }
        )
        .setTimestamp();
    await sendLog(newMsg.guild, embed);
});

// --- Member Join/Leave ---
client.on('guildMemberAdd', async (member) => {
    recordEvent(member.guild.id, 'MEMBER_JOIN', member.id, null);
    const embed = new EmbedBuilder().setTitle('📥 Yeni Üye').setColor('#00cc44')
        .setDescription(`${member.user.tag} katıldı — Hesap: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`)
        .setThumbnail(member.user.displayAvatarURL()).setTimestamp();
    await sendLog(member.guild, embed);
});

client.on('guildMemberRemove', async (member) => {
    recordEvent(member.guild.id, 'MEMBER_LEAVE', member.id, null);
    const embed = new EmbedBuilder().setTitle('📤 Üye Ayrıldı').setColor('#ff6600')
        .setDescription(`${member.user.tag} ayrıldı.`).setTimestamp();
    await sendLog(member.guild, embed);
});

// --- Voice State ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.guild || !newState.member) return;
    const user = newState.member.user;
    let desc = null;
    if (!oldState.channelId && newState.channelId) desc = `<@${user.id}> **${newState.channel?.name}**'a girdi`;
    else if (oldState.channelId && !newState.channelId) desc = `<@${user.id}> **${oldState.channel?.name}**'dan ayrıldı`;
    else if (oldState.channelId !== newState.channelId) desc = `<@${user.id}> **${oldState.channel?.name}** → **${newState.channel?.name}**`;
    if (!desc) return;
    recordEvent(newState.guild.id, 'VOICE_STATE', user.id, desc);
    const embed = new EmbedBuilder().setTitle('🔊 Ses Kanalı').setColor('#9b59b6').setDescription(desc).setTimestamp();
    await sendLog(newState.guild, embed);
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
