/**
 * BOT 5: BLACKLIST - Sunucular Arası Kara Liste
 * ✅ Slash Commands
 * ✅ Event Bus (Guardian/Sentiguard'dan otomatik ekleme)
 * ✅ Export/Import desteği (JSON sync)
 * ✅ Otomatik ban modu
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
const eventBus = require('../../shared/eventbus');
const { registerCommands } = require('../../shared/commands');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const log = createLogger('BLACKLIST');
const db = getDatabase('blacklist');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
    ]
});

const AUTO_BAN = process.env.AUTO_BAN === 'true';

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id    TEXT PRIMARY KEY,
        log_channel TEXT,
        auto_ban    INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS blacklist (
        user_id    TEXT PRIMARY KEY,
        username   TEXT,
        reason     TEXT,
        added_by   TEXT,
        guild_id   TEXT,
        source     TEXT DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

function updatePresence() {
    const count = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
    client.user?.setPresence({ activities: [{ name: `🚫 ${count} Kara Liste Kaydı` }] });
}

// --- Slash Commands ---
const slashCommands = [
    new SlashCommandBuilder().setName('bl-setup').setDescription('Kara liste log kanalını ayarla')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true))
        .addBooleanOption(o => o.setName('autoban').setDescription('Otomatik ban (varsayılan: kapalı)')),
    new SlashCommandBuilder().setName('bl-add').setDescription('Kullanıcıyı kara listeye ekle')
        .addUserOption(o => o.setName('kullanici').setDescription('Hedef').setRequired(true))
        .addStringOption(o => o.setName('sebep').setDescription('Sebep').setRequired(true)),
    new SlashCommandBuilder().setName('bl-remove').setDescription('Kullanıcıyı kara listeden çıkar')
        .addUserOption(o => o.setName('kullanici').setDescription('Hedef').setRequired(true)),
    new SlashCommandBuilder().setName('bl-check').setDescription('Kara liste durumunu sorgula')
        .addStringOption(o => o.setName('id').setDescription('Kullanıcı ID veya @mention').setRequired(true)),
    new SlashCommandBuilder().setName('bl-list').setDescription('Kara listeyi listele')
        .addIntegerOption(o => o.setName('sayfa').setDescription('Sayfa numarası').setMinValue(1)),
    new SlashCommandBuilder().setName('bl-export').setDescription('Kara listeyi JSON olarak dışa aktar'),
    new SlashCommandBuilder().setName('bl-stats').setDescription('Kara liste istatistikleri'),
    new SlashCommandBuilder().setName('bl-help').setDescription('Blacklist komut listesi'),
];

// --- Event Bus ---
eventBus.init('blacklist');

// Listen for nuke events from Guardian
eventBus.on('nuke_detected', (data, source) => {
    log.warn(`[EventBus] Nuke alert from ${source}: adding ${data.attackerTag} to blacklist`);
    const existing = db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(data.attackerId);
    if (!existing) {
        db.prepare('INSERT INTO blacklist (user_id, username, reason, added_by, guild_id, source) VALUES (?,?,?,?,?,?)')
            .run(data.attackerId, data.attackerTag, `Nuke girişimi: ${data.reason}`, 'SYSTEM', data.guildId, 'guardian_auto');
        log.info(`Auto-blacklisted ${data.attackerTag} via Guardian event`);
        updatePresence();
    }
});

// Listen for toxic user alerts from Sentiguard
eventBus.on('toxic_user_alert', (data, source) => {
    if (data.totalWarnings >= 10) {
        const existing = db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(data.userId);
        if (!existing) {
            db.prepare('INSERT INTO blacklist (user_id, username, reason, added_by, guild_id, source) VALUES (?,?,?,?,?,?)')
                .run(data.userId, data.username, `Tekrarlayan toksisite (${data.totalWarnings} uyarı)`, 'SYSTEM', data.guildId, 'sentiguard_auto');
            log.info(`Auto-blacklisted ${data.username} via Sentiguard (${data.totalWarnings} warnings)`);
            updatePresence();
        }
    }
});

// --- Events ---
client.on('ready', async () => {
    log.info(`Logged in as ${client.user.tag}`);
    updatePresence();

    if (process.env.CLIENT_ID) {
        await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, slashCommands);
    }
});

client.on('guildMemberAdd', async (member) => {
    const entry = db.prepare('SELECT * FROM blacklist WHERE user_id = ?').get(member.id);
    if (!entry) return;

    log.warn(`Blacklisted user joined: ${member.user.tag} in ${member.guild.name}`);

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(member.guild.id);
    const embed = new EmbedBuilder()
        .setTitle('🚫 Kara Listedeki Kullanıcı Girdi!')
        .setColor('#cc0000')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'Kullanıcı', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
            { name: 'Sebep', value: entry.reason, inline: true },
            { name: 'Kaynak', value: entry.source, inline: true },
            { name: 'Ekleyen', value: entry.added_by === 'SYSTEM' ? '🤖 Otomatik' : `<@${entry.added_by}>`, inline: true },
        )
        .setTimestamp();

    if (config?.log_channel) {
        const ch = member.guild.channels.cache.get(config.log_channel);
        ch?.send({ embeds: [embed] });
    }

    if (AUTO_BAN || config?.auto_ban) {
        await member.ban({ reason: `[Blacklist] ${entry.reason}` }).catch(() => { });
        log.warn(`Auto-banned ${member.user.tag}`);
    }
});

// --- Slash Command Handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guild, member } = interaction;

    if (commandName === 'bl-setup') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const ch = interaction.options.getChannel('kanal');
        const autoban = interaction.options.getBoolean('autoban') ?? false;
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel, auto_ban) VALUES (?, ?, ?)').run(guild.id, ch.id, autoban ? 1 : 0);
        return interaction.reply(`✅ Kara liste ayarlandı.\n- Log: <#${ch.id}>\n- Otomatik Ban: ${autoban ? '🔴 Açık' : '🟢 Kapalı'}`);
    }

    if (commandName === 'bl-add') {
        if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const target = interaction.options.getUser('kullanici');
        const reason = interaction.options.getString('sebep');
        db.prepare('INSERT OR REPLACE INTO blacklist (user_id, username, reason, added_by, guild_id, source) VALUES (?,?,?,?,?,?)')
            .run(target.id, target.tag, reason, member.id, guild.id, 'manual');
        updatePresence();

        eventBus.broadcast('blacklist_add', { userId: target.id, username: target.tag, reason, addedBy: member.user.tag });

        const embed = new EmbedBuilder().setTitle('🚫 Kara Listeye Eklendi').setColor('#cc0000')
            .setDescription(`**${target.tag}** (${target.id})\n**Sebep:** ${reason}`).setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bl-remove') {
        if (!member.permissions.has(PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const target = interaction.options.getUser('kullanici');
        const result = db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(target.id);
        updatePresence();
        if (result.changes === 0) return interaction.reply({ content: `${target.tag} kara listede değil.`, ephemeral: true });
        return interaction.reply(`✅ **${target.tag}** kara listeden kaldırıldı.`);
    }

    if (commandName === 'bl-check') {
        const input = interaction.options.getString('id');
        const userId = input.replace(/[<@!>]/g, '');
        const entry = db.prepare('SELECT * FROM blacklist WHERE user_id = ?').get(userId);
        if (!entry) return interaction.reply({ content: `✅ Bu kullanıcı kara listede değil.`, ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🚫 Kara Liste Kaydı Bulundu')
            .setColor('#ff6600')
            .addFields(
                { name: 'Kullanıcı', value: `${entry.username} (${entry.user_id})`, inline: true },
                { name: 'Sebep', value: entry.reason, inline: true },
                { name: 'Kaynak', value: entry.source, inline: true },
                { name: 'Ekleyen', value: entry.added_by === 'SYSTEM' ? '🤖 Otomatik' : `<@${entry.added_by}>` },
                { name: 'Tarih', value: entry.created_at }
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bl-list') {
        const page = (interaction.options.getInteger('sayfa') || 1) - 1;
        const perPage = 10;
        const total = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
        const entries = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC LIMIT ? OFFSET ?').all(perPage, page * perPage);

        if (entries.length === 0) return interaction.reply({ content: 'Kara liste boş veya bu sayfada kayıt yok.', ephemeral: true });
        const embed = new EmbedBuilder()
            .setTitle(`📋 Kara Liste (Sayfa ${page + 1}/${Math.ceil(total / perPage)})`)
            .setColor('#cc0000')
            .setDescription(entries.map((e, i) => `${page * perPage + i + 1}. **${e.username}** — ${e.reason} [${e.source}]`).join('\n'))
            .setFooter({ text: `Toplam: ${total} kayıt` })
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bl-export') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const entries = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC').all();
        const json = JSON.stringify(entries, null, 2);
        const buffer = Buffer.from(json, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: 'blacklist_export.json' });
        return interaction.reply({ content: `📥 ${entries.length} kayıt dışa aktarıldı.`, files: [attachment] });
    }

    if (commandName === 'bl-stats') {
        const total = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
        const manual = db.prepare("SELECT COUNT(*) as c FROM blacklist WHERE source = 'manual'").get().c;
        const auto = db.prepare("SELECT COUNT(*) as c FROM blacklist WHERE source != 'manual'").get().c;
        const last7d = db.prepare("SELECT COUNT(*) as c FROM blacklist WHERE created_at > datetime('now', '-7 days')").get().c;

        const embed = new EmbedBuilder()
            .setTitle('📊 Kara Liste İstatistikleri')
            .setColor('#cc0000')
            .addFields(
                { name: 'Toplam Kayıt', value: `${total}`, inline: true },
                { name: '✋ Manuel', value: `${manual}`, inline: true },
                { name: '🤖 Otomatik', value: `${auto}`, inline: true },
                { name: '📅 Son 7 Gün', value: `${last7d} yeni ekleme`, inline: true },
                { name: '🔴 Otomatik Ban', value: AUTO_BAN ? 'Açık' : 'Kapalı', inline: true },
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'bl-help') {
        const embed = new EmbedBuilder()
            .setTitle('🚫 Blacklist - Komut Listesi')
            .setColor('#cc0000')
            .setDescription([
                '`/bl-setup` — Log kanalı ve otomatik ban ayarı',
                '`/bl-add` — Kara listeye ekle',
                '`/bl-remove` — Kara listeden çıkar',
                '`/bl-check` — Kullanıcı sorgula',
                '`/bl-list` — Listeyi göster (sayfalı)',
                '`/bl-export` — JSON olarak dışa aktar',
                '`/bl-stats` — İstatistikler',
                '`/bl-help` — Bu menü',
                '',
                '**Otomatik Ekleme:** Guardian nuke tespiti ve Sentiguard 10+ uyarılı kullanıcılar otomatik eklenir.',
            ].join('\n'));
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Keep prefix commands for backward compat
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!bl ')) return;
    return message.reply('💡 Artık slash komutları kullanabilirsiniz: `/bl-add`, `/bl-check`, `/bl-list` vb.');
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
