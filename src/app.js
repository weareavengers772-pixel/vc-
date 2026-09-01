import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    AuditLogEvent
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
// DATABASE
// ======================================================

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultGuildData() {
    return {
        ranks: {},
        foreverBanned: [],
        godmode: [],
        vouches: {},

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },

        logs: {
            categoryId: null,
            serverLogChannelId: null,
            modLogChannelId: null
        },

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

        protection: {
            channelCreate: true,
            channelDelete: true,
            roleCreate: true,
            roleDelete: true,
            webhookCreate: true
        },

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
            fs.readFileSync(DATA_FILE, "utf8")
        );

        if (!database || typeof database !== "object") {
            database = {};
        }
    } catch (error) {
        console.error("Database load error:", error);
        database = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2)
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] = defaultGuildData();
        saveDatabase();
    }

    const data = database[guildId];
    const defaults = defaultGuildData();

    for (const key of Object.keys(defaults)) {
        if (data[key] === undefined) {
            data[key] = defaults[key];
        }
    }

    return data;
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
// RANK SYSTEM
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

function normalizeRank(rank) {
    if (!rank) return null;

    const value = String(rank)
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    const aliases = {
        member: "member",
        staff: "staff",
        moderator: "moderator",
        mod: "moderator",
        admin: "admin",
        administrator: "admin",
        director: "director",
        executive: "executive",
        exec: "executive",
        coowner: "coowner",
        owner: "owner",
        god: "god",
        godmode: "god",
        founder: "founder"
    };

    return aliases[value] || null;
}

function getRank(member) {
    if (!member || !member.guild) {
        return "member";
    }

    // Server owner always has Founder
    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    // Explicit rank assignment
    if (data.ranks[member.id]) {
        return normalizeRank(data.ranks[member.id]) || "member";
    }

    let highestRank = "member";
    let highestLevel = RANKS.member;

    const roleMappings = [
        ["founder", data.roles.founder],
        ["god", data.roles.god],
        ["owner", data.roles.owner],
        ["coowner", data.roles.coowner],
        ["executive", data.roles.executive],
        ["director", data.roles.director],
        ["admin", data.roles.admin],
        ["moderator", data.roles.moderator],
        ["staff", data.roles.staff]
    ];

    for (const [rank, roleId] of roleMappings) {
        if (!roleId) continue;

        if (
            member.roles.cache.has(roleId) &&
            RANKS[rank] > highestLevel
        ) {
            highestRank = rank;
            highestLevel = RANKS[rank];
        }
    }

    if (
        member.permissions.has(
            PermissionFlagsBits.Administrator
        ) &&
        highestLevel < RANKS.admin
    ) {
        highestRank = "admin";
    }

    return highestRank;
}

function getRankLevel(member) {
    return RANKS[getRank(member)] || 1;
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGod(member) {
    return getRankLevel(member) >= RANKS.god;
}

function canModerate(member) {
    return getRankLevel(member) >= RANKS.moderator;
}

function isTrustedExecutor(member) {
    return isFounder(member) || isGod(member);
}

// ======================================================
// VC+ COMMAND RESPONSE STYLE
// ======================================================

function vcEmbed(message) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+"
        })
        .setDescription(`✦ ${message}`)
        .setFooter({
            text: "VC+"
        });
}

async function replySuccess(message, title, description) {
    return message.reply({
        embeds: [
            vcEmbed(description)
        ]
    });
}

async function replyError(message, title, description) {
    return message.reply({
        embeds: [
            vcEmbed(description)
        ]
    });
}

async function replyInfo(message, title, description) {
    return message.reply({
        embeds: [
            vcEmbed(description)
        ]
    });
}

async function replyWarning(message, title, description) {
    return message.reply({
        embeds: [
            vcEmbed(description)
        ]
    });
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
\`${PREFIX}vc kick @user\`
\`${PREFIX}vc disconnect @user\`
\`${PREFIX}vc ban @user\`
\`${PREFIX}vc reject @user\`
\`${PREFIX}vc permit @user\`
\`${PREFIX}vc lock\`
\`${PREFIX}vc unlock\`
\`${PREFIX}vc transfer @user\`
\`${PREFIX}vc claim\`
\`${PREFIX}vc forceclaim\`
\`${PREFIX}vc rename <name>\`
\`${PREFIX}vc limit <number>\`
\`${PREFIX}vc stfu @user\`
\`${PREFIX}vc unstfu @user\`

**MODERATION**

\`${PREFIX}ban @user [reason]\`
\`${PREFIX}unban <userId>\`
\`${PREFIX}banlist\`
\`${PREFIX}kick @user [reason]\`
\`${PREFIX}timeout @user <minutes> [reason]\`
\`${PREFIX}untimeout @user\`
\`${PREFIX}foreverban @user [reason]\`
\`${PREFIX}purge <amount>\`
\`${PREFIX}clear <amount>\`

**RANKS**

\`${PREFIX}rank @user <rank>\`
\`${PREFIX}godmode on/off\`

**FILTER**

\`${PREFIX}filter on/off\`
\`${PREFIX}filter add <word>\`
\`${PREFIX}filter remove <word>\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on/off\`
\`${PREFIX}filter strikes <number>\`
\`${PREFIX}filter reset @user\`

**GENERAL**

\`${PREFIX}help\`
\`${PREFIX}commands\`

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
        `)
        .setFooter({
            text: "VC+"
        });
}

// ======================================================
// LOG SYSTEM
// ======================================================

async function createLogSystem(guild) {
    const data = getGuildData(guild.id);

    let category = null;

    if (data.logs.categoryId) {
        category = guild.channels.cache.get(
            data.logs.categoryId
        );
    }

    if (!category) {
        category = await guild.channels.create({
            name: "VC+ Logs",
            type: ChannelType.GuildCategory,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                }
            ]
        });

        data.logs.categoryId = category.id;
    }

    let serverLogs = null;

    if (data.logs.serverLogChannelId) {
        serverLogs = guild.channels.cache.get(
            data.logs.serverLogChannelId
        );
    }

    if (!serverLogs) {
        serverLogs = await guild.channels.create({
            name: "server-logs",
            type: ChannelType.GuildText,
            parent: category.id,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                }
            ]
        });

        data.logs.serverLogChannelId =
            serverLogs.id;
    }

    let modLogs = null;

    if (data.logs.modLogChannelId) {
        modLogs = guild.channels.cache.get(
            data.logs.modLogChannelId
        );
    }

    if (!modLogs) {
        modLogs = await guild.channels.create({
            name: "mod-logs",
            type: ChannelType.GuildText,
            parent: category.id,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                }
            ]
        });

        data.logs.modLogChannelId =
            modLogs.id;
    }

    saveDatabase();

    return {
        category,
        serverLogs,
        modLogs
    };
}

async function sendLog(
    guild,
    type,
    description,
    moderation = false
) {
    try {
        const data =
            getGuildData(guild.id);

        if (
            !data.logs.serverLogChannelId ||
            !data.logs.modLogChannelId
        ) {
            await createLogSystem(guild);
        }

        const refreshed =
            getGuildData(guild.id);

        const channelId =
            moderation
                ? refreshed.logs.modLogChannelId
                : refreshed.logs.serverLogChannelId;

        const channel =
            guild.channels.cache.get(channelId);

        if (!channel) return;

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x000000)
                    .setAuthor({
                        name: "VC+"
                    })
                    .setDescription(
                        `✦ **${type}**\n${description}`
                    )
                    .setFooter({
                        text: "VC+ Logs"
                    })
            ]
        });
    } catch (error) {
        console.error(
            "Log error:",
            error
        );
    }
}

// ======================================================
// MODERATION DM
// ======================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason,
    duration = null
) {
    try {
        const description = [
            `✦ **${action}**`,
            "",
            `**Server:** ${guild.name}`,
            `**Reason:** ${
                reason || "No reason provided."
            }`,
            duration
                ? `**Duration:** ${duration}`
                : null
        ]
            .filter(Boolean)
            .join("\n");

        await user.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x000000)
                    .setAuthor({
                        name: "VC+"
                    })
                    .setDescription(
                        description
                    )
                    .setFooter({
                        text: "VC+"
                    })
            ]
        });
    } catch {
        // User has DMs disabled.
    }
}

// ======================================================
// TEMP VC SYSTEM
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

        locked: false
    };
}

function getVCData(channelId) {
    return tempVCs.get(channelId);
}

function isVCOwner(
    member,
    channel
) {
    const vcData =
        getVCData(channel.id);

    if (!vcData) return false;

    return (
        vcData.ownerId === member.id ||
        isFounder(member)
    );
}

async function createPersonalVC(member) {
    const guild = member.guild;

    const data =
        getGuildData(guild.id);

    let category = null;

    if (data.jtc.categoryId) {
        category =
            guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    const channel =
        await guild.channels.create({
            name: `${member.user.username} VC`,
            type: ChannelType.GuildVoice,

            parent:
                category?.id || null,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,

                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.ViewChannel
                    ]
                },

                {
                    id: member.id,

                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.Stream,
                        PermissionFlagsBits.UseVAD
                    ]
                }
            ]
        });

    tempVCs.set(
        channel.id,
        createVCData(
            guild.id,
            member.id
        )
    );

    try {
        await member.voice.setChannel(
            channel
        );
    } catch {}

    await sendLog(
        guild,
        "VC CREATED",
        `${member} created ${channel}.`
    );

    return channel;
}

// ======================================================
// VC CLEANUP
// ======================================================

async function cleanupVC(channel) {
    if (!channel) return;

    const vcData =
        getVCData(channel.id);

    if (!vcData) return;

    if (channel.members.size > 0) {
        return;
    }

    tempVCs.delete(channel.id);

    try {
        await channel.delete(
            "VC+ temporary VC cleanup"
        );
    } catch {}

    await sendLog(
        channel.guild,
        "VC DELETED",
        `Temporary VC **${channel.name}** was deleted.`
    );
}

// ======================================================
// VC OWNER CHECK
// ======================================================

function requireVCOwner(message) {
    const channel =
        message.member?.voice?.channel;

    if (!channel) {
        replyError(
            message,
            "Not In VC",
            "You need to be inside your VC."
        );

        return null;
    }

    const vcData =
        getVCData(channel.id);

    if (!vcData) {
        replyError(
            message,
            "Not A VC+ Channel",
            "This is not a VC+ personal voice channel."
        );

        return null;
    }

    if (
        !isVCOwner(
            message.member,
            channel
        )
    ) {
        replyError(
            message,
            "Permission Denied",
            "Only the VC owner or Founder can use this."
        );

        return null;
    }

    return channel;
}

// ======================================================
// MESSAGE FILTER
// ======================================================

async function handleFilter(message) {
    if (!message.guild) {
        return false;
    }

    if (message.author.bot) {
        return false;
    }

    const data =
        getGuildData(
            message.guild.id
        );

    if (!data.filter.enabled) {
        return false;
    }

    if (
        isTrustedExecutor(
            message.member
        )
    ) {
        return false;
    }

    if (!data.filter.words.length) {
        return false;
    }

    const content =
        message.content.toLowerCase();

    const foundWord =
        data.filter.words.find(
            word =>
                content.includes(
                    word.toLowerCase()
                )
        );

    if (!foundWord) {
        return false;
    }

    const userId =
        message.author.id;

    data.filter.strikes[userId] =
        (data.filter.strikes[userId] || 0) + 1;

    const strikes =
        data.filter.strikes[userId];

    try {
        await message.delete();
    } catch {}

    if (data.filter.log) {
        await sendLog(
            message.guild,
            "FILTER",
            `${message.author} triggered the word filter.\nWord: \`${foundWord}\`\nStrikes: **${strikes}**`,
            true
        );
    }

    if (
        strikes >=
        data.filter.maxStrikes
    ) {
        try {
            await message.member.timeout(
                10 * 60 * 1000,
                "VC+ word filter"
            );
        } catch {}

        data.filter.strikes[userId] = 0;

        await sendLog(
            message.guild,
            "FILTER TIMEOUT",
            `${message.author} was timed out after reaching the strike limit.`,
            true
        );
    }

    saveDatabase();

    return true;
}

// ======================================================
// MESSAGE COMMAND HANDLER
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (!message.guild) {
                return;
            }

            if (message.author.bot) {
                return;
            }

            const filtered =
                await handleFilter(
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

            const args =
                message.content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()?.toLowerCase();

            if (!command) {
                return;
            }

            // ==================================================
            // HELP
            // ==================================================

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

            // ==================================================
            // VC SETUP
            // ==================================================

            if (
                command === "vc" &&
                args[0]?.toLowerCase() ===
                    "setup"
            ) {
                if (
                    !isTrustedExecutor(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Permission Denied",
                        "Only **God** or **Founder** can setup VC+."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    data.jtc.enabled &&
                    data.jtc.channelId
                ) {
                    return replyError(
                        message,
                        "Already Setup",
                        "VC+ is already setup in this server."
                    );
                }

                let category =
                    message.guild.channels.cache.find(
                        channel =>
                            channel.type ===
                                ChannelType.GuildCategory &&
                            channel.name
                                .toLowerCase() ===
                                "voice channels"
                    );

                if (!category) {
                    category =
                        await message.guild.channels.create(
                            {
                                name: "Voice Channels",
                                type: ChannelType.GuildCategory
                            }
                        );
                }

                const joinChannel =
                    await message.guild.channels.create(
                        {
                            name: "➕・Join To Create",
                            type: ChannelType.GuildVoice,
                            parent: category.id
                        }
                    );

                data.jtc.enabled = true;
                data.jtc.channelId =
                    joinChannel.id;
                data.jtc.categoryId =
                    category.id;

                saveDatabase();

                await createLogSystem(
                    message.guild
                );

                await sendLog(
                    message.guild,
                    "JTC SETUP",
                    `${message.author} enabled Join To Create.`
                );

                return replySuccess(
                    message,
                    "VC+ Setup",
                    `Join To Create is now active in ${joinChannel}.`
                );
            }

            // ==================================================
            // VC COMMANDS
            // ==================================================

            if (
                command === "vc"
            ) {
                const subcommand =
                    args.shift()?.toLowerCase();

                if (!subcommand) {
                    return replyInfo(
                        message,
                        "VC+",
                        `Use \`${PREFIX}help\` to view VC commands.`
                    );
                }

                // ------------------------------------------------
                // KICK
                // ------------------------------------------------

                if (
                    subcommand === "kick"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to kick."
                        );
                    }

                    if (
                        target.voice.channelId !==
                        channel.id
                    ) {
                        return replyError(
                            message,
                            "User Not In VC",
                            "That user isn't inside your VC."
                        );
                    }

                    try {
                        await target.voice.setChannel(
                            null
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Kick",
                        `${target} was removed from the VC.`
                    );
                }

                // ------------------------------------------------
                // DISCONNECT
                // ------------------------------------------------

                if (
                    subcommand ===
                    "disconnect"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to disconnect."
                        );
                    }

                    try {
                        await target.voice.setChannel(
                            null
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "Disconnected",
                        `${target} was disconnected.`
                    );
                }

                // ------------------------------------------------
                // VC BAN
                // ------------------------------------------------

                if (
                    subcommand === "ban"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to ban."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.banned.add(
                        target.id
                    );

                    vcData.rejected.delete(
                        target.id
                    );

                    vcData.permitted.delete(
                        target.id
                    );

                    try {
                        await target.voice.setChannel(
                            null
                        );
                    } catch {}

                    try {
                        await channel.permissionOverwrites.edit(
                            target.id,
                            {
                                Connect: false
                            }
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Ban",
                        `${target} is now banned from your VC.`
                    );
                }

                // ------------------------------------------------
                // REJECT
                // ------------------------------------------------

                if (
                    subcommand ===
                    "reject"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to reject."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.rejected.add(
                        target.id
                    );

                    vcData.permitted.delete(
                        target.id
                    );

                    try {
                        await channel.permissionOverwrites.edit(
                            target.id,
                            {
                                Connect: false
                            }
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Reject",
                        `${target} is no longer allowed to join.`
                    );
                }

                // ------------------------------------------------
                // PERMIT
                // ------------------------------------------------

                if (
                    subcommand ===
                    "permit"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to permit."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.banned.delete(
                        target.id
                    );

                    vcData.rejected.delete(
                        target.id
                    );

                    vcData.permitted.add(
                        target.id
                    );

                    try {
                        await channel.permissionOverwrites.edit(
                            target.id,
                            {
                                Connect: true,
                                ViewChannel: true
                            }
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Permit",
                        `${target} can now join your VC.`
                    );
                }

                // ------------------------------------------------
                // LOCK
                // ------------------------------------------------

                if (
                    subcommand === "lock"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.locked = true;

                    try {
                        await channel.permissionOverwrites.edit(
                            message.guild.roles.everyone.id,
                            {
                                Connect: false
                            }
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Locked",
                        "Your VC is now locked."
                    );
                }

                // ------------------------------------------------
                // UNLOCK
                // ------------------------------------------------

                if (
                    subcommand ===
                    "unlock"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.locked = false;

                    try {
                        await channel.permissionOverwrites.edit(
                            message.guild.roles.everyone.id,
                            {
                                Connect: true
                            }
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "VC Unlocked",
                        "Your VC is now unlocked."
                    );
                }

                // ------------------------------------------------
                // TRANSFER
                // ------------------------------------------------

                if (
                    subcommand ===
                    "transfer"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the person you want to transfer ownership to."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    vcData.ownerId =
                        target.id;

                    return replySuccess(
                        message,
                        "Ownership Transferred",
                        `${target} now owns this VC.`
                    );
                }

                // ------------------------------------------------
                // CLAIM
                // ------------------------------------------------

                if (
                    subcommand === "claim"
                ) {
                    const channel =
                        message.member.voice.channel;

                    if (!channel) {
                        return replyError(
                            message,
                            "Not In VC",
                            "You need to be inside a VC."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    if (!vcData) {
                        return replyError(
                            message,
                            "Not A VC+ Channel",
                            "This is not a VC+ personal voice channel."
                        );
                    }

                    const owner =
                        channel.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        owner &&
                        owner.voice.channelId ===
                            channel.id
                    ) {
                        return replyError(
                            message,
                            "Owner Present",
                            "The current owner is still inside the VC."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    return replySuccess(
                        message,
                        "VC Claimed",
                        "You now own this VC."
                    );
                }

                // ------------------------------------------------
                // FORCE CLAIM
                // ------------------------------------------------

                if (
                    subcommand ===
                    "forceclaim"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only **Founder** can force claim a VC."
                        );
                    }

                    const channel =
                        message.member.voice.channel;

                    if (!channel) {
                        return replyError(
                            message,
                            "Not In VC",
                            "You need to be inside the VC."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    if (!vcData) {
                        return replyError(
                            message,
                            "Not A VC+ Channel",
                            "This isn't a VC+ channel."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    return replySuccess(
                        message,
                        "Force Claimed",
                        "You now own this VC."
                    );
                }

                // ------------------------------------------------
                // RENAME
                // ------------------------------------------------

                if (
                    subcommand ===
                    "rename"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const newName =
                        args.join(" ").trim();

                    if (!newName) {
                        return replyError(
                            message,
                            "Missing Name",
                            "Enter a new VC name."
                        );
                    }

                    try {
                        await channel.setName(
                            newName
                        );
                    } catch {
                        return replyError(
                            message,
                            "Rename Failed",
                            "I couldn't rename the VC."
                        );
                    }

                    return replySuccess(
                        message,
                        "VC Renamed",
                        `Your VC is now **${newName}**.`
                    );
                }

                // ------------------------------------------------
                // LIMIT
                // ------------------------------------------------

                if (
                    subcommand ===
                    "limit"
                ) {
                    const channel =
                        requireVCOwner(
                            message
                        );

                    if (!channel) return;

                    const limit =
                        Number(args[0]);

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        return replyError(
                            message,
                            "Invalid Limit",
                            "Use a number from **0** to **99**."
                        );
                    }

                    try {
                        await channel.setUserLimit(
                            limit
                        );
                    } catch {
                        return replyError(
                            message,
                            "Limit Failed",
                            "I couldn't change the VC limit."
                        );
                    }

                    return replySuccess(
                        message,
                        "User Limit",
                        `VC user limit set to **${limit}**.`
                    );
                }

                // ------------------------------------------------
                // STFU
                // ------------------------------------------------

                if (
                    subcommand ===
                    "stfu"
                ) {
                    if (
                        !isTrustedExecutor(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only **God** or **Founder** can use STFU."
                        );
                    }

                    const channel =
                        message.member.voice.channel;

                    if (!channel) {
                        return replyError(
                            message,
                            "Not In VC",
                            "You need to be inside a VC."
                        );
                    }

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user you want to server mute."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    if (!vcData) {
                        return replyError(
                            message,
                            "Not A VC+ Channel",
                            "This isn't a VC+ channel."
                        );
                    }

                    vcData.stfu.add(
                        target.id
                    );

                    try {
                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "STFU",
                        `${target} has been server muted.`
                    );
                }

                // ------------------------------------------------
                // UNSTFU
                // ------------------------------------------------

                if (
                    subcommand ===
                    "unstfu"
                ) {
                    if (
                        !isTrustedExecutor(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only **God** or **Founder** can use UNSTFU."
                        );
                    }

                    const channel =
                        message.member.voice.channel;

                    if (!channel) {
                        return replyError(
                            message,
                            "Not In VC",
                            "You need to be inside a VC."
                        );
                    }

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user."
                        );
                    }

                    const vcData =
                        getVCData(
                            channel.id
                        );

                    if (!vcData) {
                        return replyError(
                            message,
                            "Not A VC+ Channel",
                            "This isn't a VC+ channel."
                        );
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    try {
                        await target.voice.setMute(
                            false,
                            "VC+ UNSTFU"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "UNSTFU",
                        `${target} can speak again.`
                    );
                }

                return replyError(
                    message,
                    "Unknown VC Command",
                    `Use \`${PREFIX}help\` to see all commands.`
                );
            }

            // ==================================================
            // MODERATION PERMISSION
            // ==================================================

            const moderationCommands = [
                "ban",
                "unban",
                "banlist",
                "kick",
                "timeout",
                "untimeout",
                "foreverban",
                "purge",
                "clear"
            ];

            if (
                moderationCommands.includes(
                    command
                )
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Permission Denied",
                        "You need **Moderator** or higher."
                    );
                }
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command === "ban"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user you want to ban."
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Hierarchy",
                        "You cannot ban someone with an equal or higher rank."
                    );
                }

                const reason =
                    args.join(" ") ||
                    "No reason provided.";

                try {
                    await sendModerationDM(
                        target.user,
                        message.guild,
                        "Banned",
                        reason
                    );

                    await target.ban({
                        reason
                    });
                } catch {
                    return replyError(
                        message,
                        "Ban Failed",
                        "I couldn't ban that user."
                    );
                }

                await sendLog(
                    message.guild,
                    "BAN",
                    `${message.author} banned ${target}.\nReason: ${reason}`,
                    true
                );

                return replySuccess(
                    message,
                    "Banned",
                    `${target} has been banned.`
                );
            }

            // ==================================================
            // UNBAN
            // ==================================================

            if (
                command === "unban"
            ) {
                const userId =
                    args[0];

                if (!userId) {
                    return replyError(
                        message,
                        "Missing ID",
                        "Provide the user's ID."
                    );
                }

                try {
                    await message.guild.members.unban(
                        userId
                    );
                } catch {
                    return replyError(
                        message,
                        "Unban Failed",
                        "I couldn't unban that user."
                    );
                }

                return replySuccess(
                    message,
                    "Unbanned",
                    `User \`${userId}\` has been unbanned.`
                );
            }

            // ==================================================
            // BANLIST
            // ==================================================

            if (
                command === "banlist"
            ) {
                const bans =
                    await message.guild.bans.fetch();

                if (!bans.size) {
                    return replyInfo(
                        message,
                        "Ban List",
                        "There are no banned users."
                    );
                }

                const list =
                    bans
                        .map(
                            ban =>
                                `• ${ban.user.tag} — \`${ban.user.id}\``
                        )
                        .slice(0, 50)
                        .join("\n");

                return message.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x000000)
                            .setAuthor({
                                name: "VC+"
                            })
                            .setDescription(
                                `✦ **BAN LIST**\n\n${list}`
                            )
                            .setFooter({
                                text: `VC+ • ${bans.size} bans`
                            })
                    ]
                });
            }

            // ==================================================
            // KICK
            // ==================================================

            if (
                command === "kick"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user you want to kick."
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Hierarchy",
                        "You cannot kick someone with an equal or higher rank."
                    );
                }

                const reason =
                    args.join(" ") ||
                    "No reason provided.";

                try {
                    await sendModerationDM(
                        target.user,
                        message.guild,
                        "Kicked",
                        reason
                    );

                    await target.kick(
                        reason
                    );
                } catch {
                    return replyError(
                        message,
                        "Kick Failed",
                        "I couldn't kick that user."
                    );
                }

                await sendLog(
                    message.guild,
                    "KICK",
                    `${message.author} kicked ${target}.\nReason: ${reason}`,
                    true
                );

                return replySuccess(
                    message,
                    "Kicked",
                    `${target} has been kicked.`
                );
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command === "timeout"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user you want to timeout."
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Hierarchy",
                        "You cannot timeout someone with an equal or higher rank."
                    );
                }

                const minutes =
                    Number(args[0]);

                if (
                    !Number.isFinite(
                        minutes
                    ) ||
                    minutes <= 0 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Invalid Duration",
                        "Use a duration from **1** to **40320** minutes."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

                try {
                    await sendModerationDM(
                        target.user,
                        message.guild,
                        "Timed Out",
                        reason,
                        `${minutes} minutes`
                    );

                    await target.timeout(
                        minutes * 60 * 1000,
                        reason
                    );
                } catch {
                    return replyError(
                        message,
                        "Timeout Failed",
                        "I couldn't timeout that user."
                    );
                }

                return replySuccess(
                    message,
                    "Timed Out",
                    `${target} was timed out for **${minutes} minutes**.`
                );
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command ===
                "untimeout"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user."
                    );
                }

                try {
                    await target.timeout(
                        null,
                        "VC+ timeout removed"
                    );
                } catch {
                    return replyError(
                        message,
                        "Failed",
                        "I couldn't remove the timeout."
                    );
                }

                return replySuccess(
                    message,
                    "Timeout Removed",
                    `${target} is no longer timed out.`
                );
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isTrustedExecutor(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Permission Denied",
                        "Only **God** or **Founder** can use foreverban."
                    );
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

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
                            args
                                .slice(1)
                                .join(" ") ||
                            "Forever banned by VC+"
                    });
                } catch {}

                await sendLog(
                    message.guild,
                    "FOREVER BAN",
                    `${message.author} permanently blocked ${target}.`,
                    true
                );

                return replySuccess(
                    message,
                    "Forever Banned",
                    `${target} has been permanently blocked from this server.`
                );
            }

            // ==================================================
            // PURGE / CLEAR
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(
                        amount
                    ) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return replyError(
                        message,
                        "Invalid Amount",
                        "Use a number from **1** to **100**."
                    );
                }

                try {
                    const deleted =
                        await message.channel.bulkDelete(
                            amount,
                            true
                        );

                    return replySuccess(
                        message,
                        "Messages Cleared",
                        `Deleted **${deleted.size}** messages.`
                    );
                } catch {
                    return replyError(
                        message,
                        "Clear Failed",
                        "I couldn't delete those messages."
                    );
                }
            }

            // ==================================================
            // RANK
            // ==================================================

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
                        "Permission Denied",
                        "Only **Founder** can change ranks."
                    );
                }

                const target =
                    message.mentions.members.first();

                const requestedRank =
                    normalizeRank(
                        args[1]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        "Mention the user."
                    );
                }

                if (!requestedRank) {
                    return replyError(
                        message,
                        "Invalid Rank",
                        "Valid ranks: Founder, God, Owner, Co Owner, Executive, Director, Admin, Moderator, Staff, Member."
                    );
                }

                if (
                    requestedRank ===
                        "founder" &&
                    target.id !==
                        message.guild.ownerId
                ) {
                    return replyError(
                        message,
                        "Founder Reserved",
                        "Founder rank is reserved for the server owner."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    requestedRank ===
                    "member"
                ) {
                    delete data.ranks[
                        target.id
                    ];
                } else {
                    data.ranks[
                        target.id
                    ] = requestedRank;
                }

                saveDatabase();

                return replySuccess(
                    message,
                    "Rank Updated",
                    `${target} is now **${requestedRank.toUpperCase()}**.`
                );
            }

            // ==================================================
            // GODMODE
            // ==================================================

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
                        "Permission Denied",
                        "Only **Founder** can manage Godmode."
                    );
                }

                const state =
                    args[0]?.toLowerCase();

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    state === "on"
                ) {
                    if (
                        !data.godmode.includes(
                            message.author.id
                        )
                    ) {
                        data.godmode.push(
                            message.author.id
                        );
                    }

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Godmode",
                        "Godmode has been **enabled** for you."
                    );
                }

                if (
                    state === "off"
                ) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                message.author.id
                        );

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Godmode",
                        "Godmode has been **disabled** for you."
                    );
                }

                return replyError(
                    message,
                    "Invalid State",
                    `Use \`${PREFIX}godmode on\` or \`${PREFIX}godmode off\`.`
                );
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command === "filter"
            ) {
                if (
                    !isTrustedExecutor(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Permission Denied",
                        "Only **God** or **Founder** can manage the filter."
                    );
                }

                const sub =
                    args.shift()?.toLowerCase();

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    sub === "on"
                ) {
                    data.filter.enabled =
                        true;

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Filter Enabled",
                        "The word filter is now active."
                    );
                }

                if (
                    sub === "off"
                ) {
                    data.filter.enabled =
                        false;

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Filter Disabled",
                        "The word filter is now disabled."
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
                            "Missing Word",
                            "Enter a word to add."
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
                        "Word Added",
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
                                item !== word
                        );

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Word Removed",
                        `Removed \`${word}\` from the filter.`
                    );
                }

                if (
                    sub === "list"
                ) {
                    const words =
                        data.filter.words.length
                            ? data.filter.words
                                .map(
                                    word =>
                                        `\`${word}\``
                                )
                                .join(", ")
                            : "No words added.";

                    return replyInfo(
                        message,
                        "Filter List",
                        words
                    );
                }

                if (
                    sub === "log"
                ) {
                    const state =
                        args[0]?.toLowerCase();

                    if (
                        state === "on"
                    ) {
                        data.filter.log =
                            true;
                    } else if (
                        state === "off"
                    ) {
                        data.filter.log =
                            false;
                    } else {
                        return replyError(
                            message,
                            "Invalid State",
                            `Use \`${PREFIX}filter log on\` or \`${PREFIX}filter log off\`.`
                        );
                    }

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Filter Logging",
                        `Filter logging is now **${
                            data.filter.log
                                ? "ON"
                                : "OFF"
                        }**.`
                    );
                }

                if (
                    sub === "strikes"
                ) {
                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(
                            amount
                        ) ||
                        amount < 1 ||
                        amount > 20
                    ) {
                        return replyError(
                            message,
                            "Invalid Strikes",
                            "Choose a number from **1** to **20**."
                        );
                    }

                    data.filter.maxStrikes =
                        amount;

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Strike Limit",
                        `Filter strike limit set to **${amount}**.`
                    );
                }

                if (
                    sub === "reset"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            "Mention the user."
                        );
                    }

                    delete data.filter.strikes[
                        target.id
                    ];

                    saveDatabase();

                    return replySuccess(
                        message,
                        "Strikes Reset",
                        `${target}'s filter strikes were reset.`
                    );
                }

                return replyError(
                    message,
                    "Filter",
                    `Use \`${PREFIX}filter on\`, \`off\`, \`add\`, \`remove\`, \`list\`, \`log\`, \`strikes\`, or \`reset\`.`
                );
            }

        } catch (error) {
            console.error(
                "Command error:",
                error
            );

            try {
                await message.reply({
                    embeds: [
                        vcEmbed(
                            "Something went wrong while processing that command."
                        )
                    ]
                });
            } catch {}
        }
    }
);

// ======================================================
// VOICE STATE SYSTEM
// ======================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            const member =
                newState.member ||
                oldState.member;

            if (!member) return;

            const guild =
                member.guild;

            const data =
                getGuildData(
                    guild.id
                );

            // ==================================================
            // JOIN TO CREATE
            // ==================================================

            if (
                newState.channelId &&
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                await createPersonalVC(
                    member
                );
            }

            // ==================================================
            // VC+ STFU ENFORCEMENT
            // ==================================================

            if (
                newState.channelId
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (
                    vcData &&
                    vcData.stfu.has(
                        member.id
                    )
                ) {
                    if (
                        !newState.serverMute
                    ) {
                        try {
                            await member.voice.setMute(
                                true,
                                "VC+ STFU enforcement"
                            );
                        } catch {}
                    }
                }
            }

            // ==================================================
            // BLOCK BANNED / REJECTED
            // ==================================================

            if (
                newState.channelId
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (vcData) {
                    const blocked =
                        vcData.banned.has(
                            member.id
                        ) ||
                        vcData.rejected.has(
                            member.id
                        );

                    if (blocked) {
                        try {
                            await member.voice.setChannel(
                                null
                            );
                        } catch {}

                        return;
                    }

                    // ==================================================
                    // LOCKED VC
                    // ==================================================

                    if (
                        vcData.locked &&
                        member.id !==
                            vcData.ownerId &&
                        !vcData.permitted.has(
                            member.id
                        ) &&
                        !isFounder(member)
                    ) {
                        try {
                            await member.voice.setChannel(
                                null
                            );
                        } catch {}

                        return;
                    }
                }
            }

            // ==================================================
            // STFU SELF-UNMUTE PROTECTION
            // ==================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    oldState.channelId &&
                oldState.serverMute &&
                !newState.serverMute
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (
                    vcData &&
                    vcData.stfu.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setMute(
                            true,
                            "VC+ STFU enforcement"
                        );
                    } catch {}
                }
            }

            // ==================================================
            // CLEAN EMPTY VC
            // ==================================================

            if (
                oldState.channelId &&
                oldState.channelId !==
                    newState.channelId
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    getVCData(
                        oldChannel.id
                    )
                ) {
                    await cleanupVC(
                        oldChannel
                    );
                }
            }

        } catch (error) {
            console.error(
                "Voice state error:",
                error
            );
        }
    }
);

// ======================================================
// FOREVER BAN PROTECTION
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
                            "VC+ Forever Ban"
                    });
                } catch {}

                await sendLog(
                    member.guild,
                    "FOREVER BAN BLOCK",
                    `${member.user.tag} attempted to rejoin and was automatically banned.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Member join error:",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL CREATE SECURITY
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) return;

            const guild =
                channel.guild;

            const data =
                getGuildData(
                    guild.id
                );

            await sendLog(
                guild,
                "CHANNEL CREATED",
                `Channel **${channel.name}** was created.`
            );

            if (
                !data.protection.channelCreate
            ) {
                return;
            }

            const logs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.ChannelCreate,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            const member =
                await guild.members.fetch(
                    executor.id
                ).catch(() => null);

            if (!member) return;

            if (
                !isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    guild,
                    "SECURITY ALERT",
                    `${member} created **${channel.name}** without Founder/God authorization.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Channel create security error:",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL DELETE SECURITY
// ======================================================

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) return;

            const guild =
                channel.guild;

            const data =
                getGuildData(
                    guild.id
                );

            await sendLog(
                guild,
                "CHANNEL DELETED",
                `Channel **${channel.name}** was deleted.`
            );

            if (
                !data.protection.channelDelete
            ) {
                return;
            }

            const logs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.ChannelDelete,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            const member =
                await guild.members.fetch(
                    executor.id
                ).catch(() => null);

            if (!member) return;

            if (
                !isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    guild,
                    "ANTI-NUKE ALERT",
                    `${member} deleted **${channel.name}** without Founder/God authorization.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Channel delete security error:",
                error
            );
        }
    }
);

// ======================================================
// ROLE CREATE SECURITY
// ======================================================

client.on(
    "roleCreate",
    async role => {
        try {
            const guild =
                role.guild;

            const data =
                getGuildData(
                    guild.id
                );

            await sendLog(
                guild,
                "ROLE CREATED",
                `Role **${role.name}** was created.`
            );

            if (
                !data.protection.roleCreate
            ) {
                return;
            }

            const logs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.RoleCreate,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            const member =
                await guild.members.fetch(
                    executor.id
                ).catch(() => null);

            if (!member) return;

            if (
                !isTrustedExecutor(
                    member
                )
            ) {
                try {
                    await role.delete(
                        "VC+ Anti-Nuke"
                    );
                } catch {}

                await sendLog(
                    guild,
                    "ANTI-NUKE",
                    `${member} created an unauthorized role. The role was removed.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Role create security error:",
                error
            );
        }
    }
);

// ======================================================
// ROLE DELETE SECURITY
// ======================================================

client.on(
    "roleDelete",
    async role => {
        try {
            const guild =
                role.guild;

            const data =
                getGuildData(
                    guild.id
                );

            await sendLog(
                guild,
                "ROLE DELETED",
                `Role **${role.name}** was deleted.`
            );

            if (
                !data.protection.roleDelete
            ) {
                return;
            }

            const logs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.RoleDelete,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            const member =
                await guild.members.fetch(
                    executor.id
                ).catch(() => null);

            if (!member) return;

            if (
                !isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    guild,
                    "ANTI-NUKE ALERT",
                    `${member} deleted role **${role.name}** without Founder/God authorization.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Role delete security error:",
                error
            );
        }
    }
);

// ======================================================
// WEBHOOK SECURITY
// ======================================================

client.on(
    "webhooksUpdate",
    async channel => {
        try {
            const guild =
                channel.guild;

            const data =
                getGuildData(
                    guild.id
                );

            if (
                !data.protection.webhookCreate
            ) {
                return;
            }

            const logs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.WebhookCreate,
                    limit: 1
                }).catch(() => null);

            if (!logs) return;

            const entry =
                logs.entries.first();

            if (!entry) return;

            const executor =
                entry.executor;

            if (!executor) return;

            const member =
                await guild.members.fetch(
                    executor.id
                ).catch(() => null);

            if (!member) return;

            if (
                !isTrustedExecutor(
                    member
                )
            ) {
                await sendLog(
                    guild,
                    "WEBHOOK SECURITY ALERT",
                    `${member} created a webhook without Founder/God authorization.`,
                    true
                );
            }
        } catch (error) {
            console.error(
                "Webhook security error:",
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
                    name: `${PREFIX}help`,
                    type: ActivityType.Watching
                }
            ],

            status: "online"
        });

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            try {
                getGuildData(
                    guild.id
                );

                await createLogSystem(
                    guild
                );
            } catch (error) {
                console.error(
                    `Startup error in ${guild.name}:`,
                    error
                );
            }
        }
    }
);

// ======================================================
// BOT JOINS SERVER
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

            const me =
                guild.members.me;

            const channel =
                guild.channels.cache
                    .filter(
                        c =>
                            c.type ===
                                ChannelType.GuildText &&
                            me &&
                            c.permissionsFor(
                                me
                            )?.has(
                                PermissionFlagsBits.SendMessages
                            )
                    )
                    .sort(
                        (a, b) =>
                            a.position -
                            b.position
                    )
                    .first();

            if (!channel) return;

            await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x000000)
                        .setAuthor({
                            name: "VC+"
                        })
                        .setDescription(`
✦ **VC+ IS ONLINE**

Welcome to **${guild.name}**.

**Prefix**
\`${PREFIX}\`

**Start**
\`${PREFIX}help\`

**VC+ INCLUDES**

• Join To Create
• VC controls
• Moderation
• Rank system
• Anti-nuke protection
• Private logs
• Word filtering
• Forever bans

━━━━━━━━━━━━━━━━━━━━

**VC+**
                        `)
                ]
            });
        } catch (error) {
            console.error(
                "Guild join error:",
                error
            );
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

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Uncaught exception:",
            error
        );
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown(signal) {
    console.log(
        `${signal} received. Shutting down...`
    );

    saveDatabase();

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

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
