import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

/*
==================================================
VC+
DISCORD.JS V14
==================================================
*/

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("[VC+] DISCORD_TOKEN is missing.");
    process.exit(1);
}

/*
==================================================
CLIENT
==================================================
*/

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
        Partials.GuildMember,
        Partials.User,
        Partials.Message
    ]
});

/*
==================================================
DATABASE
==================================================
*/

const DATA_DIR = path.join(
    process.cwd(),
    "data"
);

const DATA_FILE = path.join(
    DATA_DIR,
    "vcplus.json"
);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

function createDefaultGuildData() {
    return {
        ranks: {},
        godmode: [],
        foreverBanned: [],

        vouches: {},
        vouchRevoked: {},

        vouchLimit: 5,

        roles: {
            vouch: null
        },

        jtc: {
            channelId: null,
            categoryId: null
        },

        tempVCs: {},

        filters: {
            enabled: false,
            words: [],
            strikes: {},
            maxStrikes: 3,
            timeoutMinutes: 10
        }
    };
}

let db = {};

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            db = {};
            saveDatabase();
            return;
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        if (!raw.trim()) {
            db = {};
            saveDatabase();
            return;
        }

        db = JSON.parse(raw);

        if (
            !db ||
            typeof db !== "object"
        ) {
            db = {};
        }

        for (const guildId of Object.keys(db)) {
            ensureGuildData(guildId);
        }

        saveDatabase();

        console.log("[VC+] Database loaded.");
    } catch (error) {
        console.error(
            "[VC+] Database load error:",
            error
        );

        db = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                db,
                null,
                4
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "[VC+] Database save error:",
            error
        );
    }
}

function ensureGuildData(guildId) {
    if (!db[guildId]) {
        db[guildId] =
            createDefaultGuildData();
    }

    const data =
        db[guildId];

    data.ranks ??= {};
    data.godmode ??= [];
    data.foreverBanned ??= [];

    data.vouches ??= {};
    data.vouchRevoked ??= {};

    data.vouchLimit =
        Number(data.vouchLimit) || 5;

    data.roles ??= {};
    data.roles.vouch ??= null;

    data.jtc ??= {};
    data.jtc.channelId ??= null;
    data.jtc.categoryId ??= null;

    data.tempVCs ??= {};

    data.filters ??= {};
    data.filters.enabled ??= false;
    data.filters.words ??= [];
    data.filters.strikes ??= {};
    data.filters.maxStrikes ??= 3;
    data.filters.timeoutMinutes ??= 10;

    return data;
}

function guildData(guild) {
    return ensureGuildData(
        guild.id
    );
}

loadDatabase();

/*
==================================================
RESPONSE STYLE
==================================================
*/

function plain(title, text) {
    return `${BOT_NAME}\n\n> **${title}**\n> ${text}`;
}

async function replyError(
    message,
    text
) {
    try {
        return await message.reply(
            plain(
                "ERROR",
                text
            )
        );
    } catch {
        return null;
    }
}

/*
==================================================
RANK SYSTEM
==================================================
*/

const RANK_LEVELS = {
    founder: 10,
    god: 9,
    owner: 8,
    coowner: 7,
    executive: 6,
    director: 5,
    admin: 4,
    moderator: 3,
    staff: 2,
    member: 1
};

const RANK_NAMES = {
    founder: "Founder",
    god: "God",
    owner: "Owner",
    coowner: "Co Owner",
    executive: "Executive",
    director: "Director",
    admin: "Admin",
    moderator: "Moderator",
    staff: "Staff",
    member: "Member"
};

function normalizeRank(rank) {
    if (!rank) {
        return null;
    }

    const value =
        String(rank)
            .toLowerCase()
            .replace(/[\s_-]/g, "");

    if (
        Object.prototype.hasOwnProperty.call(
            RANK_LEVELS,
            value
        )
    ) {
        return value;
    }

    return null;
}

function getRank(
    guild,
    userId
) {
    if (!guild) {
        return "member";
    }

    if (
        guild.ownerId ===
        userId
    ) {
        return "founder";
    }

    const data =
        guildData(guild);

    const rank =
        normalizeRank(
            data.ranks[userId]
        );

    return (
        rank &&
        RANK_LEVELS[rank]
    )
        ? rank
        : "member";
}

function getRankLevel(
    guild,
    userId
) {
    return (
        RANK_LEVELS[
            getRank(
                guild,
                userId
            )
        ] || 1
    );
}

function isServerOwner(
    member
) {
    return Boolean(
        member &&
        member.guild &&
        member.id ===
            member.guild.ownerId
    );
}

function isFounder(
    member
) {
    if (!member) {
        return false;
    }

    return (
        isServerOwner(member) ||
        getRank(
            member.guild,
            member.id
        ) === "founder"
    );
}

function isGod(
    member
) {
    if (!member) {
        return false;
    }

    if (
        isFounder(member)
    ) {
        return true;
    }

    const data =
        guildData(
            member.guild
        );

    return (
        getRank(
            member.guild,
            member.id
        ) === "god" ||
        data.godmode.includes(
            member.id
        )
    );
}

function canManageTarget(
    actor,
    target
) {
    if (
        !actor ||
        !target
    ) {
        return false;
    }

    if (
        actor.id ===
        target.id
    ) {
        return false;
    }

    if (
        isServerOwner(actor)
    ) {
        return true;
    }

    return (
        getRankLevel(
            actor.guild,
            actor.id
        ) >
        getRankLevel(
            actor.guild,
            target.id
        )
    );
}

function hasRank(
    member,
    level
) {
    return (
        getRankLevel(
            member.guild,
            member.id
        ) >= level
    );
}

/*
==================================================
MEMBER / ROLE HELPERS
==================================================
*/

function getMentionedMember(
    message
) {
    return (
        message.mentions.members.first() ||
        null
    );
}

function getMentionedRole(
    message
) {
    return (
        message.mentions.roles.first() ||
        null
    );
}

function cleanName(
    value
) {
    return String(value)
        .replace(/\n/g, " ")
        .trim()
        .slice(0, 100);
}

/*
==================================================
VOUCH SYSTEM
==================================================
*/

/*
This is the important automatic-role system.

Example:

-vouch role set @Vouched
-vouch limit 5

When someone reaches 5 vouches:

VC+ automatically gives @Vouched.
*/

function getVouchCount(
    guild,
    userId
) {
    const data =
        guildData(guild);

    return Number(
        data.vouches[userId] || 0
    );
}

async function syncVouchRole(
    guild,
    userId
) {
    const data =
        guildData(guild);

    if (
        !data.roles.vouch
    ) {
        return false;
    }

    const role =
        guild.roles.cache.get(
            data.roles.vouch
        );

    if (!role) {
        return false;
    }

    if (
        role.managed
    ) {
        return false;
    }

    const member =
        await guild.members
            .fetch(userId)
            .catch(
                () => null
            );

    if (!member) {
        return false;
    }

    const botMember =
        guild.members.me;

    if (!botMember) {
        return false;
    }

    if (
        !botMember.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        console.error(
            `[VC+] Cannot give vouch role in ${guild.name}: Manage Roles missing.`
        );

        return false;
    }

    if (
        role.position >=
        botMember.roles.highest.position
    ) {
        console.error(
            `[VC+] Cannot give vouch role in ${guild.name}: role is above the bot.`
        );

        return false;
    }

    const count =
        getVouchCount(
            guild,
            userId
        );

    const limit =
        Math.max(
            1,
            Number(
                data.vouchLimit || 5
            )
        );

    const revoked =
        Boolean(
            data.vouchRevoked[userId]
        );

    /*
    User qualifies:
    Give the role automatically.
    */

    if (
        count >= limit &&
        !revoked
    ) {
        if (
            !member.roles.cache.has(
                role.id
            )
        ) {
            try {
                await member.roles.add(
                    role,
                    "VC+: reached vouch requirement"
                );

                console.log(
                    `[VC+] Automatically gave ${role.name} to ${member.user.tag}`
                );
            } catch (error) {
                console.error(
                    "[VC+] Failed to give vouch role:",
                    error
                );

                return false;
            }
        }

        return true;
    }

    /*
    User no longer qualifies:
    Remove the role automatically.
    */

    if (
        member.roles.cache.has(
            role.id
        )
    ) {
        try {
            await member.roles.remove(
                role,
                "VC+: no longer meets vouch requirement"
            );
        } catch (error) {
            console.error(
                "[VC+] Failed to remove vouch role:",
                error
            );

            return false;
        }
    }

    return false;
}

async function syncAllVouchRoles(
    guild
) {
    const data =
        guildData(guild);

    if (
        !data.roles.vouch
    ) {
        return;
    }

    for (
        const userId of Object.keys(
            data.vouches
        )
    ) {
        await syncVouchRole(
            guild,
            userId
        );
    }
}

/*
==================================================
VC HELPERS
==================================================
*/

function getTempVC(
    guild,
    channelId
) {
    const data =
        guildData(guild);

    return (
        data.tempVCs[
            channelId
        ] || null
    );
}

function isTempVC(
    guild,
    channelId
) {
    return Boolean(
        getTempVC(
            guild,
            channelId
        )
    );
}

function isVCOwner(
    member,
    channel
) {
    const record =
        getTempVC(
            member.guild,
            channel.id
        );

    if (!record) {
        return false;
    }

    return (
        record.ownerId ===
        member.id
    );
}

/*
==================================================
VC INTERFACE
==================================================
*/

function buildVCInterface() {
    const row1 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_lock"
                    )
                    .setLabel(
                        "Lock"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_unlock"
                    )
                    .setLabel(
                        "Unlock"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_claim"
                    )
                    .setLabel(
                        "Claim"
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_rename"
                    )
                    .setLabel(
                        "Rename"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    const row2 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_limit"
                    )
                    .setLabel(
                        "Limit"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_permit"
                    )
                    .setLabel(
                        "Permit"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_reject"
                    )
                    .setLabel(
                        "Reject"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_kick"
                    )
                    .setLabel(
                        "Kick"
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    const row3 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_transfer"
                    )
                    .setLabel(
                        "Transfer"
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_settings"
                    )
                    .setLabel(
                        "Settings"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    return [
        row1,
        row2,
        row3
    ];
}

async function sendVCInterface(
    channel
) {
    try {
        const message =
            await channel.send({
                content: plain(
                    "VC+ INTERFACE",
                    "Use the controls below to manage your temporary VC."
                ),
                components:
                    buildVCInterface()
            });

        const data =
            guildData(
                channel.guild
            );

        if (
            data.tempVCs[
                channel.id
            ]
        ) {
            data.tempVCs[
                channel.id
            ].interfaceMessageId =
                message.id;
        }

        saveDatabase();

        return message;
    } catch (error) {
        console.error(
            "[VC+] VC interface error:",
            error
        );

        return null;
    }
}

/*
==================================================
JTC SETUP
==================================================
*/

async function setupJTC(
    guild,
    category
) {
    const data =
        guildData(guild);

    let selectedCategory =
        category;

    if (
        !selectedCategory
    ) {
        selectedCategory =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name
                        .toLowerCase() ===
                        "voice"
            );
    }

    if (
        !selectedCategory
    ) {
        selectedCategory =
            await guild.channels.create({
                name: "VOICE",
                type:
                    ChannelType.GuildCategory
            });
    }

    let trigger =
        guild.channels.cache.find(
            channel =>
                channel.type ===
                    ChannelType.GuildVoice &&
                channel.name
                    .toLowerCase() ===
                    "vc-user"
        );

    if (!trigger) {
        trigger =
            await guild.channels.create({
                name: "VC-USER",
                type:
                    ChannelType.GuildVoice,
                parent:
                    selectedCategory.id
            });
    } else if (
        trigger.parentId !==
        selectedCategory.id
    ) {
        await trigger.setParent(
            selectedCategory.id
        );
    }

    data.jtc.channelId =
        trigger.id;

    data.jtc.categoryId =
        selectedCategory.id;

    saveDatabase();

    return {
        trigger,
        category:
            selectedCategory
    };
}

async function createTempVC(
    member
) {
    const guild =
        member.guild;

    const data =
        guildData(guild);

    if (
        !data.jtc.categoryId
    ) {
        return null;
    }

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (
        !category ||
        category.type !==
            ChannelType.GuildCategory
    ) {
        return null;
    }

    const channelName =
        cleanName(
            `${member.displayName}'s VC`
        );

    const channel =
        await guild.channels.create({
            name: channelName,
            type:
                ChannelType.GuildVoice,
            parent:
                category.id,
            userLimit: 0,

            permissionOverwrites: [
                {
                    id:
                        guild.roles.everyone.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },

                {
                    id: member.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.MoveMembers,
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.DeafenMembers
                    ]
                }
            ]
        });

    data.tempVCs[
        channel.id
    ] = {
        ownerId:
            member.id,

        locked: false,

        banned: [],

        permitted: [],

        stfu: [],

        interfaceMessageId:
            null
    };

    saveDatabase();

    try {
        await member.voice.setChannel(
            channel
        );
    } catch (error) {
        console.error(
            "[VC+] Failed to move user:",
            error
        );
    }

    await sendVCInterface(
        channel
    );

    return channel;
}

/*
==================================================
LOCK / UNLOCK
==================================================
*/

async function lockVC(
    channel
) {
    const record =
        getTempVC(
            channel.guild,
            channel.id
        );

    if (!record) {
        return false;
    }

    record.locked = true;

    await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone,
        {
            Connect: false
        }
    );

    const owner =
        channel.guild.members.cache.get(
            record.ownerId
        );

    if (owner) {
        await channel.permissionOverwrites.edit(
            owner,
            {
                ViewChannel: true,
                Connect: true
            }
        );
    }

    saveDatabase();

    return true;
}

async function unlockVC(
    channel
) {
    const record =
        getTempVC(
            channel.guild,
            channel.id
        );

    if (!record) {
        return false;
    }

    record.locked = false;

    await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone,
        {
            Connect: true
        }
    );

    saveDatabase();

    return true;
}

/*
==================================================
MESSAGE COMMANDS
==================================================
*/

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                message.author.bot ||
                !message.guild
            ) {
                return;
            }

            const data =
                guildData(
                    message.guild
                );

            /*
            ==============================
            VC TEXT FILTER
            ==============================
            */

            if (
                isTempVC(
                    message.guild,
                    message.channel.id
                ) &&
                data.filters.enabled &&
                data.filters.words.length
            ) {
                const content =
                    message.content
                        .toLowerCase();

                const matched =
                    data.filters.words.some(
                        word =>
                            content.includes(
                                String(
                                    word
                                ).toLowerCase()
                            )
                    );

                if (matched) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        try {
                            await message.delete();
                        } catch {}

                        const key =
                            `${message.guild.id}:${message.author.id}`;

                        const strikes =
                            Number(
                                data.filters
                                    .strikes[key] ||
                                    0
                            ) + 1;

                        data.filters.strikes[
                            key
                        ] = strikes;

                        saveDatabase();

                        if (
                            strikes >=
                            data.filters.maxStrikes
                        ) {
                            if (
                                message.member
                                    .moderatable
                            ) {
                                await message.member
                                    .timeout(
                                        data.filters
                                            .timeoutMinutes *
                                            60 *
                                            1000,
                                        "VC+ automatic filter"
                                    )
                                    .catch(
                                        () => {}
                                    );
                            }

                            data.filters.strikes[
                                key
                            ] = 0;

                            saveDatabase();
                        }

                        return;
                    }
                }
            }

            /*
            ==============================
            PREFIX
            ==============================
            */

            if (
                !message.content.startsWith(
                    PREFIX
                )
            ) {
                return;
            }

            const args =
                message.content
                    .slice(
                        PREFIX.length
                    )
                    .trim()
                    .split(/\s+/);

            const command =
                (
                    args.shift() ||
                    ""
                ).toLowerCase();

            /*
            ==============================
            HELP
            ==============================
            */

            if (
                command === "help"
            ) {
                return message.reply(
                    plain(
                        "COMMANDS",
                        [
                            "-help",
                            "-rank @user <rank>",
                            "-godmode @user",
                            "-godmode @user off",
                            "-vouch @user",
                            "-vouch give @user",
                            "-vouch take @user",
                            "-vouch limit",
                            "-vouch limit <number>",
                            "-vouch role",
                            "-vouch role set @role",
                            "-vouch clear",
                            "-kick @user [reason]",
                            "-ban @user [reason]",
                            "-unban <user id>",
                            "-unbanall",
                            "-foreverban @user",
                            "-foreverunban @user",
                            "-timeout @user <minutes>",
                            "-untimeout @user",
                            "-purge <amount>",
                            "-vc help",
                            "-vc info",
                            "-vc lock",
                            "-vc unlock",
                            "-vc claim",
                            "-vc rename <name>",
                            "-vc limit <number>",
                            "-vc permit @user",
                            "-vc reject @user",
                            "-vc kick @user",
                            "-vc transfer @user",
                            "-vc setup",
                            "-vc setup #category",
                            "-vc setup filter",
                            "-vc setup filter on",
                            "-vc setup filter off",
                            "-vc setup filter add <word>",
                            "-vc setup filter remove <word>",
                            "-vc setup filter list",
                            "-vc setup filter strikes <number>",
                            "-vc setup filter timeout <minutes>",
                            "-vc channel #channel",
                            "-vc category #category",
                            "-vc reset",
                            "-vc list",
                            "-vc delete",
                            "-vc stfu @user",
                            "-vc unstfu @user",
                            "-vc ban @user",
                            "-vc unban @user"
                        ].join("\n")
                    )
                );
            }

            /*
            ==============================
            RANK
            ==============================
            */

            if (
                command === "rank"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                if (
                    args[0] === "set"
                ) {
                    args.shift();
                }

                const target =
                    getMentionedMember(
                        message
                    );

                const rankArg =
                    args.find(
                        arg =>
                            !arg.startsWith(
                                "<@"
                            )
                    );

                const rank =
                    normalizeRank(
                        rankArg
                    );

                if (
                    !target ||
                    !rank
                ) {
                    return replyError(
                        message,
                        "Usage: -rank @user <rank>"
                    );
                }

                if (
                    rank ===
                        "founder" &&
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the Server Owner can assign Founder."
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return replyError(
                        message,
                        "The Server Owner cannot be changed."
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDatabase();

                return message.reply(
                    plain(
                        "RANK",
                        `${target} is now ${RANK_NAMES[rank]}.`
                    )
                );
            }

            /*
            ==============================
            GODMODE
            ==============================
            */

            if (
                command ===
                "godmode"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -godmode @user [off]"
                    );
                }

                const off =
                    args.some(
                        arg =>
                            arg.toLowerCase() ===
                            "off"
                    );

                if (off) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );

                    saveDatabase();

                    return message.reply(
                        plain(
                            "GODMODE",
                            `Godmode removed from ${target}.`
                        )
                    );
                }

                if (
                    !data.godmode.includes(
                        target.id
                    )
                ) {
                    data.godmode.push(
                        target.id
                    );
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "GODMODE",
                        `Godmode enabled for ${target}.`
                    )
                );
            }

            /*
            ==============================
            VOUCH
            ==============================
            */

            if (
                command ===
                "vouch"
            ) {
                const sub =
                    (
                        args.shift() ||
                        ""
                    ).toLowerCase();

                /*
                --------------------------
                -vouch @user
                --------------------------
                */

                if (
                    !sub
                ) {
                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vouch @user"
                        );
                    }

                    const count =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} has ${count} vouch${count === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                --------------------------
                -vouch give @user
                --------------------------
                */

                if (
                    sub === "give"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only Founder or God can give vouches."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vouch give @user"
                        );
                    }

                    const oldCount =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    const newCount =
                        oldCount + 1;

                    data.vouches[
                        target.id
                    ] = newCount;

                    data.vouchRevoked[
                        target.id
                    ] = false;

                    saveDatabase();

                    /*
                    THIS IS WHAT AUTOMATICALLY
                    GIVES THE CONFIGURED ROLE.
                    */

                    const roleGranted =
                        await syncVouchRole(
                            message.guild,
                            target.id
                        );

                    const limit =
                        Math.max(
                            1,
                            Number(
                                data.vouchLimit ||
                                5
                            )
                        );

                    if (
                        roleGranted
                    ) {
                        const role =
                            message.guild.roles.cache.get(
                                data.roles.vouch
                            );

                        return message.reply(
                            plain(
                                "VOUCH",
                                [
                                    `${target} received a vouch.`,
                                    `Vouches: ${newCount}/${limit}`,
                                    `Automatic role granted: ${role}`
                                ].join("\n")
                            )
                        );
                    }

                    if (
                        newCount >=
                        limit
                    ) {
                        return message.reply(
                            plain(
                                "VOUCH",
                                [
                                    `${target} received a vouch.`,
                                    `Vouches: ${newCount}/${limit}`,
                                    "They reached the requirement, but the role could not be granted.",
                                    "Check that VC+ has Manage Roles and that the configured role is below the bot's highest role."
                                ].join("\n")
                            )
                        );
                    }

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} received a vouch. Vouches: ${newCount}/${limit}.`
                        )
                    );
                }

                /*
                --------------------------
                -vouch take @user
                --------------------------
                */

                if (
                    sub === "take"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only Founder or God can take vouches."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vouch take @user"
                        );
                    }

                    const oldCount =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    const newCount =
                        Math.max(
                            0,
                            oldCount - 1
                        );

                    data.vouches[
                        target.id
                    ] = newCount;

                    data.vouchRevoked[
                        target.id
                    ] = false;

                    saveDatabase();

                    await syncVouchRole(
                        message.guild,
                        target.id
                    );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} now has ${newCount} vouch${newCount === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                --------------------------
                -vouch limit
                --------------------------
                */

                if (
                    sub === "limit"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    if (
                        args.length === 0
                    ) {
                        return message.reply(
                            plain(
                                "VOUCH LIMIT",
                                `Current limit: ${data.vouchLimit}`
                            )
                        );
                    }

                    const limit =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 1 ||
                        limit > 100
                    ) {
                        return replyError(
                            message,
                            "The vouch limit must be between 1 and 100."
                        );
                    }

                    data.vouchLimit =
                        limit;

                    saveDatabase();

                    /*
                    Recheck everybody immediately.
                    */

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return message.reply(
                        plain(
                            "VOUCH LIMIT",
                            `Vouch requirement set to ${limit}.`
                        )
                    );
                }

                /*
                --------------------------
                -vouch role
                --------------------------
                */

                if (
                    sub === "role"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const role =
                        getMentionedRole(
                            message
                        );

                    /*
                    Show current role.
                    */

                    if (!role) {
                        if (
                            data.roles.vouch
                        ) {
                            const currentRole =
                                message.guild.roles.cache.get(
                                    data.roles.vouch
                                );

                            return message.reply(
                                plain(
                                    "VOUCH ROLE",
                                    currentRole
                                        ? `Current automatic role: ${currentRole}`
                                        : "The configured vouch role no longer exists."
                                )
                            );
                        }

                        return message.reply(
                            plain(
                                "VOUCH ROLE",
                                "No automatic vouch role is configured."
                            )
                        );
                    }

                    if (
                        role.managed
                    ) {
                        return replyError(
                            message,
                            "Managed roles cannot be used."
                        );
                    }

                    data.roles.vouch =
                        role.id;

                    saveDatabase();

                    /*
                    Immediately check everyone
                    who already has enough vouches.
                    */

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return message.reply(
                        plain(
                            "VOUCH ROLE",
                            `${role} is now the automatic vouch role. Users who meet the vouch requirement will automatically receive it.`
                        )
                    );
                }

                /*
                --------------------------
                -vouch clear
                --------------------------
                */

                if (
                    sub === "clear"
                ) {
                    if (
                        !isServerOwner(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the Server Owner can clear all vouches."
                        );
                    }

                    data.vouches = {};
                    data.vouchRevoked = {};

                    saveDatabase();

                    /*
                    Remove the configured role
                    from everyone who had it.
                    */

                    if (
                        data.roles.vouch
                    ) {
                        const role =
                            message.guild.roles.cache.get(
                                data.roles.vouch
                            );

                        if (
                            role
                        ) {
                            for (
                                const member of message.guild.members.cache.values()
                            ) {
                                if (
                                    member.roles.cache.has(
                                        role.id
                                    )
                                ) {
                                    await member.roles
                                        .remove(
                                            role,
                                            "VC+: vouches cleared"
                                        )
                                        .catch(
                                            () => {}
                                        );
                                }
                            }
                        }
                    }

                    return message.reply(
                        plain(
                            "VOUCH",
                            "All vouches were cleared and the automatic vouch role was removed where applicable."
                        )
                    );
                }

                return replyError(
                    message,
                    "Unknown vouch command."
                );
            }

            /*
            ==============================
            KICK
            ==============================
            */

            if (
                command === "kick"
            ) {
                if (
                    !hasRank(
                        message.member,
                        3
                    )
                ) {
                    return replyError(
                        message,
                        "Moderator rank or higher is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -kick @user [reason]"
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                if (
                    !target.kickable
                ) {
                    return replyError(
                        message,
                        "I cannot kick that member."
                    );
                }

                const reason =
                    args
                        .filter(
                            arg =>
                                !arg.startsWith(
                                    "<@"
                                )
                        )
                        .join(" ") ||
                    "No reason provided.";

                await target.kick(
                    reason
                );

                return message.reply(
                    plain(
                        "KICK",
                        `${target.user.tag} was kicked.`
                    )
                );
            }

            /*
            ==============================
            BAN
            ==============================
            */

            if (
                command === "ban"
            ) {
                if (
                    !hasRank(
                        message.member,
                        5
                    )
                ) {
                    return replyError(
                        message,
                        "Director rank or higher is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -ban @user [reason]"
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                if (
                    !target.bannable
                ) {
                    return replyError(
                        message,
                        "I cannot ban that member."
                    );
                }

                const reason =
                    args
                        .filter(
                            arg =>
                                !arg.startsWith(
                                    "<@"
                                )
                        )
                        .join(" ") ||
                    "No reason provided.";

                await target.ban({
                    reason
                });

                return message.reply(
                    plain(
                        "BAN",
                        `${target.user.tag} was banned.`
                    )
                );
            }

            /*
            ==============================
            UNBAN
            ==============================
            */

            if (
                command === "unban"
            ) {
                if (
                    !hasRank(
                        message.member,
                        5
                    )
                ) {
                    return replyError(
                        message,
                        "Director rank or higher is required."
                    );
                }

                const userId =
                    args[0];

                if (
                    !userId ||
                    !/^\d+$/.test(
                        userId
                    )
                ) {
                    return replyError(
                        message,
                        "Usage: -unban <user id>"
                    );
                }

                await message.guild.members
                    .unban(
                        userId,
                        "VC+: unban"
                    );

                return message.reply(
                    plain(
                        "UNBAN",
                        `${userId} was unbanned.`
                    )
                );
            }

            /*
            ==============================
            UNBAN ALL
            ==============================
            */

            if (
                command ===
                "unbanall"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                const bans =
                    await message.guild.bans.fetch();

                let count = 0;

                for (
                    const ban of bans.values()
                ) {
                    await message.guild.members
                        .unban(
                            ban.user.id,
                            "VC+: unbanall"
                        )
                        .catch(
                            () => {}
                        );

                    count++;
                }

                return message.reply(
                    plain(
                        "UNBAN ALL",
                        `${count} users were unbanned.`
                    )
                );
            }

            /*
            ==============================
            FOREVER BAN
            ==============================
            */

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -foreverban @user"
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return replyError(
                        message,
                        "The Server Owner cannot be forever banned."
                    );
                }

                if (
                    !data.foreverBanned.includes(
                        target.id
                    )
                ) {
                    data.foreverBanned.push(
                        target.id
                    );
                }

                saveDatabase();

                if (
                    target.bannable
                ) {
                    await target.ban({
                        reason:
                            "VC+: forever ban"
                    });
                }

                return message.reply(
                    plain(
                        "FOREVER BAN",
                        `${target.user.tag} is now permanently banned.`
                    )
                );
            }

            /*
            ==============================
            FOREVER UNBAN
            ==============================
            */

            if (
                command ===
                "foreverunban"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                let userId =
                    args[0];

                const mentioned =
                    getMentionedMember(
                        message
                    );

                if (
                    mentioned
                ) {
                    userId =
                        mentioned.id;
                }

                if (
                    !userId ||
                    !/^\d+$/.test(
                        userId
                    )
                ) {
                    return replyError(
                        message,
                        "Usage: -foreverunban @user"
                    );
                }

                data.foreverBanned =
                    data.foreverBanned.filter(
                        id =>
                            id !==
                            userId
                    );

                saveDatabase();

                await message.guild.members
                    .unban(
                        userId,
                        "VC+: forever ban removed"
                    )
                    .catch(
                        () => {}
                    );

                return message.reply(
                    plain(
                        "FOREVER UNBAN",
                        `${userId} is no longer permanently banned.`
                    )
                );
            }

            /*
            ==============================
            TIMEOUT
            ==============================
            */

            if (
                command ===
                "timeout"
            ) {
                if (
                    !hasRank(
                        message.member,
                        3
                    )
                ) {
                    return replyError(
                        message,
                        "Moderator rank or higher is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                const minutes =
                    Number(
                        args.find(
                            value =>
                                /^\d+$/.test(
                                    value
                                )
                        )
                    );

                if (
                    !target ||
                    !Number.isInteger(
                        minutes
                    ) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Usage: -timeout @user <minutes> [reason]"
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                if (
                    !target.moderatable
                ) {
                    return replyError(
                        message,
                        "I cannot timeout that member."
                    );
                }

                await target.timeout(
                    minutes * 60 * 1000,
                    "VC+: timeout"
                );

                return message.reply(
                    plain(
                        "TIMEOUT",
                        `${target.user.tag} was timed out for ${minutes} minute${minutes === 1 ? "" : "s"}.`
                    )
                );
            }

            /*
            ==============================
            UNTIMEOUT
            ==============================
            */

            if (
                command ===
                "untimeout"
            ) {
                if (
                    !hasRank(
                        message.member,
                        3
                    )
                ) {
                    return replyError(
                        message,
                        "Moderator rank or higher is required."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -untimeout @user"
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                await target.timeout(
                    null,
                    "VC+: timeout removed"
                );

                return message.reply(
                    plain(
                        "UNTIMEOUT",
                        `${target.user.tag} is no longer timed out.`
                    )
                );
            }

            /*
            ==============================
            PURGE
            ==============================
            */

            if (
                command ===
                "purge"
            ) {
                if (
                    !hasRank(
                        message.member,
                        3
                    )
                ) {
                    return replyError(
                        message,
                        "Moderator rank or higher is required."
                    );
                }

                const amount =
                    Number(
                        args[0]
                    );

                if (
                    !Number.isInteger(
                        amount
                    ) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return replyError(
                        message,
                        "Usage: -purge <1-100>"
                    );
                }

                const deleted =
                    await message.channel.bulkDelete(
                        amount + 1,
                        true
                    );

                const response =
                    await message.channel.send(
                        plain(
                            "PURGE",
                            `${Math.max(0, deleted.size - 1)} messages removed.`
                        )
                    );

                setTimeout(
                    () =>
                        response
                            .delete()
                            .catch(
                                () => {}
                            ),
                    3000
                );

                return;
            }

            /*
            ==============================
            VC COMMAND
            ==============================
            */

            if (
                command === "vc"
            ) {
                const sub =
                    (
                        args.shift() ||
                        ""
                    ).toLowerCase();

                /*
                --------------------------
                VC HELP
                --------------------------
                */

                if (
                    sub === "help"
                ) {
                    return message.reply(
                        plain(
                            "VC COMMANDS",
                            [
                                "-vc help",
                                "-vc info",
                                "-vc lock",
                                "-vc unlock",
                                "-vc claim",
                                "-vc rename <name>",
                                "-vc limit <number>",
                                "-vc permit @user",
                                "-vc reject @user",
                                "-vc kick @user",
                                "-vc transfer @user",
                                "-vc setup",
                                "-vc setup #category",
                                "-vc setup filter",
                                "-vc setup filter on",
                                "-vc setup filter off",
                                "-vc setup filter add <word>",
                                "-vc setup filter remove <word>",
                                "-vc setup filter list",
                                "-vc setup filter strikes <number>",
                                "-vc setup filter timeout <minutes>",
                                "-vc channel #channel",
                                "-vc category #category",
                                "-vc reset",
                                "-vc list",
                                "-vc delete",
                                "-vc stfu @user",
                                "-vc unstfu @user",
                                "-vc ban @user",
                                "-vc unban @user"
                            ].join("\n")
                        )
                    );
                }

                /*
                --------------------------
                VC SETUP
                --------------------------
                */

                if (
                    sub === "setup"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const option =
                        (
                            args[0] ||
                            ""
                        ).toLowerCase();

                    /*
                    FILTER
                    */

                    if (
                        option ===
                        "filter"
                    ) {
                        const action =
                            (
                                args[1] ||
                                ""
                            ).toLowerCase();

                        if (
                            !action
                        ) {
                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    [
                                        `Enabled: ${data.filters.enabled ? "Yes" : "No"}`,
                                        `Words: ${data.filters.words.length}`,
                                        `Strikes: ${data.filters.maxStrikes}`,
                                        `Timeout: ${data.filters.timeoutMinutes} minutes`
                                    ].join("\n")
                                )
                            );
                        }

                        if (
                            action ===
                            "on"
                        ) {
                            data.filters.enabled =
                                true;

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    "VC text filtering is enabled."
                                )
                            );
                        }

                        if (
                            action ===
                            "off"
                        ) {
                            data.filters.enabled =
                                false;

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    "VC text filtering is disabled."
                                )
                            );
                        }

                        if (
                            action ===
                            "add"
                        ) {
                            const word =
                                args
                                    .slice(2)
                                    .join(" ")
                                    .trim()
                                    .toLowerCase();

                            if (!word) {
                                return replyError(
                                    message,
                                    "Usage: -vc setup filter add <word>"
                                );
                            }

                            if (
                                !data.filters.words.includes(
                                    word
                                )
                            ) {
                                data.filters.words.push(
                                    word
                                );
                            }

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    `Added "${word}".`
                                )
                            );
                        }

                        if (
                            action ===
                            "remove"
                        ) {
                            const word =
                                args
                                    .slice(2)
                                    .join(" ")
                                    .trim()
                                    .toLowerCase();

                            data.filters.words =
                                data.filters.words.filter(
                                    value =>
                                        value !==
                                        word
                                );

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    `Removed "${word}".`
                                )
                            );
                        }

                        if (
                            action ===
                            "list"
                        ) {
                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    data.filters.words.length
                                        ? data.filters.words.join(
                                              "\n"
                                          )
                                        : "No filtered words."
                                )
                            );
                        }

                        if (
                            action ===
                            "strikes"
                        ) {
                            const number =
                                Number(
                                    args[2]
                                );

                            if (
                                !Number.isInteger(
                                    number
                                ) ||
                                number < 1 ||
                                number > 20
                            ) {
                                return replyError(
                                    message,
                                    "Strikes must be between 1 and 20."
                                );
                            }

                            data.filters.maxStrikes =
                                number;

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    `Maximum strikes set to ${number}.`
                                )
                            );
                        }

                        if (
                            action ===
                            "timeout"
                        ) {
                            const minutes =
                                Number(
                                    args[2]
                                );

                            if (
                                !Number.isInteger(
                                    minutes
                                ) ||
                                minutes < 1 ||
                                minutes > 40320
                            ) {
                                return replyError(
                                    message,
                                    "Timeout must be between 1 and 40320 minutes."
                                );
                            }

                            data.filters.timeoutMinutes =
                                minutes;

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    `Filter timeout set to ${minutes} minutes.`
                                )
                            );
                        }

                        return replyError(
                            message,
                            "Unknown filter command."
                        );
                    }

                    /*
                    NORMAL JTC SETUP
                    */

                    const category =
                        message.mentions.channels.find(
                            channel =>
                                channel.type ===
                                ChannelType.GuildCategory
                        );

                    const result =
                        await setupJTC(
                            message.guild,
                            category
                        );

                    return message.reply(
                        plain(
                            "VC SETUP",
                            [
                                "Join-to-create is ready.",
                                `Trigger: ${result.trigger}`,
                                `Category: ${result.category}`
                            ].join("\n")
                        )
                    );
                }

                /*
                --------------------------
                VC CHANNEL
                --------------------------
                */

                if (
                    sub === "channel"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const channel =
                        message.mentions.channels.first();

                    if (
                        !channel ||
                        channel.type !==
                            ChannelType.GuildVoice
                    ) {
                        return replyError(
                            message,
                            "Mention a voice channel."
                        );
                    }

                    data.jtc.channelId =
                        channel.id;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC CHANNEL",
                            `Join-to-create trigger set to ${channel}.`
                        )
                    );
                }

                /*
                --------------------------
                VC CATEGORY
                --------------------------
                */

                if (
                    sub === "category"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const category =
                        message.mentions.channels.first();

                    if (
                        !category ||
                        category.type !==
                            ChannelType.GuildCategory
                    ) {
                        return replyError(
                            message,
                            "Mention a category."
                        );
                    }

                    data.jtc.categoryId =
                        category.id;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC CATEGORY",
                            `VC category set to ${category}.`
                        )
                    );
                }

                /*
                --------------------------
                VC RESET
                --------------------------
                */

                if (
                    sub === "reset"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    data.jtc = {
                        channelId: null,
                        categoryId: null
                    };

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC RESET",
                            "VC setup has been reset."
                        )
                    );
                }

                /*
                --------------------------
                VC LIST
                --------------------------
                */

                if (
                    sub === "list"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const list =
                        Object.entries(
                            data.tempVCs
                        );

                    if (
                        !list.length
                    ) {
                        return message.reply(
                            plain(
                                "VC LIST",
                                "No active temporary VCs."
                            )
                        );
                    }

                    const text =
                        list
                            .map(
                                ([id, record]) =>
                                    `<#${id}> — <@${record.ownerId}>`
                            )
                            .join("\n");

                    return message.reply(
                        plain(
                            "VC LIST",
                            text
                        )
                    );
                }

                /*
                --------------------------
                VC DELETE
                --------------------------
                */

                if (
                    sub === "delete"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    let count = 0;

                    for (
                        const channelId of Object.keys(
                            data.tempVCs
                        )
                    ) {
                        const channel =
                            message.guild.channels.cache.get(
                                channelId
                            );

                        if (
                            channel
                        ) {
                            await channel
                                .delete(
                                    "VC+: founder delete"
                                )
                                .catch(
                                    () => {}
                                );

                            count++;
                        }

                        delete data.tempVCs[
                            channelId
                        ];
                    }

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC DELETE",
                            `${count} temporary VCs deleted.`
                        )
                    );
                }

                /*
                --------------------------
                FOUNDER VC CONTROLS
                --------------------------
                */

                if (
                    [
                        "stfu",
                        "unstfu",
                        "ban",
                        "unban"
                    ].includes(sub)
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Founder rank or the Server Owner is required."
                        );
                    }

                    const channel =
                        message.member.voice.channel;

                    if (
                        !channel
                    ) {
                        return replyError(
                            message,
                            "You must be inside a temporary VC."
                        );
                    }

                    const record =
                        getTempVC(
                            message.guild,
                            channel.id
                        );

                    if (
                        !record
                    ) {
                        return replyError(
                            message,
                            "This is not a VC+ temporary VC."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (
                        !target
                    ) {
                        return replyError(
                            message,
                            `Usage: -vc ${sub} @user`
                        );
                    }

                    if (
                        sub === "stfu"
                    ) {
                        if (
                            !record.stfu.includes(
                                target.id
                            )
                        ) {
                            record.stfu.push(
                                target.id
                            );
                        }

                        await target.voice
                            .setMute(
                                true,
                                "VC+: Founder STFU"
                            )
                            .catch(
                                () => {}
                            );

                        saveDatabase();

                        return message.reply(
                            plain(
                                "VC STFU",
                                `${target} has been muted in this VC.`
                            )
                        );
                    }

                    if (
                        sub ===
                        "unstfu"
                    ) {
                        record.stfu =
                            record.stfu.filter(
                                id =>
                                    id !==
                                    target.id
                            );

                        await target.voice
                            .setMute(
                                false,
                                "VC+: Founder UNSTFU"
                            )
                            .catch(
                                () => {}
                            );

                        saveDatabase();

                        return message.reply(
                            plain(
                                "VC UNSTFU",
                                `${target} can speak again.`
                            )
                        );
                    }

                    if (
                        sub ===
                        "ban"
                    ) {
                        if (
                            !record.banned.includes(
                                target.id
                            )
                        ) {
                            record.banned.push(
                                target.id
                            );
                        }

                        await channel.permissionOverwrites.edit(
                            target,
                            {
                                Connect: false,
                                ViewChannel: false
                            }
                        );

                        if (
                            target.voice.channelId ===
                            channel.id
                        ) {
                            await target.voice
                                .disconnect(
                                    "VC+: VC ban"
                                )
                                .catch(
                                    () => {}
                                );
                        }

                        saveDatabase();

                        return message.reply(
                            plain(
                                "VC BAN",
                                `${target} is banned from this VC.`
                            )
                        );
                    }

                    if (
                        sub ===
                        "unban"
                    ) {
                        record.banned =
                            record.banned.filter(
                                id =>
                                    id !==
                                    target.id
                            );

                        await channel.permissionOverwrites
                            .delete(
                                target.id
                            )
                            .catch(
                                () => {}
                            );

                        saveDatabase();

                        return message.reply(
                            plain(
                                "VC UNBAN",
                                `${target} is no longer banned from this VC.`
                            )
                        );
                    }
                }

                /*
                --------------------------
                CURRENT VC
                --------------------------
                */

                const channel =
                    message.member.voice.channel;

                if (
                    !channel
                ) {
                    return replyError(
                        message,
                        "You must be inside a temporary VC."
                    );
                }

                const record =
                    getTempVC(
                        message.guild,
                        channel.id
                    );

                if (
                    !record
                ) {
                    return replyError(
                        message,
                        "This is not a VC+ temporary VC."
                    );
                }

                /*
                INFO
                */

                if (
                    sub === "info"
                ) {
                    return message.reply(
                        plain(
                            "VC INFO",
                            [
                                `Owner: <@${record.ownerId}>`,
                                `Locked: ${record.locked ? "Yes" : "No"}`,
                                `User limit: ${channel.userLimit || "Unlimited"}`,
                                `Permitted: ${record.permitted.length}`,
                                `Banned: ${record.banned.length}`,
                                `STFU: ${record.stfu.length}`
                            ].join("\n")
                        )
                    );
                }

                /*
                NORMAL VC COMMANDS REQUIRE OWNER
                */

                if (
                    !isVCOwner(
                        message.member,
                        channel
                    )
                ) {
                    return replyError(
                        message,
                        "You must be the owner of this VC."
                    );
                }

                /*
                LOCK
                */

                if (
                    sub === "lock"
                ) {
                    await lockVC(
                        channel
                    );

                    return message.reply(
                        plain(
                            "VC LOCK",
                            "Your VC has been locked."
                        )
                    );
                }

                /*
                UNLOCK
                */

                if (
                    sub === "unlock"
                ) {
                    await unlockVC(
                        channel
                    );

                    return message.reply(
                        plain(
                            "VC UNLOCK",
                            "Your VC has been unlocked."
                        )
                    );
                }

                /*
                CLAIM
                */

                if (
                    sub === "claim"
                ) {
                    const oldOwner =
                        message.guild.members.cache.get(
                            record.ownerId
                        );

                    if (
                        oldOwner &&
                        oldOwner.voice.channelId ===
                            channel.id
                    ) {
                        return replyError(
                            message,
                            "The current owner is still inside the VC."
                        );
                    }

                    record.ownerId =
                        message.member.id;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC CLAIM",
                            "You now own this VC."
                        )
                    );
                }

                /*
                RENAME
                */

                if (
                    sub === "rename"
                ) {
                    const name =
                        cleanName(
                            args.join(" ")
                        );

                    if (!name) {
                        return replyError(
                            message,
                            "Usage: -vc rename <name>"
                        );
                    }

                    await channel.setName(
                        name
                    );

                    return message.reply(
                        plain(
                            "VC RENAME",
                            `VC renamed to ${name}.`
                        )
                    );
                }

                /*
                LIMIT
                */

                if (
                    sub === "limit"
                ) {
                    const limit =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        return replyError(
                            message,
                            "Usage: -vc limit <0-99>"
                        );
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    return message.reply(
                        plain(
                            "VC LIMIT",
                            `User limit set to ${limit}.`
                        )
                    );
                }

                /*
                PERMIT
                */

                if (
                    sub === "permit"
                ) {
                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vc permit @user"
                        );
                    }

                    if (
                        !record.permitted.includes(
                            target.id
                        )
                    ) {
                        record.permitted.push(
                            target.id
                        );
                    }

                    await channel.permissionOverwrites.edit(
                        target,
                        {
                            ViewChannel: true,
                            Connect: true
                        }
                    );

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC PERMIT",
                            `${target} can now join this VC.`
                        )
                    );
                }

                /*
                REJECT
                */

                if (
                    sub === "reject"
                ) {
                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vc reject @user"
                        );
                    }

                    record.permitted =
                        record.permitted.filter(
                            id =>
                                id !==
                                target.id
                        );

                    await channel.permissionOverwrites.edit(
                        target,
                        {
                            Connect: false
                        }
                    );

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice
                            .disconnect(
                                "VC+: rejected"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC REJECT",
                            `${target} was rejected from this VC.`
                        )
                    );
                }

                /*
                KICK
                */

                if (
                    sub === "kick"
                ) {
                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vc kick @user"
                        );
                    }

                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return replyError(
                            message,
                            "That user is not inside this VC."
                        );
                    }

                    await target.voice
                        .disconnect(
                            "VC+: owner kick"
                        );

                    return message.reply(
                        plain(
                            "VC KICK",
                            `${target} was removed from the VC.`
                        )
                    );
                }

                /*
                TRANSFER
                */

                if (
                    sub ===
                    "transfer"
                ) {
                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vc transfer @user"
                        );
                    }

                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return replyError(
                            message,
                            "The new owner must be inside the VC."
                        );
                    }

                    record.ownerId =
                        target.id;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC TRANSFER",
                            `${target} is now the VC owner.`
                        )
                    );
                }

                return replyError(
                    message,
                    "Unknown VC command. Use -vc help."
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Message handler error:",
                error
            );

            try {
                await message.reply(
                    plain(
                        "ERROR",
                        "Something went wrong while processing that command."
                    )
                );
            } catch {}
        }
    }
);

/*
==================================================
BUTTONS + MODALS
==================================================
*/

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                interaction.isButton()
            ) {
                const member =
                    interaction.member;

                if (
                    !member ||
                    !interaction.guild
                ) {
                    return;
                }

                const channel =
                    member.voice.channel;

                if (
                    !channel
                ) {
                    return interaction.reply({
                        content: plain(
                            "ERROR",
                            "You must be inside your temporary VC."
                        ),
                        ephemeral: true
                    });
                }

                const record =
                    getTempVC(
                        interaction.guild,
                        channel.id
                    );

                if (
                    !record
                ) {
                    return interaction.reply({
                        content: plain(
                            "ERROR",
                            "This is not a VC+ temporary VC."
                        ),
                        ephemeral: true
                    });
                }

                /*
                Founder-only buttons
                */

                if (
                    [
                        "vc_stfu",
                        "vc_unstfu",
                        "vc_ban",
                        "vc_unban"
                    ].includes(
                        interaction.customId
                    )
                ) {
                    if (
                        !isFounder(
                            member
                        )
                    ) {
                        return interaction.reply({
                            content: plain(
                                "ACCESS DENIED",
                                "Founder rank or the Server Owner is required."
                            ),
                            ephemeral: true
                        });
                    }
                }

                /*
                Normal buttons
                */

                if (
                    !isVCOwner(
                        member,
                        channel
                    )
                ) {
                    return interaction.reply({
                        content: plain(
                            "ACCESS DENIED",
                            "You must be the owner of this VC."
                        ),
                        ephemeral: true
                    });
                }

                /*
                LOCK
                */

                if (
                    interaction.customId ===
                    "vc_lock"
                ) {
                    await lockVC(
                        channel
                    );

                    return interaction.reply({
                        content: plain(
                            "VC LOCK",
                            "Your VC has been locked."
                        ),
                        ephemeral: true
                    });
                }

                /*
                UNLOCK
                */

                if (
                    interaction.customId ===
                    "vc_unlock"
                ) {
                    await unlockVC(
                        channel
                    );

                    return interaction.reply({
                        content: plain(
                            "VC UNLOCK",
                            "Your VC has been unlocked."
                        ),
                        ephemeral: true
                    });
                }

                /*
                CLAIM
                */

                if (
                    interaction.customId ===
                    "vc_claim"
                ) {
                    const oldOwner =
                        interaction.guild.members.cache.get(
                            record.ownerId
                        );

                    if (
                        oldOwner &&
                        oldOwner.voice.channelId ===
                            channel.id
                    ) {
                        return interaction.reply({
                            content: plain(
                                "VC CLAIM",
                                "The current owner is still inside the VC."
                            ),
                            ephemeral: true
                        });
                    }

                    record.ownerId =
                        member.id;

                    saveDatabase();

                    return interaction.reply({
                        content: plain(
                            "VC CLAIM",
                            "You now own this VC."
                        ),
                        ephemeral: true
                    });
                }

                /*
                RENAME
                */

                if (
                    interaction.customId ===
                    "vc_rename"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_rename_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | RENAME"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "name"
                            )
                            .setLabel(
                                "NEW NAME"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the new voice channel name"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                100
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                LIMIT
                */

                if (
                    interaction.customId ===
                    "vc_limit"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_limit_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | LIMIT"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "limit"
                            )
                            .setLabel(
                                "USER LIMIT"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter a number from 0 to 99"
                            )
                            .setRequired(
                                true
                            )
                            .setMaxLength(
                                2
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                PERMIT
                */

                if (
                    interaction.customId ===
                    "vc_permit"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_permit_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | PERMIT"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user"
                            )
                            .setLabel(
                                "USER ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the Discord user ID"
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                REJECT
                */

                if (
                    interaction.customId ===
                    "vc_reject"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_reject_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | REJECT"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user"
                            )
                            .setLabel(
                                "USER ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the Discord user ID"
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                KICK
                */

                if (
                    interaction.customId ===
                    "vc_kick"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_kick_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | KICK"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user"
                            )
                            .setLabel(
                                "USER ID"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the Discord user ID"
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                TRANSFER
                */

                if (
                    interaction.customId ===
                    "vc_transfer"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_modal_transfer_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | TRANSFER"
                            );

                    const input =
                        new TextInputBuilder()
                            .setCustomId(
                                "user"
                            )
                            .setLabel(
                                "NEW OWNER"
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setPlaceholder(
                                "Enter the Discord user ID"
                            )
                            .setRequired(
                                true
                            );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return interaction.showModal(
                        modal
                    );
                }

                /*
                SETTINGS
                */

                if (
                    interaction.customId ===
                    "vc_settings"
                ) {
                    return interaction.reply({
                        content: plain(
                            "VC SETTINGS",
                            [
                                `Owner: <@${record.ownerId}>`,
                                `Locked: ${record.locked ? "Yes" : "No"}`,
                                `Limit: ${channel.userLimit || "Unlimited"}`,
                                `Permitted: ${record.permitted.length}`,
                                `Banned: ${record.banned.length}`,
                                `STFU: ${record.stfu.length}`
                            ].join("\n")
                        ),
                        ephemeral: true
                    });
                }

                return;
            }

            /*
            ==========================================
            MODALS
            ==========================================
            */

            if (
                interaction.isModalSubmit()
            ) {
                const member =
                    interaction.member;

                if (
                    !member ||
                    !interaction.guild
                ) {
                    return;
                }

                const id =
                    interaction.customId;

                const match =
                    id.match(
                        /^vc_modal_(rename|limit|permit|reject|kick|transfer)_(\d+)$/
                    );

                if (!match) {
                    return;
                }

                const action =
                    match[1];

                const channelId =
                    match[2];

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                if (
                    !channel
                ) {
                    return interaction.reply({
                        content: plain(
                            "ERROR",
                            "That VC no longer exists."
                        ),
                        ephemeral: true
                    });
                }

                const record =
                    getTempVC(
                        interaction.guild,
                        channel.id
                    );

                if (
                    !record ||
                    record.ownerId !==
                        member.id
                ) {
                    return interaction.reply({
                        content: plain(
                            "ACCESS DENIED",
                            "You are not the owner of this VC."
                        ),
                        ephemeral: true
                    });
                }

                /*
                RENAME
                */

                if (
                    action ===
                    "rename"
                ) {
                    const name =
                        cleanName(
                            interaction.fields.getTextInputValue(
                                "name"
                            )
                        );

                    if (!name) {
                        return interaction.reply({
                            content: plain(
                                "ERROR",
                                "Enter a valid name."
                            ),
                            ephemeral: true
                        });
                    }

                    await channel.setName(
                        name
                    );

                    return interaction.reply({
                        content: plain(
                            "VC RENAME",
                            `VC renamed to ${name}.`
                        ),
                        ephemeral: true
                    });
                }

                /*
                LIMIT
                */

                if (
                    action ===
                    "limit"
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
                            content: plain(
                                "ERROR",
                                "Enter a whole number from 0 to 99."
                            ),
                            ephemeral: true
                        });
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    return interaction.reply({
                        content: plain(
                            "VC LIMIT",
                            `User limit set to ${limit}.`
                        ),
                        ephemeral: true
                    });
                }

                /*
                USER ACTIONS
                */

                const userId =
                    interaction.fields
                        .getTextInputValue(
                            "user"
                        )
                        .replace(
                            /\D/g,
                            ""
                        );

                const target =
                    await interaction.guild.members
                        .fetch(userId)
                        .catch(
                            () => null
                        );

                if (
                    !target
                ) {
                    return interaction.reply({
                        content: plain(
                            "ERROR",
                            "I could not find that member."
                        ),
                        ephemeral: true
                    });
                }

                /*
                PERMIT
                */

                if (
                    action ===
                    "permit"
                ) {
                    if (
                        !record.permitted.includes(
                            target.id
                        )
                    ) {
                        record.permitted.push(
                            target.id
                        );
                    }

                    await channel.permissionOverwrites.edit(
                        target,
                        {
                            ViewChannel: true,
                            Connect: true
                        }
                    );

                    saveDatabase();

                    return interaction.reply({
                        content: plain(
                            "VC PERMIT",
                            `${target} can now join this VC.`
                        ),
                        ephemeral: true
                    });
                }

                /*
                REJECT
                */

                if (
                    action ===
                    "reject"
                ) {
                    record.permitted =
                        record.permitted.filter(
                            id =>
                                id !==
                                target.id
                        );

                    await channel.permissionOverwrites.edit(
                        target,
                        {
                            Connect: false
                        }
                    );

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice
                            .disconnect(
                                "VC+: rejected"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    saveDatabase();

                    return interaction.reply({
                        content: plain(
                            "VC REJECT",
                            `${target} was rejected from this VC.`
                        ),
                        ephemeral: true
                    });
                }

                /*
                KICK
                */

                if (
                    action ===
                    "kick"
                ) {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return interaction.reply({
                            content: plain(
                                "ERROR",
                                "That user is not in this VC."
                            ),
                            ephemeral: true
                        });
                    }

                    await target.voice
                        .disconnect(
                            "VC+: owner kick"
                        )
                        .catch(
                            () => {}
                        );

                    return interaction.reply({
                        content: plain(
                            "VC KICK",
                            `${target} was removed from the VC.`
                        ),
                        ephemeral: true
                    });
                }

                /*
                TRANSFER
                */

                if (
                    action ===
                    "transfer"
                ) {
                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return interaction.reply({
                            content: plain(
                                "ERROR",
                                "The new owner must be inside this VC."
                            ),
                            ephemeral: true
                        });
                    }

                    record.ownerId =
                        target.id;

                    saveDatabase();

                    return interaction.reply({
                        content: plain(
                            "VC TRANSFER",
                            `${target} is now the owner of this VC.`
                        ),
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error(
                "[VC+] Interaction error:",
                error
            );

            try {
                if (
                    interaction.replied ||
                    interaction.deferred
                ) {
                    await interaction.followUp({
                        content: plain(
                            "ERROR",
                            "Something went wrong while processing that action."
                        ),
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: plain(
                            "ERROR",
                            "Something went wrong while processing that action."
                        ),
                        ephemeral: true
                    });
                }
            } catch {}
        }
    }
);

/*
==================================================
VOICE STATE
==================================================
*/

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) {
                return;
            }

            const data =
                guildData(guild);

            /*
            FOREVER BAN
            */

            if (
                newState.member &&
                data.foreverBanned.includes(
                    newState.member.id
                )
            ) {
                await newState.member
                    .ban({
                        reason:
                            "VC+: forever banned user"
                    })
                    .catch(
                        () => {}
                    );

                return;
            }

            /*
            JOIN TO CREATE
            */

            if (
                newState.channelId ===
                data.jtc.channelId
            ) {
                const member =
                    newState.member;

                if (
                    member &&
                    !member.user.bot
                ) {
                    await createTempVC(
                        member
                    );
                }
            }

            /*
            STFU ENFORCEMENT
            */

            if (
                newState.channelId
            ) {
                const record =
                    data.tempVCs[
                        newState.channelId
                    ];

                if (
                    record &&
                    newState.member &&
                    record.stfu.includes(
                        newState.member.id
                    )
                ) {
                    await newState.member.voice
                        .setMute(
                            true,
                            "VC+: STFU enforcement"
                        )
                        .catch(
                            () => {}
                        );
                }

                /*
                VC BAN ENFORCEMENT
                */

                if (
                    record &&
                    newState.member &&
                    record.banned.includes(
                        newState.member.id
                    )
                ) {
                    await newState.member.voice
                        .disconnect(
                            "VC+: VC ban enforcement"
                        )
                        .catch(
                            () => {}
                        );
                }
            }

            /*
            DELETE EMPTY TEMP VC
            */

            if (
                oldState.channelId
            ) {
                const record =
                    data.tempVCs[
                        oldState.channelId
                    ];

                if (
                    record &&
                    oldState.channel &&
                    oldState.channel.members.size ===
                        0
                ) {
                    const channel =
                        oldState.channel;

                    delete data.tempVCs[
                        channel.id
                    ];

                    saveDatabase();

                    await channel
                        .delete(
                            "VC+: empty VC cleanup"
                        )
                        .catch(
                            () => {}
                        );
                }
            }
        } catch (error) {
            console.error(
                "[VC+] Voice state error:",
                error
            );
        }
    }
);

/*
==================================================
MEMBER JOIN
==================================================
*/

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                guildData(
                    member.guild
                );

            /*
            FOREVER BAN
            */

            if (
                data.foreverBanned.includes(
                    member.id
                )
            ) {
                await member
                    .ban({
                        reason:
                            "VC+: forever banned user rejoined"
                    })
                    .catch(
                        () => {}
                    );

                return;
            }

            /*
            VOUCH ROLE RESTORE

            If they had enough vouches before
            leaving, automatically give the
            configured role when they return.
            */

            await syncVouchRole(
                member.guild,
                member.id
            );
        } catch (error) {
            console.error(
                "[VC+] Guild member add error:",
                error
            );
        }
    }
);

/*
==================================================
READY
==================================================
*/

client.once(
    "ready",
    async () => {
        console.log(
            `[VC+] Logged in as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: "VC+",
                    type:
                        ActivityType.Watching
                }
            ],
            status: "online"
        });

        for (
            const guild of client.guilds.cache.values()
        ) {
            try {
                const data =
                    guildData(
                        guild
                    );

                /*
                CLEAN OLD VCS
                */

                for (
                    const channelId of Object.keys(
                        data.tempVCs
                    )
                ) {
                    const channel =
                        guild.channels.cache.get(
                            channelId
                        );

                    if (
                        !channel
                    ) {
                        delete data.tempVCs[
                            channelId
                        ];

                        continue;
                    }

                    if (
                        channel.type ===
                            ChannelType.GuildVoice &&
                        channel.members.size ===
                            0
                    ) {
                        await channel
                            .delete(
                                "VC+: startup cleanup"
                            )
                            .catch(
                                () => {}
                            );

                        delete data.tempVCs[
                            channelId
                        ];
                    }
                }

                /*
                SYNC ALL VOUCH ROLES
                */

                await syncAllVouchRoles(
                    guild
                );

                saveDatabase();
            } catch (error) {
                console.error(
                    `[VC+] Startup error in ${guild.name}:`,
                    error
                );
            }
        }
    }
);

/*
==================================================
ANTI-CRASH
==================================================
*/

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+] Unhandled rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[VC+] Uncaught exception:",
            error
        );
    }
);

process.on(
    "uncaughtExceptionMonitor",
    error => {
        console.error(
            "[VC+] Uncaught exception monitor:",
            error
        );
    }
);

/*
==================================================
GRACEFUL SHUTDOWN
==================================================
*/

async function shutdown(
    signal
) {
    console.log(
        `[VC+] ${signal} received.`
    );

    saveDatabase();

    try {
        client.destroy();
    } catch {}

    process.exit(0);
}

process.on(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);

process.on(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);

/*
==================================================
LOGIN
==================================================
*/

client.login(
    TOKEN
).catch(error => {
    console.error(
        "[VC+] Discord login failed:",
        error
    );

    process.exit(1);
});
