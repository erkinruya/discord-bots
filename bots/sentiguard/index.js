/**
 * BOT 1: SENTIGUARD - AI Duygu & Toksisite Analizi
 * ✅ Slash Commands
 * ✅ Gemini AI Entegrasyonu (opsiyonel)
 * ✅ Event Bus (Blacklist'e sinyal)
 * ✅ Gerilim çubuğu, istatistikler
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
const eventBus = require('../../shared/eventbus');
const { registerCommands } = require('../../shared/commands');
require('dotenv').config();

const log = createLogger('SENTIGUARD');
const db = getDatabase('sentiguard');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// --- Database Setup ---
db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
        guild_id    TEXT PRIMARY KEY,
        log_channel TEXT,
        threshold   INTEGER DEFAULT 5
    );
    CREATE TABLE IF NOT EXISTS warnings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id    TEXT,
        user_id     TEXT,
        reason      TEXT,
        score       INTEGER DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// --- Gemini AI Integration (Optional) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let geminiAvailable = false;

async function analyzeWithGemini(text) {
    if (!GEMINI_API_KEY) return null;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Analyze the toxicity of this Discord message on a scale of 0-10. Only respond with a JSON object like {"score": 5, "reason": "brief reason in Turkish"}. Message: "${text}"` }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
            })
        });
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
        }
    } catch (err) {
        log.debug(`Gemini API error: ${err.message}`);
    }
    return null;
}

// --- Keyword Toxicity (Fallback) ---
const TOXIC_PATTERNS = [
    { pattern: /\b(aptal|salak|gerizekalı|mal)\b/gi, score: 2 },
    { pattern: /\b(siktir|amk|aq|oç|piç)\b/gi, score: 3 },
    { pattern: /\b(ölüm|öldür|gebertir)\b/gi, score: 5 },
    { pattern: /\b(ırk|nefret|tehdit|linç)\b/gi, score: 3 },
];

function analyzeKeyword(content) {
    const lower = content.toLowerCase();
    let score = 0;
    let reasons = [];

    // All caps detection
    if (content === content.toUpperCase() && content.length > 15) {
        score += 1;
        reasons.push('Tümü büyük harf');
    }

    // Repeated characters (e.g. "AAAAAA")
    if (/(.)\1{5,}/.test(content)) {
        score += 1;
        reasons.push('Karakter tekrarı');
    }

    // Pattern matching
    for (const { pattern, score: s } of TOXIC_PATTERNS) {
        const matches = lower.match(pattern);
        if (matches) {
            score += s * matches.length;
            reasons.push(`Toksik kelime: ${matches.length}x`);
        }
    }

    return { score, reason: reasons.join(', ') || null };
}

// --- Tension Tracking ---
const channelTensionMap = new Map();
function getTensionKey(guildId, channelId) { return `${guildId}-${channelId}`; }

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}s ${m}dk ${s}sn`;
}

// --- Slash Commands ---
const slashCommands = [
    new SlashCommandBuilder().setName('sg-setup').setDescription('Sentiguard log kanalını ayarla')
        .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true))
        .addIntegerOption(o => o.setName('esik').setDescription('Gerilim eşiği (varsayılan: 5)').setMinValue(1).setMaxValue(50)),
    new SlashCommandBuilder().setName('sg-tension').setDescription('Bu kanalın gerilim durumunu göster'),
    new SlashCommandBuilder().setName('sg-stats').setDescription('Sunucu toksisite istatistiklerini göster'),
    new SlashCommandBuilder().setName('sg-warnings').setDescription('Kullanıcının uyarı geçmişini göster')
        .addUserOption(o => o.setName('kullanici').setDescription('Hedef kullanıcı').setRequired(true)),
    new SlashCommandBuilder().setName('sg-help').setDescription('Sentiguard komut listesi'),
];

// --- Event Bus Listener ---
eventBus.init('sentiguard');

// --- Events ---
client.on('ready', async () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🧠 Kanal Gerilimini İzliyor' }] });

    // Test Gemini
    if (GEMINI_API_KEY) {
        const test = await analyzeWithGemini('test');
        geminiAvailable = !!test;
        log.info(`Gemini AI: ${geminiAvailable ? '✅ Aktif' : '❌ Devre dışı'}`);
    }

    // Register slash commands
    if (process.env.CLIENT_ID) {
        await registerCommands(process.env.BOT_TOKEN, process.env.CLIENT_ID, slashCommands);
    }
});

// --- Slash Command Handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild, channel, member } = interaction;

    if (commandName === 'sg-setup') {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: '⛔ Yetkiniz yok.', ephemeral: true });
        const ch = interaction.options.getChannel('kanal');
        const threshold = interaction.options.getInteger('esik') || 5;
        db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel, threshold) VALUES (?, ?, ?)').run(guild.id, ch.id, threshold);
        return interaction.reply(`✅ Log kanalı <#${ch.id}> olarak ayarlandı. Eşik: **${threshold}**`);
    }

    if (commandName === 'sg-tension') {
        const key = getTensionKey(guild.id, channel.id);
        const score = channelTensionMap.get(key) || 0;
        const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guild.id);
        const threshold = config?.threshold || 5;
        const percent = Math.min(100, Math.round((score / threshold) * 100));
        const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));

        const embed = new EmbedBuilder()
            .setTitle('🌡️ Kanal Gerilim Durumu')
            .setColor(percent > 70 ? '#ff0000' : percent > 40 ? '#ffaa00' : '#00cc44')
            .addFields(
                { name: 'Kanal', value: `<#${channel.id}>`, inline: true },
                { name: 'Skor', value: `${score}/${threshold}`, inline: true },
                { name: 'Seviye', value: `[${bar}] %${percent}` },
                { name: 'AI Modu', value: geminiAvailable ? '🤖 Gemini Aktif' : '📋 Kelime Tabanlı', inline: true }
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'sg-stats') {
        const totalWarnings = db.prepare('SELECT COUNT(*) as c FROM warnings WHERE guild_id = ?').get(guild.id).c;
        const last24h = db.prepare("SELECT COUNT(*) as c FROM warnings WHERE guild_id = ? AND created_at > datetime('now', '-1 day')").get(guild.id).c;
        const topOffenders = db.prepare('SELECT user_id, COUNT(*) as c, SUM(score) as total_score FROM warnings WHERE guild_id = ? GROUP BY user_id ORDER BY c DESC LIMIT 5').all(guild.id);

        const embed = new EmbedBuilder()
            .setTitle('📈 Sentiguard - Sunucu İstatistikleri')
            .setColor('#6666ff')
            .addFields(
                { name: '⚠️ Toplam Uyarı', value: `${totalWarnings}`, inline: true },
                { name: '🕐 Son 24 Saat', value: `${last24h} uyarı`, inline: true },
                { name: '🤖 AI Modu', value: geminiAvailable ? 'Gemini Aktif' : 'Kelime Tabanlı', inline: true },
                { name: '🔴 En Çok Uyarı Alanlar', value: topOffenders.length > 0 ? topOffenders.map((u, i) => `${i + 1}. <@${u.user_id}> — ${u.c} uyarı (skor: ${u.total_score})`).join('\n') : 'Kayıt yok' },
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'sg-warnings') {
        const target = interaction.options.getUser('kullanici');
        const warns = db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10').all(guild.id, target.id);
        if (warns.length === 0) return interaction.reply({ content: `${target.username} için uyarı kaydı yok.`, ephemeral: true });
        const embed = new EmbedBuilder().setTitle(`⚠️ ${target.username} - Uyarı Geçmişi`).setColor('#ff9900')
            .setDescription(warns.map((w, i) => `**${i + 1}.** ${w.reason} (skor: ${w.score}) — *${w.created_at}*`).join('\n'));
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'sg-help') {
        const embed = new EmbedBuilder()
            .setTitle('🧠 Sentiguard - Komut Listesi')
            .setColor('#6666ff')
            .setDescription([
                '`/sg-setup` — Log kanalı ve gerilim eşiği ayarla',
                '`/sg-tension` — Bu kanalın gerilim durumu',
                '`/sg-stats` — Sunucu toksisite istatistikleri',
                '`/sg-warnings` — Kullanıcı uyarı geçmişi',
                '`/sg-help` — Bu menü',
                '',
                '**Eski prefix komutları:** `!sg setup`, `!sg tension`, `!sg stats`, `!sg warnings`, `!sg help`',
            ].join('\n'));
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// --- Message Analysis (passive) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Keep prefix commands for backward compatibility
    if (message.content.startsWith('!sg ') && message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const args = message.content.slice(4).trim().split(' ');
        const cmd = args[0];
        if (cmd === 'setup') {
            const channelId = message.mentions.channels.first()?.id;
            const threshold = parseInt(args[2]) || 5;
            if (!channelId) return message.reply('Kullanım: `!sg setup #kanal [eşik]` veya `/sg-setup`');
            db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel, threshold) VALUES (?, ?, ?)').run(message.guild.id, channelId, threshold);
            return message.reply(`✅ Ayarlandı. Artık slash komutları da kullanabilirsin: \`/sg-setup\``);
        }
        return;
    }

    // --- Auto Analysis ---
    let score = 0;
    let reason = '';

    // Try Gemini first
    if (geminiAvailable && message.content.length > 5) {
        const aiResult = await analyzeWithGemini(message.content);
        if (aiResult && aiResult.score >= 2) {
            score = aiResult.score;
            reason = `[AI] ${aiResult.reason}`;
        }
    }

    // Fallback to keyword analysis
    if (score === 0) {
        const keywordResult = analyzeKeyword(message.content);
        score = keywordResult.score;
        reason = keywordResult.reason || '';
    }

    if (score === 0) return;

    // Update tension
    const key = getTensionKey(message.guild.id, message.channel.id);
    const current = (channelTensionMap.get(key) || 0) + score;
    channelTensionMap.set(key, current);

    // Decay after 2 minutes
    setTimeout(() => {
        const val = channelTensionMap.get(key) || 0;
        channelTensionMap.set(key, Math.max(0, val - score));
    }, 2 * 60 * 1000);

    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(message.guild.id);
    if (!config) return;

    // Record warning
    if (score >= 2) {
        db.prepare('INSERT INTO warnings (guild_id, user_id, reason, score) VALUES (?, ?, ?, ?)').run(message.guild.id, message.author.id, reason, score);

        // Broadcast to event bus for other bots
        const userWarnings = db.prepare('SELECT COUNT(*) as c FROM warnings WHERE guild_id = ? AND user_id = ?').get(message.guild.id, message.author.id).c;
        if (userWarnings >= 5) {
            eventBus.broadcast('toxic_user_alert', {
                userId: message.author.id,
                guildId: message.guild.id,
                username: message.author.tag,
                totalWarnings: userWarnings,
                lastScore: score,
                lastReason: reason
            });
            log.info(`Broadcasted toxic_user_alert for ${message.author.tag} (warnings: ${userWarnings})`);
        }
    }

    // Alert if tension threshold exceeded
    if (current >= config.threshold) {
        const logChannel = message.guild.channels.cache.get(config.log_channel);
        if (!logChannel) return;

        channelTensionMap.set(key, 0);

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Sentiguard - Yüksek Gerilim!')
            .setColor('#ff0000')
            .addFields(
                { name: 'Kanal', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Gerilim', value: `${current}/${config.threshold}`, inline: true },
                { name: 'Son Tespitler', value: reason || 'Birikimli gerilim' },
                { name: 'Analiz', value: geminiAvailable ? '🤖 Gemini AI' : '📋 Kelime tabanlı', inline: true }
            )
            .setTimestamp();

        logChannel.send({ embeds: [embed] });

        // Broadcast tension alert
        eventBus.broadcast('high_tension', { channelId: message.channel.id, guildId: message.guild.id, score: current });
        log.warn(`High tension in ${message.channel.name} (score: ${current})`);
    }
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
