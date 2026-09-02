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
    AuditLogEvent,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const PREFIX = "-";

const DATA_DIR = "./data";
const RANKS_FILE = `${DATA_DIR}/ranks.json`;
const CONFIG_FILE = `${DATA_DIR}/config.json`;
const FOREVER_BANS_FILE = `${DATA_DIR}/foreverbans.json`;

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 4));
            return fallback;
        }

        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        console.error(`[JSON LOAD ERROR] ${file}`, error);

        try {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 4));
        } catch {}

        return fallback;
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 4));
    } catch (error) {
        console.error(`[JSON SAVE ERROR] ${file}`, error);
    }
}

const ranks = loadJSON(RANKS_FILE, {});
const configs = loadJSON(CONFIG_FILE, {});
const foreverBans = loadJSON(FOREVER_BANS_FILE, {});

/* =========================================================
   DISCORD CLIENT
========================================================= */

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

/* =========================================================
   RANK SYSTEM
========================================================= */

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

const RANK_NAMES = {
    10: "Founder",
    9: "God",
    8: "Owner",
    7: "Co-Owner",
    6: "Executive",
    5: "Director",
    4: "Admin",
    3: "Moderator",
    2: "Staff",
    1: "Member"
};

function getStoredRank(member) {
    if (!member) return "member";

    if (member.guild && member.id === member.guild.ownerId) {
        return "founder";
    }

    return ranks[member.guild.id]?.[member.id]?.toLowerCase() || "member";
}

function getRankLevel(member) {
    return RANKS[getStoredRank(member)] || 1;
}

function getRankName(member) {
    return RANK_NAMES[getRankLevel(member)] || "Member";
}

function hasRank(member, required) {
    return getRankLevel(member) >= (RANKS[required] || 1);
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGod(member) {
    return getRankLevel(member) >= RANKS.god;
}

function isGodmode(member) {
    const config = getGuildConfig(member.guild.id);

    return (
        config.godmode?.includes(member.id) ||
        isFounder(member) ||
        isGod(member)
    );
}

function hasGodAccess(member) {
    return isFounder(member) || isGod(member) || isGodmode(member);
}

function canModerate(member) {
    return hasRank(member, "moderator");
}

function canManageServer(member) {
    return hasRank(member, "admin");
}

function canManageVouches(member) {
    return isFounder(member);
}

/* =========================================================
   GUILD CONFIG
========================================================= */

function getGuildConfig(guildId) {
    if (!configs[guildId]) {
        configs[guildId] = {};
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

/* =========================================================
   SAFE FUNCTIONS
========================================================= */

async function safeReply(message, content) {
    try {
        if (!message || !message.channel) return null;

        return await message.reply({
            content,
            allowedMentions: {
                parse: []
            }
        });
    } catch (error) {
        console.error("[REPLY ERROR]", error);
        return null;
    }
}

async function safeDelete(message) {
    try {
        if (message?.deletable) {
            await message.delete();
        }
    } catch {}
}

async function safeDM(user, content) {
    try {
        await user.send(content);
    } catch {}
}

async function safeEdit(message, data) {
    try {
        return await message.edit(data);
    } catch (error) {
        console.error("[EDIT ERROR]", error);
        return null;
    }
}

function panel(title, description) {
    return new EmbedBuilder()
        .setTitle(`VC+ | ${title}`)
        .setDescription(description)
        .setFooter({
            text: "VC+"
        });
}

function deny(message) {
    return safeReply(
        message,
        "```VC+\nYou do not have permission to use this command.\n```"
    );
}

function usage(message, text) {
    return safeReply(
        message,
        `\`\`\`VC+\nUsage: ${text}\n\`\`\``
    );
}

/* =========================================================
   HELP
========================================================= */

const HELP_PAGES = [
    {
        name: "General",
        description: `
\`-help\`
Show the VC+ help menu.

\`-ping\`
Check bot response time.

\`-rank @user\`
View someone's VC+ rank.

\`-ranklist\`
View the VC+ rank hierarchy.
`
    },

    {
        name: "Moderation",
        description: `
\`-ban @user [reason]\`
Ban a member.

\`-unban USER_ID\`
Unban a user.

\`-unbanall\`
Unban all currently banned users.

\`-kick @user [reason]\`
Kick a member.

\`-timeout @user [duration] [reason]\`
Timeout a member.

\`-untimeout @user\`
Remove a timeout.

\`-foreverban @user [reason]\`
Permanently block a user from returning.

\`-unforeverban USER_ID\`
Remove a forever ban.

\`-purge amount\`
Delete messages.

\`-clear amount\`
Alias for purge.
`
    },

    {
        name: "Ranks",
        description: `
\`-rank @user founder\`
Assign Founder.

\`-rank @user god\`
Assign God.

\`-rank @user owner\`
Assign Owner.

\`-rank @user co-owner\`
Assign Co-Owner.

\`-rank @user executive\`
Assign Executive.

\`-rank @user director\`
Assign Director.

\`-rank @user admin\`
Assign Admin.

\`-rank @user moderator\`
Assign Moderator.

\`-rank @user staff\`
Assign Staff.

\`-rank @user member\`
Assign Member.

Only Founder can manage VC+ ranks.
`
    },

    {
        name: "Godmode",
        description: `
\`-godmode @user\`
Give a user Godmode.

\`-godmode remove @user\`
Remove Godmode.

Godmode provides elevated VC+ control.
`
    },

    {
        name: "Vouches",
        description: `
\`-vouch set role @Role\`
Set the role automatically given when someone is vouched.

\`-vouch role\`
View the configured vouch role.

\`-vouch give @user reason\`
Vouch a user and automatically give the configured role.

\`-vouch clear @user\`
Clear that user's vouch and remove the vouch role.

\`-vouch clear everyone\`
Clear every vouch and remove the vouch role from everyone who has it.

\`-vouch list\`
View stored vouches.

\`-vouches @user\`
View a user's vouches.
`
    },

    {
        name: "Filter",
        description: `
\`-filter add word\`
Add a filtered word.

\`-filter remove word\`
Remove a filtered word.

Messages containing filtered words are automatically removed.
`
    },

    {
        name: "Voice",
        description: `
\`-vc setup\`
Create the Join To Create system.

\`-vc kick @user\`
Kick someone from your VC.

\`-vc disconnect @user\`
Disconnect someone.

\`-vc ban @user\`
Ban someone from your VC.

\`-vc reject @user\`
Reject someone from your VC.

\`-vc permit @user\`
Permit someone to enter.

\`-vc lock\`
Lock the VC.

\`-vc unlock\`
Unlock the VC.

\`-vc limit number\`
Set the VC user limit.

\`-vc rename name\`
Rename your VC.

\`-vc transfer @user\`
Transfer ownership.

\`-vc claim\`
Claim an abandoned VC.

\`-vc forceclaim\`
Force claim a VC with elevated access.

\`-vc stfu @user\`
Server mute a user.

\`-vc unstfu @user\`
Remove server mute.

Every temporary VC receives its own control panel automatically.
`
    },

    {
        name: "Server Setup",
        description: `
\`-vc setup\`
Set up Join To Create.

\`-interface\`
Create the server-wide VC+ interface.

The interface controls the VC you are currently inside.
`
    }
];

async function sendHelp(message, page = 0) {
    const safePage = Math.max(
        0,
        Math.min(page, HELP_PAGES.length - 1)
    );

    const current = HELP_PAGES[safePage];

    const embed = panel(
        current.name,
        current.description
    );

    embed.setFooter({
        text: `VC+ Help • Page ${safePage + 1}/${HELP_PAGES.length}`
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`help_prev_${safePage}`)
            .setLabel("<")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId(`help_page_${safePage}`)
            .setLabel(`${safePage + 1}/${HELP_PAGES.length}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId(`help_next_${safePage}`)
            .setLabel(">")
            .setStyle(ButtonStyle.Secondary)
    );

    return safeReply(message, {
        embeds: [embed],
        components: [row]
    });
}

/* =========================================================
   RANK COMMAND
========================================================= */

async function handleRank(message, args) {
    if (!args[0]) {
        return safeReply(
            message,
            `\`\`\`VC+\nYour Rank: ${getRankName(message.member)}\nLevel: ${getRankLevel(message.member)}\n\`\`\``
        );
    }

    const target = message.mentions.members.first();

    if (!target) {
        return usage(message, "-rank @user [rank]");
    }

    if (!args[1]) {
        return safeReply(
            message,
            `\`\`\`VC+\n${target.user.tag}\nRank: ${getRankName(target)}\nLevel: ${getRankLevel(target)}\n\`\`\``
        );
    }

    if (!isFounder(message.member)) {
        return deny(message);
    }

    const rankName = args[1].toLowerCase();

    if (!RANKS[rankName]) {
        return safeReply(
            message,
            "```VC+\nThat rank does not exist.\n```"
        );
    }

    ranks[message.guild.id] ??= {};

    ranks[message.guild.id][target.id] = rankName;

    saveJSON(RANKS_FILE, ranks);

    return safeReply(
        message,
        `\`\`\`VC+\n${target.user.tag} is now ${RANK_NAMES[RANKS[rankName]]}.\n\`\`\``
    );
}

async function handleRankList(message) {
    return safeReply(
        message,
        `\`\`\`VC+\nFounder 10\nGod 9\nOwner 8\nCo-Owner 7\nExecutive 6\nDirector 5\nAdmin 4\nModerator 3\nStaff 2\nMember 1\n\`\`\``
    );
}

/* =========================================================
   GODMODE
========================================================= */

async function handleGodmode(message, args) {
    if (!isFounder(message.member)) {
        return deny(message);
    }

    const config = getGuildConfig(message.guild.id);

    if (args[0]?.toLowerCase() === "remove") {
        const target = message.mentions.members.first();

        if (!target) {
            return usage(message, "-godmode remove @user");
        }

        config.godmode = config.godmode.filter(
            id => id !== target.id
        );

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nGodmode removed from ${target.user.tag}.\n\`\`\``
        );
    }

    const target = message.mentions.members.first();

    if (!target) {
        return usage(message, "-godmode @user");
    }

    if (!config.godmode.includes(target.id)) {
        config.godmode.push(target.id);
    }

    saveJSON(CONFIG_FILE, configs);

    return safeReply(
        message,
        `\`\`\`VC+\nGodmode granted to ${target.user.tag}.\n\`\`\``
    );
}

/* =========================================================
   VOUCH SYSTEM
========================================================= */

async function handleVouch(message, args) {
    const config = getGuildConfig(message.guild.id);

    const sub = args[0]?.toLowerCase();

    /* -----------------------------------------------------
       SET ROLE
       -vouch set role @Role
    ----------------------------------------------------- */

    if (
        sub === "set" &&
        args[1]?.toLowerCase() === "role"
    ) {
        if (!canManageVouches(message.member)) {
            return deny(message);
        }

        const role = message.mentions.roles.first();

        if (!role) {
            return usage(message, "-vouch set role @Role");
        }

        if (role.managed) {
            return safeReply(
                message,
                "```VC+\nThat role is managed and cannot be assigned by the bot.\n```"
            );
        }

        const botMember =
            message.guild.members.me ||
            await message.guild.members.fetchMe().catch(() => null);

        if (!botMember) {
            return safeReply(
                message,
                "```VC+\nI could not verify my role hierarchy.\n```"
            );
        }

        if (
            role.position >=
            botMember.roles.highest.position
        ) {
            return safeReply(
                message,
                "```VC+\nThat role must be below my highest role.\n```"
            );
        }

        config.vouchRole = role.id;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nVouch role set to ${role.name}.\n\`\`\``
        );
    }

    /* -----------------------------------------------------
       VIEW ROLE
       -vouch role
    ----------------------------------------------------- */

    if (sub === "role") {
        const role = config.vouchRole
            ? message.guild.roles.cache.get(config.vouchRole)
            : null;

        return safeReply(
            message,
            `\`\`\`VC+\nVouch Role: ${role ? role.name : "Not configured"}\n\`\`\``
        );
    }

    /* -----------------------------------------------------
       GIVE VOUCH
       -vouch give @user reason
    ----------------------------------------------------- */

    if (sub === "give") {
        if (!canManageVouches(message.member)) {
            return deny(message);
        }

        const target = message.mentions.members.first();

        if (!target) {
            return usage(
                message,
                "-vouch give @user reason"
            );
        }

        const reason = args
            .slice(2)
            .join(" ")
            .trim();

        if (!reason) {
            return usage(
                message,
                "-vouch give @user reason"
            );
        }

        config.vouches[target.id] ??= [];

        config.vouches[target.id].push({
            reason,
            giver: message.author.id,
            timestamp: Date.now()
        });

        let roleMessage =
            "The configured vouch role could not be assigned.";

        if (config.vouchRole) {
            const role =
                message.guild.roles.cache.get(
                    config.vouchRole
                );

            const botMember =
                message.guild.members.me ||
                await message.guild.members.fetchMe().catch(() => null);

            if (
                role &&
                !role.managed &&
                botMember &&
                role.position < botMember.roles.highest.position
            ) {
                try {
                    if (!target.roles.cache.has(role.id)) {
                        await target.roles.add(
                            role,
                            `Vouch by ${message.author.tag}`
                        );
                    }

                    roleMessage =
                        `Role assigned: ${role.name}`;
                } catch (error) {
                    console.error(
                        "[VOUCH ROLE ERROR]",
                        error
                    );
                }
            }
        } else {
            roleMessage =
                "No vouch role has been configured.";
        }

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nVouch added to ${target.user.tag}.\nReason: ${reason}\n${roleMessage}\n\`\`\``
        );
    }

    /* -----------------------------------------------------
       CLEAR USER
       -vouch clear @user
    ----------------------------------------------------- */

    if (sub === "clear") {
        if (!canManageVouches(message.member)) {
            return deny(message);
        }

        const target = message.mentions.members.first();

        /* -----------------------------------------------
           CLEAR EVERYONE
           -vouch clear everyone
        ----------------------------------------------- */

        if (
            args[1]?.toLowerCase() === "everyone"
        ) {
            const vouchRole = config.vouchRole
                ? message.guild.roles.cache.get(
                    config.vouchRole
                )
                : null;

            let removedVouches = 0;
            let removedRoles = 0;

            for (const userId of Object.keys(config.vouches)) {
                removedVouches +=
                    config.vouches[userId]?.length || 0;
            }

            config.vouches = {};

            if (vouchRole) {
                const members = await message.guild.members
                    .fetch()
                    .catch(() => null);

                if (members) {
                    for (const member of members.values()) {
                        if (
                            member.roles.cache.has(
                                vouchRole.id
                            )
                        ) {
                            try {
                                await member.roles.remove(
                                    vouchRole,
                                    "VC+ vouch clear everyone"
                                );

                                removedRoles++;
                            } catch (error) {
                                console.error(
                                    `[VOUCH ROLE REMOVE ERROR] ${member.id}`,
                                    error
                                );
                            }
                        }
                    }
                }
            }

            saveJSON(CONFIG_FILE, configs);

            return safeReply(
                message,
                `\`\`\`VC+\nCleared everyone.\nVouches removed: ${removedVouches}\nVouch roles removed: ${removedRoles}\n\`\`\``
            );
        }

        /* -----------------------------------------------
           CLEAR SPECIFIC USER
           -vouch clear @user
        ----------------------------------------------- */

        if (!target) {
            return usage(
                message,
                "-vouch clear @user OR -vouch clear everyone"
            );
        }

        const existed =
            Array.isArray(config.vouches[target.id]) &&
            config.vouches[target.id].length > 0;

        delete config.vouches[target.id];

        let roleRemoved = false;

        if (config.vouchRole) {
            const role =
                message.guild.roles.cache.get(
                    config.vouchRole
                );

            if (
                role &&
                target.roles.cache.has(role.id)
            ) {
                try {
                    await target.roles.remove(
                        role,
                        `VC+ vouch cleared by ${message.author.tag}`
                    );

                    roleRemoved = true;
                } catch (error) {
                    console.error(
                        "[VOUCH CLEAR ROLE ERROR]",
                        error
                    );
                }
            }
        }

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nVouch cleared from ${target.user.tag}.\nStored vouch existed: ${existed ? "Yes" : "No"}\nVouch role removed: ${roleRemoved ? "Yes" : "No"}\n\`\`\``
        );
    }

    /* -----------------------------------------------------
       LIST
       -vouch list
    ----------------------------------------------------- */

    if (sub === "list") {
        return sendVouchList(message);
    }

    return usage(
        message,
        "-vouch set role @Role\n-vouch role\n-vouch give @user reason\n-vouch clear @user\n-vouch clear everyone\n-vouch list"
    );
}

async function sendVouchList(message) {
    const config = getGuildConfig(message.guild.id);

    const entries = Object.entries(
        config.vouches || {}
    );

    if (!entries.length) {
        return safeReply(
            message,
            "```VC+\nThere are no stored vouches.\n```"
        );
    }

    let output = "";

    for (const [userId, vouches] of entries) {
        const member =
            message.guild.members.cache.get(userId);

        const name =
            member?.user.tag || userId;

        output += `${name}: ${vouches.length} vouch(es)\n`;
    }

    if (output.length > 3900) {
        output = output.slice(0, 3890) + "\n...";
    }

    return safeReply(
        message,
        {
            embeds: [
                panel(
                    "VOUCHES",
                    output
                )
            ]
        }
    );
}

async function handleVouches(message, args) {
    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-vouches @user"
        );
    }

    const config =
        getGuildConfig(message.guild.id);

    const vouches =
        config.vouches[target.id] || [];

    if (!vouches.length) {
        return safeReply(
            message,
            `\`\`\`VC+\n${target.user.tag} has no vouches.\n\`\`\``
        );
    }

    let output = "";

    for (let i = 0; i < vouches.length; i++) {
        const vouch = vouches[i];

        output += `${i + 1}. ${vouch.reason}\n`;
    }

    return safeReply(
        message,
        {
            embeds: [
                panel(
                    `VOUCHES | ${target.user.tag}`,
                    output
                )
            ]
        }
    );
}

/* =========================================================
   FILTER
========================================================= */

async function checkFilter(message) {
    if (!message.guild || message.author.bot) {
        return false;
    }

    const config =
        getGuildConfig(message.guild.id);

    if (!config.filter.length) {
        return false;
    }

    if (
        message.member &&
        getRankLevel(message.member) >= RANKS.staff
    ) {
        return false;
    }

    const content =
        message.content.toLowerCase();

    const matched =
        config.filter.find(word =>
            content.includes(word.toLowerCase())
        );

    if (!matched) {
        return false;
    }

    await safeDelete(message);

    await safeReply(
        message,
        "```VC+\nThat message was removed by the server filter.\n```"
    );

    return true;
}

async function handleFilter(message, args) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const config =
        getGuildConfig(message.guild.id);

    const sub =
        args[0]?.toLowerCase();

    const word =
        args.slice(1).join(" ").trim().toLowerCase();

    if (sub === "add") {
        if (!word) {
            return usage(
                message,
                "-filter add word"
            );
        }

        if (!config.filter.includes(word)) {
            config.filter.push(word);
        }

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nFilter added: ${word}\n\`\`\``
        );
    }

    if (sub === "remove") {
        if (!word) {
            return usage(
                message,
                "-filter remove word"
            );
        }

        config.filter =
            config.filter.filter(
                x => x !== word
            );

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nFilter removed: ${word}\n\`\`\``
        );
    }

    return usage(
        message,
        "-filter add word\n-filter remove word"
    );
}

/* =========================================================
   VC HELPERS
========================================================= */

function isTemporaryVC(config, channelId) {
    return config.temporaryChannels.includes(
        channelId
    );
}

function canControlVC(member, channel) {
    if (!member || !channel) {
        return false;
    }

    const config =
        getGuildConfig(member.guild.id);

    const ownerId =
        config.voice.owners[channel.id];

    return (
        ownerId === member.id ||
        hasGodAccess(member)
    );
}

function getCurrentVC(member) {
    if (!member?.voice?.channel) {
        return null;
    }

    return member.voice.channel;
}

/* =========================================================
   AUTOMATIC VC CONTROL PANEL
========================================================= */

async function sendVCControlPanel(channel, owner) {
    try {
        const row1 =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vc_control_lock")
                    .setLabel("Lock")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_unlock")
                    .setLabel("Unlock")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_claim")
                    .setLabel("Claim")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_limit")
                    .setLabel("Limit")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_rename")
                    .setLabel("Rename")
                    .setStyle(ButtonStyle.Secondary)
            );

        const row2 =
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("vc_control_transfer")
                    .setLabel("Transfer")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_kick")
                    .setLabel("Kick")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_ban")
                    .setLabel("Ban")
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("vc_control_permit")
                    .setLabel("Permit")
                    .setStyle(ButtonStyle.Secondary)
            );

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("VC+ | VOICE CONTROL")
                    .setDescription(
                        `This is the start of **${owner.displayName}'s VC channel.**

Owner: ${owner}

Use the controls below to manage this temporary voice channel.

You can also use the \`-vc\` commands.`
                    )
            ],
            components: [
                row1,
                row2
            ]
        });
    } catch (error) {
        console.error(
            "[VC CONTROL PANEL ERROR]",
            error
        );
    }
}

/* =========================================================
   VC SETUP
========================================================= */

async function handleVCSetup(message) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const config =
        getGuildConfig(message.guild.id);

    if (config.joinToCreate) {
        const existing =
            message.guild.channels.cache.get(
                config.joinToCreate
            );

        if (existing) {
            return safeReply(
                message,
                "```VC+\nJoin To Create is already configured.\n```"
            );
        }
    }

    const category =
        await message.guild.channels.create({
            name: "VC+",
            type: ChannelType.GuildCategory
        });

    const joinChannel =
        await message.guild.channels.create({
            name: "Join To Create",
            type: ChannelType.GuildVoice,
            parent: category.id
        });

    config.joinToCreate =
        joinChannel.id;

    saveJSON(CONFIG_FILE, configs);

    return safeReply(
        message,
        "```VC+\nJoin To Create has been set up.\n```"
    );
}

/* =========================================================
   VC COMMAND
========================================================= */

async function handleVC(message, args) {
    const sub =
        args[0]?.toLowerCase();

    if (sub === "setup") {
        return handleVCSetup(message);
    }

    const channel =
        getCurrentVC(message.member);

    if (!channel) {
        return safeReply(
            message,
            "```VC+\nYou must be inside a voice channel.\n```"
        );
    }

    const config =
        getGuildConfig(message.guild.id);

    if (
        !isTemporaryVC(
            config,
            channel.id
        )
    ) {
        return safeReply(
            message,
            "```VC+\nThis is not a VC+ temporary voice channel.\n```"
        );
    }

    if (sub === "claim") {
        if (
            config.voice.owners[channel.id]
        ) {
            return safeReply(
                message,
                "```VC+\nThis VC already has an owner.\n```"
            );
        }

        config.voice.owners[channel.id] =
            message.author.id;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            "```VC+\nYou claimed this VC.\n```"
        );
    }

    if (sub === "forceclaim") {
        if (!hasGodAccess(message.member)) {
            return deny(message);
        }

        config.voice.owners[channel.id] =
            message.author.id;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            "```VC+\nYou force claimed this VC.\n```"
        );
    }

    if (
        !canControlVC(
            message.member,
            channel
        )
    ) {
        return deny(message);
    }

    if (sub === "lock") {
        const ownerId =
            config.voice.owners[channel.id];

        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: false
            }
        );

        if (ownerId) {
            await channel.permissionOverwrites.edit(
                ownerId,
                {
                    Connect: true
                }
            );
        }

        config.voice.locked[channel.id] =
            true;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            "```VC+\nVC locked.\n```"
        );
    }

    if (sub === "unlock") {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: null
            }
        );

        config.voice.locked[channel.id] =
            false;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            "```VC+\nVC unlocked.\n```"
        );
    }

    if (sub === "limit") {
        const limit =
            Number(args[1]);

        if (
            Number.isNaN(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return usage(
                message,
                "-vc limit 0-99"
            );
        }

        await channel.setUserLimit(limit);

        config.voice.limits[channel.id] =
            limit;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nUser limit set to ${limit}.\n\`\`\``
        );
    }

    if (sub === "rename") {
        const name =
            args.slice(1).join(" ").trim();

        if (!name) {
            return usage(
                message,
                "-vc rename name"
            );
        }

        await channel.setName(name);

        return safeReply(
            message,
            `\`\`\`VC+\nVC renamed to ${name}.\n\`\`\``
        );
    }

    if (
        sub === "kick" ||
        sub === "disconnect" ||
        sub === "ban" ||
        sub === "reject" ||
        sub === "permit"
    ) {
        const target =
            message.mentions.members.first();

        if (!target) {
            return usage(
                message,
                `-vc ${sub} @user`
            );
        }

        if (sub === "kick" || sub === "disconnect") {
            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice.disconnect(
                    `VC+ ${sub} by ${message.author.tag}`
                );
            }

            return safeReply(
                message,
                `\`\`\`VC+\n${target.user.tag} disconnected.\n\`\`\``
            );
        }

        if (
            sub === "ban" ||
            sub === "reject"
        ) {
            config.voice.banned[channel.id] ??= [];

            if (
                !config.voice.banned[channel.id]
                    .includes(target.id)
            ) {
                config.voice.banned[channel.id]
                    .push(target.id);
            }

            config.voice.permitted[channel.id] =
                (
                    config.voice.permitted[channel.id] ||
                    []
                ).filter(
                    id => id !== target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: false
                }
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice.disconnect(
                    "VC+ voice restriction"
                ).catch(() => {});
            }

            saveJSON(CONFIG_FILE, configs);

            return safeReply(
                message,
                `\`\`\`VC+\n${target.user.tag} is blocked from this VC.\n\`\`\``
            );
        }

        if (sub === "permit") {
            config.voice.permitted[channel.id] ??= [];

            if (
                !config.voice.permitted[channel.id]
                    .includes(target.id)
            ) {
                config.voice.permitted[channel.id]
                    .push(target.id);
            }

            config.voice.banned[channel.id] =
                (
                    config.voice.banned[channel.id] ||
                    []
                ).filter(
                    id => id !== target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: true
                }
            );

            saveJSON(CONFIG_FILE, configs);

            return safeReply(
                message,
                `\`\`\`VC+\n${target.user.tag} is permitted in this VC.\n\`\`\``
            );
        }
    }

    if (sub === "transfer") {
        const target =
            message.mentions.members.first();

        if (!target) {
            return usage(
                message,
                "-vc transfer @user"
            );
        }

        config.voice.owners[channel.id] =
            target.id;

        saveJSON(CONFIG_FILE, configs);

        return safeReply(
            message,
            `\`\`\`VC+\nVC ownership transferred to ${target.user.tag}.\n\`\`\``
        );
    }

    if (sub === "stfu") {
        if (!hasGodAccess(message.member)) {
            return deny(message);
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return usage(
                message,
                "-vc stfu @user"
            );
        }

        await target.voice.setMute(
            true,
            "VC+ STFU"
        );

        return safeReply(
            message,
            `\`\`\`VC+\n${target.user.tag} has been server muted.\n\`\`\``
        );
    }

    if (sub === "unstfu") {
        if (!hasGodAccess(message.member)) {
            return deny(message);
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return usage(
                message,
                "-vc unstfu @user"
            );
        }

        await target.voice.setMute(
            false,
            "VC+ UNSTFU"
        );

        return safeReply(
            message,
            `\`\`\`VC+\n${target.user.tag} has been unmuted.\n\`\`\``
        );
    }

    return usage(
        message,
        "-vc setup\n-vc lock\n-vc unlock\n-vc claim\n-vc forceclaim\n-vc limit 0-99\n-vc rename name\n-vc transfer @user\n-vc kick @user\n-vc disconnect @user\n-vc ban @user\n-vc reject @user\n-vc permit @user\n-vc stfu @user\n-vc unstfu @user"
    );
}

/* =========================================================
   SERVER-WIDE INTERFACE
========================================================= */

async function handleInterface(message) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const config =
        getGuildConfig(message.guild.id);

    let channel = null;

    if (config.interfaceChannel) {
        channel =
            message.guild.channels.cache.get(
                config.interfaceChannel
            );
    }

    if (
        !channel ||
        channel.type !== ChannelType.GuildText
    ) {
        channel =
            await message.guild.channels.create({
                name: "vc-interface",
                type: ChannelType.GuildText
            });
    }

    const row1 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_interface_lock")
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_interface_unlock")
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_interface_claim")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Secondary)
        );

    const row2 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_interface_limit")
                .setLabel("Limit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_interface_rename")
                .setLabel("Rename")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_interface_transfer")
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Secondary)
        );

    const sent =
        await channel.send({
            embeds: [
                panel(
                    "VOICE INTERFACE",
                    `Use these controls to manage your current VC.

You must be inside a VC+ temporary voice channel to use the controls.

You can also use the \`-vc\` commands.`
                )
            ],
            components: [
                row1,
                row2
            ]
        });

    config.interfaceChannel =
        channel.id;

    config.interfaceMessage =
        sent.id;

    saveJSON(CONFIG_FILE, configs);

    return safeReply(
        message,
        `\`\`\`VC+\nInterface created in #${channel.name}.\n\`\`\``
    );
}

/* =========================================================
   MODERATION
========================================================= */

async function handleBan(message, args) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-ban @user [reason]"
        );
    }

    if (
        target.id === message.author.id
    ) {
        return safeReply(
            message,
            "```VC+\nYou cannot ban yourself.\n```"
        );
    }

    if (
        target.roles.highest.position >=
        message.member.roles.highest.position &&
        !isFounder(message.member)
    ) {
        return safeReply(
            message,
            "```VC+\nYou cannot moderate someone at or above your rank.\n```"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    await target.ban({
        reason
    });

    return safeReply(
        message,
        `\`\`\`VC+\nBanned ${target.user.tag}\nReason: ${reason}\n\`\`\``
    );
}

async function handleKick(message, args) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-kick @user [reason]"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    await target.kick(reason);

    return safeReply(
        message,
        `\`\`\`VC+\nKicked ${target.user.tag}\nReason: ${reason}\n\`\`\``
    );
}

function parseDuration(input) {
    if (!input) return null;

    const match =
        input.match(
            /^(\d+)(s|m|h|d)$/i
        );

    if (!match) return null;

    const amount =
        Number(match[1]);

    const unit =
        match[2].toLowerCase();

    const multipliers = {
        s: 1000,
        m: 60000,
        h: 3600000,
        d: 86400000
    };

    return amount * multipliers[unit];
}

async function handleTimeout(message, args) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-timeout @user 10m [reason]"
        );
    }

    const duration =
        parseDuration(args[1]);

    if (
        !duration ||
        duration > 28 * 86400000
    ) {
        return safeReply(
            message,
            "```VC+\nDuration must be between 1s and 28d.\n```"
        );
    }

    const reason =
        args.slice(2).join(" ") ||
        "No reason provided";

    await target.timeout(
        duration,
        reason
    );

    return safeReply(
        message,
        `\`\`\`VC+\nTimed out ${target.user.tag}\nDuration: ${args[1]}\nReason: ${reason}\n\`\`\``
    );
}

async function handleUntimeout(message) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-untimeout @user"
        );
    }

    await target.timeout(
        null,
        "VC+ timeout removed"
    );

    return safeReply(
        message,
        `\`\`\`VC+\nTimeout removed from ${target.user.tag}.\n\`\`\``
    );
}

async function handleUnban(message, args) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const userId =
        args[0];

    if (!userId) {
        return usage(
            message,
            "-unban USER_ID"
        );
    }

    await message.guild.members.unban(
        userId
    );

    return safeReply(
        message,
        `\`\`\`VC+\nUnbanned ${userId}.\n\`\`\``
    );
}

async function handleUnbanAll(message) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const bans =
        await message.guild.bans.fetch();

    let count = 0;

    for (const ban of bans.values()) {
        try {
            await message.guild.members.unban(
                ban.user.id,
                "VC+ unbanall"
            );

            count++;

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        250
                    )
            );
        } catch (error) {
            console.error(
                "[UNBANALL ERROR]",
                error
            );
        }
    }

    return safeReply(
        message,
        `\`\`\`VC+\nUnbanned ${count} users.\n\`\`\``
    );
}

/* =========================================================
   FOREVER BAN
========================================================= */

async function handleForeverBan(message, args) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const target =
        message.mentions.members.first();

    if (!target) {
        return usage(
            message,
            "-foreverban @user [reason]"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    foreverBans[target.id] = {
        reason,
        moderator: message.author.id,
        timestamp: Date.now()
    };

    saveJSON(
        FOREVER_BANS_FILE,
        foreverBans
    );

    await target.ban({
        reason: `Forever ban: ${reason}`
    });

    return safeReply(
        message,
        `\`\`\`VC+\nForever banned ${target.user.tag}\nReason: ${reason}\n\`\`\``
    );
}

async function handleUnForeverBan(message, args) {
    if (!canManageServer(message.member)) {
        return deny(message);
    }

    const userId =
        args[0];

    if (!userId) {
        return usage(
            message,
            "-unforeverban USER_ID"
        );
    }

    delete foreverBans[userId];

    saveJSON(
        FOREVER_BANS_FILE,
        foreverBans
    );

    return safeReply(
        message,
        `\`\`\`VC+\nForever ban removed from ${userId}.\n\`\`\``
    );
}

/* =========================================================
   PURGE
========================================================= */

async function handlePurge(message, args) {
    if (!canModerate(message.member)) {
        return deny(message);
    }

    const amount =
        Number(args[0]);

    if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100
    ) {
        return usage(
            message,
            "-purge 1-100"
        );
    }

    const deleted =
        await message.channel.bulkDelete(
            amount,
            true
        );

    return safeReply(
        message,
        `\`\`\`VC+\nDeleted ${deleted.size} messages.\n\`\`\``
    );
}

/* =========================================================
   JOIN TO CREATE
========================================================= */

async function handleJoinToCreate(
    oldState,
    newState
) {
    try {
        const member =
            newState.member;

        if (!member) return;

        const config =
            getGuildConfig(
                newState.guild.id
            );

        /* -----------------------------------------------
           USER ENTERED JOIN TO CREATE
        ----------------------------------------------- */

        if (
            newState.channelId ===
            config.joinToCreate
        ) {
            const category =
                newState.channel?.parentId ||
                null;

            const channel =
                await newState.guild.channels.create({
                    name: `${member.displayName}'s VC`,
                    type: ChannelType.GuildVoice,
                    parent: category
                });

            config.temporaryChannels.push(
                channel.id
            );

            config.voice.owners[channel.id] =
                member.id;

            config.voice.banned[channel.id] =
                [];

            config.voice.permitted[channel.id] =
                [];

            config.voice.locked[channel.id] =
                false;

            saveJSON(
                CONFIG_FILE,
                configs
            );

            await member.voice.setChannel(
                channel
            );

            await sendVCControlPanel(
                channel,
                member
            );
        }

        /* -----------------------------------------------
           ENFORCE VC BANS
        ----------------------------------------------- */

        if (
            newState.channelId &&
            isTemporaryVC(
                config,
                newState.channelId
            )
        ) {
            const banned =
                config.voice.banned[
                    newState.channelId
                ] || [];

            if (banned.includes(member.id)) {
                await member.voice.disconnect(
                    "VC+ voice ban"
                ).catch(() => {});
            }
        }

        /* -----------------------------------------------
           DELETE EMPTY TEMP VC
        ----------------------------------------------- */

        if (
            oldState.channelId &&
            isTemporaryVC(
                config,
                oldState.channelId
            )
        ) {
            const oldChannel =
                oldState.guild.channels.cache.get(
                    oldState.channelId
                );

            if (
                oldChannel &&
                oldChannel.members.size === 0
            ) {
                delete config.voice.owners[
                    oldChannel.id
                ];

                delete config.voice.banned[
                    oldChannel.id
                ];

                delete config.voice.permitted[
                    oldChannel.id
                ];

                delete config.voice.locked[
                    oldChannel.id
                ];

                delete config.voice.limits[
                    oldChannel.id
                ];

                config.temporaryChannels =
                    config.temporaryChannels.filter(
                        id =>
                            id !==
                            oldChannel.id
                    );

                saveJSON(
                    CONFIG_FILE,
                    configs
                );

                await oldChannel.delete(
                    "VC+ temporary VC empty"
                ).catch(() => {});
            }
        }
    } catch (error) {
        console.error(
            "[JOIN TO CREATE ERROR]",
            error
        );
    }
}

/* =========================================================
   BUTTON HELPERS
========================================================= */

async function getInteractionVC(interaction) {
    const member =
        interaction.member;

    const channel =
        member?.voice?.channel;

    if (!channel) {
        await interaction.reply({
            content:
                "VC+ requires you to be inside a temporary VC.",
            ephemeral: true
        });

        return null;
    }

    const config =
        getGuildConfig(
            interaction.guild.id
        );

    if (
        !isTemporaryVC(
            config,
            channel.id
        )
    ) {
        await interaction.reply({
            content:
                "This is not a VC+ temporary voice channel.",
            ephemeral: true
        });

        return null;
    }

    return channel;
}

async function performVCInterfaceAction(
    interaction,
    action
) {
    const channel =
        await getInteractionVC(
            interaction
        );

    if (!channel) return;

    const config =
        getGuildConfig(
            interaction.guild.id
        );

    if (
        action !== "claim" &&
        !canControlVC(
            interaction.member,
            channel
        )
    ) {
        return interaction.reply({
            content:
                "You do not have permission to control this VC.",
            ephemeral: true
        });
    }

    if (action === "claim") {
        if (config.voice.owners[channel.id]) {
            return interaction.reply({
                content:
                    "This VC already has an owner.",
                ephemeral: true
            });
        }

        config.voice.owners[channel.id] =
            interaction.member.id;

        saveJSON(CONFIG_FILE, configs);

        return interaction.reply({
            content:
                "VC claimed.",
            ephemeral: true
        });
    }

    if (action === "lock") {
        const ownerId =
            config.voice.owners[channel.id];

        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
                Connect: false
            }
        );

        if (ownerId) {
            await channel.permissionOverwrites.edit(
                ownerId,
                {
                    Connect: true
                }
            );
        }

        config.voice.locked[channel.id] =
            true;

        saveJSON(CONFIG_FILE, configs);

        return interaction.reply({
            content:
                "VC locked.",
            ephemeral: true
        });
    }

    if (action === "unlock") {
        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
                Connect: null
            }
        );

        config.voice.locked[channel.id] =
            false;

        saveJSON(CONFIG_FILE, configs);

        return interaction.reply({
            content:
                "VC unlocked.",
            ephemeral: true
        });
    }

    if (action === "limit") {
        const modal =
            new ModalBuilder()
                .setCustomId(
                    "vc_modal_limit"
                )
                .setTitle(
                    "VC+ | Set Limit"
                );

        const input =
            new TextInputBuilder()
                .setCustomId("limit")
                .setLabel(
                    "User limit (0-99)"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(2);

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );

        return interaction.showModal(
            modal
        );
    }

    if (action === "rename") {
        const modal =
            new ModalBuilder()
                .setCustomId(
                    "vc_modal_rename"
                )
                .setTitle(
                    "VC+ | Rename"
                );

        const input =
            new TextInputBuilder()
                .setCustomId("name")
                .setLabel(
                    "New VC name"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(100);

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );

        return interaction.showModal(
            modal
        );
    }

    if (action === "transfer") {
        const modal =
            new ModalBuilder()
                .setCustomId(
                    "vc_modal_transfer"
                )
                .setTitle(
                    "VC+ | Transfer"
                );

        const input =
            new TextInputBuilder()
                .setCustomId("user_id")
                .setLabel(
                    "User ID"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(25);

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );

        return interaction.showModal(
            modal
        );
    }

    if (
        action === "kick" ||
        action === "ban" ||
        action === "permit"
    ) {
        const modal =
            new ModalBuilder()
                .setCustomId(
                    `vc_modal_${action}`
                )
                .setTitle(
                    `VC+ | ${action}`
                );

        const input =
            new TextInputBuilder()
                .setCustomId("user_id")
                .setLabel(
                    "User ID"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(25);

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );

        return interaction.showModal(
            modal
        );
    }
}

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {
        try {
            /* ---------------------------------------------
               HELP BUTTONS
            --------------------------------------------- */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "help_"
                )
            ) {
                const parts =
                    interaction.customId.split("_");

                const type =
                    parts[1];

                const current =
                    Number(parts[2]);

                let page = current;

                if (type === "prev") {
                    page =
                        current - 1;

                    if (
                        page <
                        0
                    ) {
                        page =
                            HELP_PAGES.length - 1;
                    }
                }

                if (type === "next") {
                    page =
                        current + 1;

                    if (
                        page >=
                        HELP_PAGES.length
                    ) {
                        page = 0;
                    }
                }

                const currentPage =
                    HELP_PAGES[page];

                const embed =
                    panel(
                        currentPage.name,
                        currentPage.description
                    );

                embed.setFooter({
                    text:
                        `VC+ Help • Page ${page + 1}/${HELP_PAGES.length}`
                });

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `help_prev_${page}`
                                )
                                .setLabel("<")
                                .setStyle(
                                    ButtonStyle.Secondary
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    `help_page_${page}`
                                )
                                .setLabel(
                                    `${page + 1}/${HELP_PAGES.length}`
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                                .setDisabled(true),

                            new ButtonBuilder()
                                .setCustomId(
                                    `help_next_${page}`
                                )
                                .setLabel(">")
                                .setStyle(
                                    ButtonStyle.Secondary
                                )
                        );

                return interaction.update({
                    embeds: [embed],
                    components: [row]
                });
            }

            /* ---------------------------------------------
               VC BUTTONS
            --------------------------------------------- */

            if (
                interaction.isButton() &&
                (
                    interaction.customId.startsWith(
                        "vc_control_"
                    ) ||
                    interaction.customId.startsWith(
                        "vc_interface_"
                    )
                )
            ) {
                let action =
                    interaction.customId
                        .replace(
                            "vc_control_",
                            ""
                        )
                        .replace(
                            "vc_interface_",
                            ""
                        );

                return performVCInterfaceAction(
                    interaction,
                    action
                );
            }

            /* ---------------------------------------------
               VC MODALS
            --------------------------------------------- */

            if (
                interaction.isModalSubmit() &&
                interaction.customId.startsWith(
                    "vc_modal_"
                )
            ) {
                const action =
                    interaction.customId.replace(
                        "vc_modal_",
                        ""
                    );

                const channel =
                    await getInteractionVC(
                        interaction
                    );

                if (!channel) return;

                const config =
                    getGuildConfig(
                        interaction.guild.id
                    );

                if (
                    !canControlVC(
                        interaction.member,
                        channel
                    )
                ) {
                    return interaction.reply({
                        content:
                            "You do not have permission to control this VC.",
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   LIMIT
                ----------------------------------------- */

                if (action === "limit") {
                    const value =
                        Number(
                            interaction.fields.getTextInputValue(
                                "limit"
                            )
                        );

                    if (
                        Number.isNaN(value) ||
                        value < 0 ||
                        value > 99
                    ) {
                        return interaction.reply({
                            content:
                                "Limit must be between 0 and 99.",
                            ephemeral: true
                        });
                    }

                    await channel.setUserLimit(
                        value
                    );

                    config.voice.limits[
                        channel.id
                    ] = value;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({
                        content:
                            `VC limit set to ${value}.`,
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   RENAME
                ----------------------------------------- */

                if (action === "rename") {
                    const name =
                        interaction.fields.getTextInputValue(
                            "name"
                        ).trim();

                    if (!name) {
                        return interaction.reply({
                            content:
                                "Enter a valid VC name.",
                            ephemeral: true
                        });
                    }

                    await channel.setName(
                        name
                    );

                    return interaction.reply({
                        content:
                            `VC renamed to ${name}.`,
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   TRANSFER
                ----------------------------------------- */

                if (
                    action ===
                    "transfer"
                ) {
                    const userId =
                        interaction.fields.getTextInputValue(
                            "user_id"
                        ).trim();

                    const target =
                        await interaction.guild.members
                            .fetch(userId)
                            .catch(
                                () => null
                            );

                    if (!target) {
                        return interaction.reply({
                            content:
                                "That user could not be found.",
                            ephemeral: true
                        });
                    }

                    config.voice.owners[
                        channel.id
                    ] = target.id;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({
                        content:
                            `VC ownership transferred to ${target.user.tag}.`,
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   KICK
                ----------------------------------------- */

                if (
                    action ===
                    "kick"
                ) {
                    const userId =
                        interaction.fields.getTextInputValue(
                            "user_id"
                        ).trim();

                    const target =
                        await interaction.guild.members
                            .fetch(userId)
                            .catch(
                                () => null
                            );

                    if (!target) {
                        return interaction.reply({
                            content:
                                "That user could not be found.",
                            ephemeral: true
                        });
                    }

                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return interaction.reply({
                            content:
                                "That user is not in your VC.",
                            ephemeral: true
                        });
                    }

                    await target.voice.disconnect(
                        "VC+ panel kick"
                    );

                    return interaction.reply({
                        content:
                            `${target.user.tag} was kicked from the VC.`,
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   BAN
                ----------------------------------------- */

                if (
                    action ===
                    "ban"
                ) {
                    const userId =
                        interaction.fields.getTextInputValue(
                            "user_id"
                        ).trim();

                    const target =
                        await interaction.guild.members
                            .fetch(userId)
                            .catch(
                                () => null
                            );

                    if (!target) {
                        return interaction.reply({
                            content:
                                "That user could not be found.",
                            ephemeral: true
                        });
                    }

                    config.voice.banned[
                        channel.id
                    ] ??= [];

                    if (
                        !config.voice.banned[
                            channel.id
                        ].includes(
                            target.id
                        )
                    ) {
                        config.voice.banned[
                            channel.id
                        ].push(
                            target.id
                        );
                    }

                    config.voice.permitted[
                        channel.id
                    ] = (
                        config.voice.permitted[
                            channel.id
                        ] || []
                    ).filter(
                        id =>
                            id !==
                            target.id
                    );

                    await channel.permissionOverwrites.edit(
                        target.id,
                        {
                            Connect: false
                        }
                    );

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice.disconnect(
                            "VC+ panel ban"
                        ).catch(
                            () => {}
                        );
                    }

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({
                        content:
                            `${target.user.tag} is now banned from this VC.`,
                        ephemeral: true
                    });
                }

                /* -----------------------------------------
                   PERMIT
                ----------------------------------------- */

                if (
                    action ===
                    "permit"
                ) {
                    const userId =
                        interaction.fields.getTextInputValue(
                            "user_id"
                        ).trim();

                    const target =
                        await interaction.guild.members
                            .fetch(userId)
                            .catch(
                                () => null
                            );

                    if (!target) {
                        return interaction.reply({
                            content:
                                "That user could not be found.",
                            ephemeral: true
                        });
                    }

                    config.voice.permitted[
                        channel.id
                    ] ??= [];

                    if (
                        !config.voice.permitted[
                            channel.id
                        ].includes(
                            target.id
                        )
                    ) {
                        config.voice.permitted[
                            channel.id
                        ].push(
                            target.id
                        );
                    }

                    config.voice.banned[
                        channel.id
                    ] = (
                        config.voice.banned[
                            channel.id
                        ] || []
                    ).filter(
                        id =>
                            id !==
                            target.id
                    );

                    await channel.permissionOverwrites.edit(
                        target.id,
                        {
                            Connect: true
                        }
                    );

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({
                        content:
                            `${target.user.tag} is permitted in this VC.`,
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error(
                "[INTERACTION ERROR]",
                error
            );

            try {
                if (
                    interaction.replied ||
                    interaction.deferred
                ) {
                    await interaction.followUp({
                        content:
                            "VC+ encountered an error while processing that action.",
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content:
                            "VC+ encountered an error while processing that action.",
                        ephemeral: true
                    });
                }
            } catch {}
        }
    }
);

/* =========================================================
   MESSAGE COMMAND ROUTER
========================================================= */

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                !message.guild ||
                message.author.bot
            ) {
                return;
            }

            if (
                await checkFilter(message)
            ) {
                return;
            }

            if (
                !message.content.startsWith(
                    PREFIX
                )
            ) {
                return;
            }

            const args =
                message.content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()?.toLowerCase();

            if (!command) return;

            switch (command) {
                case "help":
                    return sendHelp(
                        message
                    );

                case "ping":
                    return safeReply(
                        message,
                        `\`\`\`VC+\nPong: ${client.ws.ping}ms\n\`\`\``
                    );

                case "rank":
                    return handleRank(
                        message,
                        args
                    );

                case "ranklist":
                    return handleRankList(
                        message
                    );

                case "godmode":
                    return handleGodmode(
                        message,
                        args
                    );

                case "vouch":
                    return handleVouch(
                        message,
                        args
                    );

                case "vouches":
                    return handleVouches(
                        message,
                        args
                    );

                case "filter":
                    return handleFilter(
                        message,
                        args
                    );

                case "vc":
                    return handleVC(
                        message,
                        args
                    );

                case "interface":
                    return handleInterface(
                        message
                    );

                case "ban":
                    return handleBan(
                        message,
                        args
                    );

                case "unban":
                    return handleUnban(
                        message,
                        args
                    );

                case "unbanall":
                    return handleUnbanAll(
                        message
                    );

                case "kick":
                    return handleKick(
                        message,
                        args
                    );

                case "timeout":
                    return handleTimeout(
                        message,
                        args
                    );

                case "untimeout":
                    return handleUntimeout(
                        message
                    );

                case "foreverban":
                    return handleForeverBan(
                        message,
                        args
                    );

                case "unforeverban":
                    return handleUnForeverBan(
                        message,
                        args
                    );

                case "purge":
                case "clear":
                    return handlePurge(
                        message,
                        args
                    );

                default:
                    return;
            }
        } catch (error) {
            console.error(
                "[COMMAND ERROR]",
                error
            );

            await safeReply(
                message,
                "```VC+\nAn error occurred while processing that command.\n```"
            );
        }
    }
);

/* =========================================================
   VOICE STATE
========================================================= */

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        await handleJoinToCreate(
            oldState,
            newState
        );
    }
);

/* =========================================================
   FOREVER BAN ENFORCEMENT
========================================================= */

client.on(
    "guildMemberAdd",
    async member => {
        try {
            if (
                foreverBans[member.id]
            ) {
                await member.ban({
                    reason:
                        "VC+ forever ban enforcement"
                });
            }
        } catch (error) {
            console.error(
                "[FOREVER BAN ERROR]",
                error
            );
        }
    }
);

/* =========================================================
   ANTI-NUKE / SECURITY
========================================================= */

function isTrustedExecutor(
    guild,
    userId
) {
    const member =
        guild.members.cache.get(
            userId
        );

    if (!member) return false;

    return hasGodAccess(member);
}

const DANGEROUS_PERMISSIONS = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers
];

client.on(
    "roleCreate",
    async role => {
        try {
            const logs =
                await role.guild.fetchAuditLogs({
                    type: AuditLogEvent.RoleCreate,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (
                isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {
                return;
            }

            const dangerous =
                DANGEROUS_PERMISSIONS.some(
                    permission =>
                        role.permissions.has(
                            permission
                        )
                );

            if (!dangerous) return;

            await role.delete(
                "VC+ anti-nuke"
            ).catch(() => {});

            const member =
                await role.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (member) {
                await member.ban({
                    reason:
                        "VC+ anti-nuke: unauthorized dangerous role creation"
                }).catch(() => {});
            }
        } catch (error) {
            console.error(
                "[ROLE CREATE SECURITY ERROR]",
                error
            );
        }
    }
);

client.on(
    "roleDelete",
    async role => {
        try {
            const logs =
                await role.guild.fetchAuditLogs({
                    type: AuditLogEvent.RoleDelete,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (
                isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {
                return;
            }

            const member =
                await role.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (member) {
                await member.ban({
                    reason:
                        "VC+ anti-nuke: unauthorized role deletion"
                }).catch(() => {});
            }
        } catch (error) {
            console.error(
                "[ROLE DELETE SECURITY ERROR]",
                error
            );
        }
    }
);

/* =========================================================
   READY
========================================================= */

client.once(
    "ready",
    async () => {
        console.log(
            `VC+ online as ${client.user.tag}`
        );

        console.log(
            `Prefix: ${PREFIX}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: "-help",
                    type: 0
                }
            ],
            status: "online"
        });
    }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
    "error",
    error => {
        console.error(
            "[CLIENT ERROR]",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[CLIENT WARNING]",
            warning
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "[SHARD ERROR]",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[UNHANDLED REJECTION]",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[UNCAUGHT EXCEPTION]",
            error
        );
    }
);

async function shutdown(signal) {
    console.log(
        `[SHUTDOWN] ${signal}`
    );

    try {
        client.destroy();
    } catch {}

    process.exit(0);
}

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

/* =========================================================
   LOGIN
========================================================= */

const TOKEN =
    process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error(
        "DISCORD_TOKEN is missing from .env"
    );

    process.exit(1);
}

client.login(TOKEN).catch(
    error => {
        console.error(
            "[LOGIN ERROR]",
            error
        );

        process.exit(1);
    }
);
