/**
 * BOT 3: VERIFIER - Gelişmiş Giriş Doğrulama
 * Yeni üyeleri otomatik karantinaya alır.
 * Kullanıcı bir butona basarak doğrulama yapar.
 * Hesap yaşı veya profil resmi olmayan şüpheli hesaplar ek kontrol gerektirir.
 */

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
require('dotenv').config();

const log = createLogger('VERIFIER');
const db = getDatabase('verifier');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const MIN_ACCOUNT_AGE_DAYS = parseInt(process.env.MIN_ACCOUNT_AGE_DAYS) || 7;

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id        TEXT PRIMARY KEY,
        verified_role   TEXT,
        quarantine_role TEXT,
        log_channel     TEXT,
        verify_channel  TEXT
    );
    CREATE TABLE IF NOT EXISTS pending_verifications (
        user_id  TEXT,
        guild_id TEXT,
        PRIMARY KEY (user_id, guild_id)
    );
`);

client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🔐 Giriş Kapısında Nöbet' }] });
});

client.on('guildMemberAdd', async (member) => {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(member.guild.id);
    if (!config) return;

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const isSuspicious = accountAgeDays < MIN_ACCOUNT_AGE_DAYS || !member.user.avatar;

    // Assign quarantine role
    if (config.quarantine_role) {
        await member.roles.add(config.quarantine_role).catch(() => { });
    }

    db.prepare('INSERT OR REPLACE INTO pending_verifications (user_id, guild_id) VALUES (?, ?)').run(member.id, member.guild.id);

    const verifyChannel = member.guild.channels.cache.get(config.verify_channel);
    if (!verifyChannel) return;

    let description = `Merhaba ${member}! Sunucuya erişmek için aşağıdaki butona basarak doğrulama yapmalısın.`;
    let color = '#00bfff';
    let alertText = '';

    if (isSuspicious) {
        color = '#ff9900';
        alertText = `\n\n⚠️ **Şüpheli Hesap Tespiti:**\n- Hesap yaşı: **${Math.floor(accountAgeDays)} gün** (Min: ${MIN_ACCOUNT_AGE_DAYS} gün)\n- Profil resmi: **${member.user.avatar ? 'Var' : 'Yok'}**\n\nBir moderatör manuel olarak onaylaması gerekebilir.`;
        color = '#ff6600';
    }

    const embed = new EmbedBuilder()
        .setTitle('🔐 Kimlik Doğrulama Gerekiyor')
        .setDescription(description + alertText)
        .setColor(color)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: 'Bu mesaj sadece sana görünebilir.' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verify_${member.id}_${member.guild.id}`)
            .setLabel('✅ Doğrulamayı Tamamla')
            .setStyle(ButtonStyle.Success),
        ...(isSuspicious ? [
            new ButtonBuilder()
                .setCustomId(`suspect_alert_${member.id}_${member.guild.id}`)
                .setLabel('🚩 Moderatör Çağır')
                .setStyle(ButtonStyle.Danger)
        ] : [])
    );

    await verifyChannel.send({ embeds: [embed], components: [row] });
    log.info(`Verification request sent to ${member.user.tag} (suspicious: ${isSuspicious})`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('verify_')) {
        const [, userId, guildId] = interaction.customId.split('_');
        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ Bu buton sadece o kullanıcı için.', ephemeral: true });
        }

        const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
        if (!config) return;

        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        if (config.quarantine_role) await member.roles.remove(config.quarantine_role).catch(() => { });
        if (config.verified_role) await member.roles.add(config.verified_role).catch(() => { });
        db.prepare('DELETE FROM pending_verifications WHERE user_id = ? AND guild_id = ?').run(userId, guildId);

        await interaction.reply({ content: '✅ Doğrulama tamamlandı! Sunucuya hoş geldiniz.', ephemeral: true });
        log.info(`${member.user.tag} verified successfully.`);

        if (config.log_channel) {
            const logCh = interaction.guild.channels.cache.get(config.log_channel);
            logCh?.send({ embeds: [new EmbedBuilder().setTitle('✅ Verifier - Doğrulama').setDescription(`${member.user.tag} doğrulamayı tamamladı.`).setColor('#00ff00').setTimestamp()] });
        }
    }

    if (interaction.customId.startsWith('suspect_alert_')) {
        const [, , userId, guildId] = interaction.customId.split('_');
        const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
        if (config?.log_channel) {
            const logCh = interaction.guild.channels.cache.get(config.log_channel);
            logCh?.send(`⚠️ **Moderatör Dikkat!** <@${userId}> şüpheli hesap olarak işaretlendi ve manuel inceleme istedi.`);
        }
        await interaction.reply({ content: '🚩 Moderatörler bilgilendirildi.', ephemeral: true });
    }
});

// Command: !verify setup @verified-role @quarantine-role #log-ch #verify-ch
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!verify setup')) return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const roles = message.mentions.roles;
    const channels = message.mentions.channels;

    if (roles.size < 2 || channels.size < 2) {
        return message.reply('Kullanım: `!verify setup @dogrulanmis-rol @karantina-rol #log-kanalı #doğrulama-kanalı`');
    }

    const rolesArr = [...roles.values()];
    const chArr = [...channels.values()];
    db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, verified_role, quarantine_role, log_channel, verify_channel) VALUES (?,?,?,?,?)')
        .run(message.guild.id, rolesArr[0].id, rolesArr[1].id, chArr[0].id, chArr[1].id);

    message.reply(`✅ Doğrulama sistemi kuruldu!\n- Doğrulanmış: <@&${rolesArr[0].id}>\n- Karantina: <@&${rolesArr[1].id}>\n- Log: <#${chArr[0].id}>\n- Doğrulama Kanalı: <#${chArr[1].id}>`);
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
