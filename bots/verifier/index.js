/**
 * BOT 3: VERIFIER - Gelişmiş Giriş Doğrulama
 * ✅ Slash Commands
 * ✅ Matematik CAPTCHA doğrulama
 * ✅ Şüpheli hesap filtreleme (yaş + avatar)
 * ✅ Event Bus (Guardian raid bildirimlerini dinler)
 */

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
const eventBus = require('../../shared/eventbus');
const { registerCommands } = require('../../shared/commands');
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
        verify_channel  TEXT,
        captcha_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS pending_verifications (
        user_id    TEXT,
        guild_id   TEXT,
        captcha_a  INTEGER,
        captcha_b  INTEGER,
        attempts   INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guild_id)
    );
    CREATE TABLE IF NOT EXISTS verification_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id   TEXT,
        user_id    TEXT,
        username   TEXT,
        status     TEXT,
        detail     TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// --- CAPTCHA Generation ---
function generateCaptcha() {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    return { a, b, answer: a + b };
}

// --- Slash Commands ---
const slashCommands = [
    new SlashCommandBuilder().setName('verify-setup').setDescription('Doğrulama sistemini kur')
        .addRoleOption(o => o.setName('dogrulanmis').setDescription('Doğrulanmış rolü').setRequired(true))
        .addRoleOption(o => o.setName('karantina').setDescription('Karantina rolü').setRequired(true))
        .addChannelOption(o => o.setName('log').setDescription('Log kanalı').setRequired(true))
        .addChannelOption(o => o.setName('dogrulama').setDescription('Doğrulama kanalı').setRequired(true))
        .addBooleanOption(o => o.setName('captcha').setDescription('CAPTCHA aktif mi? (varsayılan: evet)')),
    new SlashCommandBuilder().setName('verify-stats').setDescription('Doğrulama istatistiklerini göster'),
    new SlashCommandBuilder().setName('verify-pending').setDescription('Bekleyen doğrulamaları göster'),
    new SlashCommandBuilder().setName('verify-approve').setDescription('Kullanıcıyı manuel onayla')
        .addUserOption(o => o.setName('kullanici').setDescription('Onaylanacak kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('verify-help').setDescription('Verifier komut listesi'),
];

// --- Event Bus ---
eventBus.init('verifier');

// Raid algılandığında yeni girişleri sıkılaştır
let raidMode = false;
eventBus.on('raid_detected', (data) => {
    log.warn(`[EventBus] Raid detected! Tightening verification.`);
    raidMode = true;
    setTimeout(() => { raidMode = false; log.info('Raid mode deactivated.'); }, 10 * 60 * 1000);
});

// --- Events ---
client.on('ready', async () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🔐 Giriş Kapısında Nöbet' }] });

    if (process.env.CLIENT_ID) {
        await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, slashCommands);
    }
});

// --- New Member Join ---
client.on('guildMemberAdd', async (member) => {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(member.guild.id);
    if (!config) return;

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    const threshold = raidMode ? MIN_ACCOUNT_AGE_DAYS * 3 : MIN_ACCOUNT_AGE_DAYS;
    const isSuspicious = accountAgeDays < threshold || !member.user.avatar;

    // Assign quarantine role
    if (config.quarantine_role) {
        await member.roles.add(config.quarantine_role).catch(() => { });
    }

    // Generate CAPTCHA
    const captcha = generateCaptcha();
    db.prepare('INSERT OR REPLACE INTO pending_verifications (user_id, guild_id, captcha_a, captcha_b, attempts) VALUES (?, ?, ?, ?, 0)').run(member.id, member.guild.id, captcha.a, captcha.b);

    const verifyChannel = member.guild.channels.cache.get(config.verify_channel);
    if (!verifyChannel) return;

    let description = `Merhaba <@${member.id}>! Sunucuya erişim için doğrulama yapmalısın.`;
    let color = '#00bfff';

    if (isSuspicious) {
        color = '#ff6600';
        description += `\n\n⚠️ **Şüpheli Hesap:**\n- Hesap yaşı: **${Math.floor(accountAgeDays)} gün** ${raidMode ? '(Raid modu aktif!)' : ''}\n- Profil resmi: **${member.user.avatar ? 'Var' : 'Yok'}**`;
    }

    if (config.captcha_enabled) {
        description += `\n\n🧮 **CAPTCHA:** Aşağıdaki butona basarak matematik sorusunu cevaplayın.`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🔐 Kimlik Doğrulama')
        .setDescription(description)
        .setColor(color)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: raidMode ? '⚠️ Raid modu aktif — sıkılaştırılmış doğrulama' : 'Doğrulama sistemi' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`captcha_start_${member.id}`)
            .setLabel(config.captcha_enabled ? '🧮 CAPTCHA Çöz' : '✅ Doğrulamayı Tamamla')
            .setStyle(ButtonStyle.Success),
    );

    if (isSuspicious) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`suspect_flag_${member.id}`)
                .setLabel('🚩 Moderatör Çağır')
                .setStyle(ButtonStyle.Danger)
        );
    }

    await verifyChannel.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] });

    db.prepare('INSERT INTO verification_log (guild_id, user_id, username, status, detail) VALUES (?,?,?,?,?)').run(
        member.guild.id, member.id, member.user.tag, 'PENDING', `Suspicious: ${isSuspicious}, RaidMode: ${raidMode}`
    );

    log.info(`Verification request for ${member.user.tag} (suspicious: ${isSuspicious})`);
});

// --- Interaction Handler ---
client.on('interactionCreate', async (interaction) => {
    // --- Button: Start CAPTCHA ---
    if (interaction.isButton() && interaction.customId.startsWith('captcha_start_')) {
        const targetId = interaction.customId.split('_')[2];
        if (interaction.user.id !== targetId) {
            return interaction.reply({ content: '❌ Bu buton sana ait değil.', ephemeral: true });
        }

        const pending = db.prepare('SELECT * FROM pending_verifications WHERE user_id = ? AND guild_id = ?').get(targetId, interaction.guild.id);
        if (!pending) return interaction.reply({ content: '❌ Doğrulama kaydı bulunamadı.', ephemeral: true });

        const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guild.id);

        // If CAPTCHA disabled, directly verify
        if (!config?.captcha_enabled) {
            return await completeVerification(interaction, targetId, interaction.guild);
        }

        // Show CAPTCHA modal
        const modal = new ModalBuilder()
            .setCustomId(`captcha_answer_${targetId}`)
            .setTitle('🧮 CAPTCHA - Matematik Sorusu');

        const input = new TextInputBuilder()
            .setCustomId('answer')
            .setLabel(`${pending.captcha_a} + ${pending.captcha_b} = ?`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Cevabınızı yazın...')
            .setRequired(true)
            .setMaxLength(5);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    // --- Modal: CAPTCHA Answer ---
    if (interaction.isModalSubmit() && interaction.customId.startsWith('captcha_answer_')) {
        const targetId = interaction.customId.split('_')[2];
        if (interaction.user.id !== targetId) return;

        const pending = db.prepare('SELECT * FROM pending_verifications WHERE user_id = ? AND guild_id = ?').get(targetId, interaction.guild.id);
        if (!pending) return interaction.reply({ content: '❌ Doğrulama kaydı bulunamadı.', ephemeral: true });

        const answer = parseInt(interaction.fields.getTextInputValue('answer'));
        const correct = pending.captcha_a + pending.captcha_b;

        if (answer === correct) {
            await completeVerification(interaction, targetId, interaction.guild);
        } else {
            const attempts = pending.attempts + 1;
            db.prepare('UPDATE pending_verifications SET attempts = ? WHERE user_id = ? AND guild_id = ?').run(attempts, targetId, interaction.guild.id);

            if (attempts >= 3) {
                db.prepare('INSERT INTO verification_log (guild_id, user_id, username, status, detail) VALUES (?,?,?,?,?)').run(
                    interaction.guild.id, targetId, interaction.user.tag, 'FAILED', `3 wrong CAPTCHA attempts`
                );
                return interaction.reply({ content: '❌ 3 kez yanlış cevap verdiniz. Bir moderatör sizi onaylamalıdır.', ephemeral: true });
            }

            // Generate new captcha
            const newCaptcha = generateCaptcha();
            db.prepare('UPDATE pending_verifications SET captcha_a = ?, captcha_b = ? WHERE user_id = ? AND guild_id = ?').run(newCaptcha.a, newCaptcha.b, targetId, interaction.guild.id);

            return interaction.reply({ content: `❌ Yanlış cevap! (${attempts}/3 deneme)\nYeni soru: **${newCaptcha.a} + ${newCaptcha.b} = ?**\nTekrar butona basarak deneyin.`, ephemeral: true });
        }
    }

    // --- Button: Suspect Flag ---
    if (interaction.isButton() && interaction.customId.startsWith('suspect_flag_')) {
        const targetId = interaction.customId.split('_')[2];
        const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(interaction.guild.id);
        if (config?.log_channel) {
            const logCh = interaction.guild.channels.cache.get(config.log_channel);
            logCh?.send(`⚠️ **Moderatör Dikkat!** <@${targetId}> şüpheli hesap — manuel onay gerekiyor.`);
        }
        await interaction.reply({ content: '🚩 Moderatörler bilgilendirildi.', ephemeral: true });
    }

    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
        const { commandName, guild, member } = interaction;

        if (commandName === 'verify-setup') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
            const verified = interaction.options.getRole('dogrulanmis');
            const quarantine = interaction.options.getRole('karantina');
            const logCh = interaction.options.getChannel('log');
            const verifyCh = interaction.options.getChannel('dogrulama');
            const captcha = interaction.options.getBoolean('captcha') ?? true;

            db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, verified_role, quarantine_role, log_channel, verify_channel, captcha_enabled) VALUES (?,?,?,?,?,?)')
                .run(guild.id, verified.id, quarantine.id, logCh.id, verifyCh.id, captcha ? 1 : 0);

            return interaction.reply(`✅ Doğrulama sistemi kuruldu!\n- ✅ Rol: <@&${verified.id}>\n- 🔒 Karantina: <@&${quarantine.id}>\n- 📋 Log: <#${logCh.id}>\n- 🔐 Kanal: <#${verifyCh.id}>\n- 🧮 CAPTCHA: ${captcha ? 'Açık' : 'Kapalı'}`);
        }

        if (commandName === 'verify-stats') {
            const total = db.prepare("SELECT COUNT(*) as c FROM verification_log WHERE guild_id = ?").get(guild.id).c;
            const verified = db.prepare("SELECT COUNT(*) as c FROM verification_log WHERE guild_id = ? AND status = 'VERIFIED'").get(guild.id).c;
            const failed = db.prepare("SELECT COUNT(*) as c FROM verification_log WHERE guild_id = ? AND status = 'FAILED'").get(guild.id).c;
            const pending = db.prepare("SELECT COUNT(*) as c FROM pending_verifications WHERE guild_id = ?").get(guild.id).c;

            const embed = new EmbedBuilder()
                .setTitle('📊 Doğrulama İstatistikleri')
                .setColor('#00bfff')
                .addFields(
                    { name: 'Toplam İşlem', value: `${total}`, inline: true },
                    { name: '✅ Doğrulanmış', value: `${verified}`, inline: true },
                    { name: '❌ Başarısız', value: `${failed}`, inline: true },
                    { name: '⏳ Bekleyen', value: `${pending}`, inline: true },
                    { name: '⚠️ Raid Modu', value: raidMode ? '🔴 Aktif' : '🟢 Normal', inline: true }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'verify-pending') {
            const pendings = db.prepare('SELECT * FROM pending_verifications WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10').all(guild.id);
            if (pendings.length === 0) return interaction.reply({ content: 'Bekleyen doğrulama yok.', ephemeral: true });
            const embed = new EmbedBuilder().setTitle('⏳ Bekleyen Doğrulamalar').setColor('#ffaa00')
                .setDescription(pendings.map((p, i) => `${i + 1}. <@${p.user_id}> — ${p.attempts}/3 deneme — *${p.created_at}*`).join('\n'));
            return interaction.reply({ embeds: [embed] });
        }

        if (commandName === 'verify-approve') {
            if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
            const target = interaction.options.getUser('kullanici');
            await completeVerification(interaction, target.id, guild, true);
        }

        if (commandName === 'verify-help') {
            const embed = new EmbedBuilder()
                .setTitle('🔐 Verifier - Komut Listesi')
                .setColor('#00bfff')
                .setDescription([
                    '`/verify-setup` — Doğrulama sistemini kur',
                    '`/verify-stats` — İstatistikler',
                    '`/verify-pending` — Bekleyen doğrulamalar',
                    '`/verify-approve` — Manuel onay',
                    '`/verify-help` — Bu menü',
                ].join('\n'));
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

async function completeVerification(interaction, userId, guild, isManual = false) {
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);
    if (!config) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Kullanıcı bulunamadı.', ephemeral: true });

    if (config.quarantine_role) await member.roles.remove(config.quarantine_role).catch(() => { });
    if (config.verified_role) await member.roles.add(config.verified_role).catch(() => { });
    db.prepare('DELETE FROM pending_verifications WHERE user_id = ? AND guild_id = ?').run(userId, guild.id);

    db.prepare('INSERT INTO verification_log (guild_id, user_id, username, status, detail) VALUES (?,?,?,?,?)').run(
        guild.id, userId, member.user.tag, 'VERIFIED', isManual ? 'Manual approval' : 'CAPTCHA passed'
    );

    await interaction.reply({ content: `✅ ${isManual ? 'Manuel onay tamamlandı' : 'CAPTCHA doğru!'} Hoş geldiniz!`, ephemeral: true });

    if (config.log_channel) {
        const logCh = guild.channels.cache.get(config.log_channel);
        logCh?.send({ embeds: [new EmbedBuilder().setTitle('✅ Doğrulama Tamamlandı').setDescription(`${member.user.tag} ${isManual ? '(Manuel)' : '(CAPTCHA)'}`).setColor('#00ff00').setTimestamp()] });
    }

    log.info(`${member.user.tag} verified (${isManual ? 'manual' : 'captcha'})`);
}

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
