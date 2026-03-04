const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Token and Prefix setup
const TOKEN = process.env.HUB_TOKEN;
const PREFIX = '!hub ';

// Owner ID to secure the Hub bot
const OWNER_ID = process.env.OWNER_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Paths and state
const botsDirectory = path.join(__dirname, '..', 'bots');
const activeBots = new Map(); // Store active child processes

client.on('ready', () => {
    console.log(`[HUB] Manager Bot logged in as ${client.user.tag}`);

    // Ensure bots directory exists
    if (!fs.existsSync(botsDirectory)) {
        fs.mkdirSync(botsDirectory, { recursive: true });
        console.log(`[HUB] Created 'bots' directory at ${botsDirectory}`);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    // Optional: Only allow the owner to run these commands
    if (OWNER_ID && message.author.id !== OWNER_ID) {
        return message.reply("⛔ Bu komutları kullanma yetkiniz yok.");
    }

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // Command: !hub status
    if (command === 'status') {
        const folders = fs.readdirSync(botsDirectory, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (folders.length === 0) {
            return message.reply("📁 Henüz `bots` klasöründe kayıtlı bir bot projesi yok.");
        }

        const embed = new EmbedBuilder()
            .setTitle("🤖 Bot Hub - Mevcut Botların Durumu")
            .setColor("#0099ff")
            .setTimestamp();

        let description = "";
        for (const botName of folders) {
            const isRunning = activeBots.has(botName);
            const statusIcon = isRunning ? '🟢 Çalışıyor' : '🔴 Kapalı';

            let uptimeStr = "";
            if (isRunning) {
                const processInfo = activeBots.get(botName);
                const uptime = Math.floor((Date.now() - processInfo.startTime) / 1000);
                uptimeStr = ` (Uptime: ${uptime}sn)`;
            }

            description += `**${botName}**: ${statusIcon}${uptimeStr}\n`;
        }

        embed.setDescription(description);
        return message.reply({ embeds: [embed] });
    }

    // Command: !hub start <botname>
    if (command === 'start') {
        const botName = args[0];
        if (!botName) return message.reply("Lütfen bir bot adı belirtin. Örn: `!hub start sentiguard`");

        const targetDir = path.join(botsDirectory, botName);
        if (!fs.existsSync(targetDir)) return message.reply(`❌ \`${botName}\` adında bir klasör bulunamadı.`);
        if (activeBots.has(botName)) return message.reply(`⚠️ \`${botName}\` zaten çalışıyor.`);

        // Determine if Node or Python
        const isPython = fs.existsSync(path.join(targetDir, 'main.py'));
        const runCmd = isPython ? 'python' : 'node';
        const runArgs = isPython ? ['main.py'] : ['.']; // Node looks for index.js implicitly

        try {
            const botProcess = spawn(runCmd, runArgs, { cwd: targetDir });

            // Store process
            activeBots.set(botName, {
                process: botProcess,
                startTime: Date.now()
            });

            botProcess.stdout.on('data', (data) => {
                console.log(`[${botName} - LOG] ${data}`);
            });

            botProcess.stderr.on('data', (data) => {
                console.error(`[${botName} - ERR] ${data}`);
            });

            botProcess.on('close', (code) => {
                console.log(`[HUB] Bot ${botName} exited with code ${code}`);
                activeBots.delete(botName);
            });

            return message.reply(`✅ \`${botName}\` başarıyla başlatıldı! (${runCmd})`);
        } catch (error) {
            return message.reply(`❌ Başlatılırken hata oluştu: ${error.message}`);
        }
    }

    // Command: !hub stop <botname>
    if (command === 'stop') {
        const botName = args[0];
        if (!botName) return message.reply("Lütfen bir bot adı belirtin. Örn: `!hub stop sentiguard`");

        if (!activeBots.has(botName)) return message.reply(`⚠️ \`${botName}\` şu anda çalışmıyor.`);

        const processInfo = activeBots.get(botName);
        processInfo.process.kill('SIGINT'); // Graceful shutdown
        activeBots.delete(botName);

        return message.reply(`🛑 \`${botName}\` durduruldu.`);
    }

    // Command: !hub restart <botname>
    if (command === 'restart') {
        const botName = args[0];
        if (!botName) return message.reply("Lütfen bir bot adı belirtin. Örn: `!hub restart sentiguard`");

        const targetDir = path.join(botsDirectory, botName);
        if (!fs.existsSync(targetDir)) return message.reply(`❌ \`${botName}\` adında bir klasör bulunamadı.`);

        // Stop if running
        if (activeBots.has(botName)) {
            const processInfo = activeBots.get(botName);
            processInfo.process.kill('SIGINT');
            activeBots.delete(botName);
        }

        // Wait briefly, then restart
        await new Promise(r => setTimeout(r, 1000));

        const isPython = fs.existsSync(path.join(targetDir, 'main.py'));
        const runCmd = isPython ? 'python' : 'node';
        const runArgs = isPython ? ['main.py'] : ['.'];

        try {
            const botProcess = spawn(runCmd, runArgs, { cwd: targetDir });
            activeBots.set(botName, { process: botProcess, startTime: Date.now() });

            botProcess.stdout.on('data', (data) => console.log(`[${botName} - LOG] ${data}`));
            botProcess.stderr.on('data', (data) => console.error(`[${botName} - ERR] ${data}`));
            botProcess.on('close', (code) => { console.log(`[HUB] Bot ${botName} exited with code ${code}`); activeBots.delete(botName); });

            return message.reply(`🔄 \`${botName}\` yeniden başlatıldı!`);
        } catch (error) {
            return message.reply(`❌ Yeniden başlatılırken hata oluştu: ${error.message}`);
        }
    }

    // Command: !hub startall
    if (command === 'startall') {
        const folders = fs.readdirSync(botsDirectory, { withFileTypes: true })
            .filter(d => d.isDirectory()).map(d => d.name);
        let started = [];
        for (const botName of folders) {
            if (activeBots.has(botName)) continue;
            const targetDir = path.join(botsDirectory, botName);
            const isPython = fs.existsSync(path.join(targetDir, 'main.py'));
            const runCmd = isPython ? 'python' : 'node';
            const runArgs = isPython ? ['main.py'] : ['.'];
            try {
                const botProcess = spawn(runCmd, runArgs, { cwd: targetDir });
                activeBots.set(botName, { process: botProcess, startTime: Date.now() });
                botProcess.stdout.on('data', (data) => console.log(`[${botName} - LOG] ${data}`));
                botProcess.stderr.on('data', (data) => console.error(`[${botName} - ERR] ${data}`));
                botProcess.on('close', (code) => { activeBots.delete(botName); });
                started.push(botName);
            } catch (e) { /* skip */ }
        }
        return message.reply(`🚀 ${started.length} bot başlatıldı: ${started.map(b => `\`${b}\``).join(', ') || 'Hiçbiri'}`);
    }

    // Command: !hub stopall
    if (command === 'stopall') {
        const stopped = [];
        for (const [botName, info] of activeBots) {
            info.process.kill('SIGINT');
            stopped.push(botName);
        }
        activeBots.clear();
        return message.reply(`🛑 ${stopped.length} bot durduruldu: ${stopped.map(b => `\`${b}\``).join(', ') || 'Hiçbiri'}`);
    }

    // Command: !hub help
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ Hub - Komut Listesi')
            .setColor('#0099ff')
            .setDescription([
                '`!hub status` — Tüm botların durumunu gösterir',
                '`!hub start <bot>` — Belirtilen botu başlatır',
                '`!hub stop <bot>` — Belirtilen botu durdurur',
                '`!hub restart <bot>` — Belirtilen botu yeniden başlatır',
                '`!hub startall` — Tüm botları başlatır',
                '`!hub stopall` — Tüm botları durdurur',
                '`!hub help` — Bu menüyü gösterir',
            ].join('\n'));
        return message.reply({ embeds: [embed] });
    }
});

client.login(TOKEN).catch(err => {
    console.error("[HUB ERROR] Geçersiz token veya bağlantı hatası: ", err.message);
});
