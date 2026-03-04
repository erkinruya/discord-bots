/**
 * BOT 2: GUARDIAN - Anti-Nuke & Anti-Raid Kalkanı
 * ✅ Slash Commands
 * ✅ Whitelist sistemi
 * ✅ Quarantine Mode (kanalları otomatik kilitle)
 * ✅ Kanal yedekleme & geri yükleme
 * ✅ Event Bus (LogMaster, Blacklist'e sinyal)
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, AuditLogEvent, SlashCommandBuilder, ChannelType } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
const eventBus = require('../../shared/eventbus');
const { registerCommands } = require('../../shared/commands');
require('dotenv').config();

const log = createLogger('GUARDIAN');
const db = getDatabase('guardian');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id        TEXT PRIMARY KEY,
        log_channel     TEXT,
        quarantine_mode INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS whitelist (
        guild_id TEXT,
        user_id  TEXT,
        PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channel_backup (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT,
        channel_id TEXT,
        name       TEXT,
        type       INTEGER,
        parent_id  TEXT,
        position   INTEGER,
        topic      TEXT,
        nsfw       INTEGER DEFAULT 0,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS nuke_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id    TEXT,
        attacker_id TEXT,
        action      TEXT,
        details     TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// --- Action Tracking ---
const actionTracker = new Map();
const THRESHOLDS = {
    channelDelete: { limit: 3, window: 10_000 },
    channelCreate: { limit: 5, window: 10_000 },
    ban: { limit: 3, window: 10_000 },
    kick: { limit: 5, window: 15_000 },
    roleDelete: { limit: 2, window: 10_000 },
};

function isWhitelisted(guildId, userId) {
    return !!db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function trackAction(guildId, userId, action) {
    if (isWhitelisted(guildId, userId)) return false;

    const key = `${guildId}-${userId}-${action}`;
    const now = Date.now();
    const threshold = THRESHOLDS[action];
    if (!threshold) return false;

    const times = (actionTracker.get(key) || []).filter(t => now - t < threshold.window);
    times.push(now);
    actionTracker.set(key, times);

    return times.length >= threshold.limit;
}

// --- Quarantine Mode ---
async function activateQuarantine(guild) {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);
    if (!config?.quarantine_mode) return;

    log.warn(`QUARANTINE MODE activated for ${guild.name}`);

    let lockedCount = 0;
    for (const [, channel] of guild.channels.cache) {
        if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
            try {
                await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, Connect: false });
                lockedCount++;
            } catch (e) { /* skip */ }
        }
    }

    // Auto-unlock after 5 minutes
    setTimeout(async () => {
        for (const [, channel] of guild.channels.cache) {
            if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice) {
                try {
                    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null, Connect: null });
                } catch (e) { /* skip */ }
            }
        }
        log.info(`Quarantine lifted for ${guild.name}`);

        if (config?.log_channel) {
            const logCh = guild.channels.cache.get(config.log_channel);
            logCh?.send({ embeds: [new EmbedBuilder().setTitle('🟢 Karantina Kaldırıldı').setDescription('5 dakikalık karantina süresi doldu. Kanallar yeniden açıldı.').setColor('#00cc44').setTimestamp()] });
        }
    }, 5 * 60 * 1000);

    return lockedCount;
}

// --- Nuke Handler ---
async function handleNuke(guild, executorId, reason) {
    log.warn(`NUKE DETECTED in ${guild.name} by ${executorId}: ${reason}`);

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);
    const executor = await guild.members.fetch(executorId).catch(() => null);

    // 1. Strip roles
    if (executor && !executor.user.bot) {
        const roles = executor.roles.cache.filter(r => r.id !== guild.id);
        await executor.roles.remove(roles).catch(() => { });
        log.warn(`Stripped all roles from ${executor.user.tag}`);
    }

    // 2. Activate quarantine
    const lockedChannels = await activateQuarantine(guild);

    // 3. Log to database
    db.prepare('INSERT INTO nuke_log (guild_id, attacker_id, action, details) VALUES (?, ?, ?, ?)').run(guild.id, executorId, reason, `Locked ${lockedChannels} channels`);

    // 4. Alert in log channel
    if (config?.log_channel) {
        const logCh = guild.channels.cache.get(config.log_channel);
        if (logCh) {
            const embed = new EmbedBuilder()
                .setTitle('🔴 GUARDIAN - Nuke Girişimi Tespit Edildi!')
                .setColor('#ff0000')
                .addFields(
                    { name: 'Saldırgan', value: executor ? `${executor.user.tag} (<@${executorId}>)` : `ID: ${executorId}`, inline: true },
                    { name: 'Sebep', value: reason, inline: true },
                    { name: 'Yapılan İşlem', value: `✅ Tüm roller alındı\n🔒 ${lockedChannels} kanal kilitlendi (5dk)\n📋 Olay kaydedildi` },
                )
                .setTimestamp();
            logCh.send({ embeds: [embed] });
        }
    }

    // 5. Broadcast to event bus
    eventBus.broadcast('nuke_detected', {
        guildId: guild.id,
        attackerId: executorId,
        attackerTag: executor?.user?.tag || 'Unknown',
        reason,
        lockedChannels
    });
}

// --- Raid Detection ---
const joinTracker = new Map();
const RAID_LIMIT = 8;
const RAID_WINDOW = 10_000;

async function handleRaid(guild) {
    log.warn(`RAID DETECTED in ${guild.name}`);
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);

    const lockedChannels = await activateQuarantine(guild);

    if (config?.log_channel) {
        const logCh = guild.channels.cache.get(config.log_channel);
        const embed = new EmbedBuilder()
            .setTitle('🛑 GUARDIAN - Raid Tespit Edildi!')
            .setColor('#ff0000')
            .setDescription(`Son ${RAID_WINDOW / 1000}sn'de ${RAID_LIMIT}+ yeni üye!\n🔒 ${lockedChannels} kanal kilitlendi (5dk)`)
            .setTimestamp();
        logCh?.send({ embeds: [embed] });
    }

    eventBus.broadcast('raid_detected', { guildId: guild.id, joinCount: RAID_LIMIT });
}

// --- Slash Commands ---
const slashCommands = [
    new SlashCommandBuilder().setName('guard-setup').setDescription('Guardian koruma kanalını ayarla')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true))
        .addBooleanOption(o => o.setName('karantina').setDescription('Karantina modu (varsayılan: açık)')),
    new SlashCommandBuilder().setName('guard-whitelist').setDescription('Kullanıcıyı korumadan muaf tut')
        .addUserOption(o => o.setName('kullanici').setDescription('Whitelist kullanıcısı').setRequired(true)),
    new SlashCommandBuilder().setName('guard-restore').setDescription('Son silinen kanalları geri yükle')
        .addIntegerOption(o => o.setName('adet').setDescription('Geri yüklenecek kanal sayısı (max 5)').setMinValue(1).setMaxValue(5)),
    new SlashCommandBuilder().setName('guard-log').setDescription('Son nuke girişim kayıtlarını göster'),
    new SlashCommandBuilder().setName('guard-help').setDescription('Guardian komut listesi'),
];

eventBus.init('guardian');

// Listen for toxic user alerts from Sentiguard
eventBus.on('toxic_user_alert', (data, source) => {
    log.info(`[EventBus] Received toxic_user_alert from ${source}: ${data.username} (${data.totalWarnings} warnings)`);
});

// --- Events ---
client.on('ready', async () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🛡️ Sunucuyu Koruyor' }] });

    if (process.env.CLIENT_ID) {
        await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, slashCommands);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, member } = interaction;

    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
    }

    if (commandName === 'guard-setup') {
        const ch = interaction.options.getChannel('kanal');
        const quarantine = interaction.options.getBoolean('karantina') ?? true;
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel, quarantine_mode) VALUES (?, ?, ?)').run(guild.id, ch.id, quarantine ? 1 : 0);
        return interaction.reply(`✅ Guardian aktif.\n- Log: <#${ch.id}>\n- Karantina: ${quarantine ? '🔒 Açık' : '🔓 Kapalı'}`);
    }

    if (commandName === 'guard-whitelist') {
        const user = interaction.options.getUser('kullanici');
        const existing = db.prepare('SELECT 1 FROM whitelist WHERE guild_id = ? AND user_id = ?').get(guild.id, user.id);
        if (existing) {
            db.prepare('DELETE FROM whitelist WHERE guild_id = ? AND user_id = ?').run(guild.id, user.id);
            return interaction.reply(`🗑️ **${user.tag}** whitelist'ten kaldırıldı.`);
        }
        db.prepare('INSERT INTO whitelist (guild_id, user_id) VALUES (?, ?)').run(guild.id, user.id);
        return interaction.reply(`✅ **${user.tag}** whitelist'e eklendi. Anti-nuke korumasından muaf tutulacak.`);
    }

    if (commandName === 'guard-restore') {
        const count = interaction.options.getInteger('adet') || 3;
        const backups = db.prepare('SELECT * FROM channel_backup WHERE guild_id = ? ORDER BY deleted_at DESC LIMIT ?').all(guild.id, count);
        if (backups.length === 0) return interaction.reply({ content: 'Yedeklenmiş kanal bulunamadı.', ephemeral: true });

        let restored = [];
        for (const backup of backups) {
            try {
                const newChannel = await guild.channels.create({
                    name: backup.name,
                    type: backup.type,
                    parent: backup.parent_id || undefined,
                    topic: backup.topic || undefined,
                    nsfw: !!backup.nsfw,
                });
                restored.push(newChannel.name);
                db.prepare('DELETE FROM channel_backup WHERE id = ?').run(backup.id);
            } catch (e) { log.error(`Restore failed for ${backup.name}: ${e.message}`); }
        }

        return interaction.reply(`✅ ${restored.length} kanal geri yüklendi: ${restored.map(n => `\`${n}\``).join(', ')}`);
    }

    if (commandName === 'guard-log') {
        const logs = db.prepare('SELECT * FROM nuke_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT 5').all(guild.id);
        if (logs.length === 0) return interaction.reply({ content: 'Kayıtlı nuke girişimi yok. 🎉', ephemeral: true });
        const embed = new EmbedBuilder().setTitle('📋 Guardian - Nuke Kayıtları').setColor('#ff6600')
            .setDescription(logs.map((l, i) => `**${i + 1}.** <@${l.attacker_id}> — ${l.action}\n   *${l.created_at}*`).join('\n\n'));
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'guard-help') {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Guardian - Komut Listesi')
            .setColor('#0099ff')
            .setDescription([
                '`/guard-setup` — Log kanalı ve karantina ayarı',
                '`/guard-whitelist` — Kullanıcıyı muaf tut/kaldır',
                '`/guard-restore` — Silinen kanalları geri yükle',
                '`/guard-log` — Nuke girişim kayıtları',
                '`/guard-help` — Bu menü',
            ].join('\n'));
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// --- Channel Delete Tracking + Backup ---
client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;

    // Backup deleted channel info
    db.prepare('INSERT INTO channel_backup (guild_id, channel_id, name, type, parent_id, position, topic, nsfw) VALUES (?,?,?,?,?,?,?,?)')
        .run(channel.guild.id, channel.id, channel.name, channel.type, channel.parentId, channel.position, channel.topic, channel.nsfw ? 1 : 0);

    const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
    const executor = audit?.entries?.first()?.executor;
    if (!executor || executor.id === client.user.id) return;

    if (trackAction(channel.guild.id, executor.id, 'channelDelete')) {
        await handleNuke(channel.guild, executor.id, 'Hızlı kanal silme (Anti-Nuke)');
    }
});

client.on('guildMemberRemove', async (member) => {
    const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
    const executor = audit?.entries?.first()?.executor;
    if (!executor || executor.id === client.user.id) return;
    if (trackAction(member.guild.id, executor.id, 'ban')) {
        await handleNuke(member.guild, executor.id, 'Toplu ban (Anti-Nuke)');
    }
});

client.on('guildMemberAdd', async (member) => {
    const now = Date.now();
    const times = (joinTracker.get(member.guild.id) || []).filter(t => now - t < RAID_WINDOW);
    times.push(now);
    joinTracker.set(member.guild.id, times);
    if (times.length >= RAID_LIMIT) {
        joinTracker.set(member.guild.id, []);
        await handleRaid(member.guild);
    }
});

client.on('roleDelete', async (role) => {
    const audit = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
    const executor = audit?.entries?.first()?.executor;
    if (!executor || executor.id === client.user.id) return;
    if (trackAction(role.guild.id, executor.id, 'roleDelete')) {
        await handleNuke(role.guild, executor.id, 'Toplu rol silme (Anti-Nuke)');
    }
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
