import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    AuditLogEvent,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ======================================================
// CONFIG
// ======================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("Missing DISCORD_TOKEN environment variable.");
    process.exit(1);
}

// ======================================================
// RANKS
// ======================================================

const RANKS = {
    member: 1,
    staff: 2,
    moderator: 3,
    admin: 4,
    director: 5,
    executive: 6,
    coowner: 7,
    owner: 8,
    god: 9,
    founder: 10
};

const RANK_NAMES = {
    1: "Member",
    2: "Staff",
    3: "Moderator",
    4: "Admin",
    5: "Director",
    6: "Executive",
    7: "Co Owner",
    8: "Owner",
    9: "God",
    10: "Founder"
};

// ======================================================
// DATABASE
// ======================================================

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

function defaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        // ==============================================
        // VOUCH SYSTEM
        // ==============================================

        vouches: {},

        vouchSettings: {
            roleId: null,
            limit: 0
        },

        // ==============================================
        // JOIN TO CREATE
        // ==============================================

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },

        // ==============================================
        // LOGGING
        // ==============================================

        logs: {
            channelId: null
        },

        // ==============================================
        // RANK ROLES
        // ==============================================

        roles: {
            founder: null,
            god: null,
            owner: null,
            coowner: null,
            executive: null,
            director: null,
            admin: null,
            moderator: null,
            staff: null
        },

        // ==============================================
        // SECURITY
        // ==============================================

        protection: {
            channelCreate: true,
            channelDelete: true,
            roleCreate: true,
            roleDelete: true,
            webhookCreate: true
        },

        // ==============================================
        // FILTER
        // ==============================================

        filter: {
            enabled: false,
            words: [],
            log: true,
            maxStrikes: 3,
            strikes: {}
        }
    };
}

let database = {};

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            database = {};
            saveDatabase();
            return;
        }

        database = JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );
    } catch (error) {
        console.error(
            "Database load error:",
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
            )
        );
    } catch (error) {
        console.error(
            "Database save error:",
            error
        );
    }
}

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] =
            defaultGuildData();

        saveDatabase();
    }

    const defaults =
        defaultGuildData();

    const current =
        database[guildId];

    database[guildId] = {
        ...defaults,
        ...current,

        ranks: {
            ...defaults.ranks,
            ...(current.ranks || {})
        },

        foreverBanned:
            Array.isArray(
                current.foreverBanned
            )
                ? current.foreverBanned
                : [],

        godmode:
            Array.isArray(
                current.godmode
            )
                ? current.godmode
                : [],

        vouches: {
            ...(current.vouches || {})
        },

        vouchSettings: {
            ...defaults.vouchSettings,
            ...(current.vouchSettings || {})
        },

        jtc: {
            ...defaults.jtc,
            ...(current.jtc || {})
        },

        logs: {
            ...defaults.logs,
            ...(current.logs || {})
        },

        roles: {
            ...defaults.roles,
            ...(current.roles || {})
        },

        protection: {
            ...defaults.protection,
            ...(current.protection || {})
        },

        filter: {
            ...defaults.filter,
            ...(current.filter || {}),

            words:
                Array.isArray(
                    current.filter?.words
                )
                    ? current.filter.words
                    : [],

            strikes: {
                ...(current.filter?.strikes || {})
            }
        }
    };

    return database[guildId];
}

loadDatabase();

// ======================================================
// CLIENT
// ======================================================

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

// ======================================================
// TEMP VC STORAGE
// ======================================================

const tempVCs = new Map();

function createVCData(
    guildId,
    ownerId
) {
    return {
        guildId,
        ownerId,

        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        stfu: new Set(),

        locked: false,

        interfaceMessageId: null
    };
}

function getVCData(channelId) {
    return tempVCs.get(
        channelId
    );
}

// ======================================================
// RANK HELPERS
// ======================================================

function normalizeRank(rank) {
    if (!rank) {
        return "member";
    }

    return String(rank)
        .toLowerCase()
        .replace(/[^a-z]/g, "");
}

function isServerOwner(member) {
    return (
        !!member &&
        member.guild.ownerId ===
            member.id
    );
}

function getRankLevel(member) {
    if (!member) {
        return 0;
    }

    // ==============================================
    // SERVER OWNER IS ALWAYS LEVEL 10
    // ==============================================

    if (
        member.guild.ownerId ===
        member.id
    ) {
        return 10;
    }

    const data =
        getGuildData(
            member.guild.id
        );

    let highest = 1;

    // ==============================================
    // EXPLICIT RANK
    // ==============================================

    if (
        data.ranks[member.id]
    ) {
        const rank =
            normalizeRank(
                data.ranks[member.id]
            );

        if (RANKS[rank]) {
            highest = Math.max(
                highest,
                RANKS[rank]
            );
        }
    }

    // ==============================================
    // CONFIGURED ROLE IDS
    // ==============================================

    for (
        const [
            rankName,
            roleId
        ] of Object.entries(
            data.roles
        )
    ) {
        if (!roleId) {
            continue;
        }

        if (
            member.roles.cache.has(
                roleId
            )
        ) {
            const level =
                RANKS[
                    normalizeRank(
                        rankName
                    )
                ] || 1;

            highest = Math.max(
                highest,
                level
            );
        }
    }

    // ==============================================
    // ROLE NAME DETECTION
    // ==============================================

    for (
        const role of
        member.roles.cache.values()
    ) {
        const normalized =
            normalizeRank(
                role.name
            );

        if (
            RANKS[normalized]
        ) {
            highest = Math.max(
                highest,
                RANKS[normalized]
            );
        }
    }

    // ==============================================
    // ADMINISTRATOR = ADMIN LEVEL
    // ==============================================

    if (
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        highest = Math.max(
            highest,
            RANKS.admin
        );
    }

    return highest;
}

function getRank(member) {
    return getRankLevel(
        member
    );
}

function getRankName(member) {
    return (
        RANK_NAMES[
            getRankLevel(member)
        ] || "Member"
    );
}

function isFounder(member) {
    return (
        getRankLevel(member) >=
        RANKS.founder
    );
}

function isGod(member) {
    if (!member) {
        return false;
    }

    if (
        isServerOwner(member)
    ) {
        return true;
    }

    if (
        getRankLevel(member) >=
        RANKS.god
    ) {
        return true;
    }

    const data =
        getGuildData(
            member.guild.id
        );

    return data.godmode.includes(
        member.id
    );
}

function canModerate(member) {
    return (
        getRankLevel(member) >=
        RANKS.moderator
    );
}

function isTrustedExecutor(member) {
    return isGod(member);
}

// ======================================================
// TARGET SECURITY
// ======================================================

function canModerateTarget(
    executor,
    target
) {
    if (
        !executor ||
        !target
    ) {
        return false;
    }

    // ==============================================
    // SERVER OWNER CAN MODERATE EVERYONE
    // ==============================================

    if (
        isServerOwner(executor)
    ) {
        return (
            executor.id !==
            target.id
        );
    }

    // ==============================================
    // NOBODY ELSE CAN MODERATE OWNER
    // ==============================================

    if (
        isServerOwner(target)
    ) {
        return false;
    }

    const executorLevel =
        getRankLevel(executor);

    const targetLevel =
        getRankLevel(target);

    return (
        executorLevel >
        targetLevel
    );
}

function canManageHighRank(
    executor,
    target
) {
    if (
        !executor ||
        !target
    ) {
        return false;
    }

    if (
        isServerOwner(target)
    ) {
        return isServerOwner(
            executor
        );
    }

    if (
        isServerOwner(executor)
    ) {
        return true;
    }

    return (
        getRankLevel(executor) >
        getRankLevel(target)
    );
}

// ======================================================
// EMBEDS
// ======================================================

function vcEmbed(
    message,
    title = "VC+"
) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: title
        })
        .setDescription(
            `✦ ${message}`
        )
        .setFooter({
            text: "VC+"
        })
        .setTimestamp();
}

function replySuccess(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(
                text,
                "VC+"
            )
        ]
    });
}

function replyError(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(
                text,
                "VC+ ERROR"
            )
        ]
    });
}

function replyInfo(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(
                text,
                "VC+ INFO"
            )
        ]
    });
}

// ======================================================
// LOGGING
// ONLY jailed-logs
// ======================================================

async function createLogSystem(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    let logChannel = null;

    if (
        data.logs.channelId
    ) {
        logChannel =
            guild.channels.cache.get(
                data.logs.channelId
            );
    }

    if (!logChannel) {
        logChannel =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildText &&
                    channel.name ===
                        "jailed-logs"
            );
    }

    if (!logChannel) {
        try {
            logChannel =
                await guild.channels.create(
                    {
                        name: "jailed-logs",
                        type: ChannelType.GuildText,

                        permissionOverwrites:
                            [
                                {
                                    id: guild.roles.everyone.id,

                                    deny: [
                                        PermissionFlagsBits.ViewChannel
                                    ]
                                },

                                {
                                    id: client.user.id,

                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.EmbedLinks,
                                        PermissionFlagsBits.ReadMessageHistory
                                    ]
                                }
                            ]
                    }
                );
        } catch (error) {
            console.error(
                "Could not create jailed-logs:",
                error
            );

            return null;
        }
    }

    data.logs.channelId =
        logChannel.id;

    saveDatabase();

    return logChannel;
}

async function sendLog(
    guild,
    type,
    description
) {
    try {
        const channel =
            await createLogSystem(
                guild
            );

        if (!channel) {
            return;
        }

        const embed =
            new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name:
                        `VC+ • ${type}`
                })
                .setDescription(
                    description
                )
                .setFooter({
                    text:
                        "Jailed Logs"
                })
                .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "Logging error:",
            error
        );
    }
}

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+"
        })
        .setDescription(`
✦ **VC+ COMMANDS**

**VOICE CHANNELS**

\`${PREFIX}vc setup\`
Set up Join To Create.

\`${PREFIX}vc count\`
Shows how many members are in your VC.

\`${PREFIX}vc kick @user\`
Disconnect someone from your VC.

\`${PREFIX}vc disconnect @user\`
Disconnect someone from your VC.

\`${PREFIX}vc ban @user\`
Ban someone from your VC.

\`${PREFIX}vc reject @user\`
Reject someone from your VC.

\`${PREFIX}vc permit @user\`
Permit someone into your VC.

\`${PREFIX}vc lock\`
Lock your VC.

\`${PREFIX}vc unlock\`
Unlock your VC.

\`${PREFIX}vc transfer @user\`
Transfer VC ownership.

\`${PREFIX}vc claim\`
Claim an ownerless VC.

\`${PREFIX}vc forceclaim\`
Founder-only forced VC claim.

\`${PREFIX}vc rename <name>\`
Rename your VC.

\`${PREFIX}vc limit <number>\`
Set your VC user limit.

\`${PREFIX}vc stfu @user\`
God/Founder server mute.

\`${PREFIX}vc unstfu @user\`
God/Founder remove server mute.

\`${PREFIX}vc delete\`
Delete your VC.

━━━━━━━━━━━━━━━━━━━━

**MODERATION**

\`${PREFIX}ban @user [reason]\`
Ban a member.

\`${PREFIX}unban <userId>\`
Unban a member.

\`${PREFIX}unbanall\`
Unban everyone. Server Owner only.

\`${PREFIX}banlist\`
View banned users.

\`${PREFIX}kick @user [reason]\`
Kick a member.

\`${PREFIX}timeout @user <minutes> [reason]\`
Timeout a member.

\`${PREFIX}untimeout @user\`
Remove a timeout.

\`${PREFIX}foreverban @user [reason]\`
Permanently add someone to the foreverban list.

\`${PREFIX}purge <amount>\`
Delete messages.

\`${PREFIX}clear <amount>\`
Delete messages.

━━━━━━━━━━━━━━━━━━━━

**RANKS**

\`${PREFIX}rank @user <rank>\`
Assign a rank. Server Owner only.

\`${PREFIX}godmode on/off\`
Enable or disable Godmode.

\`${PREFIX}godmode @user on/off\`
Give/remove Godmode. Server Owner only.

━━━━━━━━━━━━━━━━━━━━

**VOUCHES**

\`${PREFIX}vouch give @user\`
Give a vouch.

\`${PREFIX}vouch take @user\`
Take back your vouch.

\`${PREFIX}vouch count @user\`
Show someone's vouch count.

\`${PREFIX}vouch list @user\`
Show who vouched for someone.

\`${PREFIX}vouch clear @user\`
Clear someone's vouches. Owner only.

\`${PREFIX}vouch role set @role\`
Set the automatic vouch role. Owner only.

\`${PREFIX}vouch limit <number>\`
Set vouches required for the role. Owner only.

\`${PREFIX}vouchrole view\`
View current vouch role settings.

━━━━━━━━━━━━━━━━━━━━

**FILTER**

\`${PREFIX}filter on/off\`
Enable or disable filter.

\`${PREFIX}filter add <word>\`
Add a filtered word.

\`${PREFIX}filter remove <word>\`
Remove a filtered word.

\`${PREFIX}filter list\`
View filtered words.

\`${PREFIX}filter log on/off\`
Toggle filter logs.

\`${PREFIX}filter strikes <number>\`
Set strike limit.

\`${PREFIX}filter reset @user\`
Reset someone's strikes.

━━━━━━━━━━━━━━━━━━━━

**RANK HIERARCHY**

Founder
God
Owner
Co Owner
Executive
Director
Admin
Moderator
Staff
Member

━━━━━━━━━━━━━━━━━━━━

**SERVER OWNER**

The Server Owner is always the absolute
highest authority.

The Server Owner can moderate anyone,
including the highest-ranked role.

Nobody can moderate the Server Owner.
        `)
        .setFooter({
            text: "VC+"
        });
}

// ======================================================
// USER RESOLUTION
// ======================================================

function extractUserId(
    input
) {
    if (!input) {
        return null;
    }

    const match =
        String(input).match(
            /\d{17,20}/
        );

    return match
        ? match[0]
        : null;
}

async function resolveMember(
    guild,
    input
) {
    const id =
        extractUserId(input);

    if (!id) {
        return null;
    }

    try {
        return await guild.members.fetch(
            id
        );
    } catch {
        return null;
    }
}

// ======================================================
// ROLE RESOLUTION
// ======================================================

function extractRoleId(
    input
) {
    if (!input) {
        return null;
    }

    const match =
        String(input).match(
            /<?@&?(\d{17,20})>?/
        );

    if (match) {
        return match[1];
    }

    const id =
        String(input).match(
            /\d{17,20}/
        );

    return id
        ? id[0]
        : null;
}

function resolveRole(
    guild,
    input
) {
    const id =
        extractRoleId(input);

    if (id) {
        return (
            guild.roles.cache.get(
                id
            ) || null
        );
    }

    const name =
        String(input || "")
            .toLowerCase();

    return (
        guild.roles.cache.find(
            role =>
                role.name
                    .toLowerCase() ===
                name
        ) || null
    );
}

// ======================================================
// VOUCH SYSTEM
// ======================================================

function getVouches(
    guildId,
    targetId
) {
    const data =
        getGuildData(
            guildId
        );

    if (
        !Array.isArray(
            data.vouches[targetId]
        )
    ) {
        data.vouches[targetId] = [];
    }

    return data.vouches[targetId];
}

function getVouchCount(
    guildId,
    targetId
) {
    return getVouches(
        guildId,
        targetId
    ).length;
}

async function checkVouchRole(
    member
) {
    try {
        const data =
            getGuildData(
                member.guild.id
            );

        const roleId =
            data.vouchSettings.roleId;

        const limit =
            Number(
                data.vouchSettings.limit
            );

        if (
            !roleId ||
            !limit ||
            limit <= 0
        ) {
            return;
        }

        const role =
            member.guild.roles.cache.get(
                roleId
            );

        if (!role) {
            return;
        }

        const count =
            getVouchCount(
                member.guild.id,
                member.id
            );

        if (
            count >= limit
        ) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role,
                    "VC+ Vouch reward"
                );
            }
        } else {
            if (
                member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.remove(
                    role,
                    "VC+ Vouch count below limit"
                );
            }
        }
    } catch (error) {
        console.error(
            "Vouch role error:",
            error
        );
    }
}

// ======================================================
// VC INTERFACE
// ======================================================

function buildVCInterface(
    channel
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return {
            embeds: [
                vcEmbed(
                    "This VC no longer exists."
                )
            ],
            components: []
        };
    }

    const owner =
        channel.guild.members.cache.get(
            data.ownerId
        );

    const embed =
        new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name:
                    "VC+ • Voice Control"
            })
            .setDescription(`
**OWNER**
${owner ? `<@${owner.id}>` : "Unknown"}

**STATUS**
${data.locked ? "Locked" : "Unlocked"}

**MEMBERS**
${channel.members.size}

━━━━━━━━━━━━━━━━━━━━

Use the buttons below to manage this VC.
            `)
            .setFooter({
                text: "VC+"
            });

    const row1 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:lock:${channel.id}`
                    )
                    .setLabel("Lock")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:unlock:${channel.id}`
                    )
                    .setLabel("Unlock")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:kick:${channel.id}`
                    )
                    .setLabel("Kick")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:ban:${channel.id}`
                    )
                    .setLabel("Ban")
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    const row2 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:permit:${channel.id}`
                    )
                    .setLabel("Permit")
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:rename:${channel.id}`
                    )
                    .setLabel("Rename")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:limit:${channel.id}`
                    )
                    .setLabel("Limit")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:transfer:${channel.id}`
                    )
                    .setLabel("Transfer")
                    .setStyle(
                        ButtonStyle.Primary
                    )
            );

    const row3 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:claim:${channel.id}`
                    )
                    .setLabel("Claim")
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:stfu:${channel.id}`
                    )
                    .setLabel("STFU")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:unstfu:${channel.id}`
                    )
                    .setLabel("UnSTFU")
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vcplus:delete:${channel.id}`
                    )
                    .setLabel("Delete VC")
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    return {
        embeds: [embed],

        components: [
            row1,
            row2,
            row3
        ]
    };
}

async function sendVCInterface(
    channel
) {
    try {
        if (
            channel.type !==
            ChannelType.GuildVoice
        ) {
            return;
        }

        if (
            typeof channel.send !==
            "function"
        ) {
            console.error(
                "This voice channel does not expose text chat."
            );

            return;
        }

        const data =
            getVCData(
                channel.id
            );

        if (!data) {
            return;
        }

        const message =
            await channel.send(
                buildVCInterface(
                    channel
                )
            );

        data.interfaceMessageId =
            message.id;
    } catch (error) {
        console.error(
            "VC interface error:",
            error
        );
    }
}

async function refreshVCInterface(
    channel
) {
    try {
        const data =
            getVCData(
                channel.id
            );

        if (
            !data?.interfaceMessageId
        ) {
            return;
        }

        const message =
            await channel.messages.fetch(
                data.interfaceMessageId
            );

        await message.edit(
            buildVCInterface(
                channel
            )
        );
    } catch {}
}

// ======================================================
// VC PERMISSIONS
// ======================================================

function canControlVC(
    member,
    channel
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return false;
    }

    if (
        isServerOwner(member)
    ) {
        return true;
    }

    if (
        isFounder(member)
    ) {
        return true;
    }

    return (
        data.ownerId ===
        member.id
    );
}

async function denyUserFromVC(
    channel,
    userId
) {
    await channel.permissionOverwrites.edit(
        userId,
        {
            ViewChannel: false,
            Connect: false
        }
    );
}

async function permitUserInVC(
    channel,
    userId
) {
    await channel.permissionOverwrites.edit(
        userId,
        {
            ViewChannel: true,
            Connect: true
        }
    );
}

async function lockVC(
    channel,
    vcData
) {
    vcData.locked = true;

    await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        {
            ViewChannel: true,
            Connect: false
        }
    );

    await channel.permissionOverwrites.edit(
        vcData.ownerId,
        {
            ViewChannel: true,
            Connect: true
        }
    );

    for (
        const userId of
        vcData.permitted
    ) {
        await permitUserInVC(
            channel,
            userId
        );
    }
}

async function unlockVC(
    channel,
    vcData
) {
    vcData.locked = false;

    await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        {
            ViewChannel: true,
            Connect: true
        }
    );

    for (
        const userId of
        vcData.banned
    ) {
        await denyUserFromVC(
            channel,
            userId
        );
    }

    for (
        const userId of
        vcData.rejected
    ) {
        await denyUserFromVC(
            channel,
            userId
        );
    }
}

// ======================================================
// JTC SETUP
// ======================================================

async function setupJTC(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    let category = null;

    if (
        data.jtc.categoryId
    ) {
        category =
            guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    if (!category) {
        category =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name ===
                        "Voice Channels"
            );
    }

    if (!category) {
        category =
            await guild.channels.create(
                {
                    name:
                        "Voice Channels",

                    type:
                        ChannelType.GuildCategory
                }
            );
    }

    let joinChannel = null;

    if (
        data.jtc.channelId
    ) {
        joinChannel =
            guild.channels.cache.get(
                data.jtc.channelId
            );
    }

    if (!joinChannel) {
        joinChannel =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildVoice &&
                    channel.name ===
                        "Join To Create"
            );
    }

    if (!joinChannel) {
        joinChannel =
            await guild.channels.create(
                {
                    name:
                        "Join To Create",

                    type:
                        ChannelType.GuildVoice,

                    parent:
                        category.id
                }
            );
    }

    data.jtc.enabled =
        true;

    data.jtc.channelId =
        joinChannel.id;

    data.jtc.categoryId =
        category.id;

    saveDatabase();

    return {
        category,
        joinChannel
    };
}

async function createPersonalVC(
    member
) {
    const guild =
        member.guild;

    const data =
        getGuildData(
            guild.id
        );

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (!category) {
        return null;
    }

    const safeName =
        member.user.username
            .replace(
                /[^\w\- ]/g,
                ""
            )
            .slice(0, 70) ||
        "User";

    const channel =
        await guild.channels.create(
            {
                name:
                    `${safeName} VC`,

                type:
                    ChannelType.GuildVoice,

                parent:
                    category.id,

                permissionOverwrites:
                    [
                        {
                            id:
                                guild.roles
                                    .everyone
                                    .id,

                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect
                            ]
                        },

                        {
                            id:
                                member.id,

                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect
                            ]
                        }
                    ]
            }
        );

    const vcData =
        createVCData(
            guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await sendVCInterface(
        channel
    );

    try {
        await member.voice.setChannel(
            channel
        );
    } catch {}

    await sendLog(
        guild,
        "VC CREATE",
        `${member} created **${channel.name}**.`
    );

    return channel;
}

// ======================================================
// COMMAND HANDLER
// ======================================================

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

            const data =
                getGuildData(
                    message.guild.id
                );

            // ==========================================
            // FILTER
            // ==========================================

            if (
                data.filter.enabled &&
                !message.content.startsWith(
                    PREFIX
                )
            ) {
                const lower =
                    message.content.toLowerCase();

                const matched =
                    data.filter.words.find(
                        word =>
                            lower.includes(
                                word.toLowerCase()
                            )
                    );

                if (
                    matched &&
                    !isTrustedExecutor(
                        message.member
                    )
                ) {
                    try {
                        await message.delete();
                    } catch {}

                    if (
                        !data.filter.strikes[
                            message.author.id
                        ]
                    ) {
                        data.filter.strikes[
                            message.author.id
                        ] = 0;
                    }

                    data.filter.strikes[
                        message.author.id
                    ]++;

                    saveDatabase();

                    if (
                        data.filter.log
                    ) {
                        await sendLog(
                            message.guild,
                            "FILTER",
                            `${message.author} triggered the filter.\nWord: \`${matched}\`\nStrike: ${data.filter.strikes[message.author.id]}/${data.filter.maxStrikes}`
                        );
                    }

                    if (
                        data.filter.strikes[
                            message.author.id
                        ] >=
                        data.filter.maxStrikes
                    ) {
                        try {
                            await message.member.timeout(
                                10 * 60 * 1000,
                                "VC+ word filter"
                            );
                        } catch {}

                        data.filter.strikes[
                            message.author.id
                        ] = 0;

                        saveDatabase();
                    }

                    return;
                }
            }

            // ==========================================
            // PREFIX
            // ==========================================

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
                args.shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            // ==========================================
            // HELP
            // ==========================================

            if (
                command === "help" ||
                command === "commands"
            ) {
                return message.reply({
                    embeds: [
                        helpEmbed()
                    ]
                });
            }

            // ==========================================
            // UNBAN ALL
            // ==========================================

            if (
                command === "unbanall"
            ) {
                if (
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the **Server Owner** can use `-unbanall`."
                    );
                }

                let bans;

                try {
                    bans =
                        await message.guild.bans.fetch();
                } catch {
                    return replyError(
                        message,
                        "I could not retrieve the server ban list."
                    );
                }

                if (
                    bans.size === 0
                ) {
                    return replyInfo(
                        message,
                        "There are no banned users."
                    );
                }

                let success =
                    0;

                let failed =
                    0;

                for (
                    const ban of
                    bans.values()
                ) {
                    try {
                        await message.guild.bans.remove(
                            ban.user.id,
                            "VC+ unbanall"
                        );

                        success++;
                    } catch {
                        failed++;
                    }
                }

                data.foreverBanned =
                    data.foreverBanned.filter(
                        id =>
                            !bans.has(id)
                    );

                saveDatabase();

                await sendLog(
                    message.guild,
                    "UNBAN ALL",
                    `${message.author} used \`-unbanall\`.\nSuccessfully unbanned: **${success}**\nFailed: **${failed}**`
                );

                return replySuccess(
                    message,
                    `Unban all finished.\n\n**Unbanned:** ${success}\n**Failed:** ${failed}`
                );
            }

            // ==========================================
            // VOUCH ROLE VIEW
            // ==========================================

            if (
                command ===
                "vouchrole"
            ) {
                const sub =
                    args.shift()
                        ?.toLowerCase();

                if (
                    sub !== "view"
                ) {
                    return replyInfo(
                        message,
                        "Use `-vouchrole view`."
                    );
                }

                const roleId =
                    data.vouchSettings.roleId;

                const limit =
                    Number(
                        data.vouchSettings.limit
                    );

                const role =
                    roleId
                        ? message.guild.roles.cache.get(
                              roleId
                          )
                        : null;

                return message.reply({
                    embeds: [
                        vcEmbed(
                            `**VOUCH ROLE**\n${
                                role
                                    ? `<@&${role.id}>`
                                    : "Not configured"
                            }\n\n**REQUIRED VOUCHES**\n${
                                limit > 0
                                    ? limit
                                    : "Not configured"
                            }`,
                            "VC+ • Vouch Role"
                        )
                    ]
                });
            }

            // ==========================================
            // VOUCH
            // ==========================================

            if (
                command === "vouch"
            ) {
                const sub =
                    args.shift()
                        ?.toLowerCase();

                // --------------------------------------
                // VOUCH GIVE
                // --------------------------------------

                if (
                    sub === "give"
                ) {
                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Mention a member to vouch for."
                        );
                    }

                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return replyError(
                            message,
                            "You cannot vouch for yourself."
                        );
                    }

                    const vouches =
                        getVouches(
                            message.guild.id,
                            target.id
                        );

                    if (
                        vouches.includes(
                            message.author.id
                        )
                    ) {
                        return replyError(
                            message,
                            `You already vouched for ${target}.`
                        );
                    }

                    vouches.push(
                        message.author.id
                    );

                    saveDatabase();

                    await checkVouchRole(
                        target
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH",
                        `${message.author} vouched for ${target}.\nTotal vouches: **${vouches.length}**`
                    );

                    return replySuccess(
                        message,
                        `You vouched for ${target}.\n\n**Total:** ${vouches.length}`
                    );
                }

                // --------------------------------------
                // VOUCH TAKE
                // --------------------------------------

                if (
                    sub === "take"
                ) {
                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Mention a member."
                        );
                    }

                    const vouches =
                        getVouches(
                            message.guild.id,
                            target.id
                        );

                    const index =
                        vouches.indexOf(
                            message.author.id
                        );

                    if (
                        index === -1
                    ) {
                        return replyError(
                            message,
                            `You have not vouched for ${target}.`
                        );
                    }

                    vouches.splice(
                        index,
                        1
                    );

                    saveDatabase();

                    await checkVouchRole(
                        target
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH TAKE",
                        `${message.author} removed their vouch from ${target}.\nTotal vouches: **${vouches.length}**`
                    );

                    return replySuccess(
                        message,
                        `Your vouch for ${target} was removed.\n\n**Total:** ${vouches.length}`
                    );
                }

                // --------------------------------------
                // VOUCH COUNT
                // --------------------------------------

                if (
                    sub === "count"
                ) {
                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        ) ||
                        message.member;

                    const count =
                        getVouchCount(
                            message.guild.id,
                            target.id
                        );

                    return message.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has **${count}** vouch${count === 1 ? "" : "es"}.`,
                                "VC+ • Vouch Count"
                            )
                        ]
                    });
                }

                // --------------------------------------
                // VOUCH LIST
                // --------------------------------------

                if (
                    sub === "list"
                ) {
                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        ) ||
                        message.member;

                    const vouches =
                        getVouches(
                            message.guild.id,
                            target.id
                        );

                    if (
                        !vouches.length
                    ) {
                        return replyInfo(
                            message,
                            `${target} has no vouches yet.`
                        );
                    }

                    const list =
                        vouches
                            .slice(0, 50)
                            .map(
                                id =>
                                    `• <@${id}>`
                            )
                            .join("\n");

                    return message.reply({
                        embeds: [
                            vcEmbed(
                                `**${target}** has **${vouches.length}** vouches.\n\n${list}`,
                                "VC+ • Vouch List"
                            )
                        ]
                    });
                }

                // --------------------------------------
                // VOUCH CLEAR
                // --------------------------------------

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
                            "Only the **Server Owner** can clear vouches."
                        );
                    }

                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Mention a member."
                        );
                    }

                    const oldCount =
                        getVouchCount(
                            message.guild.id,
                            target.id
                        );

                    data.vouches[
                        target.id
                    ] = [];

                    saveDatabase();

                    await checkVouchRole(
                        target
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH CLEAR",
                        `${message.author} cleared **${oldCount}** vouches from ${target}.`
                    );

                    return replySuccess(
                        message,
                        `Cleared **${oldCount}** vouches from ${target}.`
                    );
                }

                // --------------------------------------
                // VOUCH ROLE SET
                // --------------------------------------

                if (
                    sub === "role" &&
                    args[0]?.toLowerCase() ===
                        "set"
                ) {
                    if (
                        !isServerOwner(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the **Server Owner** can set the vouch role."
                        );
                    }

                    const role =
                        resolveRole(
                            message.guild,
                            args
                                .slice(1)
                                .join(" ")
                        );

                    if (!role) {
                        return replyError(
                            message,
                            "I could not find that role."
                        );
                    }

                    if (
                        role.id ===
                        message.guild.id
                    ) {
                        return replyError(
                            message,
                            "That role cannot be used."
                        );
                    }

                    data.vouchSettings.roleId =
                        role.id;

                    saveDatabase();

                    await sendLog(
                        message.guild,
                        "VOUCH ROLE",
                        `${message.author} set the vouch reward role to ${role}.`
                    );

                    return replySuccess(
                        message,
                        `Vouch reward role set to ${role}.`
                    );
                }

                // --------------------------------------
                // VOUCH LIMIT
                // --------------------------------------

                if (
                    sub === "limit"
                ) {
                    if (
                        !isServerOwner(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the **Server Owner** can set the vouch limit."
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
                        limit > 100000
                    ) {
                        return replyError(
                            message,
                            "Vouch limit must be a whole number from 1 to 100000."
                        );
                    }

                    data.vouchSettings.limit =
                        limit;

                    saveDatabase();

                    await sendLog(
                        message.guild,
                        "VOUCH LIMIT",
                        `${message.author} set the vouch limit to **${limit}**.`
                    );

                    return replySuccess(
                        message,
                        `Vouch limit set to **${limit}**.`
                    );
                }

                return replyInfo(
                    message,
                    "Use `-help` to see all vouch commands."
                );
            }

            // ==========================================
            // VC COMMANDS
            // ==========================================

            if (
                command === "vc"
            ) {
                const sub =
                    args.shift()
                        ?.toLowerCase();

                if (
                    sub === "setup"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only **Founder** or **God** can set up Join To Create."
                        );
                    }

                    await setupJTC(
                        message.guild
                    );

                    return replySuccess(
                        message,
                        "Join To Create has been configured."
                    );
                }

                const channel =
                    message.member.voice.channel;

                if (
                    !channel ||
                    !getVCData(
                        channel.id
                    )
                ) {
                    return replyError(
                        message,
                        "You must be inside a VC+ personal voice channel."
                    );
                }

                const vcData =
                    getVCData(
                        channel.id
                    );

                // ======================================
                // VC COUNT
                // ======================================

                if (
                    sub === "count"
                ) {
                    return replyInfo(
                        message,
                        `There are currently **${channel.members.size}** member${channel.members.size === 1 ? "" : "s"} in this VC.`
                    );
                }

                // ======================================
                // LOCK
                // ======================================

                if (
                    sub === "lock"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
                        );
                    }

                    await lockVC(
                        channel,
                        vcData
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        "Voice channel locked."
                    );
                }

                // ======================================
                // UNLOCK
                // ======================================

                if (
                    sub === "unlock"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
                        );
                    }

                    await unlockVC(
                        channel,
                        vcData
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        "Voice channel unlocked."
                    );
                }

                // ======================================
                // RENAME
                // ======================================

                if (
                    sub === "rename"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
                        );
                    }

                    const name =
                        args.join(" ")
                            .trim();

                    if (!name) {
                        return replyError(
                            message,
                            "Give me a new VC name."
                        );
                    }

                    await channel.setName(
                        name.slice(0, 100)
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        `VC renamed to **${name.slice(0, 100)}**.`
                    );
                }

                // ======================================
                // LIMIT
                // ======================================

                if (
                    sub === "limit"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
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
                        limit < 0 ||
                        limit > 99
                    ) {
                        return replyError(
                            message,
                            "VC limit must be between 0 and 99."
                        );
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    return replySuccess(
                        message,
                        `VC limit set to **${limit}**.`
                    );
                }

                // ======================================
                // CLAIM
                // ======================================

                if (
                    sub === "claim"
                ) {
                    if (
                        channel.members.has(
                            vcData.ownerId
                        )
                    ) {
                        return replyError(
                            message,
                            "The current VC owner is still inside."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        "You are now the VC owner."
                    );
                }

                // ======================================
                // FORCECLAIM
                // ======================================

                if (
                    sub === "forceclaim"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only Founder can force claim a VC."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        "You force claimed this VC."
                    );
                }

                // ======================================
                // DELETE
                // ======================================

                if (
                    sub === "delete"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
                        );
                    }

                    tempVCs.delete(
                        channel.id
                    );

                    await sendLog(
                        message.guild,
                        "VC DELETE",
                        `${message.author} deleted **${channel.name}**.`
                    );

                    await channel.delete(
                        "VC+ delete"
                    );

                    return;
                }

                // ======================================
                // KICK / DISCONNECT / BAN / REJECT /
                // PERMIT / TRANSFER
                // ======================================

                if (
                    [
                        "kick",
                        "disconnect",
                        "ban",
                        "reject",
                        "permit",
                        "transfer"
                    ].includes(
                        sub
                    )
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this VC."
                        );
                    }

                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "I could not find that member."
                        );
                    }

                    if (
                        sub === "kick" ||
                        sub === "disconnect"
                    ) {
                        if (
                            target.voice.channelId !==
                            channel.id
                        ) {
                            return replyError(
                                message,
                                "That member is not in this VC."
                            );
                        }

                        await target.voice.setChannel(
                            null
                        );

                        return replySuccess(
                            message,
                            `${target} was disconnected.`
                        );
                    }

                    if (
                        sub === "ban"
                    ) {
                        vcData.banned.add(
                            target.id
                        );

                        await denyUserFromVC(
                            channel,
                            target.id
                        );

                        if (
                            target.voice.channelId ===
                            channel.id
                        ) {
                            await target.voice.setChannel(
                                null
                            );
                        }

                        return replySuccess(
                            message,
                            `${target} is now banned from this VC.`
                        );
                    }

                    if (
                        sub === "reject"
                    ) {
                        vcData.rejected.add(
                            target.id
                        );

                        await denyUserFromVC(
                            channel,
                            target.id
                        );

                        if (
                            target.voice.channelId ===
                            channel.id
                        ) {
                            await target.voice.setChannel(
                                null
                            );
                        }

                        return replySuccess(
                            message,
                            `${target} was rejected from this VC.`
                        );
                    }

                    if (
                        sub === "permit"
                    ) {
                        vcData.banned.delete(
                            target.id
                        );

                        vcData.rejected.delete(
                            target.id
                        );

                        vcData.permitted.add(
                            target.id
                        );

                        await permitUserInVC(
                            channel,
                            target.id
                        );

                        return replySuccess(
                            message,
                            `${target} has been permitted.`
                        );
                    }

                    if (
                        sub === "transfer"
                    ) {
                        if (
                            !channel.members.has(
                                target.id
                            )
                        ) {
                            return replyError(
                                message,
                                "The target must be inside this VC."
                            );
                        }

                        vcData.ownerId =
                            target.id;

                        await refreshVCInterface(
                            channel
                        );

                        return replySuccess(
                            message,
                            `VC ownership transferred to ${target}.`
                        );
                    }
                }

                // ======================================
                // STFU
                // ======================================

                if (
                    sub === "stfu"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only God or Founder can use STFU."
                        );
                    }

                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "I could not find that member."
                        );
                    }

                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return replyError(
                            message,
                            "That member is not in this VC."
                        );
                    }

                    vcData.stfu.add(
                        target.id
                    );

                    await target.voice.setMute(
                        true,
                        "VC+ STFU"
                    );

                    return replySuccess(
                        message,
                        `${target} is now server muted.`
                    );
                }

                // ======================================
                // UNSTFU
                // ======================================

                if (
                    sub === "unstfu"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only God or Founder can use UnSTFU."
                        );
                    }

                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "I could not find that member."
                        );
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    try {
                        await target.voice.setMute(
                            false,
                            "VC+ UnSTFU"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        `${target} has been unmuted.`
                    );
                }

                return replyInfo(
                    message,
                    "Use `-help` to see all VC+ commands."
                );
            }

            // ==========================================
            // BAN
            // ==========================================

            if (
                command === "ban"
            ) {
                if (
                    !canModerate(
                        message.member
                    ) &&
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to ban members."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !canModerateTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot ban this member. Only the **Server Owner** can moderate the highest role."
                    );
                }

                const reason =
                    args
                        .slice(
                            message.mentions.members.first()
                                ? 1
                                : 1
                        )
                        .join(" ") ||
                    "No reason provided";

                try {
                    await target.send({
                        embeds: [
                            vcEmbed(
                                `You were banned from **${message.guild.name}**.\n\n**Reason:** ${reason}`,
                                "VC+ • Ban"
                            )
                        ]
                    }).catch(() => {});

                    await target.ban({
                        reason
                    });

                    await sendLog(
                        message.guild,
                        "BAN",
                        `${message.author} banned **${target.user.tag}**.\nReason: ${reason}`
                    );

                    return replySuccess(
                        message,
                        `Banned **${target.user.tag}**.`
                    );
                } catch (error) {
                    console.error(
                        "Ban error:",
                        error
                    );

                    return replyError(
                        message,
                        "I could not ban that member. Check VC+'s role position and permissions."
                    );
                }
            }

            // ==========================================
            // KICK
            // ==========================================

            if (
                command === "kick"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to kick members."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !canModerateTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot kick this member."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

                try {
                    await target.kick(
                        reason
                    );

                    await sendLog(
                        message.guild,
                        "KICK",
                        `${message.author} kicked **${target.user.tag}**.\nReason: ${reason}`
                    );

                    return replySuccess(
                        message,
                        `Kicked **${target.user.tag}**.`
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not kick that member."
                    );
                }
            }

            // ==========================================
            // TIMEOUT
            // ==========================================

            if (
                command === "timeout"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to timeout members."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !canModerateTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot timeout this member."
                    );
                }

                const minutes =
                    Number(
                        args[
                            message.mentions.members.first()
                                ? 1
                                : 0
                        ]
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
                        "Timeout must be between 1 minute and 28 days."
                    );
                }

                const reason =
                    args
                        .slice(
                            message.mentions.members.first()
                                ? 2
                                : 1
                        )
                        .join(" ") ||
                    "No reason provided";

                try {
                    await target.timeout(
                        minutes * 60 * 1000,
                        reason
                    );

                    await sendLog(
                        message.guild,
                        "TIMEOUT",
                        `${message.author} timed out **${target.user.tag}** for **${minutes} minutes**.\nReason: ${reason}`
                    );

                    return replySuccess(
                        message,
                        `Timed out **${target.user.tag}** for **${minutes} minutes**.`
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not timeout that member."
                    );
                }
            }

            // ==========================================
            // UNTIMEOUT
            // ==========================================

            if (
                command === "untimeout"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to remove timeouts."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !canModerateTarget(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot modify this member."
                    );
                }

                try {
                    await target.timeout(
                        null,
                        "VC+ timeout removed"
                    );

                    return replySuccess(
                        message,
                        `Timeout removed from **${target.user.tag}**.`
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not remove the timeout."
                    );
                }
            }

            // ==========================================
            // FOREVERBAN
            // ==========================================

            if (
                command === "foreverban"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only God or Founder can use foreverban."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !canManageHighRank(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot foreverban this member."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

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

                try {
                    await target.ban({
                        reason:
                            `Foreverban: ${reason}`
                    });
                } catch {}

                await sendLog(
                    message.guild,
                    "FOREVERBAN",
                    `${message.author} foreverbanned **${target.user.tag}**.\nReason: ${reason}`
                );

                return replySuccess(
                    message,
                    `**${target.user.tag}** was added to the foreverban list.`
                );
            }

            // ==========================================
            // UNBAN
            // ==========================================

            if (
                command === "unban"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only God or Founder can unban users."
                    );
                }

                const userId =
                    extractUserId(
                        args[0]
                    );

                if (!userId) {
                    return replyError(
                        message,
                        "Give me a valid user ID."
                    );
                }

                try {
                    await message.guild.bans.remove(
                        userId,
                        "VC+ unban"
                    );

                    data.foreverBanned =
                        data.foreverBanned.filter(
                            id =>
                                id !==
                                userId
                        );

                    saveDatabase();

                    await sendLog(
                        message.guild,
                        "UNBAN",
                        `${message.author} unbanned \`${userId}\`.`
                    );

                    return replySuccess(
                        message,
                        `Unbanned **${userId}**.`
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not unban that user."
                    );
                }
            }

            // ==========================================
            // BANLIST
            // ==========================================

            if (
                command === "banlist"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to view the ban list."
                    );
                }

                try {
                    const bans =
                        await message.guild.bans.fetch();

                    if (
                        !bans.size
                    ) {
                        return replyInfo(
                            message,
                            "There are no banned users."
                        );
                    }

                    const list =
                        bans
                            .first(30)
                            .map(
                                ban =>
                                    `• ${ban.user.tag} — \`${ban.user.id}\``
                            )
                            .join("\n");

                    return message.reply({
                        embeds: [
                            vcEmbed(
                                `**Banned Users: ${bans.size}**\n\n${list}`,
                                "VC+ • Ban List"
                            )
                        ]
                    });
                } catch {
                    return replyError(
                        message,
                        "I could not retrieve the ban list."
                    );
                }
            }

            // ==========================================
            // PURGE / CLEAR
            // ==========================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to clear messages."
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
                        "Amount must be between 1 and 100."
                    );
                }

                try {
                    const deleted =
                        await message.channel.bulkDelete(
                            amount,
                            true
                        );

                    const response =
                        await message.channel.send({
                            embeds: [
                                vcEmbed(
                                    `Deleted **${deleted.size}** messages.`,
                                    "VC+ • Clear"
                                )
                            ]
                        });

                    setTimeout(
                        () =>
                            response.delete()
                                .catch(
                                    () => {}
                                ),
                        5000
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not clear those messages."
                    );
                }

                return;
            }

            // ==========================================
            // RANK
            // ==========================================

            if (
                command === "rank"
            ) {
                if (
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the **Server Owner** can assign ranks."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                const rank =
                    normalizeRank(
                        args[1] ||
                        args[0]
                    );

                if (
                    !RANKS[rank]
                ) {
                    return replyError(
                        message,
                        "Invalid rank."
                    );
                }

                if (
                    rank ===
                    "founder"
                ) {
                    return replyError(
                        message,
                        "The Server Owner is the absolute Founder. You cannot assign Founder."
                    );
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDatabase();

                await sendLog(
                    message.guild,
                    "RANK",
                    `${message.author} assigned **${RANK_NAMES[RANKS[rank]]}** to ${target}.`
                );

                return replySuccess(
                    message,
                    `${target} is now **${RANK_NAMES[RANKS[rank]]}**.`
                );
            }

            // ==========================================
            // GODMODE
            // ==========================================

            if (
                command === "godmode"
            ) {
                if (
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the **Server Owner** can manage Godmode."
                    );
                }

                const target =
                    message.mentions.members.first() ||
                    message.member;

                const state =
                    message.mentions.members.first()
                        ? args[1]?.toLowerCase()
                        : args[0]?.toLowerCase();

                if (
                    state !== "on" &&
                    state !== "off"
                ) {
                    return replyError(
                        message,
                        "Use `-godmode on`, `-godmode off`, or `-godmode @user on/off`."
                    );
                }

                if (
                    state === "on"
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
                } else {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );
                }

                saveDatabase();

                return replySuccess(
                    message,
                    `Godmode **${state}** for ${target}.`
                );
            }

            // ==========================================
            // FILTER
            // ==========================================

            if (
                command === "filter"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only God or Founder can manage the filter."
                    );
                }

                const sub =
                    args.shift()
                        ?.toLowerCase();

                if (
                    sub === "on" ||
                    sub === "off"
                ) {
                    data.filter.enabled =
                        sub === "on";

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Word filter turned **${sub}**.`
                    );
                }

                if (
                    sub === "add"
                ) {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    if (!word) {
                        return replyError(
                            message,
                            "Give me a word."
                        );
                    }

                    if (
                        !data.filter.words.includes(
                            word
                        )
                    ) {
                        data.filter.words.push(
                            word
                        );
                    }

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Added \`${word}\` to the filter.`
                    );
                }

                if (
                    sub === "remove"
                ) {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    data.filter.words =
                        data.filter.words.filter(
                            item =>
                                item !==
                                word
                        );

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Removed \`${word}\` from the filter.`
                    );
                }

                if (
                    sub === "list"
                ) {
                    if (
                        !data.filter.words.length
                    ) {
                        return replyInfo(
                            message,
                            "No filtered words are configured."
                        );
                    }

                    return message.reply({
                        embeds: [
                            vcEmbed(
                                data.filter.words
                                    .map(
                                        word =>
                                            `• \`${word}\``
                                    )
                                    .join("\n"),
                                "VC+ • Filter"
                            )
                        ]
                    });
                }

                if (
                    sub === "log"
                ) {
                    const state =
                        args[0]?.toLowerCase();

                    if (
                        state !== "on" &&
                        state !== "off"
                    ) {
                        return replyError(
                            message,
                            "Use `-filter log on` or `-filter log off`."
                        );
                    }

                    data.filter.log =
                        state === "on";

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Filter logging turned **${state}**.`
                    );
                }

                if (
                    sub === "strikes"
                ) {
                    const strikes =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            strikes
                        ) ||
                        strikes < 1 ||
                        strikes > 20
                    ) {
                        return replyError(
                            message,
                            "Strike limit must be between 1 and 20."
                        );
                    }

                    data.filter.maxStrikes =
                        strikes;

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Strike limit set to **${strikes}**.`
                    );
                }

                if (
                    sub === "reset"
                ) {
                    const target =
                        message.mentions.members.first() ||
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "I could not find that member."
                        );
                    }

                    delete data.filter.strikes[
                        target.id
                    ];

                    saveDatabase();

                    return replySuccess(
                        message,
                        `Filter strikes reset for ${target}.`
                    );
                }

                return replyInfo(
                    message,
                    "Use `-help` for filter commands."
                );
            }
        } catch (error) {
            console.error(
                "messageCreate error:",
                error
            );

            try {
                await sendLog(
                    message.guild,
                    "ERROR",
                    `Command error:\n\`\`\`\n${String(error).slice(0, 1500)}\n\`\`\``
                );
            } catch {}
        }
    }
);

// ======================================================
// VOICE STATE
// ======================================================

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

            const member =
                newState.member ||
                oldState.member;

            if (!guild || !member) {
                return;
            }

            const data =
                getGuildData(
                    guild.id
                );

            // ==========================================
            // JOIN TO CREATE
            // ==========================================

            if (
                newState.channelId &&
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                await createPersonalVC(
                    member
                );

                return;
            }

            // ==========================================
            // JOIN MANAGED VC
            // ==========================================

            if (
                newState.channelId
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (vcData) {
                    const channel =
                        newState.channel;

                    if (
                        vcData.banned.has(
                            member.id
                        ) ||
                        vcData.rejected.has(
                            member.id
                        )
                    ) {
                        try {
                            await member.voice.setChannel(
                                null
                            );
                        } catch {}

                        return;
                    }

                    if (
                        vcData.locked &&
                        member.id !==
                            vcData.ownerId &&
                        !vcData.permitted.has(
                            member.id
                        ) &&
                        !isGod(member)
                    ) {
                        try {
                            await member.voice.setChannel(
                                null
                            );
                        } catch {}

                        return;
                    }

                    if (
                        vcData.stfu.has(
                            member.id
                        )
                    ) {
                        try {
                            await member.voice.setMute(
                                true,
                                "VC+ STFU"
                            );
                        } catch {}
                    }
                }
            }

            // ==========================================
            // EMPTY VC DELETE
            // ==========================================

            if (
                oldState.channelId
            ) {
                const oldData =
                    getVCData(
                        oldState.channelId
                    );

                if (
                    oldData &&
                    oldState.channel &&
                    oldState.channel.members
                        .size === 0
                ) {
                    const oldChannel =
                        oldState.channel;

                    tempVCs.delete(
                        oldChannel.id
                    );

                    await sendLog(
                        guild,
                        "VC DELETE",
                        `**${oldChannel.name}** was deleted because it became empty.`
                    );

                    try {
                        await oldChannel.delete(
                            "VC+ empty VC"
                        );
                    } catch {}
                }
            }
        } catch (error) {
            console.error(
                "voiceStateUpdate error:",
                error
            );
        }
    }
);

// ======================================================
// STFU PROTECTION
// ======================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            const channel =
                newState.channel;

            if (!channel) {
                return;
            }

            const data =
                getVCData(
                    channel.id
                );

            if (!data) {
                return;
            }

            if (
                data.stfu.has(
                    newState.id
                ) &&
                !newState.serverMute
            ) {
                await newState.setMute(
                    true,
                    "VC+ STFU protection"
                );
            }
        } catch {}
    }
);

// ======================================================
// FOREVERBAN PROTECTION
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                data.foreverBanned.includes(
                    member.id
                )
            ) {
                try {
                    await member.ban({
                        reason:
                            "VC+ Foreverban protection"
                    });
                } catch {}

                await sendLog(
                    member.guild,
                    "FOREVERBAN",
                    `${member.user.tag} was automatically banned by the foreverban system.`
                );
            }
        } catch (error) {
            console.error(
                "guildMemberAdd error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE AUDIT
// ======================================================

async function getRecentAuditExecutor(
    guild,
    type
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                limit: 1,
                type
            });

        const entry =
            logs.entries.first();

        if (!entry) {
            return null;
        }

        if (
            Date.now() -
                entry.createdTimestamp >
            15000
        ) {
            return null;
        }

        return entry.executor;
    } catch {
        return null;
    }
}

// ======================================================
// CHANNEL CREATE
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection
                    .channelCreate
            ) {
                return;
            }

            const executor =
                await getRecentAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) {
                return;
            }

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members.fetch(
                    executor.id
                ).catch(
                    () => null
                );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    channel.guild,
                    "SECURITY",
                    `${executor.tag} created **${channel.name}**.`
                );

                return;
            }

            try {
                await channel.delete(
                    "VC+ anti-nuke"
                );
            } catch {}

            await sendLog(
                channel.guild,
                "ANTI-NUKE",
                `Unauthorized channel creation by **${executor.tag}**.\nChannel: \`${channel.name}\`\nAction: Channel deleted.`
            );
        } catch (error) {
            console.error(
                "Channel protection error:",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL DELETE
// ======================================================

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection
                    .channelDelete
            ) {
                return;
            }

            const executor =
                await getRecentAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

            if (!executor) {
                return;
            }

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members.fetch(
                    executor.id
                ).catch(
                    () => null
                );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    channel.guild,
                    "SECURITY",
                    `${executor.tag} deleted **${channel.name}**.`
                );

                return;
            }

            await sendLog(
                channel.guild,
                "ANTI-NUKE",
                `Unauthorized channel deletion by **${executor.tag}**.\nChannel: \`${channel.name}\``
            );
        } catch {}
    }
);

// ======================================================
// ROLE CREATE
// ======================================================

client.on(
    "roleCreate",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection
                    .roleCreate
            ) {
                return;
            }

            const executor =
                await getRecentAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleCreate
                );

            if (!executor) {
                return;
            }

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await role.guild.members.fetch(
                    executor.id
                ).catch(
                    () => null
                );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    role.guild,
                    "SECURITY",
                    `${executor.tag} created role **${role.name}**.`
                );

                return;
            }

            try {
                await role.delete(
                    "VC+ anti-nuke"
                );
            } catch {}

            await sendLog(
                role.guild,
                "ANTI-NUKE",
                `Unauthorized role creation by **${executor.tag}**.\nRole: \`${role.name}\`\nAction: Role deleted.`
            );
        } catch {}
    }
);

// ======================================================
// ROLE DELETE
// ======================================================

client.on(
    "roleDelete",
    async role => {
        try {
            const executor =
                await getRecentAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleDelete
                );

            if (!executor) {
                return;
            }

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await role.guild.members.fetch(
                    executor.id
                ).catch(
                    () => null
                );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    role.guild,
                    "SECURITY",
                    `${executor.tag} deleted role **${role.name}**.`
                );

                return;
            }

            await sendLog(
                role.guild,
                "ANTI-NUKE",
                `Unauthorized role deletion by **${executor.tag}**.\nRole: \`${role.name}\``
            );
        } catch {}
    }
);

// ======================================================
// WEBHOOK SECURITY
// ======================================================

client.on(
    "webhooksUpdate",
    async channel => {
        try {
            const executor =
                await getRecentAuditExecutor(
                    channel.guild,
                    AuditLogEvent.WebhookCreate
                );

            if (!executor) {
                return;
            }

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members.fetch(
                    executor.id
                ).catch(
                    () => null
                );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    channel.guild,
                    "SECURITY",
                    `${executor.tag} created or modified a webhook.`
                );

                return;
            }

            await sendLog(
                channel.guild,
                "ANTI-NUKE",
                `Unauthorized webhook activity by **${executor.tag}**.`
            );
        } catch {}
    }
);

// ======================================================
// GUILD CREATE
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            getGuildData(
                guild.id
            );

            await createLogSystem(
                guild
            );

            await sendLog(
                guild,
                "WELCOME",
                `VC+ has joined **${guild.name}**.\n\nUse \`-help\` to view commands.\nUse \`-vc setup\` to configure Join To Create.`
            );

            const embed =
                new EmbedBuilder()
                    .setColor(0x000000)
                    .setAuthor({
                        name: "VC+"
                    })
                    .setDescription(`
✦ **VC+ IS READY**

**Getting Started**

\`-help\`
View every command.

\`-vc setup\`
Set up Join To Create.

**Security**

Server Owner = absolute highest authority.

Founder/God = high-level security.

**Logs**

\`jailed-logs\`
                    `)
                    .setFooter({
                        text: "VC+"
                    });

            const system =
                guild.systemChannel;

            if (
                system &&
                system.permissionsFor(
                    client.user
                )?.has(
                    PermissionFlagsBits.SendMessages
                )
            ) {
                await system.send({
                    embeds: [embed]
                });
            }
        } catch (error) {
            console.error(
                "guildCreate error:",
                error
            );
        }
    }
);

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    async () => {
        console.log(
            `${BOT_NAME} is online as ${client.user.tag}`
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
            const guild of
            client.guilds.cache.values()
        ) {
            try {
                await createLogSystem(
                    guild
                );
            } catch {}
        }
    }
);

// ======================================================
// ERROR PROTECTION
// ======================================================

client.on(
    "error",
    error => {
        console.error(
            "Discord client error:",
            error
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "Discord shard error:",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "Discord warning:",
            warning
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled Promise Rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught Exception:",
            error
        );
    }
);

process.on(
    "warning",
    warning => {
        console.warn(
            "Node warning:",
            warning
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(
    TOKEN
);
