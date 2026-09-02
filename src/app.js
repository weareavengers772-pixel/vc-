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
            fs.writeFileSync(
                file,
                JSON.stringify(fallback, null, 2)
            );

            return structuredClone(fallback);
        }

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    } catch (error) {

        console.error(
            `[FILE ERROR] ${file}`,
            error
        );

        try {
            fs.writeFileSync(
                file,
                JSON.stringify(fallback, null, 2)
            );
        } catch {}

        return structuredClone(fallback);
    }
}


function saveJSON(file, data) {
    try {

        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2)
        );

    } catch (error) {

        console.error(
            `[SAVE ERROR] ${file}`,
            error
        );
    }
}


let ranks =
    loadJSON(
        RANK_FILE,
        {}
    );

let configs =
    loadJSON(
        CONFIG_FILE,
        {}
    );

let foreverBans =
    loadJSON(
        FOREVER_BAN_FILE,
        {}
    );


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

    return (
        ranks[guildId]?.[userId] ||
        null
    );

}


function getRankLevel(member) {

    if (!member) return 0;

    if (
        member.guild.ownerId ===
        member.id
    ) {

        return RANKS.founder;

    }

    const stored =
        getStoredRank(
            member.guild.id,
            member.id
        );

    if (!stored) return 0;

    return RANKS[stored] || 0;

}


function getRankName(member) {

    if (!member) {
        return "member";
    }

    if (
        member.guild.ownerId ===
        member.id
    ) {

        return "founder";

    }

    return (
        getStoredRank(
            member.guild.id,
            member.id
        ) ||
        "member"
    );

}


function hasRank(member, required) {

    return (
        getRankLevel(member) >=
        (RANKS[required] || 999)
    );

}


function isFounder(member) {

    return (
        getRankLevel(member) >=
        RANKS.founder
    );

}


function isGod(member) {

    return (
        getRankLevel(member) >=
        RANKS.god
    );

}


function isGodmode(member) {

    if (!member?.guild) {
        return false;
    }

    const guildData =
        configs[member.guild.id];

    return (
        guildData?.godmode?.includes(
            member.id
        ) ||
        false
    );

}


function hasGodAccess(member) {

    return (

        member.guild.ownerId ===
        member.id ||

        isFounder(member) ||

        isGod(member) ||

        isGodmode(member)

    );

}


function canModerate(member) {

    return (

        member.guild.ownerId ===
        member.id ||

        getRankLevel(member) >=
        RANKS.moderator ||

        member.permissions.has(
            PermissionsBitField.Flags.BanMembers
        ) ||

        member.permissions.has(
            PermissionsBitField.Flags.KickMembers
        )

    );

}


function canManageServer(member) {

    return (

        member.guild.ownerId ===
        member.id ||

        isFounder(member) ||

        getRankLevel(member) >=
        RANKS.owner ||

        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )

    );

}


function canManageVouches(member) {

    return (

        member.guild.ownerId ===
        member.id ||

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

        saveJSON(
            CONFIG_FILE,
            configs
        );
    }

    const config =
        configs[guildId];

    // Repair older config files.

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

        console.error(
            "[REPLY ERROR]",
            error
        );

        return null;
    }
}


async function safeEdit(message, content) {

    try {

        return await message.edit(content);

    } catch (error) {

        console.error(
            "[EDIT ERROR]",
            error
        );

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


function panel(title, description) {

    return {

        embeds: [

            new EmbedBuilder()
                .setTitle(
                    `VC+ | ${title}`
                )
                .setDescription(
                    description
                )
                .setFooter({
                    text: "VC+"
                })

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
Clear a user's vouches.

-vouch clear everyone
Clear all vouches.

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
                .setCustomId(
                    "help_prev"
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
                    `${page + 1}`
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true),

            new ButtonBuilder()
                .setCustomId(
                    "help_next"
                )
                .setLabel(">")
                .setStyle(
                    ButtonStyle.Secondary
                )

        );

}


function helpPayload(page) {

    const current =
        HELP_PAGES[page];

    return {

        embeds: [

            new EmbedBuilder()
                .setTitle(
                    `VC+ | ${current.name}`
                )
                .setDescription(
                    `\`\`\`\n${current.description}\n\`\`\``
                )
                .setFooter({
                    text:
                        `Page ${page + 1}/${HELP_PAGES.length} • Use -help category for direct access`
                })

        ],

        components: [

            helpButtons(page)

        ]

    };

}


async function handleHelp(message, args) {

    const category =
        args[0]?.toLowerCase();

    if (category) {

        const index =
            HELP_PAGES.findIndex(
                page =>
                    page.name.toLowerCase() ===
                    category
            );

        if (index === -1) {

            return safeReply(

                message,

                "```VC+\nUnknown help category.\nUse -help to view the available categories.\n```"

            );

        }

        return safeReply(
            message,
            helpPayload(index)
        );
    }

    return safeReply(
        message,
        helpPayload(0)
    );
}


// ============================================================
// PING
// ============================================================

async function handlePing(message) {

    const sent =
        await safeReply(
            message,
            "```VC+\nPinging...\n```"
        );

    if (!sent) return;

    const latency =
        sent.createdTimestamp -
        message.createdTimestamp;

    await safeEdit(

        sent,

        `\`\`\`\nVC+\nPong\nLatency: ${latency}ms\nWebSocket: ${client.ws.ping}ms\n\`\`\``

    );

}


// ============================================================
// RANK
// ============================================================

async function handleRank(message, args) {

    const target =
        message.mentions.members.first();

    if (!target) {

        return usage(
            message,
            "-rank @user [rank]"
        );

    }

    if (!args[1]) {

        return safeReply(

            message,

            `\`\`\`\nVC+\nUser: ${target.user.tag}\nRank: ${RANK_DISPLAY[getRankName(target)] || "Member"}\n\`\`\``

        );

    }

    if (
        !canManageServer(
            message.member
        )
    ) {

        return deny(message);

    }

    const requested =
        args[1].toLowerCase();

    if (!RANKS[requested]) {

        return safeReply(
            message,
            "```VC+\nInvalid rank.\n```"
        );

    }

    const actorLevel =
        getRankLevel(
            message.member
        );

    const targetLevel =
        getRankLevel(target);

    const newLevel =
        RANKS[requested];

    if (
        message.guild.ownerId !==
            message.author.id &&
        newLevel >= actorLevel
    ) {

        return safeReply(

            message,

            "```VC+\nYou cannot assign a rank equal to or higher than your own rank.\n```"

        );

    }

    if (
        message.guild.ownerId !==
            message.author.id &&
        targetLevel >= actorLevel
    ) {

        return safeReply(

            message,

            "```VC+\nYou cannot change the rank of someone at or above your rank.\n```"

        );

    }

    if (!ranks[message.guild.id]) {

        ranks[message.guild.id] = {};

    }

    ranks[
        message.guild.id
    ][target.id] = requested;

    saveJSON(
        RANK_FILE,
        ranks
    );

    return safeReply(

        message,

        `\`\`\`\nVC+\n${target.user.tag}\nRank set to ${RANK_DISPLAY[requested]}.\n\`\`\``

    );

}


async function handleRankList(message) {

    return safeReply(

        message,

        `\`\`\`\nVC+ | RANK HIERARCHY\n\n10  Founder\n9   God\n8   Owner\n7   Co-Owner\n6   Executive\n5   Director\n4   Admin\n3   Moderator\n2   Staff\n1   Member\n\nServer Owner = Founder\n\`\`\``

    );

}


// ============================================================
// GODMODE
// ============================================================

async function handleGodmode(message, args) {

    if (
        !isFounder(
            message.member
        )
    ) {

        return deny(message);

    }

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );

    if (
        args[0]?.toLowerCase() ===
        "remove"
    ) {

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(
                message,
                "-godmode remove @user"
            );

        }

        guildConfig.godmode =
            guildConfig.godmode.filter(
                id => id !== target.id
            );

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\nGodmode removed from ${target.user.tag}.\n\`\`\``

        );

    }

    const target =
        message.mentions.members.first();

    if (!target) {

        return usage(
            message,
            "-godmode @user"
        );

    }

    if (
        !guildConfig.godmode.includes(
            target.id
        )
    ) {

        guildConfig.godmode.push(
            target.id
        );

    }

    saveJSON(
        CONFIG_FILE,
        configs
    );

    return safeReply(

        message,

        `\`\`\`\nVC+\nGodmode granted to ${target.user.tag}.\n\`\`\``

    );

}


// ============================================================
// BAN
// ============================================================

async function handleBan(message, args) {

    if (
        !canModerate(
            message.member
        )
    ) {

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
        target.id ===
        message.author.id
    ) {

        return safeReply(
            message,
            "```VC+\nYou cannot ban yourself.\n```"
        );

    }

    if (
        message.guild.ownerId !==
            message.author.id &&
        getRankLevel(target) >=
            getRankLevel(message.member)
    ) {

        return safeReply(

            message,

            "```VC+\nYou cannot moderate someone at or above your rank.\n```"

        );

    }

    if (!target.bannable) {

        return safeReply(
            message,
            "```VC+\nI cannot ban that member.\n```"
        );

    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    try {

        await target.ban({

            reason:
                `${message.author.tag}: ${reason}`

        });

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} was banned.\nReason: ${reason}\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[BAN ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to ban that member.\n```"
        );

    }

}


// ============================================================
// UNBAN
// ============================================================

async function handleUnban(message, args) {

    if (
        !canModerate(
            message.member
        )
    ) {

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

    try {

        await message.guild.members.unban(

            userId,

            `Unbanned by ${message.author.tag}`

        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${userId} has been unbanned.\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[UNBAN ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nThat user could not be unbanned.\n```"
        );

    }

}


// ============================================================
// UNBAN ALL
// ============================================================

async function handleUnbanAll(message) {

    if (
        !isFounder(
            message.member
        )
    ) {

        return deny(message);

    }

    try {

        const bans =
            await message.guild.bans.fetch();

        if (!bans.size) {

            return safeReply(

                message,

                "```VC+\nThere are no banned users.\n```"

            );

        }

        let count = 0;

        for (const [id] of bans) {

            try {

                await message.guild.members.unban(

                    id,

                    `VC+ unbanall by ${message.author.tag}`

                );

                count++;

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            250
                        )
                );

            } catch {}

        }

        return safeReply(

            message,

            `\`\`\`\nVC+\nUnbanned ${count} user(s).\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[UNBANALL ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to complete unbanall.\n```"
        );

    }

}


// ============================================================
// KICK
// ============================================================

async function handleKick(message, args) {

    if (
        !canModerate(
            message.member
        )
    ) {

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

    if (!target.kickable) {

        return safeReply(
            message,
            "```VC+\nI cannot kick that member.\n```"
        );

    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    try {

        await target.kick(
            `${message.author.tag}: ${reason}`
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} was kicked.\nReason: ${reason}\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[KICK ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to kick that member.\n```"
        );

    }

}


// ============================================================
// TIMEOUT
// ============================================================

function parseDuration(input) {

    if (!input) return null;

    const match =
        /^(\d+)(s|m|h|d)$/i.exec(
            input
        );

    if (!match) return null;

    const amount =
        Number(match[1]);

    const unit =
        match[2].toLowerCase();

    const multipliers = {

        s: 1000,

        m: 60 * 1000,

        h: 60 * 60 * 1000,

        d: 24 * 60 * 60 * 1000

    };

    return (
        amount *
        multipliers[unit]
    );

}


async function handleTimeout(message, args) {

    if (
        !canModerate(
            message.member
        )
    ) {

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

    if (!duration) {

        return safeReply(

            message,

            "```VC+\nInvalid duration. Example: 10m, 1h, 2d\n```"

        );

    }

    const reason =
        args.slice(2).join(" ") ||
        "No reason provided";

    try {

        await target.timeout(

            duration,

            `${message.author.tag}: ${reason}`

        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} was timed out.\nDuration: ${args[1]}\nReason: ${reason}\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[TIMEOUT ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to timeout that member.\n```"
        );

    }

}


// ============================================================
// UNTIMEOUT
// ============================================================

async function handleUntimeout(message, args) {

    if (
        !canModerate(
            message.member
        )
    ) {

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

    try {

        await target.timeout(

            null,

            `Untimeout by ${message.author.tag}`

        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} is no longer timed out.\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[UNTIMEOUT ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to remove the timeout.\n```"
        );

    }

}


// ============================================================
// FOREVER BAN
// ============================================================

async function handleForeverBan(message, args) {

    if (
        !isFounder(
            message.member
        )
    ) {

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

    if (
        !foreverBans[
            message.guild.id
        ]
    ) {

        foreverBans[
            message.guild.id
        ] = {};

    }

    foreverBans[
        message.guild.id
    ][target.id] = {

        reason,

        addedBy:
            message.author.id,

        timestamp:
            Date.now()

    };

    saveJSON(
        FOREVER_BAN_FILE,
        foreverBans
    );

    try {

        if (target.bannable) {

            await target.ban({

                reason:
                    `VC+ Forever Ban: ${reason}`

            });

        }

    } catch (error) {

        console.error(
            "[FOREVER BAN]",
            error
        );

    }

    return safeReply(

        message,

        `\`\`\`\nVC+\n${target.user.tag} is now forever banned.\nReason: ${reason}\n\`\`\``

    );

}


// ============================================================
// UNFOREVER BAN
// ============================================================

async function handleUnForeverBan(
    message,
    args
) {

    if (
        !isFounder(
            message.member
        )
    ) {

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

    if (
        foreverBans[
            message.guild.id
        ]
    ) {

        delete foreverBans[
            message.guild.id
        ][userId];

    }

    saveJSON(
        FOREVER_BAN_FILE,
        foreverBans
    );

    return safeReply(

        message,

        `\`\`\`\nVC+\n${userId} removed from the forever-ban list.\n\`\`\``

    );

}


// ============================================================
// PURGE
// ============================================================

async function handlePurge(message, args) {

    if (

        !canManageServer(
            message.member
        ) &&

        !message.member.permissions.has(
            PermissionsBitField.Flags.ManageMessages
        )

    ) {

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

    try {

        const deleted =
            await message.channel.bulkDelete(
                amount,
                true
            );

        const response =
            await safeReply(

                message,

                `\`\`\`\nVC+\nDeleted ${deleted.size} message(s).\n\`\`\``

            );

        if (response) {

            setTimeout(
                () =>
                    safeDelete(response),
                3000
            );

        }

    } catch (error) {

        console.error(
            "[PURGE ERROR]",
            error
        );

        return safeReply(
            message,
            "```VC+\nFailed to delete messages.\n```"
        );

    }

}


// ======================================================
// VOUCH COMMANDS
// ======================================================

if (command === "vouch") {

    const sub =
        args[0]?.toLowerCase();

    // ==================================================
    // -vouch set role @Role
    // ==================================================

    if (
        sub === "set" &&
        args[1]?.toLowerCase() === "role"
    ) {

        if (
            !isServerOwner(member) &&
            !isFounder(member)
        ) {
            return sendBox(
                message,
                "Vouch",
                "Only the **Server Owner** or **Founder** can manage the vouch role."
            );
        }

        const role =
            message.mentions.roles.first();

        if (!role) {
            return sendBox(
                message,
                "Vouch",
                "Usage: `-vouch set role @Role`"
            );
        }

        if (role.managed) {
            return sendBox(
                message,
                "Vouch",
                "That role is managed by Discord and cannot be used."
            );
        }

        const botMember =
            message.guild.members.me ||
            await message.guild.members.fetchMe()
                .catch(() => null);

        if (!botMember) {
            return sendBox(
                message,
                "Vouch",
                "I couldn't find my bot member."
            );
        }

        if (
            role.position >=
            botMember.roles.highest.position
        ) {
            return sendBox(
                message,
                "Vouch",
                "That role must be below my highest role."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        data.roles.vouch =
            role.id;

        saveDB();

        return sendBox(
            message,
            "Vouch",
            `Vouch role set to <@&${role.id}>.`
        );
    }

    // ==================================================
    // -vouch role
    // ==================================================

    if (sub === "role") {

        const data =
            getGuildData(
                message.guild.id
            );

        if (!data.roles.vouch) {
            return sendBox(
                message,
                "Vouch",
                "No vouch role has been configured.\n\nUse `-vouch set role @Role`."
            );
        }

        const role =
            message.guild.roles.cache.get(
                data.roles.vouch
            );

        if (!role) {
            return sendBox(
                message,
                "Vouch",
                "The configured vouch role no longer exists."
            );
        }

        return sendBox(
            message,
            "Vouch",
            `Current Vouch Role: <@&${role.id}>`
        );
    }

    // ==================================================
    // -vouch give @user reason
    // ==================================================

    if (sub === "give") {

        if (
            !isServerOwner(member) &&
            !isFounder(member)
        ) {
            return sendBox(
                message,
                "Vouch",
                "Only the **Server Owner** or **Founder** can give vouches."
            );
        }

        const target =
            await getTarget(
                message,
                args[1]
            );

        if (!target) {
            return sendBox(
                message,
                "Vouch",
                "Usage: `-vouch give @user reason`"
            );
        }

        const reason =
            args
                .slice(2)
                .join(" ")
                .trim();

        if (!reason) {
            return sendBox(
                message,
                "Vouch",
                "You need to provide a reason."
            );
        }

        if (reason.length > 500) {
            return sendBox(
                message,
                "Vouch",
                "The reason must be 500 characters or less."
            );
        }

        const role =
            getConfiguredVouchRole(
                message.guild
            );

        if (!role) {
            return sendBox(
                message,
                "Vouch",
                "No vouch role is configured.\n\nUse `-vouch set role @Role` first."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        if (!data.vouches[target.id]) {
            data.vouches[target.id] = [];
        }

        data.vouches[target.id].push({
            from: message.author.id,
            reason: reason,
            timestamp: Date.now()
        });

        saveDB();

        const roleGiven =
            await giveVouchRole(
                message.guild,
                target.id
            );

        const total =
            data.vouches[target.id].length;

        return sendBox(
            message,
            "Vouch",
            [
                `<@${message.author.id}> vouched for <@${target.id}>.`,
                "",
                `Reason: **${reason}**`,
                "",
                `Total Vouches: **${total}**`,
                "",
                roleGiven
                    ? `Vouch role: <@&${role.id}>`
                    : "The vouch was saved, but I could not give the configured role."
            ].join("\n")
        );
    }

    // ==================================================
    // -vouch clear @user
    // -vouch clear everyone
    // ==================================================

    if (sub === "clear") {

        if (
            !isServerOwner(member) &&
            !isFounder(member)
        ) {
            return sendBox(
                message,
                "Vouch",
                "Only the **Server Owner** or **Founder** can clear vouches."
            );
        }

        // ----------------------------------------------
        // CLEAR EVERYONE
        // ----------------------------------------------

        if (
            args[1]?.toLowerCase() ===
            "everyone"
        ) {

            const data =
                getGuildData(
                    message.guild.id
                );

            const role =
                getConfiguredVouchRole(
                    message.guild
                );

            // Clear database FIRST.
            data.vouches = {};

            saveDB();

            let removed = 0;
            let failed = 0;

            if (role) {

                try {
                    await message.guild.members.fetch();
                } catch {}

                const members =
                    [...role.members.values()];

                for (const target of members) {

                    try {

                        if (!target.manageable) {
                            failed++;
                            continue;
                        }

                        await target.roles.remove(
                            role,
                            "VC+ Vouch Clear Everyone"
                        );

                        removed++;

                    } catch {
                        failed++;
                    }
                }
            }

            return sendBox(
                message,
                "Vouch",
                [
                    "**Everyone's vouches have been cleared.**",
                    "",
                    `Vouch role removed from: **${removed}** member${removed === 1 ? "" : "s"}.`,
                    `Failed removals: **${failed}**.`
                ].join("\n")
            );
        }

        // ----------------------------------------------
        // CLEAR ONE USER
        // ----------------------------------------------

        const target =
            await getTarget(
                message,
                args[1]
            );

        if (!target) {
            return sendBox(
                message,
                "Vouch",
                "Usage: `-vouch clear @user`\n\nOr: `-vouch clear everyone`"
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        // Delete their vouches FIRST.
        delete data.vouches[target.id];

        saveDB();

        // Remove the EXACT configured role.
        const roleRemoved =
            await removeVouchRole(
                message.guild,
                target.id
            );

        return sendBox(
            message,
            "Vouch",
            [
                `Cleared all vouches from <@${target.id}>.`,
                "",
                roleRemoved
                    ? "The configured vouch role was removed."
                    : "The vouch role could not be removed."
            ].join("\n")
        );
    }

    // ==================================================
    // -vouch clearall
    // ==================================================

    if (sub === "clearall") {

        if (
            !isServerOwner(member) &&
            !isFounder(member)
        ) {
            return sendBox(
                message,
                "Vouch",
                "Only the **Server Owner** or **Founder** can clear vouches."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        const role =
            getConfiguredVouchRole(
                message.guild
            );

        data.vouches = {};

        saveDB();

        let removed = 0;
        let failed = 0;

        if (role) {

            try {
                await message.guild.members.fetch();
            } catch {}

            for (
                const target
                of [...role.members.values()]
            ) {

                try {

                    if (!target.manageable) {
                        failed++;
                        continue;
                    }

                    await target.roles.remove(
                        role,
                        "VC+ Vouch Clear All"
                    );

                    removed++;

                } catch {
                    failed++;
                }
            }
        }

        return sendBox(
            message,
            "Vouch",
            [
                "**All vouches have been cleared.**",
                "",
                `Vouch role removed from: **${removed}** member${removed === 1 ? "" : "s"}.`,
                `Failed removals: **${failed}**.`
            ].join("\n")
        );
    }

    // ==================================================
    // -vouch list
    // ==================================================

    if (sub === "list") {

        const data =
            getGuildData(
                message.guild.id
            );

        const entries =
            Object.entries(
                data.vouches
            )
            .map(
                ([userId, vouches]) => ({
                    userId,
                    count:
                        Array.isArray(vouches)
                            ? vouches.length
                            : 0
                })
            )
            .filter(
                entry =>
                    entry.count > 0
            )
            .sort(
                (a, b) =>
                    b.count - a.count
            )
            .slice(0, 10);

        if (!entries.length) {
            return sendBox(
                message,
                "Vouch Leaderboard",
                "There are no vouches yet."
            );
        }

        const description =
            entries
                .map(
                    (entry, index) =>
                        `**${index + 1}.** <@${entry.userId}> — **${entry.count}**`
                )
                .join("\n");

        return sendBox(
            message,
            "Vouch Leaderboard",
            description
        );
    }

    return sendBox(
        message,
        "Vouch",
        [
            "**Vouch Commands**",
            "",
            "`-vouch set role @Role`",
            "`-vouch role`",
            "`-vouch give @user reason`",
            "`-vouch clear @user`",
            "`-vouch clear everyone`",
            "`-vouch clearall`",
            "`-vouch list`",
            "`-vouches @user`"
        ].join("\n")
    );
}

// ============================================================
// FILTER
// ============================================================

async function handleFilter(
    message,
    args
) {

    if (
        !canManageServer(
            message.member
        )
    ) {

        return deny(message);

    }

    const sub =
        args[0]?.toLowerCase();

    const word =
        args
            .slice(1)
            .join(" ")
            .toLowerCase();

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );


    if (sub === "add") {

        if (!word) {

            return usage(
                message,
                "-filter add word"
            );

        }

        if (
            !guildConfig.filter.includes(
                word
            )
        ) {

            guildConfig.filter.push(
                word
            );

        }

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\nAdded "${word}" to the filter.\n\`\`\``

        );

    }


    if (sub === "remove") {

        if (!word) {

            return usage(
                message,
                "-filter remove word"
            );

        }

        guildConfig.filter =
            guildConfig.filter.filter(
                item =>
                    item !== word
            );

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\nRemoved "${word}" from the filter.\n\`\`\``

        );

    }


    return safeReply(

        message,

        "```VC+\n-filter add word\n-filter remove word\n```"

    );

}


// ============================================================
// VOICE HELPERS
// ============================================================

function getVoiceChannel(member) {

    return (
        member?.voice?.channel ||
        null
    );

}


function isTemporaryVC(
    guildConfig,
    channelId
) {

    return guildConfig
        .temporaryChannels
        .includes(channelId);

}


function isVCOwner(
    member,
    channel
) {

    const guildConfig =
        getGuildConfig(
            member.guild.id
        );

    return (
        guildConfig.voice.owners[
            channel.id
        ] === member.id
    );

}


function canControlVC(
    member,
    channel
) {

    return (

        member.guild.ownerId ===
        member.id ||

        isFounder(member) ||

        isGod(member) ||

        isGodmode(member) ||

        isVCOwner(
            member,
            channel
        )

    );

}


// ============================================================
// VC CONTROL PANEL
// ============================================================

function vcControlPayload(owner) {

    return {

        embeds: [

            new EmbedBuilder()

                .setTitle(
                    "VC+ | VOICE CONTROL"
                )

                .setDescription(
`This is the start of **${owner.displayName}'s VC channel.**

Owner: ${owner}

Use the buttons below to control this temporary voice channel.

You can also use the \`-vc\` commands.`
                )

                .setFooter({
                    text: "VC+ Voice Control"
                })

        ],

        components: [

            new ActionRowBuilder()
                .addComponents(

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_lock"
                        )
                        .setLabel(
                            "Lock"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_unlock"
                        )
                        .setLabel(
                            "Unlock"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_claim"
                        )
                        .setLabel(
                            "Claim"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_limit"
                        )
                        .setLabel(
                            "Limit"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_rename"
                        )
                        .setLabel(
                            "Rename"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        )

                ),

            new ActionRowBuilder()
                .addComponents(

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_transfer"
                        )
                        .setLabel(
                            "Transfer"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_kick"
                        )
                        .setLabel(
                            "Kick"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_ban"
                        )
                        .setLabel(
                            "Ban"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            "vc_panel_permit"
                        )
                        .setLabel(
                            "Permit"
                        )
                        .setStyle(
                            ButtonStyle.Secondary
                        )

                )

        ]

    };

}


async function sendVCControlPanel(
    channel,
    owner
) {

    try {

        if (!channel) return;

        if (
            channel.type !==
            ChannelType.GuildVoice
        ) {

            return;

        }

        await channel.send(
            vcControlPayload(owner)
        );

    } catch (error) {

        console.error(
            "[VC PANEL ERROR]",
            error
        );

    }

}


// ============================================================
// VC SETUP
// ============================================================

async function handleVCSetup(message) {

    if (
        !canManageServer(
            message.member
        )
    ) {

        return deny(message);

    }

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );

    if (
        guildConfig.joinToCreate
    ) {

        const existing =
            message.guild.channels.cache.get(
                guildConfig.joinToCreate
            );

        if (existing) {

            return safeReply(

                message,

                `\`\`\`\nVC+\nJoin-to-Create is already configured.\nChannel: ${existing.name}\n\`\`\``

            );

        }

    }

    try {

        const category =
            await message.guild.channels.create({

                name: "VC+",

                type:
                    ChannelType.GuildCategory

            });

        const createChannel =
            await message.guild.channels.create({

                name:
                    "Join To Create",

                type:
                    ChannelType.GuildVoice,

                parent:
                    category.id

            });

        guildConfig.joinToCreate =
            createChannel.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+ | SERVER SETUP\n\nJoin-to-Create enabled.\n\nJoin channel: ${createChannel.name}\nCategory: ${category.name}\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[VC SETUP ERROR]",
            error
        );

        return safeReply(

            message,

            "```VC+\nFailed to set up Join-to-Create.\nMake sure I have Manage Channels permission.\n```"

        );

    }

}


// ============================================================
// SERVER VOICE INTERFACE
// ============================================================

async function handleInterface(
    message
) {

    if (
        !canManageServer(
            message.member
        )
    ) {

        return deny(message);

    }

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );

    try {

        // Delete old interface if it exists.

        if (
            guildConfig.interfaceChannel
        ) {

            const oldChannel =
                message.guild.channels.cache.get(
                    guildConfig.interfaceChannel
                );

            if (oldChannel) {

                await oldChannel.delete()
                    .catch(() => {});

            }

        }


        const channel =
            await message.guild.channels.create({

                name:
                    "VC+ Interface",

                type:
                    ChannelType.GuildText

            });


        const sent =
            await channel.send({

                embeds: [

                    new EmbedBuilder()

                        .setTitle(
                            "VC+ | Voice Interface"
                        )

                        .setDescription(
`Use the controls below to manage your temporary voice channel.

These controls apply to the temporary VC you are currently inside.

For advanced controls use:

-vc kick @user
-vc ban @user
-vc permit @user
-vc limit number
-vc rename name
-vc transfer @user`
                        )

                        .setFooter({
                            text:
                                "VC+ Voice Interface"
                        })

                ],

                components: [

                    new ActionRowBuilder()
                        .addComponents(

                            new ButtonBuilder()
                                .setCustomId(
                                    "vc_interface_lock"
                                )
                                .setLabel(
                                    "Lock"
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    "vc_interface_unlock"
                                )
                                .setLabel(
                                    "Unlock"
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                ),

                            new ButtonBuilder()
                                .setCustomId(
                                    "vc_interface_claim"
                                )
                                .setLabel(
                                    "Claim"
                                )
                                .setStyle(
                                    ButtonStyle.Secondary
                                )

                        )

                ]

            });


        guildConfig.interfaceChannel =
            channel.id;

        guildConfig.interfaceMessage =
            sent.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\nVoice interface created in ${channel.name}.\n\`\`\``

        );

    } catch (error) {

        console.error(
            "[INTERFACE ERROR]",
            error
        );

        return safeReply(

            message,

            "```VC+\nFailed to create the interface.\n```"

        );

    }

}


// ============================================================
// VC COMMAND
// ============================================================

async function handleVC(
    message,
    args
) {

    const sub =
        args[0]?.toLowerCase();

    if (sub === "setup") {

        return handleVCSetup(
            message
        );

    }

    const member =
        message.member;

    const channel =
        getVoiceChannel(member);

    if (!channel) {

        return safeReply(

            message,

            "```VC+\nYou must be in a voice channel.\n```"

        );

    }

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );

    if (
        !isTemporaryVC(
            guildConfig,
            channel.id
        )
    ) {

        return safeReply(

            message,

            "```VC+\nYou must be in a VC+ temporary voice channel.\n```"

        );

    }


    // ========================================================
    // KICK / DISCONNECT
    // ========================================================

    if (
        sub === "kick" ||
        sub === "disconnect"
    ) {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(

                message,

                `-vc ${sub} @user`

            );

        }

        if (
            target.voice.channelId !==
            channel.id
        ) {

            return safeReply(

                message,

                "```VC+\nThat user is not in your VC.\n```"

            );

        }

        try {

            await target.voice.disconnect(
                "VC+ voice moderation"
            );

            return safeReply(

                message,

                `\`\`\`\nVC+\n${target.user.tag} was disconnected.\n\`\`\``

            );

        } catch (error) {

            console.error(
                "[VC DISCONNECT]",
                error
            );

            return safeReply(
                message,
                "```VC+\nFailed to disconnect that user.\n```"
            );

        }

    }


    // ========================================================
    // VC BAN
    // ========================================================

    if (sub === "ban") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(
                message,
                "-vc ban @user"
            );

        }

        if (
            !guildConfig.voice.banned[
                channel.id
            ]
        ) {

            guildConfig.voice.banned[
                channel.id
            ] = [];

        }

        if (
            !guildConfig.voice.banned[
                channel.id
            ].includes(target.id)
        ) {

            guildConfig.voice.banned[
                channel.id
            ].push(target.id);

        }

        if (
            target.voice.channelId ===
            channel.id
        ) {

            try {

                await target.voice.disconnect();

            } catch {}

        }

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} was banned from this VC.\n\`\`\``

        );

    }


    // ========================================================
    // REJECT
    // ========================================================

    if (sub === "reject") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(
                message,
                "-vc reject @user"
            );

        }

        if (
            !guildConfig.voice.banned[
                channel.id
            ]
        ) {

            guildConfig.voice.banned[
                channel.id
            ] = [];

        }

        if (
            !guildConfig.voice.banned[
                channel.id
            ].includes(target.id)
        ) {

            guildConfig.voice.banned[
                channel.id
            ].push(target.id);

        }

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} is rejected from this VC.\n\`\`\``

        );

    }


    // ========================================================
    // PERMIT
    // ========================================================

    if (sub === "permit") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(
                message,
                "-vc permit @user"
            );

        }

        if (
            !guildConfig.voice.permitted[
                channel.id
            ]
        ) {

            guildConfig.voice.permitted[
                channel.id
            ] = [];

        }

        if (
            !guildConfig.voice.permitted[
                channel.id
            ].includes(target.id)
        ) {

            guildConfig.voice.permitted[
                channel.id
            ].push(target.id);

        }

        if (
            guildConfig.voice.banned[
                channel.id
            ]
        ) {

            guildConfig.voice.banned[
                channel.id
            ] =
                guildConfig.voice.banned[
                    channel.id
                ].filter(
                    id => id !== target.id
                );

        }

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\n${target.user.tag} was permitted.\n\`\`\``

        );

    }


    // ========================================================
    // LOCK
    // ========================================================

    if (sub === "lock") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        try {

            await channel.permissionOverwrites.edit(

                message.guild.roles.everyone,

                {
                    Connect: false
                }

            );

            guildConfig.voice.locked[
                channel.id
            ] = true;

            saveJSON(
                CONFIG_FILE,
                configs
            );

            return safeReply(
                message,
                "```VC+\nVC locked.\n```"
            );

        } catch (error) {

            console.error(
                "[VC LOCK]",
                error
            );

            return safeReply(
                message,
                "```VC+\nFailed to lock the VC.\n```"
            );

        }

    }


    // ========================================================
    // UNLOCK
    // ========================================================

    if (sub === "unlock") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        try {

            await channel.permissionOverwrites.edit(

                message.guild.roles.everyone,

                {
                    Connect: null
                }

            );

            guildConfig.voice.locked[
                channel.id
            ] = false;

            saveJSON(
                CONFIG_FILE,
                configs
            );

            return safeReply(
                message,
                "```VC+\nVC unlocked.\n```"
            );

        } catch (error) {

            console.error(
                "[VC UNLOCK]",
                error
            );

            return safeReply(
                message,
                "```VC+\nFailed to unlock the VC.\n```"
            );

        }

    }


    // ========================================================
    // LIMIT
    // ========================================================

    if (sub === "limit") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const limit =
            Number(args[1]);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {

            return usage(
                message,
                "-vc limit 0-99"
            );

        }

        try {

            await channel.setUserLimit(
                limit
            );

            guildConfig.voice.limits[
                channel.id
            ] = limit;

            saveJSON(
                CONFIG_FILE,
                configs
            );

            return safeReply(

                message,

                `\`\`\`\nVC+\nVC user limit set to ${limit}.\n\`\`\``

            );

        } catch (error) {

            console.error(
                "[VC LIMIT]",
                error
            );

            return safeReply(
                message,
                "```VC+\nFailed to change the VC limit.\n```"
            );

        }

    }


    // ========================================================
    // RENAME
    // ========================================================

    if (sub === "rename") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const name =
            args.slice(1).join(" ");

        if (!name) {

            return usage(
                message,
                "-vc rename name"
            );

        }

        try {

            const finalName =
                name.slice(0, 100);

            await channel.setName(
                finalName
            );

            return safeReply(

                message,

                `\`\`\`\nVC+\nVC renamed to ${finalName}.\n\`\`\``

            );

        } catch (error) {

            console.error(
                "[VC RENAME]",
                error
            );

            return safeReply(
                message,
                "```VC+\nFailed to rename the VC.\n```"
            );

        }

    }


    // ========================================================
    // TRANSFER
    // ========================================================

    if (sub === "transfer") {

        if (
            !canControlVC(
                member,
                channel
            )
        ) {

            return deny(message);

        }

        const target =
            message.mentions.members.first();

        if (!target) {

            return usage(
                message,
                "-vc transfer @user"
            );

        }

        guildConfig.voice.owners[
            channel.id
        ] = target.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(

            message,

            `\`\`\`\nVC+\nVC ownership transferred to ${target.user.tag}.\n\`\`\``

        );

    }


    // ========================================================
    // CLAIM
    // ========================================================

    if (sub === "claim") {

        const ownerId =
            guildConfig.voice.owners[
                channel.id
            ];

        if (ownerId) {

            const owner =
                channel.guild.members.cache.get(
                    ownerId
                );

            if (
                owner &&
                owner.voice.channelId ===
                channel.id
            ) {

                return safeReply(

                    message,

                    "```VC+\nThis VC already has an active owner.\n```"

                );

            }

        }

        guildConfig.voice.owners[
            channel.id
        ] = message.author.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(
            message,
            "```VC+\nYou claimed this VC.\n```"
        );

    }


    // ========================================================
    // FORCECLAIM
    // ========================================================

    if (sub === "forceclaim") {

        if (
            !hasGodAccess(member)
        ) {

            return deny(message);

        }

        guildConfig.voice.owners[
            channel.id
        ] = message.author.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );

        return safeReply(
            message,
            "```VC+\nYou force claimed this VC.\n```"
        );

    }


    // ========================================================
    // STFU
    // ========================================================

    if (sub === "stfu") {

        if (
            !hasGodAccess(member)
        ) {

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

        try {

            await target.voice.setMute(

                true,

                `VC+ STFU by ${message.author.tag}`

            );

            return safeReply(

                message,

                `\`\`\`\nVC+\n${target.user.tag} has been server muted.\n\`\`\``

            );

        } catch (error) {

            console.error(
                "[STFU]",
                error
            );

            return safeReply(

                message,

                "```VC+\nFailed to server mute that user.\n```"

            );

        }

    }


    // ========================================================
    // UNSTFU
    // ========================================================

    if (sub === "unstfu") {

        if (
            !hasGodAccess(member)
        ) {

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

        try {

            await target.voice.setMute(

                false,

                `VC+ UNSTFU by ${message.author.tag}`

            );

            return safeReply(

                message,

                `\`\`\`\nVC+\n${target.user.tag} is no longer server muted.\n\`\`\``

            );

        } catch (error) {

            console.error(
                "[UNSTFU]",
                error
            );

            return safeReply(

                message,

                "```VC+\nFailed to remove the server mute.\n```"

            );

        }

    }


    return safeReply(

        message,

        "```VC+\nUnknown VC command.\nUse -help voice\n```"

    );

}


// ============================================================
// JOIN TO CREATE
// ============================================================

async function handleJoinToCreate(
    oldState,
    newState
) {

    if (!newState.guild) return;

    const guildConfig =
        getGuildConfig(
            newState.guild.id
        );

    if (

        !guildConfig.joinToCreate ||

        newState.channelId !==
            guildConfig.joinToCreate

    ) {

        return;

    }

    const member =
        newState.member;

    if (!member) return;

    try {

        const category =
            newState.channel?.parent;

        const channel =
            await newState.guild.channels.create({

                name:
                    `${member.user.username}'s VC`,

                type:
                    ChannelType.GuildVoice,

                parent:
                    category?.id || null,

                permissionOverwrites: [

                    {

                        id:
                            newState.guild.roles.everyone.id,

                        allow: [

                            PermissionsBitField.Flags.Connect

                        ]

                    },

                    {

                        id:
                            member.id,

                        allow: [

                            PermissionsBitField.Flags.Connect

                        ]

                    }

                ]

            });


        guildConfig.temporaryChannels.push(
            channel.id
        );

        guildConfig.voice.owners[
            channel.id
        ] = member.id;

        saveJSON(
            CONFIG_FILE,
            configs
        );


        await member.voice.setChannel(
            channel
        );


        // ====================================================
        // AUTOMATIC VC CONTROL PANEL
        // ====================================================

        await sendVCControlPanel(
            channel,
            member
        );

    } catch (error) {

        console.error(
            "[JOIN TO CREATE ERROR]",
            error
        );

    }

}


// ============================================================
// CLEAN EMPTY TEMP VCS
// ============================================================

async function cleanupVoiceChannel(
    channel
) {

    if (!channel?.guild) return;

    const guildConfig =
        getGuildConfig(
            channel.guild.id
        );

    if (
        !guildConfig.temporaryChannels
            .includes(channel.id)
    ) {

        return;

    }

    if (
        channel.members.size > 0
    ) {

        return;

    }

    try {

        await channel.delete(
            "VC+ temporary VC cleanup"
        );

    } catch (error) {

        console.error(
            "[VC CLEANUP]",
            error
        );

    }

    guildConfig.temporaryChannels =
        guildConfig.temporaryChannels
            .filter(
                id =>
                    id !== channel.id
            );

    delete guildConfig.voice.owners[
        channel.id
    ];

    delete guildConfig.voice.banned[
        channel.id
    ];

    delete guildConfig.voice.permitted[
        channel.id
    ];

    delete guildConfig.voice.locked[
        channel.id
    ];

    delete guildConfig.voice.limits[
        channel.id
    ];

    saveJSON(
        CONFIG_FILE,
        configs
    );

}


// ============================================================
// FILTER MESSAGE
// ============================================================

async function checkFilter(message) {

    if (!message.guild) {
        return false;
    }

    if (message.author.bot) {
        return false;
    }

    const guildConfig =
        getGuildConfig(
            message.guild.id
        );

    if (
        !guildConfig.filter.length
    ) {

        return false;

    }

    const content =
        message.content.toLowerCase();

    const matched =
        guildConfig.filter.find(
            word =>
                content.includes(word)
        );

    if (!matched) {
        return false;
    }


    // Staff and above bypass filter.

    if (

        message.member &&

        getRankLevel(
            message.member
        ) >= RANKS.staff

    ) {

        return false;

    }


    try {

        if (message.deletable) {

            await message.delete();

        }

    } catch {}


    return true;

}


// ============================================================
// ANTI-NUKE
// ============================================================

function dangerousPermissionChange(
    change
) {

    const permissions =
        change?.permissions;

    if (!permissions) {
        return false;
    }

    return (

        permissions.has(
            PermissionsBitField.Flags.Administrator
        ) ||

        permissions.has(
            PermissionsBitField.Flags.ManageGuild
        ) ||

        permissions.has(
            PermissionsBitField.Flags.ManageRoles
        ) ||

        permissions.has(
            PermissionsBitField.Flags.ManageChannels
        ) ||

        permissions.has(
            PermissionsBitField.Flags.BanMembers
        ) ||

        permissions.has(
            PermissionsBitField.Flags.KickMembers
        )

    );

}


function isTrustedExecutor(
    guild,
    userId
) {

    if (
        guild.ownerId ===
        userId
    ) {

        return true;

    }

    const member =
        guild.members.cache.get(
            userId
        );

    if (!member) {
        return false;
    }

    return hasGodAccess(
        member
    );

}


async function getAuditExecutor(
    guild,
    type
) {

    try {

        const logs =
            await guild.fetchAuditLogs({

                type,

                limit: 1

            });

        const entry =
            logs.entries.first();

        if (!entry) {
            return null;
        }

        return entry.executor;

    } catch (error) {

        console.error(
            "[AUDIT LOG ERROR]",
            error
        );

        return null;

    }

}


// ============================================================
// ROLE CREATE PROTECTION
// ============================================================

client.on(
    "roleCreate",
    async role => {

        try {

            const executor =
                await getAuditExecutor(

                    role.guild,

                    AuditLogEvent.RoleCreate

                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {

                return;

            }

            if (
                role.permissions.has(
                    PermissionsBitField.Flags.Administrator
                ) ||
                dangerousPermissionChange(role)
            ) {

                try {

                    await role.delete(
                        "VC+ anti-nuke"
                    );

                } catch {}


                const attacker =
                    role.guild.members.cache.get(
                        executor.id
                    );

                if (
                    attacker &&
                    attacker.bannable
                ) {

                    try {

                        await attacker.ban({

                            reason:
                                "VC+ anti-nuke: unauthorized dangerous role creation"

                        });

                    } catch {}

                }

                return;

            }

        } catch (error) {

            console.error(
                "[ROLE CREATE PROTECTION]",
                error
            );

        }

    }
);


// ============================================================
// ROLE DELETE PROTECTION
// ============================================================

client.on(
    "roleDelete",
    async role => {

        try {

            const executor =
                await getAuditExecutor(

                    role.guild,

                    AuditLogEvent.RoleDelete

                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {

                return;

            }

            const attacker =
                role.guild.members.cache.get(
                    executor.id
                );

            if (
                attacker &&
                attacker.bannable
            ) {

                await attacker.ban({

                    reason:
                        "VC+ anti-nuke: unauthorized role deletion"

                }).catch(
                    () => {}
                );

            }

        } catch (error) {

            console.error(
                "[ROLE DELETE PROTECTION]",
                error
            );

        }

    }
);


// ============================================================
// MEMBER UPDATE / DANGEROUS ROLE ASSIGNMENT
// ============================================================

client.on(
    "guildMemberUpdate",
    async (
        oldMember,
        newMember
    ) => {

        try {

            const oldRoles =
                new Set(
                    oldMember.roles.cache.keys()
                );

            const newRoles =
                [
                    ...newMember.roles.cache.values()
                ].filter(
                    role =>
                        !oldRoles.has(
                            role.id
                        )
                );

            if (!newRoles.length) {
                return;
            }

            const executor =
                await getAuditExecutor(

                    newMember.guild,

                    AuditLogEvent.MemberRoleUpdate

                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    newMember.guild,
                    executor.id
                )
            ) {

                return;

            }

            const dangerous =
                newRoles.some(
                    role =>
                        dangerousPermissionChange(
                            role
                        )
                );

            if (!dangerous) {
                return;
            }

            const attacker =
                newMember.guild.members.cache.get(
                    executor.id
                );

            if (
                attacker &&
                attacker.bannable
            ) {

                await attacker.ban({

                    reason:
                        "VC+ anti-nuke: unauthorized dangerous role assignment"

                }).catch(
                    () => {}
                );

            }

            for (
                const role
                of newRoles
            ) {

                if (
                    newMember.roles.cache.has(
                        role.id
                    )
                ) {

                    await newMember.roles.remove(

                        role,

                        "VC+ anti-nuke"

                    ).catch(
                        () => {}
                    );

                }

            }

        } catch (error) {

            console.error(
                "[MEMBER ROLE PROTECTION]",
                error
            );

        }

    }
);


// ============================================================
// MESSAGE COMMAND ROUTER
// ============================================================

client.on(
    "messageCreate",
    async message => {

        try {

            if (
                message.author.bot
            ) {

                return;

            }

            if (!message.guild) {
                return;
            }


            // =================================================
            // FILTER
            // =================================================

            const filtered =
                await checkFilter(
                    message
                );

            if (filtered) {
                return;
            }


            if (
                !message.content.startsWith(
                    PREFIX
                )
            ) {

                return;

            }


            const parts =
                message.content
                    .slice(
                        PREFIX.length
                    )
                    .trim()
                    .split(/\s+/);

            const command =
                parts
                    .shift()
                    ?.toLowerCase();

            const args =
                parts;

            if (!command) {
                return;
            }


            // =================================================
            // COMMAND ROUTER
            // =================================================

            switch (command) {


                // =================================================
                // GENERAL
                // =================================================

                case "help":

                    await handleHelp(
                        message,
                        args
                    );

                    break;


                case "ping":

                    await handlePing(
                        message
                    );

                    break;


                // =================================================
                // MODERATION
                // =================================================

                case "ban":

                    await handleBan(
                        message,
                        args
                    );

                    break;


                case "unban":

                    await handleUnban(
                        message,
                        args
                    );

                    break;


                case "unbanall":

                    await handleUnbanAll(
                        message
                    );

                    break;


                case "kick":

                    await handleKick(
                        message,
                        args
                    );

                    break;


                case "timeout":

                    await handleTimeout(
                        message,
                        args
                    );

                    break;


                case "untimeout":

                    await handleUntimeout(
                        message,
                        args
                    );

                    break;


                case "foreverban":

                    await handleForeverBan(
                        message,
                        args
                    );

                    break;


                case "unforeverban":

                    await handleUnForeverBan(
                        message,
                        args
                    );

                    break;


                case "purge":
                case "clear":

                    await handlePurge(
                        message,
                        args
                    );

                    break;


                // =================================================
                // RANKS
                // =================================================

                case "rank":

                    await handleRank(
                        message,
                        args
                    );

                    break;


                case "ranklist":

                    await handleRankList(
                        message
                    );

                    break;


                // =================================================
                // GODMODE
                // =================================================

                case "godmode":

                    await handleGodmode(
                        message,
                        args
                    );

                    break;


                // =================================================
                // VOUCHES
                // =================================================

                case "vouch":

                    await handleVouch(
                        message,
                        args
                    );

                    break;


                case "vouches":

                    await handleVouches(
                        message,
                        args
                    );

                    break;


                // =================================================
                // FILTER
                // =================================================

                case "filter":

                    await handleFilter(
                        message,
                        args
                    );

                    break;


                // =================================================
                // VOICE
                // =================================================

                case "vc":

                    await handleVC(
                        message,
                        args
                    );

                    break;


                case "interface":

                    await handleInterface(
                        message
                    );

                    break;


                // =================================================
                // UNKNOWN
                // =================================================

                default:

                    await safeReply(

                        message,

                        `\`\`\`\nVC+\nUnknown command: ${PREFIX}${command}\nUse -help to view commands.\n\`\`\``

                    );

                    break;

            }

        } catch (error) {

            console.error(
                "[MESSAGE COMMAND ERROR]",
                error
            );

            await safeReply(

                message,

                "```VC+\nAn error occurred while executing that command.\n```"

            );

        }

    }
);


// ============================================================
// INTERACTION SYSTEM
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {


            // ==================================================
            // HELP BUTTONS
            // ==================================================

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    "help_"
                )
            ) {

                const currentMatch =
                    interaction.message
                        .components?.[0]
                        ?.components?.[1]
                        ?.customId
                        ?.match(
                            /help_page_(\d+)/
                        );

                let page =
                    currentMatch
                        ? Number(
                            currentMatch[1]
                        )
                        : 0;


                if (
                    interaction.customId ===
                    "help_prev"
                ) {

                    page--;

                    if (page < 0) {

                        page =
                            HELP_PAGES.length - 1;

                    }

                }


                if (
                    interaction.customId ===
                    "help_next"
                ) {

                    page++;

                    if (
                        page >=
                        HELP_PAGES.length
                    ) {

                        page = 0;

                    }

                }


                await interaction.update(
                    helpPayload(page)
                );

                return;

            }


            // ==================================================
            // ONLY HANDLE BUTTONS/MODALS BELOW
            // ==================================================

            if (
                !interaction.isButton() &&
                !interaction.isModalSubmit()
            ) {

                return;

            }


            const guild =
                interaction.guild;

            if (!guild) {

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({

                        content:
                            "VC+ commands can only be used in a server.",

                        ephemeral: true

                    });

                }

                return;

            }


            const member =
                await guild.members.fetch(
                    interaction.user.id
                );


            // ==================================================
            // GET VC
            // ==================================================

            const channel =
                member.voice.channel;


            if (!channel) {

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({

                        content:
                            "You must be in a VC+ temporary voice channel.",

                        ephemeral: true

                    });

                }

                return;

            }


            const guildConfig =
                getGuildConfig(
                    guild.id
                );


            if (
                !isTemporaryVC(
                    guildConfig,
                    channel.id
                )
            ) {

                if (
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({

                        content:
                            "You must be in a VC+ temporary voice channel.",

                        ephemeral: true

                    });

                }

                return;

            }


            // ==================================================
            // BUTTON HANDLER
            // ==================================================

            if (
                interaction.isButton()
            ) {

                const id =
                    interaction.customId;


                // ==============================================
                // CONTROL PERMISSION
                // ==============================================

                if (
                    id.startsWith(
                        "vc_panel_"
                    ) ||
                    id.startsWith(
                        "vc_interface_"
                    )
                ) {

                    if (
                        !canControlVC(
                            member,
                            channel
                        )
                    ) {

                        return interaction.reply({

                            content:
                                "You do not control this VC.",

                            ephemeral: true

                        });

                    }

                }


                // ==============================================
                // LOCK
                // ==============================================

                if (
                    id ===
                    "vc_panel_lock" ||
                    id ===
                    "vc_interface_lock"
                ) {

                    await channel.permissionOverwrites.edit(

                        guild.roles.everyone,

                        {
                            Connect: false
                        }

                    );

                    guildConfig.voice.locked[
                        channel.id
                    ] = true;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            "VC locked.",

                        ephemeral: true

                    });

                }


                // ==============================================
                // UNLOCK
                // ==============================================

                if (
                    id ===
                    "vc_panel_unlock" ||
                    id ===
                    "vc_interface_unlock"
                ) {

                    await channel.permissionOverwrites.edit(

                        guild.roles.everyone,

                        {
                            Connect: null
                        }

                    );

                    guildConfig.voice.locked[
                        channel.id
                    ] = false;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            "VC unlocked.",

                        ephemeral: true

                    });

                }


                // ==============================================
                // CLAIM
                // ==============================================

                if (
                    id ===
                    "vc_panel_claim" ||
                    id ===
                    "vc_interface_claim"
                ) {

                    const ownerId =
                        guildConfig.voice.owners[
                            channel.id
                        ];

                    if (ownerId) {

                        const owner =
                            guild.members.cache.get(
                                ownerId
                            );

                        if (
                            owner &&
                            owner.voice.channelId ===
                            channel.id
                        ) {

                            return interaction.reply({

                                content:
                                    "This VC already has an active owner.",

                                ephemeral: true

                            });

                        }

                    }

                    guildConfig.voice.owners[
                        channel.id
                    ] =
                        interaction.user.id;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            "You claimed this VC.",

                        ephemeral: true

                    });

                }


                // ==============================================
                // LIMIT MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_limit"
                ) {

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
                            .setCustomId(
                                "limit"
                            )
                            .setLabel(
                                "User Limit"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "0-99"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(2);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }


                // ==============================================
                // RENAME MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_rename"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "vc_modal_rename"
                            )
                            .setTitle(
                                "VC+ | Rename VC"
                            );


                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "name"
                            )
                            .setLabel(
                                "New VC Name"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter a new name"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(100);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }


                // ==============================================
                // TRANSFER MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_transfer"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "vc_modal_transfer"
                            )
                            .setTitle(
                                "VC+ | Transfer Ownership"
                            );


                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user_id"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the user's ID"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(25);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }


                // ==============================================
                // KICK MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_kick"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "vc_modal_kick"
                            )
                            .setTitle(
                                "VC+ | Kick User"
                            );


                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user_id"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the user's ID"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(25);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }


                // ==============================================
                // BAN MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_ban"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "vc_modal_ban"
                            )
                            .setTitle(
                                "VC+ | Ban User"
                            );


                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user_id"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the user's ID"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(25);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }


                // ==============================================
                // PERMIT MODAL
                // ==============================================

                if (
                    id ===
                    "vc_panel_permit"
                ) {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                "vc_modal_permit"
                            )
                            .setTitle(
                                "VC+ | Permit User"
                            );


                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user_id"
                            )
                            .setLabel(
                                "Discord User ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the user's ID"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(25);


                    modal.addComponents(

                        new ActionRowBuilder()
                            .addComponents(
                                input
                            )

                    );

                    return interaction.showModal(
                        modal
                    );

                }

            }


            // ==================================================
            // MODAL HANDLER
            // ==================================================

            if (
                interaction.isModalSubmit()
            ) {

                const id =
                    interaction.customId;


                if (
                    !id.startsWith(
                        "vc_modal_"
                    )
                ) {

                    return;

                }


                if (
                    !canControlVC(
                        member,
                        channel
                    )
                ) {

                    return interaction.reply({

                        content:
                            "You do not control this VC.",

                        ephemeral: true

                    });

                }


                // ==============================================
                // LIMIT
                // ==============================================

                if (
                    id ===
                    "vc_modal_limit"
                ) {

                    const limit =
                        Number(
                            interaction.fields.getTextInputValue(
                                "limit"
                            )
                        );

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 0 ||
                        limit > 99
                    ) {

                        return interaction.reply({

                            content:
                                "The limit must be between 0 and 99.",

                            ephemeral: true

                        });

                    }

                    await channel.setUserLimit(
                        limit
                    );

                    guildConfig.voice.limits[
                        channel.id
                    ] = limit;

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            `VC user limit set to ${limit}.`,

                        ephemeral: true

                    });

                }


                // ==============================================
                // RENAME
                // ==============================================

                if (
                    id ===
                    "vc_modal_rename"
                ) {

                    const name =
                        interaction.fields
                            .getTextInputValue(
                                "name"
                            )
                            .trim()
                            .slice(0, 100);

                    if (!name) {

                        return interaction.reply({

                            content:
                                "You must enter a VC name.",

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


                // ==============================================
                // TRANSFER
                // ==============================================

                if (
                    id ===
                    "vc_modal_transfer"
                ) {

                    const userId =
                        interaction.fields
                            .getTextInputValue(
                                "user_id"
                            )
                            .replace(
                                /[<@!>]/g,
                                ""
                            )
                            .trim();

                    let target;

                    try {

                        target =
                            await guild.members.fetch(
                                userId
                            );

                    } catch {

                        return interaction.reply({

                            content:
                                "That user could not be found in this server.",

                            ephemeral: true

                        });

                    }

                    guildConfig.voice.owners[
                        channel.id
                    ] =
                        target.id;

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


                // ==============================================
                // KICK
                // ==============================================

                if (
                    id ===
                    "vc_modal_kick"
                ) {

                    const userId =
                        interaction.fields
                            .getTextInputValue(
                                "user_id"
                            )
                            .replace(
                                /[<@!>]/g,
                                ""
                            )
                            .trim();

                    let target;

                    try {

                        target =
                            await guild.members.fetch(
                                userId
                            );

                    } catch {

                        return interaction.reply({

                            content:
                                "That user could not be found in this server.",

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
                        "VC+ control panel kick"
                    );

                    return interaction.reply({

                        content:
                            `${target.user.tag} was disconnected.`,

                        ephemeral: true

                    });

                }


                // ==============================================
                // BAN
                // ==============================================

                if (
                    id ===
                    "vc_modal_ban"
                ) {

                    const userId =
                        interaction.fields
                            .getTextInputValue(
                                "user_id"
                            )
                            .replace(
                                /[<@!>]/g,
                                ""
                            )
                            .trim();

                    let target;

                    try {

                        target =
                            await guild.members.fetch(
                                userId
                            );

                    } catch {

                        return interaction.reply({

                            content:
                                "That user could not be found in this server.",

                            ephemeral: true

                        });

                    }

                    if (
                        !guildConfig.voice.banned[
                            channel.id
                        ]
                    ) {

                        guildConfig.voice.banned[
                            channel.id
                        ] = [];

                    }

                    if (
                        !guildConfig.voice.banned[
                            channel.id
                        ].includes(
                            target.id
                        )
                    ) {

                        guildConfig.voice.banned[
                            channel.id
                        ].push(
                            target.id
                        );

                    }

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {

                        await target.voice
                            .disconnect(
                                "VC+ control panel ban"
                            )
                            .catch(
                                () => {}
                            );

                    }

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            `${target.user.tag} was banned from this VC.`,

                        ephemeral: true

                    });

                }


                // ==============================================
                // PERMIT
                // ==============================================

                if (
                    id ===
                    "vc_modal_permit"
                ) {

                    const userId =
                        interaction.fields
                            .getTextInputValue(
                                "user_id"
                            )
                            .replace(
                                /[<@!>]/g,
                                ""
                            )
                            .trim();

                    let target;

                    try {

                        target =
                            await guild.members.fetch(
                                userId
                            );

                    } catch {

                        return interaction.reply({

                            content:
                                "That user could not be found in this server.",

                            ephemeral: true

                        });

                    }

                    if (
                        !guildConfig.voice.permitted[
                            channel.id
                        ]
                    ) {

                        guildConfig.voice.permitted[
                            channel.id
                        ] = [];

                    }

                    if (
                        !guildConfig.voice.permitted[
                            channel.id
                        ].includes(
                            target.id
                        )
                    ) {

                        guildConfig.voice.permitted[
                            channel.id
                        ].push(
                            target.id
                        );

                    }

                    if (
                        guildConfig.voice.banned[
                            channel.id
                        ]
                    ) {

                        guildConfig.voice.banned[
                            channel.id
                        ] =
                            guildConfig.voice.banned[
                                channel.id
                            ].filter(
                                id =>
                                    id !==
                                    target.id
                            );

                    }

                    saveJSON(
                        CONFIG_FILE,
                        configs
                    );

                    return interaction.reply({

                        content:
                            `${target.user.tag} was permitted in this VC.`,

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
                    !interaction.replied &&
                    !interaction.deferred
                ) {

                    await interaction.reply({

                        content:
                            "VC+ encountered an error while processing that action.",

                        ephemeral: true

                    });

                } else if (
                    interaction.deferred
                ) {

                    await interaction.editReply({

                        content:
                            "VC+ encountered an error while processing that action."

                    });

                }

            } catch {}

        }

    }
);


// ============================================================
// VOICE STATE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {

        try {

            // =================================================
            // JOIN TO CREATE
            // =================================================

            await handleJoinToCreate(
                oldState,
                newState
            );


            // =================================================
            // DELETE OLD TEMP VC
            // =================================================

            if (

                oldState.channel &&

                oldState.channelId !==
                    newState.channelId

            ) {

                await cleanupVoiceChannel(
                    oldState.channel
                );

            }


            // =================================================
            // VC BAN / REJECT ENFORCEMENT
            // =================================================

            if (
                newState.channel
            ) {

                const guildConfig =
                    getGuildConfig(
                        newState.guild.id
                    );

                const channelId =
                    newState.channel.id;

                const banned =
                    guildConfig.voice.banned[
                        channelId
                    ] || [];

                if (
                    banned.includes(
                        newState.member.id
                    )
                ) {

                    try {

                        await newState.member
                            .voice
                            .disconnect(
                                "VC+ VC ban enforcement"
                            );

                    } catch {}

                }

            }

        } catch (error) {

            console.error(
                "[VOICE STATE ERROR]",
                error
            );

        }

    }
);


// ============================================================
// FOREVER BAN JOIN PROTECTION
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {

        try {

            const guildBans =
                foreverBans[
                    member.guild.id
                ];

            if (!guildBans) {
                return;
            }

            if (
                !guildBans[
                    member.id
                ]
            ) {

                return;

            }

            try {

                await member.ban({

                    reason:
                        "VC+ forever-ban enforcement"

                });

            } catch {}

        } catch (error) {

            console.error(
                "[FOREVER BAN JOIN]",
                error
            );

        }

    }
);


// ============================================================
// READY
// ============================================================

client.once(
    "ready",
    () => {

        console.log(
            `VC+ online as ${client.user.tag}`
        );

        client.user.setPresence({

            activities: [

                {
                    name: "-help"
                }

            ],

            status:
                "online"

        });

    }
);


// ============================================================
// CLIENT ERROR PROTECTION
// ============================================================

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


// ============================================================
// PROCESS ERROR PROTECTION
// ============================================================

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


process.on(
    "warning",
    warning => {

        console.warn(
            "[NODE WARNING]",
            warning
        );

    }
);


// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(
    signal
) {

    console.log(
        `VC+ received ${signal}. Shutting down safely.`
    );

    try {

        client.destroy();

    } catch {}

    process.exit(0);

}


process.on(
    "SIGINT",
    () =>
        shutdown("SIGINT")
);


process.on(
    "SIGTERM",
    () =>
        shutdown("SIGTERM")
);


// ============================================================
// START BOT
// ============================================================

async function startBot() {

    const token =
        process.env.DISCORD_TOKEN;

    if (!token) {

        console.error(
            "Missing DISCORD_TOKEN in .env"
        );

        process.exit(1);

    }

    try {

        await client.login(
            token
        );

    } catch (error) {

        console.error(
            "[LOGIN ERROR]",
            error
        );

        process.exit(1);

    }

}


startBot();
