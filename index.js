require('dotenv').config();

const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const AUTO_CLEAR_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 Stunden
const HELP_CHANNEL_NAMES = ['help', 'csharp-help', 'python-help'];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let levels = {};
if (fs.existsSync('./levels.json')) {
  try { levels = JSON.parse(fs.readFileSync('./levels.json')); } catch (e) { levels = {}; }
}

function saveLevels() {
  try { fs.writeFileSync('./levels.json', JSON.stringify(levels, null, 2)); } catch (e) { console.error('Fehler beim Speichern:', e); }
}

async function clearChannelMessages(channel, limit = 100) {
  try {
    const fetched = await channel.messages.fetch({ limit });
    const deletable = fetched.filter(m => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
    if (deletable.size === 0) return 0;
    const deleted = await channel.bulkDelete(deletable, true);
    return deleted.size;
  } catch (err) {
    console.error(`Fehler beim Löschen in #${channel.name}:`, err);
    return 0;
  }
}

async function autoClearHelpChannels() {
  for (const guild of client.guilds.cache.values()) {
    for (const name of HELP_CHANNEL_NAMES) {
      const channel = guild.channels.cache.find(c => c.name === name && c.isTextBased());
      if (channel) {
        const deleted = await clearChannelMessages(channel, 100);
        if (deleted > 0) console.log(`AutoClear: ${deleted} Nachrichten in ${guild.name}#${channel.name} gelöscht`);
      }
    }
  }
}

client.once('ready', () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  setTimeout(autoClearHelpChannels, 5000);
  setInterval(autoClearHelpChannels, AUTO_CLEAR_INTERVAL_MS);
});

client.on('guildMemberAdd', member => {
  const channel = member.guild.systemChannel;
  if (channel) channel.send(`👋 Willkommen, ${member}! Schön, dass du da bist.`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const msg = message.content.trim();
  const lmsg = msg.toLowerCase();
  const userId = message.author.id;

  // --- !clear (Admin/ManageMessages) ---
  if (lmsg.startsWith('!clear')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages) &&
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.channel.send('❌ Du hast keine Berechtigung, Nachrichten zu löschen.');
    }
    const parts = msg.split(/\s+/);
    const amount = parseInt(parts[1]) || 10;
    if (isNaN(amount) || amount < 1 || amount > 100) {
      return message.channel.send('⚠️ Bitte gib eine Zahl zwischen 1 und 100 an. Beispiel: `!clear 10`');
    }
    try {
      const deleted = await message.channel.bulkDelete(amount, true);
      const sent = await message.channel.send(`✅ ${deleted.size} Nachrichten gelöscht.`);
      setTimeout(() => sent.delete().catch(() => {}), 3000);
    } catch (err) {
      console.error('bulkDelete Error:', err);
      message.channel.send('❌ Fehler beim Löschen (Eventuell fehlen dem Bot Rechte oder Nachrichten sind älter als 14 Tage).');
    }
    return;
  }

  // --- XP-System ---
  if (!levels[userId]) levels[userId] = { xp: 0, level: 1 };
  levels[userId].xp += Math.floor(Math.random() * 10) + 5;
  const neededXp = levels[userId].level * 100;
  if (levels[userId].xp >= neededXp) {
    levels[userId].level++;
    levels[userId].xp = 0;
    message.channel.send(`🎉 ${message.author} ist jetzt Level ${levels[userId].level}!`);
  }
  saveLevels();

  // Helper: is message in a help channel?
  const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
  const isHelpChannel = HELP_CHANNEL_NAMES.includes(channelName);

  // --- General Commands (anywhere) ---
  if (lmsg === '!hallo') {
    return message.channel.send('👋 Hallo! Ich bin CodeXBot. Gebe `!hilfe` ein für mehr Infos!');
  }

  if (lmsg === '!hilfe') {
    return message.channel.send('🛠 Befehle:\n`!hallo`, `!level`, `!hilfe`, `!portfolio`, `!youtube`, `!serverinfo`, `!idee`, `!idee-hilfe`, `!contact`, `!clear`, `!frage <text>`');
  }

  if (lmsg === '!level') {
    const { level, xp } = levels[userId] || { level: 1, xp: 0 };
    return message.channel.send(`📊 ${message.author}, du bist Level **${level}** mit **${xp} XP**.`);
  }

  if (lmsg === '!portfolio') {
    return message.channel.send('🌐 Mein Portfolio:\nhttps://sedin-mulasalihovic.github.io/portfolio/');
  }

  if (lmsg === '!youtube') {
    return message.channel.send('📺 Mein YouTube Kanal:\nhttps://www.youtube.com/@CodeX-404-yt');
  }

  if (lmsg === '!serverinfo') {
    const { guild } = message;
    return message.channel.send(`📊 **Serverinfo**\n• Name: ${guild.name}\n• Mitglieder: ${guild.memberCount}\n• Erstellt am: ${guild.createdAt.toLocaleDateString()}\n• Besitzer: <@${guild.ownerId}>`);
  }

  if (lmsg === '!idee-hilfe') {
    return message.channel.send('💡 Beispiel: `!idee Deine-Idee-Hier` — wird an den Admin gesendet.');
  }

  if (lmsg.startsWith('!idee ')) {
    const idea = msg.slice(6).trim();
    if (idea.length < 5) return message.channel.send('❗ Bitte gib eine längere Idee ein.');
    fs.appendFileSync('ideen.txt', `${message.author.tag}: ${idea}\n`);
    return message.channel.send('✅ Idee gespeichert!');
  }

  if (lmsg === '!contact') {
    return message.channel.send('📧 Email: sedin.mulasalihovic@gmail.com');
  }

  // --- Channel-restricted help / code snippets / AI mode ---
  if (isHelpChannel) {
    if (lmsg === '!hilfe js' || lmsg === '!hilfe javascript') {
      return message.channel.send({
        content:
`JavaScript - Beispiel: ToDo App (localStorage)
\`\`\`js
// einfache ToDo-Addition
const todos = JSON.parse(localStorage.getItem('todos')||'[]');
function addTodo(t){ todos.push(t); localStorage.setItem('todos', JSON.stringify(todos)); }
\`\`\``
      });
    }

    if (lmsg === '!hilfe python') {
      return message.channel.send({
        content:
`Python - Beispiel: Einfacher Rechner
\`\`\`py
def add(a,b):
    return a+b

if __name__ == "__main__":
    print(add(2,3))
\`\`\``
      });
    }

    if (lmsg === '!hilfe csharp' || lmsg === '!hilfe c#') {
      return message.channel.send({
        content:
`C# - Beispiel: Console Hello World
\`\`\`cs
using System;
class Program {
  static void Main(){
    Console.WriteLine("Hello World");
  }
}
\`\`\``
      });
    }

    // AI mode: !frage <text>
    if (lmsg.startsWith('!frage ')) {
      const question = msg.slice(7).trim();
      if (!question) return message.channel.send('❗ Bitte stelle eine Frage nach `!frage `');
      if (!process.env.OPENAI_API_KEY) {
        return message.channel.send('⚠️ AI-Mode ist nicht aktiviert. Setze OPENAI_API_KEY in deiner .env-Datei.');
      }
      await message.channel.send('🔎 Ich recherchiere... (kann ein paar Sekunden dauern)');
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4', // falls nicht verfügbar, ggf. "gpt-4o" / "gpt-4"
            messages: [
              { role: 'system', content: 'Du bist ein hilfreicher Assistent, der Programmierfragen präzise beantwortet, mit Beispielcode wenn möglich.' },
              { role: 'user', content: question }
            ],
            max_tokens: 800,
            temperature: 0.2
          })
        });
        const data = await resp.json();
        if (!data || !data.choices || !data.choices[0]) {
          return message.channel.send('❌ Keine Antwort erhalten.');
        }
        const answer = data.choices[0].message.content;
        const chunks = answer.match(/[\s\S]{1,1900}/g) || [answer];
        for (const c of chunks) await message.channel.send(c);
      } catch (err) {
        console.error('OpenAI Error:', err);
        message.channel.send('❌ Fehler beim Abrufen der Antwort von der AI.');
      }
      return;
    }
  } // end isHelpChannel
});

client.login(process.env.TOKEN);
