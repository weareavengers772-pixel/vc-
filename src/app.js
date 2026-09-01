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
========================================
VC+
DISCORD.JS V14
========================================
*/

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("DISCORD_TOKEN is missing.");
    process.exit(1);
}

/*
========================================
CLIENT
========================================
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
========================================
DATABASE
========================================
*/

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

function defaultGuildData() {
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

let database = {};

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            database = {};
            return;
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        database = JSON.parse(raw);

        if (
            !database ||
            typeof database !== "object"
        ) {
            database = {};
        }
    } catch (error) {
        console.error(
            "[VC+] Database load error:",
            error
        );

        database = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                database,
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

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] =
            defaultGuildData();
    }

    const data =
        database[guildId];

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

loadDatabase();

/*
========================================
GENERAL HELPERS
========================================
*/

function plain(title, text) {
    return `${BOT_NAME}\n\n> **${title}**\n> ${text}`;
}

function replyError(message, text) {
    return message.reply(
        plain(
            "Error",
            text
        )
    );
}

function normalizeRank(rank) {
    if (!rank) {
        return null;
    }

    const value =
        rank
            .toLowerCase()
            .replace(/[^a-z]/g, "");

    if (value === "coowner") {
        return "coowner";
    }

    if (value === "co-owner") {
        return "coowner";
    }

    return value;
}

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

function getRank(guild, userId) {
    if (!guild) {
        return "member";
    }

    if (
        guild.ownerId === userId
    ) {
        return "founder";
    }

    const data =
        getGuildData(guild.id);

    const stored =
        normalizeRank(
            data.ranks[userId]
        );

    return (
        stored &&
        RANK_LEVELS[stored]
    )
        ? stored
        : "member";
}

function getRankLevel(guild, userId) {
    const rank =
        getRank(
            guild,
            userId
        );

    return (
        RANK_LEVELS[rank] || 1
    );
}

function isServerOwner(member) {
    return (
        member &&
        member.guild.ownerId ===
            member.id
    );
}

function isFounder(member) {
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

function isGod(member) {
    if (!member) {
        return false;
    }

    if (isFounder(member)) {
        return true;
    }

    const data =
        getGuildData(
            member.guild.id
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

function canUseRank(member, minimumLevel) {
    return (
        getRankLevel(
            member.guild,
            member.id
        ) >= minimumLevel
    );
}

function canManageTarget(
    executor,
    target
) {
    if (!executor || !target) {
        return false;
    }

    if (
        executor.guild.ownerId ===
        executor.id
    ) {
        return true;
    }

    if (
        executor.id ===
        target.id
    ) {
        return false;
    }

    return (
        getRankLevel(
            executor.guild,
            executor.id
        ) >
        getRankLevel(
            executor.guild,
            target.id
        )
    );
}

function getMentionedMember(message) {
    return (
        message.mentions.members.first() ||
        null
    );
}

function getMentionedRole(message) {
    return (
        message.mentions.roles.first() ||
        null
    );
}

function cleanName(name) {
    return (
        name
            .replace(/\n/g, " ")
            .trim()
            .slice(0, 100)
    );
}

/*
========================================
MODAL HELPERS
========================================
*/

function shortInput(
    id,
    label,
    placeholder,
    required = true
) {
    return new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(
            TextInputStyle.Short
        )
        .setPlaceholder(
            placeholder
        )
        .setRequired(required)
        .setMaxLength(100);
}

function paragraphInput(
    id,
    label,
    placeholder,
    required = true
) {
    return new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(
            TextInputStyle.Paragraph
        )
        .setPlaceholder(
            placeholder
        )
        .setRequired(required)
        .setMaxLength(1000);
}

/*
========================================
VOUCH SYSTEM
========================================
*/

function getVouchCount(
    guild,
    userId
) {
    const data =
        getGuildData(
            guild.id
        );

    return Number(
        data.vouches[userId] || 0
    );
}

async function syncVouchRole(
    guild,
    userId
) {
    const data =
        getGuildData(
            guild.id
        );

    const roleId =
        data.roles.vouch;

    if (!roleId) {
        return false;
    }

    const role =
        guild.roles.cache.get(
            roleId
        );

    if (!role) {
        return false;
    }

    const member =
        await guild.members
            .fetch(userId)
            .catch(() => null);

    if (!member) {
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

    const shouldHaveRole =
        count >= limit &&
        !revoked;

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
        return false;
    }

    if (
        role.position >=
        botMember.roles.highest.position
    ) {
        return false;
    }

    try {
        if (shouldHaveRole) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role,
                    "VC+: reached vouch requirement"
                );
            }

            return true;
        }

        if (
            member.roles.cache.has(
                role.id
            )
        ) {
            await member.roles.remove(
                role,
                "VC+: vouch requirement no longer met"
            );
        }

        return false;
    } catch (error) {
        console.error(
            "[VC+] Vouch role sync error:",
            error
        );

        return false;
    }
}

/*
========================================
JOIN TO CREATE
========================================
*/

async function setupJTC(
    guild,
    category = null
) {
    const data =
        getGuildData(
            guild.id
        );

    let categoryChannel =
        category;

    if (
        !categoryChannel
    ) {
        categoryChannel =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name
                        .toLowerCase() ===
                        "voice"
            );
    }

    if (!categoryChannel) {
        categoryChannel =
            await guild.channels.create({
                name: "VOICE",
                type: ChannelType.GuildCategory
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
                type: ChannelType.GuildVoice,
                parent:
                    categoryChannel.id
            });
    } else if (
        trigger.parentId !==
        categoryChannel.id
    ) {
        await trigger.setParent(
            categoryChannel.id
        );
    }

    data.jtc.channelId =
        trigger.id;

    data.jtc.categoryId =
        categoryChannel.id;

    saveDatabase();

    return {
        trigger,
        category: categoryChannel
    };
}

async function createTempVC(
    member
) {
    const guild =
        member.guild;

    const data =
        getGuildData(
            guild.id
        );

    const category =
        data.jtc.categoryId
            ? guild.channels.cache.get(
                  data.jtc.categoryId
              )
            : null;

    if (!category) {
        return null;
    }

    const name =
        cleanName(
            `${member.displayName}'s VC`
        );

    const channel =
        await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: category.id,

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

    data.tempVCs[channel.id] = {
        ownerId: member.id,
        locked: false,
        banned: [],
        permitted: [],
        stfu: [],
        interfaceMessageId: null
    };

    saveDatabase();

    try {
        await member.voice.setChannel(
            channel
        );
    } catch (error) {
        console.error(
            "[VC+] Failed to move member:",
            error
        );
    }

    await sendVCInterface(
        channel
    );

    return channel;
}

/*
========================================
VC INTERFACE
========================================
*/

function buildVCInterface() {
    const row1 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "vc_lock"
                )
                .setLabel("Lock")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_unlock"
                )
                .setLabel("Unlock")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_claim"
                )
                .setLabel("Claim")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_rename"
                )
                .setLabel("Rename")
                .setStyle(
                    ButtonStyle.Secondary
                )
        );

    const row2 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "vc_limit"
                )
                .setLabel("Limit")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_permit"
                )
                .setLabel("Permit")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_reject"
                )
                .setLabel("Reject")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_kick"
                )
                .setLabel("Kick")
                .setStyle(
                    ButtonStyle.Secondary
                )
        );

    const row3 =
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "vc_transfer"
                )
                .setLabel("Transfer")
                .setStyle(
                    ButtonStyle.Secondary
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vc_settings"
                )
                .setLabel("Settings")
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
                    "VC INTERFACE",
                    "Use the controls below to manage your temporary voice channel."
                ),

                components:
                    buildVCInterface()
            });

        const data =
            getGuildData(
                channel.guild.id
            );

        if (
            data.tempVCs[channel.id]
        ) {
            data.tempVCs[
                channel.id
            ].interfaceMessageId =
                message.id;

            saveDatabase();
        }

        return message;
    } catch (error) {
        console.error(
            "[VC+] Failed to send VC interface:",
            error
        );

        return null;
    }
}

/*
========================================
VC OWNER CHECK
========================================
*/

function getTempVC(
    channel
) {
    if (!channel) {
        return null;
    }

    const data =
        getGuildData(
            channel.guild.id
        );

    return (
        data.tempVCs[
            channel.id
        ] || null
    );
}

function isVCOwner(
    member,
    channel
) {
    const record =
        getTempVC(channel);

    if (!record) {
        return false;
    }

    return (
        record.ownerId ===
        member.id
    );
}

function isFounderVCAdmin(
    member
) {
    return isFounder(member);
}

/*
========================================
VC PERMISSIONS
========================================
*/

async function lockVC(
    channel
) {
    const record =
        getTempVC(channel);

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
                Connect: true,
                ViewChannel: true
            }
        );
    }

    const data =
        getGuildData(
            channel.guild.id
        );

    data.tempVCs[channel.id] =
        record;

    saveDatabase();

    return true;
}

async function unlockVC(
    channel
) {
    const record =
        getTempVC(channel);

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

    const data =
        getGuildData(
            channel.guild.id
        );

    data.tempVCs[channel.id] =
        record;

    saveDatabase();

    return true;
}

/*
========================================
MESSAGE COMMANDS
========================================
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

            /*
            ================================
            FILTER SYSTEM
            ================================
            */

            const data =
                getGuildData(
                    message.guild.id
                );

            const tempVC =
                data.tempVCs[
                    message.channel.id
                ];

            if (
                tempVC &&
                data.filters.enabled &&
                message.content
            ) {
                const lower =
                    message.content.toLowerCase();

                const matched =
                    data.filters.words.find(
                        word =>
                            lower.includes(
                                word.toLowerCase()
                            )
                    );

                if (matched) {
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

                    data.filters.strikes[key] =
                        strikes;

                    saveDatabase();

                    if (
                        strikes >=
                        data.filters.maxStrikes
                    ) {
                        const member =
                            await message.guild.members
                                .fetch(
                                    message.author.id
                                )
                                .catch(
                                    () => null
                                );

                        if (
                            member &&
                            member.moderatable
                        ) {
                            await member.timeout(
                                data.filters
                                    .timeoutMinutes *
                                    60 *
                                    1000,

                                "VC+ automatic filter timeout"
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
                    args.shift() || ""
                ).toLowerCase();

            /*
            ================================
            HELP
            ================================
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
                            "-timeout @user <minutes> [reason]",
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
            ================================
            RANK
            ================================
            */

            if (
                command === "rank"
            ) {
                if (
                    !isFounder(message.member)
                ) {
                    return replyError(
                        message,
                        "Founder rank or the Server Owner is required."
                    );
                }

                if (
                    args[0]?.toLowerCase() ===
                    "set"
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
                    !rank ||
                    !RANK_LEVELS[rank]
                ) {
                    return replyError(
                        message,
                        "Usage: -rank @user <rank>"
                    );
                }

                if (
                    rank === "founder" &&
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
                    message.guild.ownerId &&
                    rank !== "founder"
                ) {
                    return replyError(
                        message,
                        "The Server Owner cannot be demoted."
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    ) &&
                    target.id !==
                        message.member.id
                ) {
                    return replyError(
                        message,
                        "You cannot manage an equal or higher rank."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                data.ranks[target.id] =
                    rank;

                if (
                    rank === "god"
                ) {
                    if (
                        !data.godmode.includes(
                            target.id
                        )
                    ) {
                        data.godmode.push(
                            target.id
                        );
                    }
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "RANK",
                        `${target} is now ${RANK_NAMES[rank]}.`
                    )
                );
            }

            /*
            ================================
            GODMODE
            ================================
            */

            if (
                command === "godmode"
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

                const data =
                    getGuildData(
                        message.guild.id
                    );

                const off =
                    args
                        .map(x =>
                            x.toLowerCase()
                        )
                        .includes("off");

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
            ================================
            VOUCH
            ================================
            */

            if (
                command === "vouch"
            ) {
                const sub =
                    (
                        args.shift() || ""
                    ).toLowerCase();

                /*
                ----------------------------
                SIMPLE VOUCH
                ----------------------------
                */

                if (!sub) {
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

                    const current =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} has ${current} vouch${current === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                ----------------------------
                GIVE
                ----------------------------
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

                    const current =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    const newCount =
                        current + 1;

                    data.vouches[
                        target.id
                    ] = newCount;

                    data.vouchRevoked[
                        target.id
                    ] = false;

                    saveDatabase();

                    const limit =
                        Math.max(
                            1,
                            Number(
                                data.vouchLimit ||
                                5
                            )
                        );

                    const roleGranted =
                        await syncVouchRole(
                            message.guild,
                            target.id
                        );

                    if (
                        roleGranted
                    ) {
                        const role =
                            message.guild
                                .roles.cache.get(
                                    data.roles.vouch
                                );

                        return message.reply(
                            plain(
                                "VOUCH",
                                [
                                    `${target} received a vouch.`,
                                    `Vouches: ${newCount}/${limit}`,
                                    `Role granted: ${role || "Configured role"}`
                                ].join("\n")
                            )
                        );
                    }

                    return message.reply(
                        plain(
                            "VOUCH",
                            [
                                `${target} received a vouch.`,
                                `Vouches: ${newCount}/${limit}`,

                                newCount >=
                                    limit
                                    ? "The vouch role could not be granted. Check Manage Roles and make sure the bot role is above the vouch role."
                                    : "Vouch requirement not reached yet."
                            ].join("\n")
                        )
                    );
                }

                /*
                ----------------------------
                TAKE
                ----------------------------
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

                    const current =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    const newCount =
                        Math.max(
                            0,
                            current - 1
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
                ----------------------------
                LIMIT
                ----------------------------
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

                    const value =
                        args[0];

                    if (
                        value ===
                        undefined
                    ) {
                        return message.reply(
                            plain(
                                "VOUCH LIMIT",
                                `Current limit: ${data.vouchLimit}`
                            )
                        );
                    }

                    const number =
                        Number(value);

                    if (
                        !Number.isInteger(
                            number
                        ) ||
                        number < 1 ||
                        number > 100
                    ) {
                        return replyError(
                            message,
                            "The vouch limit must be a whole number from 1 to 100."
                        );
                    }

                    data.vouchLimit =
                        number;

                    saveDatabase();

                    for (
                        const userId of Object.keys(
                            data.vouches
                        )
                    ) {
                        await syncVouchRole(
                            message.guild,
                            userId
                        );
                    }

                    return message.reply(
                        plain(
                            "VOUCH LIMIT",
                            `Vouch requirement set to ${number}.`
                        )
                    );
                }

                /*
                ----------------------------
                ROLE
                ----------------------------
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

                    if (!role) {
                        const currentRole =
                            data.roles.vouch
                                ? message.guild
                                      .roles.cache.get(
                                          data.roles.vouch
                                      )
                                : null;

                        return message.reply(
                            plain(
                                "VOUCH ROLE",
                                currentRole
                                    ? `Current role: ${currentRole}`
                                    : "No vouch role is configured."
                            )
                        );
                    }

                    if (
                        role.managed
                    ) {
                        return replyError(
                            message,
                            "Managed roles cannot be used as the vouch role."
                        );
                    }

                    data.roles.vouch =
                        role.id;

                    saveDatabase();

                    for (
                        const userId of Object.keys(
                            data.vouches
                        )
                    ) {
                        await syncVouchRole(
                            message.guild,
                            userId
                        );
                    }

                    return message.reply(
                        plain(
                            "VOUCH ROLE",
                            `${role} is now the automatic vouch role.`
                        )
                    );
                }

                /*
                ----------------------------
                CLEAR
                ----------------------------
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

                    return message.reply(
                        plain(
                            "VOUCH",
                            "All vouch counts have been cleared."
                        )
                    );
                }

                return replyError(
                    message,
                    "Unknown vouch command."
                );
            }

            /*
            ================================
            KICK
            ================================
            */

            if (
                command === "kick"
            ) {
                if (
                    !canUseRank(
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
            ================================
            BAN
            ================================
            */

            if (
                command === "ban"
            ) {
                if (
                    !canUseRank(
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
            ================================
            UNBAN
            ================================
            */

            if (
                command === "unban"
            ) {
                if (
                    !canUseRank(
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

                await message.guild.members.unban(
                    userId
                );

                return message.reply(
                    plain(
                        "UNBAN",
                        `${userId} was unbanned.`
                    )
                );
            }

            /*
            ================================
            UNBAN ALL
            ================================
            */

            if (
                command === "unbanall"
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
                    !message.guild.members.me
                        ?.permissions.has(
                            PermissionFlagsBits.BanMembers
                        )
                ) {
                    return replyError(
                        message,
                        "I need Ban Members permission."
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
                        .catch(() => {});

                    count++;
                }

                return message.reply(
                    plain(
                        "UNBAN ALL",
                        `${count} banned users were processed.`
                    )
                );
            }

            /*
            ================================
            FOREVER BAN
            ================================
            */

            if (
                command === "foreverban"
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
                            "VC+: permanent server ban"
                    });
                }

                return message.reply(
                    plain(
                        "FOREVER BAN",
                        `${target.user.tag} is now permanently banned from this server.`
                    )
                );
            }

            /*
            ================================
            FOREVER UNBAN
            ================================
            */

            if (
                command === "foreverunban"
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
                            id !== userId
                    );

                saveDatabase();

                await message.guild.members
                    .unban(
                        userId,
                        "VC+: forever ban removed"
                    )
                    .catch(() => {});

                return message.reply(
                    plain(
                        "FOREVER UNBAN",
                        `${userId} is no longer permanently banned.`
                    )
                );
            }

            /*
            ================================
            TIMEOUT
            ================================
            */

            if (
                command === "timeout"
            ) {
                if (
                    !canUseRank(
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
                            arg =>
                                /^\d+$/.test(
                                    arg
                                )
                        )
                    );

                if (
                    !target ||
                    !minutes ||
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

                const reason =
                    args
                        .filter(
                            arg =>
                                arg !==
                                String(
                                    minutes
                                ) &&
                                !arg.startsWith(
                                    "<@"
                                )
                        )
                        .join(" ") ||
                    "No reason provided.";

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                return message.reply(
                    plain(
                        "TIMEOUT",
                        `${target.user.tag} was timed out for ${minutes} minute${minutes === 1 ? "" : "s"}.`
                    )
                );
            }

            /*
            ================================
            UNTIMEOUT
            ================================
            */

            if (
                command === "untimeout"
            ) {
                if (
                    !canUseRank(
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
            ================================
            PURGE
            ================================
            */

            if (
                command === "purge"
            ) {
                if (
                    !canUseRank(
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
            ================================
            VC COMMANDS
            ================================
            */

            if (
                command === "vc"
            ) {
                const sub =
                    (
                        args.shift() || ""
                    ).toLowerCase();

                /*
                ----------------------------
                VC HELP
                ----------------------------
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
                ----------------------------
                SETUP
                ----------------------------
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

                    const setupArg =
                        (
                            args[0] || ""
                        ).toLowerCase();

                    /*
                    FILTER
                    */

                    if (
                        setupArg ===
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
                                    `Filter: ${data.filters.enabled ? "on" : "off"}\nWords: ${data.filters.words.length}\nStrikes: ${data.filters.maxStrikes}\nTimeout: ${data.filters.timeoutMinutes} minutes`
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
                                    "The VC text filter is now enabled."
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
                                    "The VC text filter is now disabled."
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
                                    `Added "${word}" to the filter.`
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
                                    item =>
                                        item !==
                                        word
                                );

                            saveDatabase();

                            return message.reply(
                                plain(
                                    "VC FILTER",
                                    `Removed "${word}" from the filter.`
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
                                        : "No filtered words configured."
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
                                    "Strike limit must be a whole number from 1 to 20."
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
                                    "Filter timeout must be a whole number from 1 to 40320 minutes."
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
                    NORMAL SETUP
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
                            `Join-to-create is ready.\nTrigger: ${result.trigger}\nCategory: ${result.category}`
                        )
                    );
                }

                /*
                ----------------------------
                CHANNEL
                ----------------------------
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
                            `Join-to-create channel set to ${channel}.`
                        )
                    );
                }

                /*
                ----------------------------
                CATEGORY
                ----------------------------
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
                            `Temporary VC category set to ${category}.`
                        )
                    );
                }

                /*
                ----------------------------
                RESET
                ----------------------------
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
                            "Join-to-create configuration has been reset."
                        )
                    );
                }

                /*
                ----------------------------
                LIST
                ----------------------------
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

                    const vcs =
                        Object.entries(
                            data.tempVCs
                        );

                    if (!vcs.length) {
                        return message.reply(
                            plain(
                                "VC LIST",
                                "There are no active temporary VCs."
                            )
                        );
                    }

                    const text =
                        vcs
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
                ----------------------------
                DELETE
                ----------------------------
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

                        if (channel) {
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
                            `${count} temporary VCs were removed.`
                        )
                    );
                }

                /*
                ----------------------------
                FOUNDER STFU
                ----------------------------
                */

                if (
                    sub === "stfu" ||
                    sub === "unstfu" ||
                    sub === "ban" ||
                    sub === "unban"
                ) {
                    if (
                        !isFounderVCAdmin(
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

                    if (!channel) {
                        return replyError(
                            message,
                            "You must be inside a temporary VC."
                        );
                    }

                    const record =
                        getTempVC(
                            channel
                        );

                    if (!record) {
                        return replyError(
                            message,
                            "This is not a VC+ temporary VC."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            `Usage: -vc ${sub} @user`
                        );
                    }

                    if (
                        sub ===
                        "stfu"
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
                                `${target} has been server-muted in this VC.`
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
                                    "VC+: Founder VC ban"
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

                        await channel.permissionOverwrites.delete(
                            target.id
                        ).catch(
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
                ----------------------------
                NORMAL VC COMMANDS
                ----------------------------
                */

                const channel =
                    message.member.voice.channel;

                if (!channel) {
                    return replyError(
                        message,
                        "You must be inside your VC."
                    );
                }

                const record =
                    getTempVC(
                        channel
                    );

                if (!record) {
                    return replyError(
                        message,
                        "This is not a VC+ temporary VC."
                    );
                }

                if (
                    sub === "info"
                ) {
                    const owner =
                        channel.guild.members.cache.get(
                            record.ownerId
                        );

                    return message.reply(
                        plain(
                            "VC INFO",
                            [
                                `Owner: ${owner || `<@${record.ownerId}>`}`,
                                `Channel: ${channel}`,
                                `Locked: ${record.locked ? "Yes" : "No"}`,
                                `Banned: ${record.banned.length}`,
                                `Permitted: ${record.permitted.length}`,
                                `STFU: ${record.stfu.length}`
                            ].join("\n")
                        )
                    );
                }

                if (
                    !isVCOwner(
                        message.member,
                        channel
                    )
                ) {
                    return replyError(
                        message,
                        "You must be the VC owner to use this command."
                    );
                }

                /*
                ----------------------------
                LOCK
                ----------------------------
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
                ----------------------------
                UNLOCK
                ----------------------------
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
                ----------------------------
                CLAIM
                ----------------------------
                */

                if (
                    sub === "claim"
                ) {
                    if (
                        record.ownerId ===
                        message.member.id
                    ) {
                        return replyError(
                            message,
                            "You already own this VC."
                        );
                    }

                    const oldOwner =
                        channel.guild.members.cache.get(
                            record.ownerId
                        );

                    if (
                        oldOwner &&
                        oldOwner.voice.channelId ===
                            channel.id
                    ) {
                        return replyError(
                            message,
                            "The current owner is still inside this VC."
                        );
                    }

                    record.ownerId =
                        message.member.id;

                    data.tempVCs[
                        channel.id
                    ] = record;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC CLAIM",
                            `${message.member} now owns this VC.`
                        )
                    );
                }

                /*
                ----------------------------
                RENAME
                ----------------------------
                */

                if (
                    sub === "rename"
                ) {
                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `vc_rename_${channel.id}`
                            )
                            .setTitle(
                                "VC+ | RENAME"
                            );

                    const input =
                        shortInput(
                            "name",
                            "NEW NAME",
                            "Enter the new voice channel name"
                        );

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            input
                        )
                    );

                    return message.showModal(
                        modal
                    );
                }

                /*
                ----------------------------
                LIMIT
                ----------------------------
                */

                if (
                    sub === "limit"
                ) {
                    const number =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            number
                        ) ||
                        number < 0 ||
                        number > 99
                    ) {
                        return replyError(
                            message,
                            "Usage: -vc limit <0-99>"
                        );
                    }

                    await channel.setUserLimit(
                        number
                    );

                    return message.reply(
                        plain(
                            "VC LIMIT",
                            `User limit set to ${number}.`
                        )
                    );
                }

                /*
                ----------------------------
                PERMIT
                ----------------------------
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
                            `${target} is permitted to join this VC.`
                        )
                    );
                }

                /*
                ----------------------------
                REJECT
                ----------------------------
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

                    saveDatabase();

                    if (
                        target.voice.channelId ===
                        channel.id
                    ) {
                        await target.voice
                            .disconnect(
                                "VC+: rejected from VC"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    return message.reply(
                        plain(
                            "VC REJECT",
                            `${target} has been rejected from this VC.`
                        )
                    );
                }

                /*
                ----------------------------
                KICK
                ----------------------------
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
                            "That user is not in your VC."
                        );
                    }

                    await target.voice.disconnect(
                        "VC+: VC owner kick"
                    );

                    return message.reply(
                        plain(
                            "VC KICK",
                            `${target} was removed from your VC.`
                        )
                    );
                }

                /*
                ----------------------------
                TRANSFER
                ----------------------------
                */

                if (
                    sub === "transfer"
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
                            "The new owner must be inside your VC."
                        );
                    }

                    record.ownerId =
                        target.id;

                    saveDatabase();

                    return message.reply(
                        plain(
                            "VC TRANSFER",
                            `${target} is now the owner of this VC.`
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
                "[VC+] Message command error:",
                error
            );

            try {
                await message.reply(
                    plain(
                        "Error",
                        "Something went wrong while processing that command."
                    )
                );
            } catch {}
        }
    }
);

/*
========================================
BUTTON INTERACTIONS
========================================
*/

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isButton() &&
                !interaction.isModalSubmit()
            ) {
                return;
            }

            const member =
                interaction.member;

            if (!member) {
                return;
            }

            /*
            ================================
            MODALS
            ================================
            */

            if (
                interaction.isModalSubmit()
            ) {
                const id =
                    interaction.customId;

                /*
                ----------------------------
                RENAME
                ----------------------------
                */

                if (
                    id.startsWith(
                        "vc_rename_"
                    )
                ) {
                    const channelId =
                        id.replace(
                            "vc_rename_",
                            ""
                        );

                    const channel =
                        interaction.guild.channels.cache.get(
                            channelId
                        );

                    if (
                        !channel
                    ) {
                        return interaction.reply({
                            content: plain(
                                "Error",
                                "That VC no longer exists."
                            ),
                            ephemeral: true
                        });
                    }

                    const record =
                        getTempVC(
                            channel
                        );

                    if (
                        !record ||
                        record.ownerId !==
                            member.id
                    ) {
                        return interaction.reply({
                            content: plain(
                                "Error",
                                "You are not the owner of this VC."
                            ),
                            ephemeral: true
                        });
                    }

                    const name =
                        cleanName(
                            interaction.fields.getTextInputValue(
                                "name"
                            )
                        );

                    if (!name) {
                        return interaction.reply({
                            content: plain(
                                "Error",
                                "Enter a valid VC name."
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

                return;
            }

            /*
            ================================
            BUTTONS
            ================================
            */

            const channel =
                member.voice.channel;

            if (!channel) {
                return interaction.reply({
                    content: plain(
                        "Error",
                        "You must be inside a VC."
                    ),
                    ephemeral: true
                });
            }

            const record =
                getTempVC(
                    channel
                );

            if (!record) {
                return interaction.reply({
                    content: plain(
                        "Error",
                        "This is not a VC+ temporary VC."
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            FOUNDER-ONLY SAFETY
            ================================
            */

            const founderOnlyButtons = [
                "vc_stfu",
                "vc_unstfu",
                "vc_ban",
                "vc_unban"
            ];

            if (
                founderOnlyButtons.includes(
                    interaction.customId
                ) &&
                !isFounder(
                    member
                )
            ) {
                return interaction.reply({
                    content: plain(
                        "Access Denied",
                        "Founder rank or the Server Owner is required."
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            OWNER CHECK
            ================================
            */

            if (
                !isVCOwner(
                    member,
                    channel
                )
            ) {
                return interaction.reply({
                    content: plain(
                        "Access Denied",
                        "You must be the owner of this VC."
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            LOCK
            ================================
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
            ================================
            UNLOCK
            ================================
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
            ================================
            CLAIM
            ================================
            */

            if (
                interaction.customId ===
                "vc_claim"
            ) {
                if (
                    record.ownerId ===
                    member.id
                ) {
                    return interaction.reply({
                        content: plain(
                            "VC CLAIM",
                            "You already own this VC."
                        ),
                        ephemeral: true
                    });
                }

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
                            "The current owner is still inside this VC."
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
            ================================
            RENAME
            ================================
            */

            if (
                interaction.customId ===
                "vc_rename"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_rename_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | RENAME"
                        );

                const input =
                    shortInput(
                        "name",
                        "NEW NAME",
                        "Enter the new voice channel name"
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
            ================================
            LIMIT
            ================================
            */

            if (
                interaction.customId ===
                "vc_limit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_limit_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | LIMIT"
                        );

                const input =
                    shortInput(
                        "limit",
                        "USER LIMIT",
                        "Enter a number from 0 to 99"
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
            ================================
            PERMIT
            ================================
            */

            if (
                interaction.customId ===
                "vc_permit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_permit_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | PERMIT"
                        );

                const input =
                    shortInput(
                        "user",
                        "USER ID",
                        "Enter the Discord user ID"
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
            ================================
            REJECT
            ================================
            */

            if (
                interaction.customId ===
                "vc_reject"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_reject_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | REJECT"
                        );

                const input =
                    shortInput(
                        "user",
                        "USER ID",
                        "Enter the Discord user ID"
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
            ================================
            KICK
            ================================
            */

            if (
                interaction.customId ===
                "vc_kick"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_kick_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | KICK"
                        );

                const input =
                    shortInput(
                        "user",
                        "USER ID",
                        "Enter the Discord user ID"
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
            ================================
            TRANSFER
            ================================
            */

            if (
                interaction.customId ===
                "vc_transfer"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            `vc_transfer_${channel.id}`
                        )
                        .setTitle(
                            "VC+ | TRANSFER"
                        );

                const input =
                    shortInput(
                        "user",
                        "NEW OWNER",
                        "Enter the Discord user ID"
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
            ================================
            SETTINGS
            ================================
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
                            `User limit: ${channel.userLimit || "Unlimited"}`,
                            `Permitted: ${record.permitted.length}`,
                            `Banned: ${record.banned.length}`
                        ].join("\n")
                    ),
                    ephemeral: true
                });
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
                            "Error",
                            "Something went wrong while processing that action."
                        ),
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: plain(
                            "Error",
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
========================================
MODAL SUBMISSIONS
========================================
*/

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isModalSubmit()
            ) {
                return;
            }

            const id =
                interaction.customId;

            const parts =
                id.split("_");

            const action =
                parts[1];

            const channelId =
                parts.slice(2).join("_");

            const channel =
                interaction.guild.channels.cache.get(
                    channelId
                );

            if (
                !channel
            ) {
                return interaction.reply({
                    content: plain(
                        "Error",
                        "That VC no longer exists."
                    ),
                    ephemeral: true
                });
            }

            const record =
                getTempVC(
                    channel
                );

            if (
                !record ||
                record.ownerId !==
                    interaction.user.id
            ) {
                return interaction.reply({
                    content: plain(
                        "Access Denied",
                        "You are not the owner of this VC."
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            RENAME
            ================================
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
                            "Error",
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
            ================================
            LIMIT
            ================================
            */

            if (
                action ===
                "limit"
            ) {
                const number =
                    Number(
                        interaction.fields.getTextInputValue(
                            "limit"
                        )
                    );

                if (
                    !Number.isInteger(
                        number
                    ) ||
                    number < 0 ||
                    number > 99
                ) {
                    return interaction.reply({
                        content: plain(
                            "Error",
                            "Enter a whole number from 0 to 99."
                        ),
                        ephemeral: true
                    });
                }

                await channel.setUserLimit(
                    number
                );

                return interaction.reply({
                    content: plain(
                        "VC LIMIT",
                        `User limit set to ${number}.`
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            USER LOOKUP
            ================================
            */

            const userId =
                interaction.fields
                    .getTextInputValue(
                        "user"
                    )
                    .replace(
                        /[^0-9]/g,
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
                        "Error",
                        "I could not find that member."
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            PERMIT
            ================================
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
                        `${target} is permitted to join this VC.`
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            REJECT
            ================================
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
            ================================
            KICK
            ================================
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
                            "Error",
                            "That user is not inside your VC."
                        ),
                        ephemeral: true
                    });
                }

                await target.voice
                    .disconnect(
                        "VC+: owner kick"
                    );

                return interaction.reply({
                    content: plain(
                        "VC KICK",
                        `${target} was removed from your VC.`
                    ),
                    ephemeral: true
                });
            }

            /*
            ================================
            TRANSFER
            ================================
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
                            "Error",
                            "The new owner must be inside your VC."
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
        } catch (error) {
            console.error(
                "[VC+] Modal error:",
                error
            );
        }
    }
);

/*
========================================
VOICE STATE
========================================
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
                getGuildData(
                    guild.id
                );

            /*
            ================================
            FOREVER BAN
            ================================
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
                            "VC+: forever banned user rejoined"
                    })
                    .catch(
                        () => {}
                    );

                return;
            }

            /*
            ================================
            CREATE VC
            ================================
            */

            if (
                newState.channelId &&
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
            ================================
            STFU ENFORCEMENT
            ================================
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
                    record.stfu.includes(
                        newState.member?.id
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
                ================================
                VC BAN ENFORCEMENT
                ================================
                */

                if (
                    record &&
                    record.banned.includes(
                        newState.member?.id
                    )
                ) {
                    await newState.member.voice
                        .disconnect(
                            "VC+: banned from VC"
                        )
                        .catch(
                            () => {}
                        );
                }
            }

            /*
            ================================
            DELETE EMPTY TEMP VC
            ================================
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
                            "VC+: empty temporary VC"
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
========================================
READY
========================================
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

        /*
        ================================
        CLEAN OLD TEMP VCS
        ================================
        */

        for (
            const guild of client.guilds.cache.values()
        ) {
            try {
                const data =
                    getGuildData(
                        guild.id
                    );

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
                                "VC+: cleanup empty VC"
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
                ================================
                SYNC VOUCH ROLES
                ================================
                */

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

                saveDatabase();
            } catch (error) {
                console.error(
                    "[VC+] Guild startup error:",
                    error
                );
            }
        }
    }
);

/*
========================================
ERROR PROTECTION
========================================
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
            "[VC+] Exception monitor:",
            error
        );
    }
);

/*
========================================
SHUTDOWN
========================================
*/

async function shutdown(
    signal
) {
    console.log(
        `[VC+] ${signal} received. Saving database.`
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
        shutdown("SIGINT")
);

process.on(
    "SIGTERM",
    () =>
        shutdown("SIGTERM")
);

/*
========================================
LOGIN
========================================
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
