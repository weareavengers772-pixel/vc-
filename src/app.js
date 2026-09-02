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
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    AuditLogEvent
} from "discord.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


// ============================================================
// VC+ CONFIG
// ============================================================

const PREFIX = "-";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const RANK_FILE = path.join(DATA_DIR, "ranks.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const FOREVER_BAN_FILE = path.join(DATA_DIR, "foreverbans.json");


// ============================================================
// SAFE JSON
// ============================================================

function loadJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            return structuredClone(fallback);
        }

        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.error(`[FILE ERROR] ${file}`, error);

        try {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
        } catch {}

        return structuredClone(fallback);
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`[SAVE ERROR] ${file}`, error);
    }
}

let ranks = loadJSON(RANK_FILE, {});
let configs = loadJSON(CONFIG_FILE, {});
let foreverBans = loadJSON(FOREVER_BAN_FILE, {});


// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
});


// ============================================================
// RANK SYSTEM
// ============================================================

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

function getRankLevel(member) {
    if (!member) return 0;

    if (member.guild.ownerId === member.id) {
        return RANKS.founder;
    }

    const stored = getStoredRank(member.guild.id, member.id);
    if (!stored) return 0;

    return RANKS[stored] || 0;
}

function getRankName(member) {
    if (!member) return "member";

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    return getStoredRank(member.guild.id, member.id) || "member";
}

function hasRank(member, required) {
    return getRankLevel(member) >= (RANKS[required] || 999);
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGod(member) {
    return getRankLevel(member) >= RANKS.god;
}

function isGodmode(member) {
    if (!member?.guild) return false;

    const guildData = configs[member.guild.id];

    return guildData?.godmode?.includes(member.id) || false;
}

function hasGodAccess(member) {
    return (
        member.guild.ownerId === member.id ||
        isFounder(member) ||
        isGod(member) ||
        isGodmode(member)
    );
}

function canModerate(member) {
    return (
        member.guild.ownerId === member.id ||
        getRankLevel(member) >= RANKS.moderator ||
        member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
        member.permissions.has(PermissionsBitField.Flags.KickMembers)
    );
}

function canManageServer(member) {
    return (
        member.guild.ownerId === member.id ||
        isFounder(member) ||
        getRankLevel(member) >= RANKS.owner ||
        member.permissions.has(PermissionsBitField.Flags.Administrator)
    );
}

function canManageVouches(member) {
    return (
        member.guild.ownerId === member.id ||
        isFounder(member)
    );
}


// ============================================================
// GUILD CONFIG
// ============================================================

function getGuildConfig(guildId) {
    if (!configs[guildId]) {
        configs[guildId] = {
            joinToCreate: null,
            interfaceChannel: null,
            interfaceMessage: null,
            vouchRole: null,
            vouches: {},
            godmode: [],
            filter: [],
            voice: {
                owners: {},
                banned: {},
                permitted: {},
                locked: {},
                limits: {}
            },
            temporaryChannels: []
        };

        saveJSON(CONFIG_FILE, configs);
    }

    const config = configs[guildId];

    config.joinToCreate ??= null;
    config.interfaceChannel ??= null;
    config.interfaceMessage ??= null;
    config.vouchRole ??= null;
    config.vouches ??= {};
    config.godmode ??= [];
    config.filter ??= [];
    config.voice ??= {};
    config.voice.owners ??= {};
    config.voice.banned ??= {};
    config.voice.permitted ??= {};
    config.voice.locked ??= {};
    config.voice.limits ??= {};
    config.temporaryChannels ??= [];

    return config;
}


// ============================================================
// SAFE HELPERS
// ============================================================

async function safeReply(message, content) {
    try {
        return await message.reply(content);
    } catch (error) {
        console.error("[REPLY ERROR]", error);
        return null;
    }
}

async function safeEdit(message, content) {
    try {
        return await message.edit(content);
    } catch (error) {
        console.error("[EDIT ERROR]", error);
        return null;
    }
}

async function safeDelete(message) {
    try {
        if (message?.deletable) await message.delete();
    } catch {}
}

async function safeDM(user, content) {
    try {
        await user.send(content);
    } catch {}
}

function panel(title, description) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`VC+ | ${title}`)
                .setDescription(description)
                .setFooter({ text: "VC+" })
        ]
    };
}

async function deny(message) {
    return safeReply(
        message,
        "```VC+\nYou do not have permission to use this command.\n```"
    );
}

async function usage(message, text) {
    return safeReply(
        message,
        `\`\`\`VC+\nUsage: ${text}\n\`\`\``
    );
}


// ============================================================
// HELP SYSTEM
// ============================================================

const HELP_PAGES = [
    {
        name: "General",
        description:
`-help
Open the VC+ help menu.

-ping
Check bot latency.`
    },
    {
        name: "Moderation",
        description:
`-ban @user [reason]
Ban a member.

-unban USER_ID
Unban a user.

-unbanall
Unban all users.

-kick @user [reason]
Kick a member.

-timeout @user [duration] [reason]
Timeout a member.

-untimeout @user
Remove a timeout.

-foreverban @user [reason]
Permanently ban a member through VC+.

-unforeverban USER_ID
Remove a VC+ forever ban.

-purge amount
Delete messages.

-clear amount
Alias for purge.`
    },
    {
        name: "Ranks",
        description:
`-rank @user founder
Set Founder.

-rank @user god
Set God.

-rank @user owner
Set Owner.

-rank @user co-owner
Set Co-Owner.

-rank @user executive
Set Executive.

-rank @user director
Set Director.

-rank @user admin
Set Admin.

-rank @user moderator
Set Moderator.

-rank @user staff
Set Staff.

-rank @user member
Set Member.

-rank @user
View rank.

-removerank @user
Server owner only. Remove a user's VC+ rank and return them to Member.

-ranklist
View rank hierarchy.`
    },
    {
        name: "Godmode",
        description:
`-godmode @user
Give internal VC+ Godmode.

-godmode remove @user
Remove internal Godmode.

Godmode is an internal VC+ permission and is not a Discord role.`
    },
    {
        name: "Vouches",
        description:
`-vouch set role @Role
Set the vouch role.

-vouch role
View the configured vouch role.

-vouch give @user reason
Give a vouch and automatically assign the configured role.

-vouch clear @user
Clear a user's vouches and remove the configured vouch role.

-vouch clear everyone
Clear all vouches and remove the configured vouch role from everyone.

-vouch list
View vouches.

-vouches @user
View a user's vouches.`
    },
    {
        name: "Filter",
        description:
`-filter add word
Add a filtered word.

-filter remove word
Remove a filtered word.`
    },
    {
        name: "Voice",
        description:
`-vc setup
Create the Join-to-Create system.

-vc kick @user
Disconnect a user.

-vc disconnect @user
Disconnect a user.

-vc ban @user
Ban a user from your temporary VC.

-vc reject @user
Reject a user.

-vc permit @user
Permit a user.

-vc lock
Lock your VC.

-vc unlock
Unlock your VC.

-vc limit number
Set the VC user limit.

-vc rename name
Rename your VC.

-vc transfer @user
Transfer VC ownership.

-vc claim
Claim an abandoned VC.

-vc forceclaim
Force claim a VC.

-vc stfu @user
Server voice mute.

-vc unstfu @user
Remove server voice mute.

Every temporary VC also receives its own VC+ control panel.`
    },
    {
        name: "Server Setup",
        description:
`-vc setup
Create the Join-to-Create system.

-interface
Create the VC+ server voice interface.

The Join-to-Create system automatically creates temporary voice channels when members join the creation channel.

The vouch role is configured with:

-vouch set role @Role`
    }
];

function helpButtons(page) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("help_prev")
                .setLabel("<")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`help_page_${page}`)
                .setLabel(`${page + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId("help_next")
                .setLabel(">")
                .setStyle(ButtonStyle.Secondary)
        );
}

function helpPayload(page) {
    const current = HELP_PAGES[page];

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`VC+ | ${current.name}`)
                .setDescription(`\`\`\`\n${current.description}\n\`\`\``)
                .setFooter({
                    text: `Page ${page + 1}/${HELP_PAGES.length} • Use -help category for direct access`
                })
        ],
        components: [helpButtons(page)]
    };
}

async function handleHelp(message, args) {
    const category = args[0]?.toLowerCase();

    if (category) {
        const index = HELP_PAGES.findIndex(
            page => page.name.toLowerCase() === category
        );

        if (index === -1) {
            return safeReply(
                message,
                "```VC+\nUnknown help category.\nUse -help to view the available categories.\n```"
            );
        }

        return safeReply(message, helpPayload(index));
    }

    return safeReply(message, helpPayload(0));
}


// ============================================================
// COMMAND HELPERS
// ============================================================

async function handleRemoveRank(message) {
    if (message.guild.ownerId !== message.author.id) {
        return deny(message);
    }

    const target = message.mentions.members.first();

    if (!target) {
        return usage(message, "-removerank @user");
    }

    if (target.id === message.guild.ownerId) {
        return safeReply(
            message,
            panel("Remove Rank", "The server owner is always Founder.")
        );
    }

    if (!ranks[message.guild.id]) {
        ranks[message.guild.id] = {};
    }

    const oldRank = ranks[message.guild.id][target.id] || "member";
    delete ranks[message.guild.id][target.id];
    saveJSON(RANK_FILE, ranks);

    return safeReply(
        message,
        panel(
            "Remove Rank",
            `${target} has been removed from the VC+ rank **${RANK_DISPLAY[oldRank] || "Member"}** and returned to **Member**.`
        )
    );
}

async function clearVouchRoleFromMember(member, role, reason) {
    if (!role || !member?.roles?.cache?.has(role.id)) return false;

    try {
        await member.roles.remove(role, reason);
        return true;
    } catch (error) {
        console.error("[VC+] Failed to remove vouch role:", error);
        return false;
    }
}


// ============================================================
// PING
// ============================================================

async function handlePing(message) {
    const sent = await safeReply(message, "```VC+\nPinging...\n```\n");

    if (!sent) return;

    const latency = sent.createdTimestamp - message.createdTimestamp;

    await safeEdit(
        sent,
        `\`\`\`VC+\nLatency: ${latency}ms\nAPI: ${Math.round(client.ws.ping)}ms\n\`\`\``
    );
}


// ============================================================
// MESSAGE COMMAND ROUTER
// ============================================================

client.on("messageCreate", async message => {
    try {
        if (message.author.bot || !message.guild) return;

        if (!message.content.startsWith(PREFIX)) return;

        const raw = message.content.slice(PREFIX.length).trim();
        if (!raw) return;

        const parts = raw.split(/\s+/);
        const command = parts.shift()?.toLowerCase();
        const args = parts;

        if (!command) return;

        if (command === "help") {
            return handleHelp(message, args);
        }

        if (command === "ping") {
            return handlePing(message);
        }

        if (command === "removerank") {
            return handleRemoveRank(message);
        }

        // Existing VC+ commands continue below this point.
        // Keep your existing command handlers here if this file contains
        // additional command implementations in your local version.
    } catch (error) {
        console.error("[COMMAND ERROR]", error);

        await safeReply(
            message,
            "```VC+\nAn error occurred while processing that command.\n```"
        );
    }
});


// ============================================================
// ERROR PROTECTION
// ============================================================

client.on("error", error => {
    console.error("[CLIENT ERROR]", error);
});

client.on("warn", warning => {
    console.warn("[CLIENT WARN]", warning);
});

process.on("unhandledRejection", error => {
    console.error("[UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", error => {
    console.error("[UNCAUGHT EXCEPTION]", error);
});


// ============================================================
// LOGIN
// ============================================================

if (!process.env.TOKEN) {
    console.error("[VC+] TOKEN is missing from the environment.");
} else {
    client.login(process.env.TOKEN).catch(error => {
        console.error("[LOGIN ERROR]", error);
    });
}
