/**
 * BOT 1: SENTIGUARD - AI Duygu & Toksisite Analizi
 * Kanalların "tansiyonunu" izler. Gerginlik seviyesi yükseldiğinde
 * moderatörlere erken uyarı verir.
 */

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const createLogger = require('../../shared/logger');
const getDatabase = require('../../shared/db');
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
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// --- Toxicity Detection ---
// Simple keyword-based toxicity scoring (can be replaced with Perspective API or Gemini later)
const TOXIC_WORDS = ['küfür1', 'küfür2', 'nefret', 'tehdit', 'linç']; // Customize for your server
const EXTREME_WORDS = ['ölüm tehdidi', 'dox']; // Instant action triggers

const channelTensionMap = new Map(); // guildId-channelId -> score

function getTensionKey(guildId, channelId) { return `${guildId}-${channelId}`; }

function analyzeToxicity(content) {
    const lower = content.toLowerCase();
    let score = 0;
    if (lower === lower.toUpperCase() && content.length > 10) score += 1; // All caps
    for (const word of TOXIC_WORDS) if (lower.includes(word)) score += 2;
    for (const phrase of EXTREME_WORDS) if (lower.includes(phrase)) score += 10;
    return score;
}

// --- Events ---
client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: '🧠 Kanal Gerilimini İzliyor' }] });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // --- Command Handling ---
    if (message.content.startsWith('!sg ') && message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        const args = message.content.slice(4).trim().split(' ');
        const cmd = args[0];

        if (cmd === 'setup') {
            // !sg setup #log-channel [threshold]
            const channelId = message.mentions.channels.first()?.id;
            const threshold = parseInt(args[2]) || 5;
            if (!channelId) return message.reply('Lütfen bir log kanalı etiketleyin. Örn: `!sg setup #log-channel 5`');

            db.prepare('INSERT OR REPLACE INTO guild_config (guild_id, log_channel, threshold) VALUES (?, ?, ?)').run(message.guild.id, channelId, threshold);
            return message.reply(`✅ Log kanalı <#${channelId}> olarak ayarlandı. Gerilim eşiği: **${threshold}**`);
        }

        if (cmd === 'warnings') {
            const target = message.mentions.users.first();
            if (!target) return message.reply('Kullanıcı etiketleyin. Örn: `!sg warnings @kullanici`');
            const warns = db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 5').all(message.guild.id, target.id);
            if (warns.length === 0) return message.reply(`${target.username} için uyarı kaydı yok.`);
            const embed = new EmbedBuilder().setTitle(`⚠️ ${target.username} - Uyarı Geçmişi`).setColor('#ff9900')
                .setDescription(warns.map((w, i) => `**${i + 1}.** ${w.reason} *(${w.created_at})*`).join('\n'));
            return message.reply({ embeds: [embed] });
        }
        return;
    }

    // --- Tension Analysis ---
    const score = analyzeToxicity(message.content);
    if (score === 0) return;

    const key = getTensionKey(message.guild.id, message.channel.id);
    const current = (channelTensionMap.get(key) || 0) + score;
    channelTensionMap.set(key, current);

    // Decay tension every 2 minutes
    setTimeout(() => {
        const val = channelTensionMap.get(key) || 0;
        channelTensionMap.set(key, Math.max(0, val - score));
    }, 2 * 60 * 1000);

    // Get config
    const config = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(message.guild.id);
    if (!config) return;

    // Log a warning to user
    if (score >= 2) {
        db.prepare('INSERT INTO warnings (guild_id, user_id, reason) VALUES (?, ?, ?)').run(message.guild.id, message.author.id, `Toksik içerik tespit edildi (skor: ${score})`);
    }

    // Alert moderators if tension exceeds threshold
    if (current >= config.threshold) {
        const logChannel = message.guild.channels.cache.get(config.log_channel);
        if (!logChannel) return;

        channelTensionMap.set(key, 0); // Reset after alert

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Sentiguard - Yüksek Gerilim Uyarısı!')
            .setColor('#ff0000')
            .setDescription(`**Kanal:** <#${message.channel.id}>\n**Gerilim Skoru:** ${current}/${config.threshold}\n\nBu kanalda müdahale gerekebilir!`)
            .setTimestamp();

        logChannel.send({ embeds: [embed] });
        log.warn(`High tension detected in ${message.channel.name} (score: ${current})`);
    }
});

client.login(process.env.BOT_TOKEN).catch(err => log.error(`Login failed: ${err.message}`));
