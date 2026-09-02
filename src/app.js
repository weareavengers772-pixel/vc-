import "dotenv/config";
import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    AuditLogEvent
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "-";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const RANK_FILE = path.join(DATA_DIR, "ranks.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const FOREVER_BAN_FILE = path.join(DATA_DIR, "foreverbans.json");

function loadJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            return structuredClone(fallback);
        }
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.error(`[VC+ FILE ERROR] ${file}`, error);
        try { fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); } catch {}
        return structuredClone(fallback);
    }
}

function saveJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (error) { console.error(`[VC+ SAVE ERROR] ${file}`, error); }
}

let ranks = loadJSON(RANK_FILE, {});
let configs = loadJSON(CONFIG_FILE, {});
let foreverBans = loadJSON(FOREVER_BAN_FILE, {});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

const RANKS = {
    founder: 10, god: 9, owner: 8, "co-owner": 7, executive: 6,
    director: 5, admin: 4, moderator: 3, staff: 2, member: 1
};

const RANK_DISPLAY = {
    founder: "Founder", god: "God", owner: "Owner", "co-owner": "Co-Owner",
    executive: "Executive", director: "Director", admin: "Admin",
    moderator: "Moderator", staff: "Staff", member: "Member"
};

function getStoredRank(guildId, userId) { return ranks[guildId]?.[userId] || null; }
function getRankName(member) {
    if (!member) return "member";
    if (member.guild.ownerId === member.id) return "founder";
    return getStoredRank(member.guild.id, member.id) || "member";
}
function getRankLevel(member) { return RANKS[getRankName(member)] || 0; }
function isFounder(member) { return getRankLevel(member) >= RANKS.founder; }
function isGod(member) { return getRankLevel(member) >= RANKS.god; }
function isGodmode(member) { return !!configs[member?.guild?.id]?.godmode?.includes(member.id); }
function hasGodAccess(member) { return member?.guild?.ownerId === member?.id || isFounder(member) || isGod(member) || isGodmode(member); }
function canManageServer(member) {
    return member?.guild?.ownerId === member?.id || getRankLevel(member) >= RANKS.owner || member.permissions.has(PermissionsBitField.Flags.Administrator);
}
function canModerate(member) {
    return member?.guild?.ownerId === member?.id || getRankLevel(member) >= RANKS.moderator || member.permissions.has(PermissionsBitField.Flags.BanMembers) || member.permissions.has(PermissionsBitField.Flags.KickMembers);
}
function canManageVouches(member) { return member?.guild?.ownerId === member?.id || isFounder(member); }

function getGuildConfig(guildId) {
    if (!configs[guildId]) configs[guildId] = {};
    const c = configs[guildId];
    c.joinToCreate ??= null;
    c.interfaceChannel ??= null;
    c.interfaceMessage ??= null;
    c.vouchRole ??= null;
    c.vouches ??= {};
    c.godmode ??= [];
    c.filter ??= [];
    c.voice ??= {};
    c.voice.owners ??= {};
    c.voice.banned ??= {};
    c.voice.permitted ??= {};
    c.voice.locked ??= {};
    c.voice.limits ??= {};
    c.temporaryChannels ??= [];
    return c;
}

async function reply(message, content) {
    try { return await message.reply(content); } catch (e) { console.error("[VC+ REPLY]", e); return null; }
}
function panel(title, description) {
    return { embeds: [new EmbedBuilder().setTitle(`VC+ | ${title}`).setDescription(description).setFooter({ text: "VC+" })] };
}
function deny(message) { return reply(message, "```VC+\nYou do not have permission to use this command.\n```"); }
function usage(message, text) { return reply(message, `\`\`\`VC+\nUsage: ${text}\n\`\`\``); }

const HELP_PAGES = [
    { name: "General", description: `-help\nOpen the VC+ help menu.\n\n-ping\nCheck bot latency.` },
    { name: "Moderation", description: `-ban @user [reason]\nBan a member.\n\n-unban USER_ID\nUnban a user.\n\n-unbanall\nUnban all users.\n\n-kick @user [reason]\nKick a member.\n\n-timeout @user 10m [reason]\nTimeout a member.\n\n-untimeout @user\nRemove a timeout.\n\n-foreverban @user [reason]\nForever ban a member through VC+.\n\n-unforeverban USER_ID\nRemove a VC+ forever ban.\n\n-purge 1-100\nDelete messages.\n\n-clear 1-100\nAlias for purge.` },
    { name: "Ranks", description: `-rank @user <rank>\nSet a VC+ rank.\n\n-rank @user\nView a user's rank.\n\n-ranklist\nView rank hierarchy.\n\n-removerank @user\nServer owner only. Remove a user's VC+ rank and return them to Member.` },
    { name: "Godmode", description: `-godmode @user\nGive internal Godmode.\n\n-godmode remove @user\nRemove internal Godmode.` },
    { name: "Vouches", description: `-vouch set role @Role\nSet the vouch role.\n\n-vouch role\nView the vouch role.\n\n-vouch give @user reason\nGive a vouch and assign the role.\n\n-vouch clear @user\nClear a user's vouches and remove the role.\n\n-vouch clear everyone\nClear everyone's vouches and remove the role from everyone.\n\n-vouch list\nView vouches.\n\n-vouches @user\nView a user's vouches.` },
    { name: "Filter", description: `-filter add word\nAdd a filtered word.\n\n-filter remove word\nRemove a filtered word.` },
    { name: "Voice", description: `-vc setup\nCreate Join-to-Create.\n\n-vc kick @user\nDisconnect a user.\n\n-vc disconnect @user\nDisconnect a user.\n\n-vc ban @user\nBan a user from the VC.\n\n-vc reject @user\nReject a user.\n\n-vc permit @user\nPermit a user.\n\n-vc lock\nLock the VC.\n\n-vc unlock\nUnlock the VC.\n\n-vc limit number\nSet the user limit.\n\n-vc rename name\nRename the VC.\n\n-vc transfer @user\nTransfer ownership.\n\n-vc claim\nClaim an abandoned VC.\n\n-vc forceclaim\nForce claim a VC.\n\n-vc stfu @user\nServer mute a user.\n\n-vc unstfu @user\nRemove server mute.` },
    { name: "Server Setup", description: `-vc setup\nCreate the Join-to-Create system.\n\n-interface\nCreate the VC+ server interface.\n\n-vouch set role @Role\nConfigure the vouch role.` }
];

function helpPayload(page) {
    const p = HELP_PAGES[page];
    return {
        embeds: [new EmbedBuilder().setTitle(`VC+ | ${p.name}`).setDescription(`\`\`\`\n${p.description}\n\`\`\``).setFooter({ text: `Page ${page + 1}/${HELP_PAGES.length}` })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("help_prev").setLabel("<").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`help_page_${page}`).setLabel(`${page + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId("help_next").setLabel(">").setStyle(ButtonStyle.Secondary)
        )]
    };
}

async function handleHelp(message, args) {
    if (args[0]) {
        const i = HELP_PAGES.findIndex(p => p.name.toLowerCase() === args[0].toLowerCase());
        if (i < 0) return reply(message, "```VC+\nUnknown help category.\n``` ");
        return reply(message, helpPayload(i));
    }
    return reply(message, helpPayload(0));
}

async function handleRemoveRank(message) {
    if (message.guild.ownerId !== message.author.id) return deny(message);
    const target = message.mentions.members.first();
    if (!target) return usage(message, "-removerank @user");
    if (target.id === message.guild.ownerId) return reply(message, panel("Remove Rank", "The server owner is always Founder."));
    ranks[message.guild.id] ??= {};
    const oldRank = ranks[message.guild.id][target.id] || "member";
    delete ranks[message.guild.id][target.id];
    saveJSON(RANK_FILE, ranks);
    return reply(message, panel("Remove Rank", `${target} was removed from **${RANK_DISPLAY[oldRank] || "Member"}** and returned to **Member**.`));
}

async function handleRank(message, args) {
    const target = message.mentions.members.first();
    if (!target) return usage(message, "-rank @user [rank]");
    if (!args[1]) return reply(message, panel("Rank", `User: ${target.user.tag}\nRank: **${RANK_DISPLAY[getRankName(target)] || "Member"}**`));
    if (!canManageServer(message.member)) return deny(message);
    const requested = args[1].toLowerCase();
    if (!RANKS[requested]) return reply(message, "```VC+\nInvalid rank.\n``` ");
    if (message.guild.ownerId !== message.author.id && RANKS[requested] >= getRankLevel(message.member)) return reply(message, "```VC+\nYou cannot assign a rank equal to or higher than your own.\n``` ");
    if (message.guild.ownerId !== message.author.id && getRankLevel(target) >= getRankLevel(message.member)) return reply(message, "```VC+\nYou cannot change someone at or above your rank.\n``` ");
    ranks[message.guild.id] ??= {};
    ranks[message.guild.id][target.id] = requested;
    saveJSON(RANK_FILE, ranks);
    return reply(message, panel("Rank", `${target.user.tag} is now **${RANK_DISPLAY[requested]}**.`));
}

async function handleVouch(message, args) {
    const c = getGuildConfig(message.guild.id);
    const sub = args[0]?.toLowerCase();
    if (sub === "set" && args[1]?.toLowerCase() === "role" || sub === "role" && args[1]?.toLowerCase() === "set") {
        if (!canManageVouches(message.member)) return deny(message);
        const role = message.mentions.roles.first();
        if (!role) return usage(message, "-vouch set role @Role");
        const bot = message.guild.members.me;
        if (!bot || role.position >= bot.roles.highest.position) return reply(message, "```VC+\nThat role must be below my highest role.\n``` ");
        c.vouchRole = role.id;
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch Role", `Vouch role set to **${role.name}**.`));
    }
    if (sub === "role") {
        if (!canManageVouches(message.member)) return deny(message);
        const role = c.vouchRole ? message.guild.roles.cache.get(c.vouchRole) : null;
        return reply(message, panel("Vouch Role", role ? role.toString() : "Not configured."));
    }
    if (sub === "give") {
        if (!canManageVouches(message.member)) return deny(message);
        const target = message.mentions.members.first();
        if (!target) return usage(message, "-vouch give @user reason");
        const reason = args.slice(2).join(" ") || "No reason provided";
        c.vouches[target.id] ??= [];
        c.vouches[target.id].push({ by: message.author.id, reason, timestamp: Date.now() });
        let roleStatus = "No vouch role configured.";
        if (c.vouchRole) {
            const role = message.guild.roles.cache.get(c.vouchRole);
            const bot = message.guild.members.me;
            if (!role) { c.vouchRole = null; roleStatus = "Configured vouch role no longer exists."; }
            else if (!bot || role.position >= bot.roles.highest.position) roleStatus = "Vouch saved, but the role is above my highest role.";
            else if (!target.roles.cache.has(role.id)) {
                try { await target.roles.add(role, "VC+ vouch"); roleStatus = `Role assigned: ${role.name}`; }
                catch (e) { console.error("[VC+ VOUCH ROLE]", e); roleStatus = "Vouch saved, but I could not assign the role."; }
            } else roleStatus = `Role already assigned: ${role.name}`;
        }
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch", `Vouch added to ${target}.\nReason: ${reason}\n${roleStatus}`));
    }
    if (sub === "clear") {
        if (!canManageVouches(message.member)) return deny(message);
        const role = c.vouchRole ? message.guild.roles.cache.get(c.vouchRole) : null;
        if (args[1]?.toLowerCase() === "everyone") {
            const ids = Object.keys(c.vouches);
            c.vouches = {};
            let removed = 0;
            if (role) {
                try {
                    const members = await message.guild.members.fetch();
                    for (const member of members.values()) {
                        if (member.roles.cache.has(role.id)) {
                            try { await member.roles.remove(role, "VC+ vouches cleared for everyone"); removed++; } catch (e) { console.error("[VC+ VOUCH CLEAR]", e); }
                        }
                    }
                } catch (e) { console.error("[VC+ MEMBER FETCH]", e); }
            }
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Vouch Clear", `Cleared **${ids.length}** vouch entries.\nRemoved the configured vouch role from **${removed}** member(s).`));
        }
        const target = message.mentions.members.first();
        if (!target) return usage(message, "-vouch clear @user\n-vouch clear everyone");
        delete c.vouches[target.id];
        let removed = false;
        if (role && target.roles.cache.has(role.id)) {
            try { await target.roles.remove(role, "VC+ vouches cleared"); removed = true; } catch (e) { console.error("[VC+ VOUCH CLEAR]", e); }
        }
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch Clear", `Cleared vouches for ${target}.\nVouch role removed: **${removed ? "Yes" : "No"}**.`));
    }
    if (sub === "list") {
        const entries = Object.entries(c.vouches);
        if (!entries.length) return reply(message, "```VC+\nNo vouches have been recorded.\n``` ");
        return reply(message, panel("Vouches", entries.slice(0, 20).map(([id, list]) => `${id}: ${list.length} vouch(es)`).join("\n")));
    }
    return usage(message, "-vouch set role @Role\n-vouch give @user reason\n-vouch clear @user\n-vouch clear everyone\n-vouch list");
}

async function handleVouches(message) {
    const target = message.mentions.members.first();
    if (!target) return usage(message, "-vouches @user");
    const list = getGuildConfig(message.guild.id).vouches[target.id] || [];
    if (!list.length) return reply(message, panel("Vouches", `${target.user.tag} has **0** vouches.`));
    return reply(message, panel("Vouches", `${target.user.tag} has **${list.length}** vouch(es).\n\n${list.slice(-10).map((v, i) => `${i + 1}. ${v.reason}`).join("\n")}`));
}

function parseDuration(input) {
    const m = /^(\d+)(s|m|h|d)$/i.exec(input || "");
    if (!m) return null;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return Number(m[1]) * mult[m[2].toLowerCase()];
}

async function handleModeration(message, command, args) {
    if (!canModerate(message.member)) return deny(message);
    const target = message.mentions.members.first();
    if (["ban", "kick", "timeout", "untimeout", "foreverban"].includes(command) && !target) return usage(message, `-${command} @user`);
    try {
        if (command === "ban") { if (!target.bannable) return reply(message, "```VC+\nI cannot ban that member.\n``` "); await target.ban({ reason: args.slice(1).join(" ") || "VC+ moderation" }); return reply(message, panel("Ban", `${target.user.tag} was banned.`)); }
        if (command === "kick") { if (!target.kickable) return reply(message, "```VC+\nI cannot kick that member.\n``` "); await target.kick(args.slice(1).join(" ") || "VC+ moderation"); return reply(message, panel("Kick", `${target.user.tag} was kicked.`)); }
        if (command === "timeout") { const d = parseDuration(args[1]); if (!d) return usage(message, "-timeout @user 10m [reason]"); await target.timeout(d, args.slice(2).join(" ") || "VC+ moderation"); return reply(message, panel("Timeout", `${target.user.tag} was timed out for ${args[1]}.`)); }
        if (command === "untimeout") { await target.timeout(null, "VC+ untimeout"); return reply(message, panel("Timeout", `${target.user.tag} is no longer timed out.`)); }
        if (command === "unban") { if (!args[0]) return usage(message, "-unban USER_ID"); await message.guild.members.unban(args[0], "VC+ unban"); return reply(message, panel("Unban", `${args[0]} was unbanned.`)); }
        if (command === "unbanall") { if (!isFounder(message.member)) return deny(message); const bans = await message.guild.bans.fetch(); let count = 0; for (const [id] of bans) { try { await message.guild.members.unban(id, "VC+ unbanall"); count++; } catch {} } return reply(message, panel("Unban All", `Unbanned **${count}** user(s).`)); }
        if (command === "foreverban") { if (!isFounder(message.member)) return deny(message); foreverBans[message.guild.id] ??= {}; foreverBans[message.guild.id][target.id] = { reason: args.slice(1).join(" ") || "No reason provided", addedBy: message.author.id, timestamp: Date.now() }; saveJSON(FOREVER_BAN_FILE, foreverBans); if (target.bannable) await target.ban({ reason: "VC+ Forever Ban" }).catch(() => {}); return reply(message, panel("Forever Ban", `${target.user.tag} is forever banned.`)); }
        if (command === "unforeverban") { if (!isFounder(message.member)) return deny(message); if (!args[0]) return usage(message, "-unforeverban USER_ID"); delete foreverBans[message.guild.id]?.[args[0]]; saveJSON(FOREVER_BAN_FILE, foreverBans); return reply(message, panel("Forever Ban", `${args[0]} was removed from the forever-ban list.`)); }
        if (command === "purge" || command === "clear") { if (!canManageServer(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return deny(message); const n = Number(args[0]); if (!Number.isInteger(n) || n < 1 || n > 100) return usage(message, `-${command} 1-100`); const deleted = await message.channel.bulkDelete(n, true); return reply(message, panel("Purge", `Deleted **${deleted.size}** message(s).`)); }
    } catch (e) { console.error(`[VC+ ${command}]`, e); return reply(message, "```VC+\nThe command could not be completed. Check my Discord permissions.\n``` "); }
}

function currentVC(member) { return member?.voice?.channel || null; }
function tempVC(c, id) { return c.temporaryChannels.includes(id); }
function controls(member, channel) { const c = getGuildConfig(member.guild.id); return hasGodAccess(member) || c.voice.owners[channel.id] === member.id; }

async function sendVCPanel(channel, owner) {
    try {
        await channel.send({ embeds: [new EmbedBuilder().setTitle("VC+ | VOICE CONTROL").setDescription(`Owner: ${owner}\n\nUse the buttons below or the -vc commands.`).setFooter({ text: "VC+ Voice Control" })], components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("vc_lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("vc_unlock").setLabel("Unlock").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("vc_claim").setLabel("Claim").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("vc_refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
        )] });
    } catch (e) { console.error("[VC+ PANEL]", e); }
}

async function handleVC(message, args) {
    const sub = args[0]?.toLowerCase();
    if (sub === "setup") {
        if (!canManageServer(message.member)) return deny(message);
        const c = getGuildConfig(message.guild.id);
        if (c.joinToCreate && message.guild.channels.cache.get(c.joinToCreate)) return reply(message, panel("VC Setup", "Join-to-Create is already configured."));
        try {
            const category = await message.guild.channels.create({ name: "VC+", type: ChannelType.GuildCategory });
            const create = await message.guild.channels.create({ name: "Join To Create", type: ChannelType.GuildVoice, parent: category.id });
            c.joinToCreate = create.id; saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("VC Setup", `Join-to-Create created in **${category.name}**.`));
        } catch (e) { console.error("[VC+ SETUP]", e); return reply(message, "```VC+\nFailed to set up Join-to-Create. Make sure I have Manage Channels.\n``` "); }
    }
    const channel = currentVC(message.member);
    if (!channel) return reply(message, "```VC+\nYou must be in a voice channel.\n``` ");
    const c = getGuildConfig(message.guild.id);
    if (!tempVC(c, channel.id)) return reply(message, "```VC+\nYou must be in a VC+ temporary voice channel.\n``` ");
    if (!controls(message.member, channel)) return deny(message);
    try {
        if (sub === "kick" || sub === "disconnect") { const t = message.mentions.members.first(); if (!t) return usage(message, `-vc ${sub} @user`); if (t.voice.channelId === channel.id) await t.voice.disconnect("VC+ voice control"); return reply(message, panel("Voice", `${t.user.tag} was disconnected.`)); }
        if (sub === "ban" || sub === "reject") { const t = message.mentions.members.first(); if (!t) return usage(message, `-vc ${sub} @user`); c.voice.banned[channel.id] ??= []; if (!c.voice.banned[channel.id].includes(t.id)) c.voice.banned[channel.id].push(t.id); if (t.voice.channelId === channel.id) await t.voice.disconnect("VC+ VC ban").catch(() => {}); saveJSON(CONFIG_FILE, configs); return reply(message, panel("Voice", `${t.user.tag} was ${sub === "ban" ? "banned" : "rejected"}.`)); }
        if (sub === "permit") { const t = message.mentions.members.first(); if (!t) return usage(message, "-vc permit @user"); c.voice.permitted[channel.id] ??= []; if (!c.voice.permitted[channel.id].includes(t.id)) c.voice.permitted[channel.id].push(t.id); c.voice.banned[channel.id] = (c.voice.banned[channel.id] || []).filter(id => id !== t.id); saveJSON(CONFIG_FILE, configs); return reply(message, panel("Voice", `${t.user.tag} was permitted.`)); }
        if (sub === "lock" || sub === "unlock") { await channel.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: sub === "lock" ? false : null }); c.voice.locked[channel.id] = sub === "lock"; saveJSON(CONFIG_FILE, configs); return reply(message, panel("Voice", `VC ${sub}ed.`)); }
        if (sub === "limit") { const n = Number(args[1]); if (!Number.isInteger(n) || n < 0 || n > 99) return usage(message, "-vc limit 0-99"); await channel.setUserLimit(n); c.voice.limits[channel.id] = n; saveJSON(CONFIG_FILE, configs); return reply(message, panel("Voice", `User limit set to **${n}**.`)); }
        if (sub === "rename") { const name = args.slice(1).join(" ").slice(0, 100); if (!name) return usage(message, "-vc rename name"); await channel.setName(name); return reply(message, panel("Voice", `VC renamed to **${name}**.`)); }
        if (sub === "transfer") { const t = message.mentions.members.first(); if (!t) return usage(message, "-vc transfer @user"); c.voice.owners[channel.id] = t.id; saveJSON(CONFIG_FILE, configs); return reply(message, panel("Voice", `Ownership transferred to ${t}.`)); }
        if (sub === "claim") { const owner = c.voice.owners[channel.id]; const m = owner ? message.guild.members.cache.get(owner) : null; if (m?.voice.channelId === channel.id) return reply(message, "```VC+\nThis VC already has an active owner.\n``` "); c.voice.owners[channel.id] = message.author.id; saveJSON(CONFIG_FILE, configs); return reply(message, "```VC+\nYou claimed this VC.\n``` "); }
        if (sub === "forceclaim") { if (!hasGodAccess(message.member)) return deny(message); c.voice.owners[channel.id] = message.author.id; saveJSON(CONFIG_FILE, configs); return reply(message, "```VC+\nYou force claimed this VC.\n``` "); }
        if (sub === "stfu" || sub === "unstfu") { if (!hasGodAccess(message.member)) return deny(message); const t = message.mentions.members.first(); if (!t) return usage(message, `-vc ${sub} @user`); await t.voice.setMute(sub === "stfu", `VC+ ${sub}`); return reply(message, panel("Voice", `${t.user.tag} ${sub === "stfu" ? "was server muted" : "is no longer server muted"}.`)); }
        return usage(message, "-vc setup | kick | disconnect | ban | reject | permit | lock | unlock | limit | rename | transfer | claim | forceclaim | stfu | unstfu");
    } catch (e) { console.error("[VC+ VC COMMAND]", e); return reply(message, "```VC+\nThe VC command could not be completed.\n``` "); }
}

async function handleInterface(message) {
    if (!canManageServer(message.member)) return deny(message);
    const c = getGuildConfig(message.guild.id);
    try {
        if (c.interfaceChannel) await message.guild.channels.cache.get(c.interfaceChannel)?.delete().catch(() => {});
        const ch = await message.guild.channels.create({ name: "VC+ Interface", type: ChannelType.GuildText });
        const sent = await ch.send({ embeds: [new EmbedBuilder().setTitle("VC+ | Voice Interface").setDescription("Use the controls below to manage your current temporary VC.\n\nAdvanced controls use the -vc commands.").setFooter({ text: "VC+ Voice Interface" })], components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("vc_lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("vc_unlock").setLabel("Unlock").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("vc_claim").setLabel("Claim").setStyle(ButtonStyle.Secondary)
        )] });
        c.interfaceChannel = ch.id; c.interfaceMessage = sent.id; saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Interface", `VC+ interface created in ${ch}.`));
    } catch (e) { console.error("[VC+ INTERFACE]", e); return reply(message, "```VC+\nFailed to create the interface.\n``` "); }
}

async function handleFilter(message, args) {
    if (!canManageServer(message.member)) return deny(message);
    const c = getGuildConfig(message.guild.id), sub = args[0]?.toLowerCase(), word = args.slice(1).join(" ").toLowerCase();
    if (!word || !["add", "remove"].includes(sub)) return usage(message, "-filter add word\n-filter remove word");
    if (sub === "add" && !c.filter.includes(word)) c.filter.push(word);
    if (sub === "remove") c.filter = c.filter.filter(x => x !== word);
    saveJSON(CONFIG_FILE, configs); return reply(message, panel("Filter", `${sub === "add" ? "Added" : "Removed"} **${word}**.`));
}

async function checkFilter(message) {
    if (!message.guild || message.author.bot || message.content.startsWith(PREFIX)) return false;
    const c = getGuildConfig(message.guild.id);
    if (getRankLevel(message.member) >= RANKS.staff) return false;
    const hit = c.filter.find(w => message.content.toLowerCase().includes(w));
    if (!hit) return false;
    try { await message.delete(); } catch {}
    return true;
}

client.on("messageCreate", async message => {
    try {
        if (await checkFilter(message)) return;
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;
        const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const command = parts.shift()?.toLowerCase();
        const args = parts;
        if (!command) return;
        switch (command) {
            case "help": return handleHelp(message, args);
            case "ping": return reply(message, panel("Ping", `API latency: **${Math.round(client.ws.ping)}ms**.`));
            case "removerank": return handleRemoveRank(message);
            case "rank": return handleRank(message, args);
            case "ranklist": return reply(message, "```VC+ | RANK HIERARCHY\n10 Founder\n9 God\n8 Owner\n7 Co-Owner\n6 Executive\n5 Director\n4 Admin\n3 Moderator\n2 Staff\n1 Member\n```");
            case "godmode": {
                if (!isFounder(message.member)) return deny(message);
                const c = getGuildConfig(message.guild.id), t = message.mentions.members.first();
                if (!t) return usage(message, "-godmode @user\n-godmode remove @user");
                if (args[0]?.toLowerCase() === "remove") c.godmode = c.godmode.filter(id => id !== t.id);
                else if (!c.godmode.includes(t.id)) c.godmode.push(t.id);
                saveJSON(CONFIG_FILE, configs); return reply(message, panel("Godmode", `${t.user.tag}: **${args[0]?.toLowerCase() === "remove" ? "removed" : "granted"}**.`));
            }
            case "vouch": return handleVouch(message, args);
            case "vouches": return handleVouches(message);
            case "filter": return handleFilter(message, args);
            case "vc": return handleVC(message, args);
            case "interface": return handleInterface(message);
            case "ban": case "kick": case "timeout": case "untimeout": case "unban": case "unbanall": case "foreverban": case "unforeverban": case "purge": case "clear": return handleModeration(message, command, args);
            default: return reply(message, `\`\`\`VC+\nUnknown command: -${command}\nUse -help to view commands.\n\`\`\``);
        }
    } catch (e) { console.error("[VC+ COMMAND ERROR]", e); await reply(message, "```VC+\nAn error occurred while executing that command.\n``` "); }
});

client.on("interactionCreate", async interaction => {
    try {
        if (!interaction.isButton()) return;
        if (interaction.customId.startsWith("help_")) {
            const match = interaction.message.components?.[0]?.components?.[1]?.customId?.match(/help_page_(\d+)/);
            let page = match ? Number(match[1]) : 0;
            if (interaction.customId === "help_prev") page = (page - 1 + HELP_PAGES.length) % HELP_PAGES.length;
            if (interaction.customId === "help_next") page = (page + 1) % HELP_PAGES.length;
            return interaction.update(helpPayload(page));
        }
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const channel = member.voice.channel;
        if (!channel || !tempVC(getGuildConfig(interaction.guild.id), channel.id)) return interaction.reply({ content: "You must be in a VC+ temporary voice channel.", ephemeral: true });
        const c = getGuildConfig(interaction.guild.id);
        if (!controls(member, channel)) return interaction.reply({ content: "You do not control this VC.", ephemeral: true });
        if (interaction.customId === "vc_lock") { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false }); c.voice.locked[channel.id] = true; }
        else if (interaction.customId === "vc_unlock") { await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: null }); c.voice.locked[channel.id] = false; }
        else if (interaction.customId === "vc_claim") { c.voice.owners[channel.id] = interaction.user.id; }
        else if (interaction.customId === "vc_refresh") return interaction.reply({ content: "VC+ panel refreshed.", ephemeral: true });
        else return;
        saveJSON(CONFIG_FILE, configs);
        return interaction.reply({ content: `VC ${interaction.customId === "vc_lock" ? "locked" : interaction.customId === "vc_unlock" ? "unlocked" : "claimed"}.`, ephemeral: true });
    } catch (e) {
        console.error("[VC+ INTERACTION ERROR]", e);
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "VC+ could not complete that action.", ephemeral: true }); } catch {}
    }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        const c = getGuildConfig(newState.guild.id);
        if (c.joinToCreate && newState.channelId === c.joinToCreate && newState.member) {
            const parent = newState.channel?.parent;
            const ch = await newState.guild.channels.create({ name: `${newState.member.user.username}'s VC`, type: ChannelType.GuildVoice, parent: parent?.id || null });
            c.temporaryChannels.push(ch.id); c.voice.owners[ch.id] = newState.member.id; saveJSON(CONFIG_FILE, configs);
            await newState.member.voice.setChannel(ch);
            await sendVCPanel(ch, newState.member);
        }
        if (oldState.channel && oldState.channelId !== newState.channelId && c.temporaryChannels.includes(oldState.channelId) && oldState.channel.members.size === 0) {
            await oldState.channel.delete("VC+ empty temporary VC").catch(() => {});
            c.temporaryChannels = c.temporaryChannels.filter(id => id !== oldState.channelId);
            delete c.voice.owners[oldState.channelId]; delete c.voice.banned[oldState.channelId]; delete c.voice.permitted[oldState.channelId]; delete c.voice.locked[oldState.channelId]; delete c.voice.limits[oldState.channelId]; saveJSON(CONFIG_FILE, configs);
        }
        if (newState.channel && c.voice.banned[newState.channel.id]?.includes(newState.member.id)) await newState.member.voice.disconnect("VC+ VC ban enforcement").catch(() => {});
    } catch (e) { console.error("[VC+ VOICE ERROR]", e); }
});

client.on("guildMemberAdd", async member => {
    try {
        const ban = foreverBans[member.guild.id]?.[member.id];
        if (ban) await member.ban({ reason: "VC+ forever-ban enforcement" }).catch(() => {});
    } catch (e) { console.error("[VC+ FOREVER BAN]", e); }
});

client.on("roleCreate", async role => {
    try {
        const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 });
        const executor = logs.entries.first()?.executor;
        if (!executor || executor.id === role.guild.ownerId) return;
        const member = role.guild.members.cache.get(executor.id);
        if (!member || hasGodAccess(member)) return;
        if (role.permissions.has(PermissionsBitField.Flags.Administrator) || role.permissions.has(PermissionsBitField.Flags.ManageGuild) || role.permissions.has(PermissionsBitField.Flags.ManageRoles) || role.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await role.delete("VC+ anti-nuke").catch(() => {});
            if (member.bannable) await member.ban({ reason: "VC+ anti-nuke" }).catch(() => {});
        }
    } catch (e) { console.error("[VC+ ANTI-NUKE]", e); }
});

client.once("ready", () => {
    console.log(`VC+ online as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: "-help" }], status: "online" });
});

client.on("error", e => console.error("[VC+ CLIENT ERROR]", e));
client.on("warn", e => console.warn("[VC+ WARNING]", e));
client.on("shardError", e => console.error("[VC+ SHARD ERROR]", e));
process.on("unhandledRejection", e => console.error("[VC+ UNHANDLED REJECTION]", e));
process.on("uncaughtException", e => console.error("[VC+ UNCAUGHT EXCEPTION]", e));

async function startBot() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    if (!token) { console.error("Missing DISCORD_TOKEN or TOKEN in .env"); process.exit(1); }
    try { await client.login(token); }
    catch (e) { console.error("[VC+ LOGIN ERROR]", e); process.exit(1); }
}
startBot();
