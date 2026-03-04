/**
 * BOT 5: BLACKLIST - Sunucular Arası Kara Liste
 * Birden fazla sunucu tarafından paylaşılan ortak bir kötü kullanıcı veritabanı.
 * Kara listedeki bir kullanıcı sunucuya girdiğinde anında uyarır veya banlar.
 * Komut: !bl add @user <sebep>  |  !bl remove @user  |  !bl check @user
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
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

const AUTO_BAN = process.env.AUTO_BAN === 'true'; // If true, auto-ban blacklisted users on join

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id    TEXT PRIMARY KEY,
        log_channel TEXT
    );
    CREATE TABLE IF NOT EXISTS blacklist (
        user_id    TEXT PRIMARY KEY,
        reason     TEXT,
        added_by   TEXT,
        guild_id   TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}`);
    const count = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
    client.user.setPresence({ activities: [{ name: `🚫 ${count} Kara Liste Kaydı` }] });
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
            { name: 'Ekleyen', value: `<@${entry.added_by}> (${entry.guild_id})`, inline: true },
            { name: 'Kayıt Tarihi', value: entry.created_at }
        )
        .setTimestamp();

    if (config?.log_channel) {
        const ch = member.guild.channels.cache.get(config.log_channel);
        ch?.send({ embeds: [embed] });
    }

    if (AUTO_BAN) {
        await member.ban({ reason: `[AutoBan] Kara liste: ${entry.reason}` }).catch(() => { });
        log.warn(`Auto-banned ${member.user.tag}`);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!bl ')) return;
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply('⛔ Bu komutu kullanmak için `Ban Members` yetkisine ihtiyacınız var.');
    }

    const args = message.content.slice(4).trim().split(/ +/);
    const cmd = args.shift();

    // !bl add @user <reason>
    if (cmd === 'add') {
        const target = message.mentions.users.first();
        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi';
        if (!target) return message.reply('Kullanım: `!bl add @kullanici <sebep>`');

        db.prepare('INSERT OR REPLACE INTO blacklist (user_id, reason, added_by, guild_id) VALUES (?,?,?,?)')
            .run(target.id, reason, message.author.id, message.guild.id);

        const count = db.prepare('SELECT COUNT(*) as c FROM blacklist').get().c;
        client.user.setPresence({ activities: [{ name: `🚫 ${count} Kara Liste Kaydı` }] });

        const embed = new EmbedBuilder()
            .setTitle('🚫 Kara Listeye Eklendi')
            .setColor('#cc0000')
            .setDescription(`**${target.tag}** (${target.id}) kara listeye eklendi.\n**Sebep:** ${reason}`)
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // !bl remove @user
    if (cmd === 'remove') {
        const target = message.mentions.users.first();
        if (!target) return message.reply('Kullanım: `!bl remove @kullanici`');

        const result = db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(target.id);
        if (result.changes === 0) return message.reply(`${target.tag} kara listede değil.`);
        return message.reply(`✅ **${target.tag}** kara listeden kaldırıldı.`);
    }

    // !bl check @user or ID
    if (cmd === 'check') {
        const target = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
        if (!target) return message.reply('Kullanım: `!bl check @kullanici` veya `!bl check <ID>`');

        const entry = db.prepare('SELECT * FROM blacklist WHERE user_id = ?').get(target.id);
        if (!entry) return message.reply(`✅ **${target.tag}** kara listede değil.`);

        const embed = new EmbedBuilder()
            .setTitle('🚫 Kara Liste Kaydı Bulundu')
            .setColor('#ff6600')
            .setThumbnail(target.displayAvatarURL())
            .addFields(
                { name: 'Kullanıcı', value: `${target.tag} (${target.id})`, inline: true },
                { name: 'Sebep', value: entry.reason, inline: true },
                { name: 'Ekleyen', value: `<@${entry.added_by}>`, inline: true },
                { name: 'Eklendiği Sunucu ID', value: entry.guild_id },
                { name: 'Tarih', value: entry.created_at }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // !bl list
    if (cmd === 'list') {
        const entries = db.prepare('SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 10').all();
        if (entries.length === 0) return message.reply('Kara liste boş.');
        const embed = new EmbedBuilder()
            .setTitle('📋 Kara Liste (Son 10)')
            .setColor('#cc0000')
            .setDescription(entries.map((e, i) => `${i + 1}. <@${e.user_id}> — ${e.reason}`).join('\n'))
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // !bl setup #log-channel
    if (cmd === 'setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const ch = message.mentions.channels.first();
        if (!ch) return message.reply('Kullanım: `!bl setup #log-kanalı`');
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel) VALUES (?, ?)').run(message.guild.id, ch.id);
        return message.reply(`✅ Kara liste log kanalı <#${ch.id}> olarak ayarlandı.`);
    }
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
