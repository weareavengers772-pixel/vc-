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
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
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
    founder: 10,
    god: 9,
    owner: 8,
    "co-owner": 7,
    executive: 6,
    director: 5,
    admin: 4,
    moderator: 3,
    staff: 2,
    member: 1
};

const RANK_DISPLAY = {
    founder: "Founder",
    god: "God",
    owner: "Owner",
    "co-owner": "Co-Owner",
    executive: "Executive",
    director: "Director",
    admin: "Admin",
    moderator: "Moderator",
    staff: "Staff",
    member: "Member"
};

function getStoredRank(guildId, userId) {
    return ranks[guildId]?.[userId] || null;
}

function getRankName(member) {
    if (!member) return "member";
    if (member.guild.ownerId === member.id) return "founder";
    return getStoredRank(member.guild.id, member.id) || "member";
}

function getRankLevel(member) {
    return RANKS[getRankName(member)] || 0;
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGodOrHigher(member) {
    return getRankLevel(member) >= RANKS.god;
}

function canManageServer(member) {
    return Boolean(
        member?.guild?.ownerId === member?.id ||
        getRankLevel(member) >= RANKS.owner ||
        member?.permissions?.has(PermissionsBitField.Flags.Administrator)
    );
}

function canModerate(member) {
    return Boolean(
        member?.guild?.ownerId === member?.id ||
        getRankLevel(member) >= RANKS.moderator ||
        member?.permissions?.has(PermissionsBitField.Flags.BanMembers) ||
        member?.permissions?.has(PermissionsBitField.Flags.KickMembers)
    );
}

function canManageVouches(member) {
    return Boolean(member?.guild?.ownerId === member?.id || isFounder(member));
}

function getGuildConfig(guildId) {
    if (!configs[guildId]) configs[guildId] = {};
    const c = configs[guildId];
    c.joinToCreate ??= null;
    c.interfaceChannel ??= null;
    c.interfaceMessage ??= null;
    c.vouchRole ??= null;
    c.vouches ??= {};
    c.voice ??= {};
    c.voice.owners ??= {};
    c.voice.banned ??= {};
    c.voice.permitted ??= {};
    c.voice.locked ??= {};
    c.voice.limits ??= {};
    c.temporaryChannels ??= [];
    return c;
}

function panel(title, description) {
    return {
        embeds: [new EmbedBuilder().setTitle(`VC+ | ${title}`).setDescription(description).setFooter({ text: "VC+" })]
    };
}

async function reply(message, content) {
    try { return await message.reply(content); }
    catch (error) { console.error("[VC+ REPLY]", error); return null; }
}

function deny(message) {
    return reply(message, "```VC+\nYou do not have permission to use this command.\n```");
}

function usage(message, text) {
    return reply(message, `\`\`\`VC+\nUsage: ${text}\n\`\`\``);
}

const HELP_PAGES = [
    { name: "General", description: "-help\nOpen the VC+ command panel.\n\n-ping\nCheck bot latency." },
    { name: "Ranks", description: "-rank @user\nView a rank.\n\n-rank @user <rank>\nSet a rank.\n\n-ranklist\nView the rank hierarchy.\n\n-removerank @user\nServer owner only. Return a user to Member." },
    { name: "Vouches", description: "-vouch set role @Role\nSet the automatic vouch role.\n\n-vouch role\nView the configured vouch role.\n\n-vouch give @user reason\nAdd a vouch and assign the role.\n\n-vouch remove @user\nRemove the latest vouch.\n\n-vouch clear @user\nClear all vouches and remove the role.\n\n-vouch clear everyone\nClear every vouch and remove the role from members.\n\n-vouch list\nView vouch counts.\n\n-vouches @user\nView vouch history." },
    { name: "Voice", description: "-vc setup\nServer owner only. Create Join-to-Create.\n\n-vc kick @user\nDisconnect a member.\n\n-vc ban @user\nBlock a member from the VC.\n\n-vc permit @user\nAllow a member again.\n\n-vc lock\nLock the VC.\n\n-vc unlock\nUnlock the VC.\n\n-vc limit 0-99\nSet the user limit.\n\n-vc name <name>\nRename the VC.\n\n-vc transfer @user\nTransfer ownership.\n\n-vc claim\nClaim an abandoned VC.\n\n-vc forceclaim\nFounder/God only. Force claim.\n\n-vc stfu @user\nFounder/God only. Server mute.\n\n-vc unstfu @user\nFounder/God only. Remove server mute." },
    { name: "Interface", description: "-interface\nCreate the VC+ control panel.\n\nThe panel provides Lock, Unlock, Claim, Kick, VC Ban, Permit, Limit, Rename, Transfer, Force Claim, STFU and UnSTFU controls." },
    { name: "Moderation", description: "-ban @user [reason]\nServer owner only.\n\n-kick @user [reason]\nKick a member.\n\n-timeout @user 10m [reason]\nTimeout a member.\n\n-untimeout @user\nRemove a timeout.\n\n-unban USER_ID\nUnban a user.\n\n-unbanall\nFounder only. Unban everyone.\n\n-purge 1-100\nDelete messages.\n\n-clear 1-100\nAlias for purge." }
];

function helpPayload(page) {
    const safePage = Math.max(0, Math.min(page, HELP_PAGES.length - 1));
    const p = HELP_PAGES[safePage];
    return {
        embeds: [new EmbedBuilder().setTitle(`VC+ | ${p.name}`).setDescription(`\`\`\`\n${p.description}\n\`\`\``).setFooter({ text: `Page ${safePage + 1}/${HELP_PAGES.length}` })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("help_prev").setLabel("<").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`help_page_${safePage}`).setLabel(`${safePage + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId("help_next").setLabel(">").setStyle(ButtonStyle.Secondary)
        )]
    };
}

async function handleHelp(message, args) {
    if (args.length) {
        const page = HELP_PAGES.findIndex(p => p.name.toLowerCase() === args.join(" ").toLowerCase());
        if (page === -1) return reply(message, "```VC+\nUnknown help category.\n```");
        return reply(message, helpPayload(page));
    }
    return reply(message, helpPayload(0));
}

async function handleRank(message, args) {
    const target = message.mentions.members.first();
    if (!target) return usage(message, "-rank @user [rank]");

    if (!args[1]) return reply(message, panel("Rank", `User: ${target.user.tag}\nRank: **${RANK_DISPLAY[getRankName(target)]}**`));
    if (!canManageServer(message.member)) return deny(message);

    const requested = args[1].toLowerCase();
    if (!RANKS[requested]) return reply(message, "```VC+\nInvalid rank.\n```");
    if (target.id === message.guild.ownerId) return reply(message, panel("Rank", "The server owner is always Founder."));

    if (message.guild.ownerId !== message.author.id) {
        if (RANKS[requested] >= getRankLevel(message.member)) return reply(message, "```VC+\nYou cannot assign a rank equal to or higher than your own.\n```");
        if (getRankLevel(target) >= getRankLevel(message.member)) return reply(message, "```VC+\nYou cannot change someone at or above your rank.\n```");
    }

    ranks[message.guild.id] ??= {};
    ranks[message.guild.id][target.id] = requested;
    saveJSON(RANK_FILE, ranks);
    return reply(message, panel("Rank", `${target.user.tag} is now **${RANK_DISPLAY[requested]}**.`));
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

async function handleVouch(message, args) {
    const c = getGuildConfig(message.guild.id);
    const sub = args[0]?.toLowerCase();

    if ((sub === "set" && args[1]?.toLowerCase() === "role") || (sub === "role" && args[1]?.toLowerCase() === "set")) {
        if (!canManageVouches(message.member)) return deny(message);
        const role = message.mentions.roles.first();
        if (!role) return usage(message, "-vouch set role @Role");
        const bot = message.guild.members.me;
        if (!bot || role.position >= bot.roles.highest.position) return reply(message, "```VC+\nThat role must be below my highest role.\n```");
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
        if (target.user.bot) return reply(message, "```VC+\nBots cannot receive vouches.\n```");

        const reason = args.slice(2).join(" ") || "No reason provided";
        c.vouches[target.id] ??= [];
        c.vouches[target.id].push({ by: message.author.id, reason, timestamp: Date.now() });

        let roleStatus = "No vouch role configured.";
        if (c.vouchRole) {
            const role = message.guild.roles.cache.get(c.vouchRole);
            const bot = message.guild.members.me;
            if (!role) {
                c.vouchRole = null;
                roleStatus = "Configured vouch role no longer exists.";
            } else if (!bot || role.position >= bot.roles.highest.position) {
                roleStatus = "Vouch saved, but the role is above my highest role.";
            } else if (!target.roles.cache.has(role.id)) {
                try {
                    await target.roles.add(role, "VC+ vouch");
                    roleStatus = `Role assigned: ${role.name}`;
                } catch (error) {
                    console.error("[VC+ VOUCH ROLE]", error);
                    roleStatus = "Vouch saved, but I could not assign the role.";
                }
            } else roleStatus = `Role already assigned: ${role.name}`;
        }

        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch", `Vouch added to ${target}.\nReason: ${reason}\n${roleStatus}`));
    }

    if (sub === "remove") {
        if (!canManageVouches(message.member)) return deny(message);
        const target = message.mentions.members.first();
        if (!target) return usage(message, "-vouch remove @user");
        const list = c.vouches[target.id] || [];
        if (!list.length) return reply(message, panel("Vouch Remove", `${target} has no vouches.`));
        list.pop();
        if (!list.length) delete c.vouches[target.id];
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch Remove", `Removed the latest vouch from ${target}.`));
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
                        if (!member.roles.cache.has(role.id)) continue;
                        try { await member.roles.remove(role, "VC+ vouches cleared for everyone"); removed++; }
                        catch (error) { console.error("[VC+ VOUCH CLEAR]", error); }
                    }
                } catch (error) { console.error("[VC+ MEMBER FETCH]", error); }
            }
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Vouch Clear", `Cleared **${ids.length}** vouch entries.\nRemoved the configured vouch role from **${removed}** member(s).`));
        }

        const target = message.mentions.members.first();
        if (!target) return usage(message, "-vouch clear @user\n-vouch clear everyone");
        delete c.vouches[target.id];
        let removed = false;
        if (role && target.roles.cache.has(role.id)) {
            try { await target.roles.remove(role, "VC+ vouches cleared"); removed = true; }
            catch (error) { console.error("[VC+ VOUCH CLEAR]", error); }
        }
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Vouch Clear", `Cleared vouches for ${target}.\nVouch role removed: **${removed ? "Yes" : "No"}**.`));
    }

    if (sub === "list") {
        if (!canManageVouches(message.member)) return deny(message);
        const entries = Object.entries(c.vouches)
            .map(([id, list]) => [id, Array.isArray(list) ? list.length : 0])
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        if (!entries.length) return reply(message, "```VC+\nNo vouches have been recorded.\n```");
        const lines = entries.map(([id, count]) => {
            const member = message.guild.members.cache.get(id);
            return `${member ? member.user.tag : id}: ${count} vouch(es)`;
        });
        return reply(message, panel("Vouches", lines.join("\n")));
    }

    return usage(message, "-vouch set role @Role\n-vouch role\n-vouch give @user reason\n-vouch remove @user\n-vouch clear @user\n-vouch clear everyone\n-vouch list");
}

async function handleVouches(message) {
    const target = message.mentions.members.first();
    if (!target) return usage(message, "-vouches @user");
    const list = getGuildConfig(message.guild.id).vouches[target.id] || [];
    if (!list.length) return reply(message, panel("Vouches", `${target.user.tag} has **0** vouches.`));
    const history = list.slice(-10).map((v, i) => `${i + 1}. ${v.reason} — ${new Date(v.timestamp).toLocaleDateString()}`).join("\n");
    return reply(message, panel("Vouches", `${target.user.tag} has **${list.length}** vouch(es).\n\n${history}`));
}

function parseDuration(input) {
    const match = /^(\d+)(s|m|h|d)$/i.exec(input || "");
    if (!match) return null;
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return Number(match[1]) * mult[match[2].toLowerCase()];
}

async function handleModeration(message, command, args) {
    if (!canModerate(message.member)) return deny(message);
    const target = message.mentions.members.first();
    if (["ban", "kick", "timeout", "untimeout"].includes(command) && !target) return usage(message, `-${command} @user`);

    try {
        if (command === "ban") {
            if (message.guild.ownerId !== message.author.id) return deny(message);
            if (target.id === message.guild.ownerId) return reply(message, panel("Ban", "The server owner cannot be banned."));
            if (!target.bannable) return reply(message, "```VC+\nI cannot ban that member.\n```");
            const reason = args.slice(1).join(" ") || "No reason provided.";
            try { await target.send(panel("Ban Notice", `You have been banned from **${message.guild.name}**.\n\nReason: ${reason}\nBanned by: ${message.author.tag}`)); } catch {}
            await target.ban({ reason: `VC+ owner ban: ${reason}` });
            return reply(message, panel("Ban", `**${target.user.tag}** was banned.\nReason: ${reason}`));
        }

        if (command === "kick") {
            if (!target.kickable) return reply(message, "```VC+\nI cannot kick that member.\n```");
            if (isFounder(target)) return reply(message, panel("Kick", "Founder members cannot be kicked by VC+."));
            await target.kick(args.slice(1).join(" ") || "VC+ moderation");
            return reply(message, panel("Kick", `${target.user.tag} was kicked.`));
        }

        if (command === "timeout") {
            const duration = parseDuration(args[1]);
            if (!duration) return usage(message, "-timeout @user 10m [reason]");
            await target.timeout(duration, args.slice(2).join(" ") || "VC+ moderation");
            return reply(message, panel("Timeout", `${target.user.tag} was timed out for ${args[1]}.`));
        }

        if (command === "untimeout") {
            await target.timeout(null, "VC+ untimeout");
            return reply(message, panel("Timeout", `${target.user.tag} is no longer timed out.`));
        }

        if (command === "unban") {
            if (!args[0]) return usage(message, "-unban USER_ID");
            await message.guild.members.unban(args[0], "VC+ unban");
            return reply(message, panel("Unban", `${args[0]} was unbanned.`));
        }

        if (command === "unbanall") {
            if (!isFounder(message.member)) return deny(message);
            const bans = await message.guild.bans.fetch();
            let count = 0;
            for (const [id] of bans) {
                try { await message.guild.members.unban(id, "VC+ unbanall"); count++; } catch {}
            }
            return reply(message, panel("Unban All", `Unbanned **${count}** user(s).`));
        }

        if (command === "purge" || command === "clear") {
            if (!canManageServer(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return deny(message);
            const amount = Number(args[0]);
            if (!Number.isInteger(amount) || amount < 1 || amount > 100) return usage(message, `-${command} 1-100`);
            const deleted = await message.channel.bulkDelete(amount, true);
            return reply(message, panel("Purge", `Deleted **${deleted.size}** message(s).`));
        }
    } catch (error) {
        console.error(`[VC+ ${command}]`, error);
        return reply(message, "```VC+\nThe command could not be completed. Check the bot permissions.\n```");
    }
}

function currentVC(member) { return member?.voice?.channel || null; }
function isTempVC(c, id) { return c.temporaryChannels.includes(id); }
function canControlVC(member, channel) {
    if (!member || !channel) return false;
    const c = getGuildConfig(member.guild.id);
    return isGodOrHigher(member) || c.voice.owners[channel.id] === member.id;
}

async function createVCPanel(channel, owner) {
    try {
        await channel.send({
            embeds: [new EmbedBuilder().setTitle("VC+ | Voice Control").setDescription(`Owner: ${owner}\n\nUse the buttons below or the -vc commands.`).setFooter({ text: "VC+ Voice Control" })],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_unlock").setLabel("Unlock").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_claim").setLabel("Claim").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_kick").setLabel("Kick").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_ban").setLabel("VC Ban").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_permit").setLabel("Permit").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_transfer").setLabel("Transfer").setStyle(ButtonStyle.Secondary)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_limit").setLabel("Limit").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_rename").setLabel("Rename").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_forceclaim").setLabel("Force Claim").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_stfu").setLabel("STFU").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_unstfu").setLabel("UnSTFU").setStyle(ButtonStyle.Secondary)
                )
            ]
        });
    } catch (error) { console.error("[VC+ VOICE PANEL]", error); }
}

async function handleVC(message, args) {
    const sub = args[0]?.toLowerCase();

    if (sub === "setup") {
        if (message.guild.ownerId !== message.author.id) return deny(message);
        const c = getGuildConfig(message.guild.id);
        const existing = c.joinToCreate ? message.guild.channels.cache.get(c.joinToCreate) : null;
        if (existing) return reply(message, panel("VC Setup", "Join-to-Create is already configured."));

        try {
            const category = await message.guild.channels.create({ name: "VC+", type: ChannelType.GuildCategory });
            const create = await message.guild.channels.create({ name: "Join To Create", type: ChannelType.GuildVoice, parent: category.id });
            c.joinToCreate = create.id;
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("VC Setup", `Join-to-Create created in **${category.name}**.`));
        } catch (error) {
            console.error("[VC+ SETUP]", error);
            return reply(message, "```VC+\nFailed to set up Join-to-Create. Make sure I have Manage Channels.\n```");
        }
    }

    const channel = currentVC(message.member);
    if (!channel) return reply(message, "```VC+\nYou must be in a voice channel.\n```");
    const c = getGuildConfig(message.guild.id);
    if (!isTempVC(c, channel.id)) return reply(message, "```VC+\nYou must be in a VC+ temporary voice channel.\n```");
    if (!canControlVC(message.member, channel)) return deny(message);

    try {
        if (sub === "kick" || sub === "disconnect") {
            const target = message.mentions.members.first();
            if (!target) return usage(message, `-vc ${sub} @user`);
            if (isFounder(target)) return reply(message, panel("Voice", "Founder members cannot be kicked or disconnected."));
            if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ voice control");
            return reply(message, panel("Voice", `${target.user.tag} was disconnected.`));
        }

        if (sub === "ban" || sub === "reject") {
            const target = message.mentions.members.first();
            if (!target) return usage(message, `-vc ${sub} @user`);
            if (isFounder(target)) return reply(message, panel("Voice", "Founder members cannot be VC banned or rejected."));
            c.voice.banned[channel.id] ??= [];
            if (!c.voice.banned[channel.id].includes(target.id)) c.voice.banned[channel.id].push(target.id);
            c.voice.permitted[channel.id] = (c.voice.permitted[channel.id] || []).filter(id => id !== target.id);
            if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ VC ban").catch(() => {});
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Voice", `${target.user.tag} was ${sub === "ban" ? "VC banned" : "rejected"}.`));
        }

        if (sub === "permit") {
            const target = message.mentions.members.first();
            if (!target) return usage(message, "-vc permit @user");
            c.voice.permitted[channel.id] ??= [];
            if (!c.voice.permitted[channel.id].includes(target.id)) c.voice.permitted[channel.id].push(target.id);
            c.voice.banned[channel.id] = (c.voice.banned[channel.id] || []).filter(id => id !== target.id);
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Voice", `${target.user.tag} was permitted.`));
        }

        if (sub === "lock" || sub === "unlock") {
            await channel.permissionOverwrites.edit(message.guild.roles.everyone, { Connect: sub === "lock" ? false : null });
            c.voice.locked[channel.id] = sub === "lock";
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Voice", `VC ${sub === "lock" ? "locked" : "unlocked"}.`));
        }

        if (sub === "limit") {
            const limit = Number(args[1]);
            if (!Number.isInteger(limit) || limit < 0 || limit > 99) return usage(message, "-vc limit 0-99");
            await channel.setUserLimit(limit);
            c.voice.limits[channel.id] = limit;
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Voice", `User limit set to **${limit}**.`));
        }

        if (sub === "name" || sub === "rename") {
            const name = args.slice(1).join(" ").slice(0, 100);
            if (!name) return usage(message, `-vc ${sub} name`);
            await channel.setName(name);
            return reply(message, panel("Voice", `VC renamed to **${name}**.`));
        }

        if (sub === "transfer") {
            const target = message.mentions.members.first();
            if (!target) return usage(message, "-vc transfer @user");
            if (target.user.bot) return reply(message, "```VC+\nBots cannot own a VC.\n```");
            c.voice.owners[channel.id] = target.id;
            saveJSON(CONFIG_FILE, configs);
            return reply(message, panel("Voice", `Ownership transferred to ${target}.`));
        }

        if (sub === "claim") {
            const ownerId = c.voice.owners[channel.id];
            const owner = ownerId ? message.guild.members.cache.get(ownerId) : null;
            if (owner?.voice.channelId === channel.id) return reply(message, "```VC+\nThis VC already has an active owner.\n```");
            c.voice.owners[channel.id] = message.author.id;
            saveJSON(CONFIG_FILE, configs);
            return reply(message, "```VC+\nYou claimed this VC.\n```");
        }

        if (sub === "forceclaim") {
            if (!isGodOrHigher(message.member)) return deny(message);
            c.voice.owners[channel.id] = message.author.id;
            saveJSON(CONFIG_FILE, configs);
            return reply(message, "```VC+\nYou force claimed this VC.\n```");
        }

        if (sub === "stfu" || sub === "unstfu") {
            if (!isGodOrHigher(message.member)) return deny(message);
            const target = message.mentions.members.first();
            if (!target) return usage(message, `-vc ${sub} @user`);
            if (isFounder(target)) return reply(message, panel("Voice", "Founder members cannot be server muted or unmuted through VC+."));
            if (target.voice.channelId !== channel.id) return reply(message, "```VC+\nThat member is not in your VC.\n```");
            await target.voice.setMute(sub === "stfu", `VC+ ${sub}`);
            return reply(message, panel("Voice", `${target.user.tag} ${sub === "stfu" ? "was server muted" : "is no longer server muted"}.`));
        }

        return usage(message, "-vc setup\n-vc kick @user\n-vc ban @user\n-vc permit @user\n-vc lock\n-vc unlock\n-vc limit 0-99\n-vc name <name>\n-vc transfer @user\n-vc claim\n-vc forceclaim\n-vc stfu @user\n-vc unstfu @user");
    } catch (error) {
        console.error("[VC+ VC COMMAND]", error);
        return reply(message, "```VC+\nThe VC command could not be completed. Check the bot permissions.\n```");
    }
}

async function handleInterface(message) {
    if (!canManageServer(message.member)) return deny(message);
    const c = getGuildConfig(message.guild.id);

    try {
        let channel = c.interfaceChannel ? message.guild.channels.cache.get(c.interfaceChannel) : null;
        if (!channel) {
            channel = await message.guild.channels.create({ name: "VC+ Interface", type: ChannelType.GuildText });
            c.interfaceChannel = channel.id;
        }

        const sent = await channel.send({
            embeds: [new EmbedBuilder().setTitle("VC+ | Voice Interface").setDescription("Join your temporary VC and use the controls below. Advanced controls are also available through -vc commands.").setFooter({ text: "VC+ Voice Interface" })],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_lock").setLabel("Lock").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_unlock").setLabel("Unlock").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_claim").setLabel("Claim").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_kick").setLabel("Kick").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_ban").setLabel("VC Ban").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_permit").setLabel("Permit").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_transfer").setLabel("Transfer").setStyle(ButtonStyle.Secondary)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("vcui_limit").setLabel("Limit").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_rename").setLabel("Rename").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_forceclaim").setLabel("Force Claim").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("vcui_stfu").setLabel("STFU").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("vcui_unstfu").setLabel("UnSTFU").setStyle(ButtonStyle.Secondary)
                )
            ]
        });

        c.interfaceMessage = sent.id;
        saveJSON(CONFIG_FILE, configs);
        return reply(message, panel("Interface", `VC+ interface created in ${channel}.`));
    } catch (error) {
        console.error("[VC+ INTERFACE]", error);
        return reply(message, "```VC+\nFailed to create the interface.\n```");
    }
}

function getInteractionVC(interaction) { return interaction.member?.voice?.channel || null; }

function getModalMember(interaction) {
    const value = interaction.fields.getTextInputValue("vcui_user").trim();
    const match = value.match(/^<@!?(\d+)>$/);
    const id = match ? match[1] : value;
    return interaction.guild.members.cache.get(id) || null;
}

async function showUserModal(interaction, action) {
    const labels = {
        kick: "User to kick",
        ban: "User to VC ban",
        permit: "User to permit",
        transfer: "Transfer ownership to",
        stfu: "User to STFU",
        unstfu: "User to UnSTFU"
    };

    const modal = new ModalBuilder().setCustomId(`vcui_modal_${action}`).setTitle(`VC+ | ${labels[action] || "User"}`);
    const input = new TextInputBuilder().setCustomId("vcui_user").setLabel("User ID or @mention").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("123456789012345678 or @user");
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
}

async function showValueModal(interaction, action) {
    const data = { limit: ["User limit", "0 to 99"], rename: ["New channel name", "My VC"] };
    const item = data[action];
    if (!item) return;

    const modal = new ModalBuilder().setCustomId(`vcui_modal_${action}`).setTitle(`VC+ | ${item[0]}`);
    const input = new TextInputBuilder().setCustomId("vcui_value").setLabel(item[0]).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(item[1]);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
}

async function handleInterfaceButton(interaction) {
    const channel = getInteractionVC(interaction);
    if (!channel) return interaction.reply({ ephemeral: true, content: "```VC+\nJoin your temporary VC first.\n```" });

    const c = getGuildConfig(interaction.guild.id);
    if (!isTempVC(c, channel.id)) return interaction.reply({ ephemeral: true, content: "```VC+\nThis is not a VC+ temporary channel.\n```" });
    if (!canControlVC(interaction.member, channel)) return interaction.reply({ ephemeral: true, content: "```VC+\nYou do not control this VC.\n```" });

    const action = interaction.customId.replace("vcui_", "");
    if (["kick", "ban", "permit", "transfer", "stfu", "unstfu"].includes(action)) return showUserModal(interaction, action);
    if (["limit", "rename"].includes(action)) return showValueModal(interaction, action);

    try {
        if (action === "refresh") return interaction.reply({ ephemeral: true, content: "```VC+\nInterface is ready.\n```" });

        if (action === "lock" || action === "unlock") {
            await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: action === "lock" ? false : null });
            c.voice.locked[channel.id] = action === "lock";
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: `\`\`\`VC+\nVC ${action === "lock" ? "locked" : "unlocked"}.\n\`\`\`` });
        }

        if (action === "claim") {
            const ownerId = c.voice.owners[channel.id];
            const owner = ownerId ? interaction.guild.members.cache.get(ownerId) : null;
            if (owner?.voice.channelId === channel.id) return interaction.reply({ ephemeral: true, content: "```VC+\nThis VC already has an active owner.\n```" });
            c.voice.owners[channel.id] = interaction.user.id;
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: "```VC+\nYou now own this VC.\n```" });
        }

        if (action === "forceclaim") {
            if (!isGodOrHigher(interaction.member)) return interaction.reply({ ephemeral: true, content: "```VC+\nFounder or God access is required.\n```" });
            c.voice.owners[channel.id] = interaction.user.id;
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: "```VC+\nVC ownership force claimed.\n```" });
        }
    } catch (error) {
        console.error("[VC+ INTERFACE BUTTON]", error);
        return interaction.reply({ ephemeral: true, content: "```VC+\nThe interface action failed. Check bot permissions.\n```" });
    }
}

async function handleInterfaceModal(interaction) {
    const channel = getInteractionVC(interaction);
    if (!channel) return interaction.reply({ ephemeral: true, content: "```VC+\nJoin your temporary VC first.\n```" });

    const c = getGuildConfig(interaction.guild.id);
    if (!isTempVC(c, channel.id)) return interaction.reply({ ephemeral: true, content: "```VC+\nThis is not a VC+ temporary channel.\n```" });
    if (!canControlVC(interaction.member, channel)) return interaction.reply({ ephemeral: true, content: "```VC+\nYou do not control this VC.\n```" });

    const action = interaction.customId.replace("vcui_modal_", "");

    try {
        if (["limit", "rename"].includes(action)) {
            const value = interaction.fields.getTextInputValue("vcui_value").trim();
            if (action === "limit") {
                const limit = Number(value);
                if (!Number.isInteger(limit) || limit < 0 || limit > 99) return interaction.reply({ ephemeral: true, content: "```VC+\nLimit must be a whole number from 0 to 99.\n```" });
                await channel.setUserLimit(limit, "VC+ interface limit");
                c.voice.limits[channel.id] = limit;
                saveJSON(CONFIG_FILE, configs);
                return interaction.reply({ ephemeral: true, content: `\`\`\`VC+\nUser limit set to ${limit}.\n\`\`\`` });
            }
            const name = value.slice(0, 100);
            if (!name) return interaction.reply({ ephemeral: true, content: "```VC+\nEnter a channel name.\n```" });
            await channel.setName(name, "VC+ interface rename");
            return interaction.reply({ ephemeral: true, content: "```VC+\nVC renamed.\n```" });
        }

        const target = getModalMember(interaction);
        if (!target) return interaction.reply({ ephemeral: true, content: "```VC+\nMember not found. Use a valid server member ID or @mention.\n```" });
        if (isFounder(target) && ["kick", "ban", "stfu", "unstfu"].includes(action)) return interaction.reply({ ephemeral: true, content: "```VC+\nFounder members are protected from this control.\n```" });

        if (action === "kick") {
            if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ interface kick").catch(() => {});
            return interaction.reply({ ephemeral: true, content: "```VC+\nMember disconnected.\n```" });
        }

        if (action === "ban") {
            c.voice.banned[channel.id] ??= [];
            if (!c.voice.banned[channel.id].includes(target.id)) c.voice.banned[channel.id].push(target.id);
            c.voice.permitted[channel.id] = (c.voice.permitted[channel.id] || []).filter(id => id !== target.id);
            if (target.voice.channelId === channel.id) await target.voice.disconnect("VC+ VC ban").catch(() => {});
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: "```VC+\nMember VC banned.\n```" });
        }

        if (action === "permit") {
            c.voice.permitted[channel.id] ??= [];
            if (!c.voice.permitted[channel.id].includes(target.id)) c.voice.permitted[channel.id].push(target.id);
            c.voice.banned[channel.id] = (c.voice.banned[channel.id] || []).filter(id => id !== target.id);
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: "```VC+\nMember permitted.\n```" });
        }

        if (action === "transfer") {
            if (target.user.bot) return interaction.reply({ ephemeral: true, content: "```VC+\nBots cannot own a VC.\n```" });
            c.voice.owners[channel.id] = target.id;
            saveJSON(CONFIG_FILE, configs);
            return interaction.reply({ ephemeral: true, content: "```VC+\nVC ownership transferred.\n```" });
        }

        if (action === "stfu" || action === "unstfu") {
            if (!isGodOrHigher(interaction.member)) return interaction.reply({ ephemeral: true, content: "```VC+\nFounder or God access is required.\n```" });
            if (isFounder(target)) return interaction.reply({ ephemeral: true, content: "```VC+\nFounder members cannot be server muted or unmuted through VC+.\n```" });
            if (target.voice.channelId !== channel.id) return interaction.reply({ ephemeral: true, content: "```VC+\nThat member is not in your VC.\n```" });
            await target.voice.setMute(action === "stfu", `VC+ ${action}`);
            return interaction.reply({ ephemeral: true, content: `\`\`\`VC+\nMember ${action === "stfu" ? "server muted" : "server unmuted"}.\n\`\`\`` });
        }

        return interaction.reply({ ephemeral: true, content: "```VC+\nUnknown interface action.\n```" });
    } catch (error) {
        console.error("[VC+ INTERFACE MODAL]", error);
        return interaction.reply({ ephemeral: true, content: "```VC+\nThe interface action failed. Check bot permissions.\n```" });
    }
}

client.on("messageCreate", async message => {
    try {
        if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

        const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const command = parts.shift()?.toLowerCase();
        const args = parts;
        if (!command) return;

        switch (command) {
            case "help": return handleHelp(message, args);
            case "ping": return reply(message, panel("Ping", `API latency: **${Math.round(client.ws.ping)}ms**.`));
            case "rank": return handleRank(message, args);
            case "removerank": return handleRemoveRank(message);
            case "ranklist": return reply(message, "```VC+ | RANK HIERARCHY\n10 Founder\n9 God\n8 Owner\n7 Co-Owner\n6 Executive\n5 Director\n4 Admin\n3 Moderator\n2 Staff\n1 Member\n```");
            case "vouch": return handleVouch(message, args);
            case "vouches": return handleVouches(message);
            case "vc": return handleVC(message, args);
            case "interface": return handleInterface(message);
            case "ban":
            case "kick":
            case "timeout":
            case "untimeout":
            case "unban":
            case "unbanall":
            case "purge":
            case "clear":
                return handleModeration(message, command, args);
            default:
                return reply(message, `\`\`\`VC+\nUnknown command: -${command}\nUse -help to view commands.\n\`\`\``);
        }
    } catch (error) {
        console.error("[VC+ COMMAND ERROR]", error);
        await reply(message, "```VC+\nAn error occurred while executing that command.\n```");
    }
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton() && interaction.customId.startsWith("help_")) {
            const current = interaction.message.components?.[0]?.components?.[1]?.customId?.match(/help_page_(\d+)/);
            let page = current ? Number(current[1]) : 0;
            if (interaction.customId === "help_prev") page = (page - 1 + HELP_PAGES.length) % HELP_PAGES.length;
            if (interaction.customId === "help_next") page = (page + 1) % HELP_PAGES.length;
            return interaction.update(helpPayload(page));
        }

        if (interaction.isButton() && interaction.customId.startsWith("vcui_")) return handleInterfaceButton(interaction);
        if (interaction.isModalSubmit() && interaction.customId.startsWith("vcui_modal_")) return handleInterfaceModal(interaction);
    } catch (error) {
        console.error("[VC+ INTERACTION ERROR]", error);
        try {
            if (!interaction.replied && !interaction.deferred) await interaction.reply({ ephemeral: true, content: "```VC+\nThat action could not be completed.\n```" });
        } catch {}
    }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;
        const c = getGuildConfig(guild.id);

        if (c.joinToCreate && newState.channelId === c.joinToCreate && newState.member) {
            c.temporaryChannels = c.temporaryChannels.filter(id => guild.channels.cache.has(id));
            const parent = newState.channel?.parent;
            const channel = await guild.channels.create({
                name: `${newState.member.user.username}'s VC`.slice(0, 100),
                type: ChannelType.GuildVoice,
                parent: parent?.id || null
            });

            c.temporaryChannels.push(channel.id);
            c.voice.owners[channel.id] = newState.member.id;
            saveJSON(CONFIG_FILE, configs);
            await newState.member.voice.setChannel(channel);
            await createVCPanel(channel, newState.member);
        }

        if (oldState.channel && oldState.channelId !== newState.channelId && isTempVC(c, oldState.channelId) && oldState.channel.members.size === 0) {
            const oldId = oldState.channelId;
            await oldState.channel.delete("VC+ empty temporary VC").catch(() => {});
            c.temporaryChannels = c.temporaryChannels.filter(id => id !== oldId);
            delete c.voice.owners[oldId];
            delete c.voice.banned[oldId];
            delete c.voice.permitted[oldId];
            delete c.voice.locked[oldId];
            delete c.voice.limits[oldId];
            saveJSON(CONFIG_FILE, configs);
        }

        if (newState.channel && c.voice.banned[newState.channel.id]?.includes(newState.member.id)) {
            await newState.member.voice.disconnect("VC+ VC ban enforcement").catch(() => {});
        }
    } catch (error) {
        console.error("[VC+ VOICE ERROR]", error);
    }
});

client.once("ready", () => {
    console.log(`VC+ online as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: "-help" }], status: "online" });
});

client.on("error", error => console.error("[VC+ CLIENT ERROR]", error));
client.on("warn", warning => console.warn("[VC+ WARNING]", warning));
client.on("shardError", error => console.error("[VC+ SHARD ERROR]", error));
process.on("unhandledRejection", error => console.error("[VC+ UNHANDLED REJECTION]", error));
process.on("uncaughtException", error => console.error("[VC+ UNCAUGHT EXCEPTION]", error));

async function startBot() {
    const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
    if (!token) {
        console.error("Missing DISCORD_TOKEN or TOKEN in .env");
        process.exit(1);
    }
    try { await client.login(token); }
    catch (error) { console.error("[VC+ LOGIN ERROR]", error); process.exit(1); }
}

startBot();
