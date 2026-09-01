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

// ======================================================
// DATABASE
// ======================================================

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({
            guilds: {}
        }, null, 2)
    );
}

let db;

try {
    db = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
    );
} catch {
    db = {
        guilds: {}
    };
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error(
            "Database save error:",
            error
        );
    }
}

// ======================================================
// DEFAULT GUILD DATA
// ======================================================

function defaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        vouches: [],

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
        },

        logs: {
            categoryId: null,
            serverChannelId: null,
            modChannelId: null,
            voiceChannelId: null
        },

        roles: {
            vouch: null
        },

        protection: {
            enabled: true,
            channelCreate: true,
            channelDelete: true,
            roleCreate: true,
            roleDelete: true,
            webhookCreate: true
        },

        filters: {
            enabled: false,
            words: [],
            strikes: {},
            logChannelId: null,
            maxStrikes: 3,
            timeoutMinutes: 10,
            warningDeleteMs: 5000
        }
    };
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] =
            defaultGuildData();

        saveDB();
    }

    return db.guilds[guildId];
}

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
    if (!rank) {
        return "member";
    }

    const value =
        String(rank).toLowerCase();

    return RANKS[value]
        ? value
        : "member";
}

function getRank(member) {
    if (!member) {
        return "member";
    }

    if (
        member.guild.ownerId ===
        member.id
    ) {
        return "founder";
    }

    const data =
        getGuildData(
            member.guild.id
        );

    return normalizeRank(
        data.ranks[member.id]
    );
}

function getRankLevel(member) {
    return (
        RANKS[
            getRank(member)
        ] ?? 1
    );
}

function isFounder(member) {
    if (!member) {
        return false;
    }

    return (
        member.guild.ownerId ===
            member.id ||
        getRank(member) ===
            "founder"
    );
}

function isGod(member) {
    if (!member) {
        return false;
    }

    const data =
        getGuildData(
            member.guild.id
        );

    return (
        isFounder(member) ||
        getRank(member) ===
            "god" ||
        data.godmode.includes(
            member.id
        )
    );
}

function canModerate(
    actor,
    target
) {
    if (!actor || !target) {
        return false;
    }

    if (
        actor.id ===
        target.id
    ) {
        return false;
    }

    if (
        isFounder(actor)
    ) {
        return true;
    }

    if (
        isFounder(target)
    ) {
        return false;
    }

    return (
        getRankLevel(actor) >
        getRankLevel(target)
    );
}

// ======================================================
// EMBEDS
// ======================================================

function successEmbed(
    title,
    description
) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(
    title,
    description
) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(
    title,
    description
) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

// ======================================================
// CLIENT
// ======================================================

const client =
    new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates
        ],

        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.User,
            Partials.GuildMember
        ]
    });

// ======================================================
// LOGGING
// ======================================================

async function sendLog(
    guild,
    type,
    title,
    description,
    fields = []
) {
    if (!guild) {
        return;
    }

    const data =
        getGuildData(
            guild.id
        );

    let channelId = null;

    if (type === "server") {
        channelId =
            data.logs.serverChannelId;
    }

    if (type === "mod") {
        channelId =
            data.logs.modChannelId;
    }

    if (type === "voice") {
        channelId =
            data.logs.voiceChannelId;
    }

    if (!channelId) {
        return;
    }

    const channel =
        guild.channels.cache.get(
            channelId
        );

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        return;
    }

    const embed =
        new EmbedBuilder()
            .setTitle(title)
            .setDescription(
                description
            )
            .setTimestamp();

    if (fields.length) {
        embed.addFields(
            fields
        );
    }

    await channel.send({
        embeds: [embed]
    }).catch(
        error => {
            console.error(
                "Log send error:",
                error
            );
        }
    );
}

// ======================================================
// CREATE LOG CHANNELS
// ======================================================

async function setupLogChannels(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    let category = null;

    if (
        data.logs.categoryId
    ) {
        category =
            guild.channels.cache.get(
                data.logs.categoryId
            );
    }

    // Find existing LOGS category
    if (
        !category
    ) {
        category =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name.toLowerCase() ===
                        "logs"
            );
    }

    // Create LOGS category
    if (!category) {
        category =
            await guild.channels.create({
                name: "LOGS",
                type:
                    ChannelType.GuildCategory
            }).catch(
                error => {
                    console.error(
                        "Log category error:",
                        error
                    );

                    return null;
                }
            );
    }

    if (!category) {
        return null;
    }

    data.logs.categoryId =
        category.id;

    // ==================================================
    // SERVER LOGS
    // ==================================================

    let serverLogs =
        data.logs.serverChannelId
            ? guild.channels.cache.get(
                data.logs.serverChannelId
            )
            : null;

    if (
        !serverLogs
    ) {
        serverLogs =
            guild.channels.cache.find(
                channel =>
                    channel.parentId ===
                        category.id &&
                    channel.name ===
                        "server-logs"
            );
    }

    if (!serverLogs) {
        serverLogs =
            await guild.channels.create({
                name:
                    "server-logs",

                type:
                    ChannelType.GuildText,

                parent:
                    category.id
            }).catch(
                () => null
            );
    }

    if (serverLogs) {
        data.logs.serverChannelId =
            serverLogs.id;
    }

    // ==================================================
    // MOD LOGS
    // ==================================================

    let modLogs =
        data.logs.modChannelId
            ? guild.channels.cache.get(
                data.logs.modChannelId
            )
            : null;

    if (
        !modLogs
    ) {
        modLogs =
            guild.channels.cache.find(
                channel =>
                    channel.parentId ===
                        category.id &&
                    channel.name ===
                        "mod-logs"
            );
    }

    if (!modLogs) {
        modLogs =
            await guild.channels.create({
                name:
                    "mod-logs",

                type:
                    ChannelType.GuildText,

                parent:
                    category.id
            }).catch(
                () => null
            );
    }

    if (modLogs) {
        data.logs.modChannelId =
            modLogs.id;
    }

    // ==================================================
    // VOICE LOGS
    // ==================================================

    let voiceLogs =
        data.logs.voiceChannelId
            ? guild.channels.cache.get(
                data.logs.voiceChannelId
            )
            : null;

    if (
        !voiceLogs
    ) {
        voiceLogs =
            guild.channels.cache.find(
                channel =>
                    channel.parentId ===
                        category.id &&
                    channel.name ===
                        "voice-logs"
            );
    }

    if (!voiceLogs) {
        voiceLogs =
            await guild.channels.create({
                name:
                    "voice-logs",

                type:
                    ChannelType.GuildText,

                parent:
                    category.id
            }).catch(
                () => null
            );
    }

    if (voiceLogs) {
        data.logs.voiceChannelId =
            voiceLogs.id;
    }

    saveDB();

    await sendLog(
        guild,
        "server",
        "Logging Enabled",
        "Server logging has been configured."
    );

    return category;
}

// ======================================================
// MODERATION DM
// ======================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided.",
    duration = null
) {
    if (!user) {
        return false;
    }

    try {
        const embed =
            new EmbedBuilder()
                .setTitle(
                    `You were ${action}`
                )
                .setDescription(
                    `You have been **${action}** in **${guild.name}**.`
                )
                .addFields({
                    name: "Reason",
                    value:
                        String(reason)
                            .slice(
                                0,
                                1024
                            )
                })
                .setTimestamp();

        if (duration) {
            embed.addFields({
                name: "Duration",
                value:
                    String(duration)
            });
        }

        await user.send({
            embeds: [embed]
        });

        return true;
    } catch {
        return false;
    }
}

// ======================================================
// TEMP VC STORAGE
// ======================================================

const tempVCs =
    new Map();

// Prevent duplicate interface messages
const interfaceLocks =
    new Set();

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

function getVCData(
    channelId
) {
    return tempVCs.get(
        channelId
    );
}

// ======================================================
// VC INTERFACE
// ======================================================

async function updateVCInterface(
    channel
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return;
    }

    // Prevent multiple update operations
    if (
        interfaceLocks.has(
            channel.id
        )
    ) {
        return;
    }

    interfaceLocks.add(
        channel.id
    );

    try {
        const owner =
            channel.guild.members.cache.get(
                data.ownerId
            );

        const ownerName =
            owner?.user?.username ??
            "Unknown";

        const memberCount =
            channel.members.size;

        const limit =
            channel.userLimit === 0
                ? "Unlimited"
                : String(
                    channel.userLimit
                );

        const status =
            data.locked
                ? "Locked"
                : "Open";

        const embed =
            new EmbedBuilder()
                .setTitle(
                    "Voice Channel"
                )
                .setDescription(
                    [
                        `Owner: **${ownerName}**`,
                        `Members: **${memberCount}**`,
                        `Limit: **${limit}**`,
                        `Status: **${status}**`,
                        "",
                        "**Voice Commands**",
                        "",
                        "`-vc kick @user`",
                        "`-vc disconnect @user`",
                        "`-vc ban @user`",
                        "`-vc reject @user`",
                        "`-vc permit @user`",
                        "`-vc stfu @user`",
                        "`-vc unstfu @user`",
                        "`-vc lock`",
                        "`-vc unlock`",
                        "`-vc transfer @user`",
                        "`-vc claim`",
                        "`-vc forceclaim`",
                        "`-vc rename name`",
                        "`-vc limit amount`"
                    ].join("\n")
                )
                .setTimestamp();

        // ==================================================
        // EXISTING INTERFACE
        // ==================================================

        if (
            data.interfaceMessageId
        ) {
            const existing =
                await channel.messages
                    .fetch(
                        data.interfaceMessageId
                    )
                    .catch(
                        () => null
                    );

            if (existing) {
                await existing.edit({
                    embeds: [embed],
                    components: []
                });

                return;
            }

            // Old message no longer exists
            data.interfaceMessageId =
                null;

            saveDB();
        }

        // ==================================================
        // DOUBLE-CHECK BEFORE SENDING
        // ==================================================

        const messages =
            await channel.messages
                .fetch({
                    limit: 20
                })
                .catch(
                    () => null
                );

        if (messages) {
            const botInterface =
                messages.find(
                    msg =>
                        msg.author.id ===
                            client.user.id &&
                        msg.embeds.length > 0 &&
                        msg.embeds[0].title ===
                            "Voice Channel"
                );

            if (botInterface) {
                data.interfaceMessageId =
                    botInterface.id;

                saveDB();

                await botInterface.edit({
                    embeds: [embed],
                    components: []
                });

                return;
            }
        }

        // ==================================================
        // SEND ONE INTERFACE
        // ==================================================

        const message =
            await channel.send({
                embeds: [embed],
                components: []
            });

        data.interfaceMessageId =
            message.id;

        saveDB();

    } catch (error) {
        console.error(
            "VC interface error:",
            error
        );
    } finally {
        interfaceLocks.delete(
            channel.id
        );
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(
    member
) {
    const data =
        getGuildData(
            member.guild.id
        );

    if (
        !data.jtc.enabled
    ) {
        return null;
    }

    const jtc =
        member.guild.channels.cache.get(
            data.jtc.channelId
        );

    if (
        !jtc ||
        jtc.type !==
            ChannelType.GuildVoice
    ) {
        return null;
    }

    // Don't create another VC if one is already being made
    for (
        const [
            channelId,
            vcData
        ] of tempVCs
    ) {
        if (
            vcData.guildId ===
                member.guild.id &&
            vcData.ownerId ===
                member.id
        ) {
            const existing =
                member.guild.channels.cache.get(
                    channelId
                );

            if (existing) {
                return existing;
            }
        }
    }

    const category =
        data.jtc.categoryId
            ? member.guild.channels.cache.get(
                data.jtc.categoryId
            )
            : null;

    const username =
        member.user.username
            .replace(
                /[^\p{L}\p{N}._-]/gu,
                ""
            )
            .slice(
                0,
                90
            ) ||
        "User";

    const channel =
        await member.guild.channels.create({
            name:
                `${username} VC`,

            type:
                ChannelType.GuildVoice,

            parent:
                category?.type ===
                ChannelType.GuildCategory
                    ? category.id
                    : undefined,

            permissionOverwrites: [
                {
                    id:
                        member.id,

                    allow: [
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.Stream,
                        PermissionFlagsBits.UseVAD,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ]
        }).catch(
            error => {
                console.error(
                    "VC creation error:",
                    error
                );

                return null;
            }
        );

    if (!channel) {
        return null;
    }

    const vcData =
        createVCData(
            member.guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await sendLog(
        member.guild,
        "voice",
        "Voice Channel Created",
        `${member} created ${channel}.`,
        [
            {
                name: "Owner",
                value:
                    `${member.user.tag} (${member.id})`
            },
            {
                name: "Channel",
                value:
                    `${channel.name} (${channel.id})`
            }
        ]
    );

    await member.voice
        .setChannel(
            channel
        )
        .catch(
            () => {}
        );

    await updateVCInterface(
        channel
    );

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(
    channel
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return;
    }

    if (
        channel.members.size >
        0
    ) {
        return;
    }

    const ownerId =
        data.ownerId;

    await sendLog(
        channel.guild,
        "voice",
        "Voice Channel Deleted",
        `The empty voice channel **${channel.name}** was deleted.`,
        [
            {
                name: "Previous Owner",
                value:
                    `<@${ownerId}>`
            }
        ]
    );

    await channel.delete()
        .catch(
            () => {}
        );

    tempVCs.delete(
        channel.id
    );

    interfaceLocks.delete(
        channel.id
    );
}

// ======================================================
// VC BAN
// ======================================================

async function applyVCBan(
    channel,
    userId
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return;
    }

    data.banned.add(
        userId
    );

    data.rejected.delete(
        userId
    );

    await channel.permissionOverwrites.edit(
        userId,
        {
            Connect: false,
            Speak: false
        }
    ).catch(
        () => {}
    );

    const member =
        channel.guild.members.cache.get(
            userId
        );

    if (
        member?.voice?.channelId ===
        channel.id
    ) {
        await member.voice
            .disconnect()
            .catch(
                () => {}
            );
    }
}

async function removeVCBan(
    channel,
    userId
) {
    const data =
        getVCData(
            channel.id
        );

    if (!data) {
        return;
    }

    data.banned.delete(
        userId
    );

    await channel.permissionOverwrites.delete(
        userId
    ).catch(
        () => {}
    );
}

// ======================================================
// FILTER SYSTEM
// ======================================================

async function handleFilteredMessage(
    message
) {
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

    if (
        !data.filters.enabled
    ) {
        return false;
    }

    if (
        isGod(
            message.member
        )
    ) {
        return false;
    }

    const content =
        message.content.toLowerCase();

    const matched =
        data.filters.words.some(
            word =>
                content.includes(
                    String(
                        word
                    ).toLowerCase()
                )
        );

    if (!matched) {
        return false;
    }

    await message.delete()
        .catch(
            () => {}
        );

    if (
        !data.filters.strikes[
            message.author.id
        ]
    ) {
        data.filters.strikes[
            message.author.id
        ] = 0;
    }

    data.filters.strikes[
        message.author.id
    ]++;

    const strikes =
        data.filters.strikes[
            message.author.id
        ];

    await sendLog(
        message.guild,
        "mod",
        "Filtered Message",
        `${message.author} sent a filtered message.`,
        [
            {
                name: "Strikes",
                value:
                    String(strikes)
            },
            {
                name: "Channel",
                value:
                    `${message.channel}`
            }
        ]
    );

    if (
        strikes >=
        data.filters.maxStrikes
    ) {
        await message.member
            .timeout(
                data.filters.timeoutMinutes *
                    60 *
                    1000,
                "Automatic filter strike limit reached"
            )
            .catch(
                () => {}
            );

        data.filters.strikes[
            message.author.id
        ] = 0;
    }

    saveDB();

    return true;
}

// ======================================================
// MESSAGE COMMANDS
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

            if (
                await handleFilteredMessage(
                    message
                )
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
                    .slice(
                        PREFIX.length
                    )
                    .trim()
                    .split(
                        /\s+/
                    );

            const command =
                args
                    .shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            const member =
                message.member;

            const data =
                getGuildData(
                    message.guild.id
                );

            // ==================================================
            // HELP
            // ==================================================

            if (
                command ===
                "help"
            ) {
                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Help",
                            [
                                "**Voice Commands**",
                                "`-vc setup`",
                                "`-vc kick @user`",
                                "`-vc disconnect @user`",
                                "`-vc ban @user`",
                                "`-vc reject @user`",
                                "`-vc permit @user`",
                                "`-vc stfu @user`",
                                "`-vc unstfu @user`",
                                "`-vc lock`",
                                "`-vc unlock`",
                                "`-vc transfer @user`",
                                "`-vc claim`",
                                "`-vc forceclaim`",
                                "`-vc rename name`",
                                "`-vc limit amount`",
                                "",
                                "**Moderation**",
                                "`-ban @user reason`",
                                "`-unban userID`",
                                "`-banlist`",
                                "`-kick @user reason`",
                                "`-timeout @user minutes reason`",
                                "`-untimeout @user`",
                                "`-foreverban @user reason`",
                                "`-purge amount`",
                                "",
                                "**Ranks**",
                                "`-rank @user rank`",
                                "`-godmode @user`",
                                "",
                                "**Filter**",
                                "`-filter on`",
                                "`-filter off`",
                                "`-filter add word`",
                                "`-filter remove word`",
                                "`-filter list`",
                                "`-filter log #channel`",
                                "`-filter strikes @user`",
                                "`-filter reset @user`"
                            ].join("\n")
                        )
                    ]
                });
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command ===
                "filter"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const sub =
                    args
                        .shift()
                        ?.toLowerCase();

                if (
                    sub ===
                    "on"
                ) {
                    data.filters.enabled =
                        true;

                    saveDB();

                    await sendLog(
                        message.guild,
                        "mod",
                        "Filter Enabled",
                        `${member} enabled the message filter.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Enabled",
                                "The message filter is now enabled."
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "off"
                ) {
                    data.filters.enabled =
                        false;

                    saveDB();

                    await sendLog(
                        message.guild,
                        "mod",
                        "Filter Disabled",
                        `${member} disabled the message filter.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Disabled",
                                "The message filter is now disabled."
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "add"
                ) {
                    const word =
                        args
                            .join(" ")
                            .trim();

                    if (!word) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing Word",
                                    "Provide a word to add."
                                )
                            ]
                        });
                    }

                    if (
                        !data.filters.words.includes(
                            word.toLowerCase()
                        )
                    ) {
                        data.filters.words.push(
                            word.toLowerCase()
                        );
                    }

                    saveDB();

                    await sendLog(
                        message.guild,
                        "mod",
                        "Filter Word Added",
                        `${member} added a filtered word.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Word Added",
                                `Added "${word}" to the filter.`
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "remove"
                ) {
                    const word =
                        args
                            .join(" ")
                            .trim();

                    data.filters.words =
                        data.filters.words.filter(
                            x =>
                                x.toLowerCase() !==
                                word.toLowerCase()
                        );

                    saveDB();

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Word Removed",
                                `Removed "${word}" from the filter.`
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "list"
                ) {
                    return message.reply({
                        embeds: [
                            infoEmbed(
                                "Filtered Words",
                                data.filters.words.length
                                    ? data.filters.words.join("\n")
                                    : "No filtered words are configured."
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "log"
                ) {
                    const channel =
                        message.mentions.channels.first();

                    if (!channel) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing Channel",
                                    "Mention a channel."
                                )
                            ]
                        });
                    }

                    data.filters.logChannelId =
                        channel.id;

                    saveDB();

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Log Channel Set",
                                `Filter logs will be sent to ${channel}.`
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "strikes"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Mention a user."
                                )
                            ]
                        });
                    }

                    const strikes =
                        data.filters.strikes[
                            target.id
                        ] ?? 0;

                    return message.reply({
                        embeds: [
                            infoEmbed(
                                "Strikes",
                                `${target.user.tag} has ${strikes} strike(s).`
                            )
                        ]
                    });
                }

                if (
                    sub ===
                    "reset"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Mention a user."
                                )
                            ]
                        });
                    }

                    delete data.filters.strikes[
                        target.id
                    ];

                    saveDB();

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Strikes Reset",
                                `Reset strikes for ${target.user.tag}.`
                            )
                        ]
                    });
                }

                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Filter",
                            "Unknown filter command."
                        )
                    ]
                });
            }

            // ==================================================
            // VC SYSTEM
            // ==================================================

            if (
                command ===
                "vc"
            ) {
                const sub =
                    args
                        .shift()
                        ?.toLowerCase();

                // ==============================================
                // VC SETUP
                // ==============================================

                if (
                    sub ===
                    "setup"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Access Denied",
                                    "You do not have permission to set up the voice system."
                                )
                            ]
                        });
                    }

                    await setupLogChannels(
                        message.guild
                    );

                    const existing =
                        data.jtc.channelId
                            ? message.guild.channels.cache.get(
                                data.jtc.channelId
                            )
                            : null;

                    if (
                        existing &&
                        existing.type ===
                            ChannelType.GuildVoice
                    ) {
                        await sendLog(
                            message.guild,
                            "server",
                            "Voice System Checked",
                            `${member} checked the voice system.`
                        );

                        return message.reply({
                            embeds: [
                                infoEmbed(
                                    "Voice System",
                                    `Join To Create is already configured: ${existing}\n\nLogging channels are also configured.`
                                )
                            ]
                        });
                    }

                    let category =
                        data.jtc.categoryId
                            ? message.guild.channels.cache.get(
                                data.jtc.categoryId
                            )
                            : null;

                    if (
                        !category
                    ) {
                        category =
                            message.guild.channels.cache.find(
                                channel =>
                                    channel.type ===
                                        ChannelType.GuildCategory &&
                                    channel.name.toLowerCase() ===
                                        "voice"
                            );
                    }

                    if (!category) {
                        category =
                            await message.guild.channels.create({
                                name:
                                    "Voice",

                                type:
                                    ChannelType.GuildCategory
                            }).catch(
                                () => null
                            );
                    }

                    const jtc =
                        await message.guild.channels.create({
                            name:
                                "Join To Create",

                            type:
                                ChannelType.GuildVoice,

                            parent:
                                category?.id
                        }).catch(
                            () => null
                        );

                    if (!jtc) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Setup Failed",
                                    "The voice system could not be created."
                                )
                            ]
                        });
                    }

                    data.jtc.enabled =
                        true;

                    data.jtc.channelId =
                        jtc.id;

                    data.jtc.categoryId =
                        category?.id ??
                        null;

                    saveDB();

                    await sendLog(
                        message.guild,
                        "server",
                        "Voice System Setup",
                        `${member} configured the voice system.`,
                        [
                            {
                                name:
                                    "Join To Create",
                                value:
                                    `${jtc}`
                            },
                            {
                                name:
                                    "Logs",
                                value:
                                    data.logs.categoryId
                                        ? `<#${data.logs.categoryId}>`
                                        : "Not configured"
                            }
                        ]
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Voice System Ready",
                                [
                                    `Join ${jtc} to create your personal VC.`,
                                    "",
                                    "**Logs Created**",
                                    `Server Logs: <#${data.logs.serverChannelId}>`,
                                    `Mod Logs: <#${data.logs.modChannelId}>`,
                                    `Voice Logs: <#${data.logs.voiceChannelId}>`
                                ].join("\n")
                            )
                        ]
                    });
                }

                // ==============================================
                // REQUIRE PERSONAL VC
                // ==============================================

                const voiceChannel =
                    member.voice.channel;

                if (
                    !voiceChannel
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "No Voice Channel",
                                "You must be inside a voice channel."
                            )
                        ]
                    });
                }

                const vcData =
                    getVCData(
                        voiceChannel.id
                    );

                if (!vcData) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Not A Personal VC",
                                "You must be inside your personal voice channel."
                            )
                        ]
                    });
                }

                const isOwner =
                    vcData.ownerId ===
                    member.id;

                if (
                    !isOwner &&
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only the VC owner or Founder can control this channel."
                            )
                        ]
                    });
                }

                // ==============================================
                // KICK
                // ==============================================

                if (
                    sub ===
                    "kick"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc kick @user."
                                )
                            ]
                        });
                    }

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .disconnect()
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Kick",
                        `${member} kicked ${target} from ${voiceChannel}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Kicked",
                                `${target.user.tag} has been disconnected from the VC.`
                            )
                        ]
                    });
                }

                // ==============================================
                // DISCONNECT
                // ==============================================

                if (
                    sub ===
                    "disconnect"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc disconnect @user."
                                )
                            ]
                        });
                    }

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .disconnect()
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Disconnect",
                        `${member} disconnected ${target} from ${voiceChannel}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Disconnected",
                                `${target.user.tag} has been disconnected.`
                            )
                        ]
                    });
                }

                // ==============================================
                // BAN
                // ==============================================

                if (
                    sub ===
                    "ban"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc ban @user."
                                )
                            ]
                        });
                    }

                    await applyVCBan(
                        voiceChannel,
                        target.id
                    );

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Ban",
                        `${member} banned ${target} from ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Banned",
                                `${target.user.tag} is banned from this VC.`
                            )
                        ]
                    });
                }

                // ==============================================
                // REJECT
                // ==============================================

                if (
                    sub ===
                    "reject"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc reject @user."
                                )
                            ]
                        });
                    }

                    vcData.rejected.add(
                        target.id
                    );

                    await voiceChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            Connect: false
                        }
                    ).catch(
                        () => {}
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .disconnect()
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Reject",
                        `${member} rejected ${target} from ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Rejected",
                                `${target.user.tag} can no longer join this VC.`
                            )
                        ]
                    });
                }

                // ==============================================
                // PERMIT
                // ==============================================

                if (
                    sub ===
                    "permit"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc permit @user."
                                )
                            ]
                        });
                    }

                    vcData.rejected.delete(
                        target.id
                    );

                    vcData.banned.delete(
                        target.id
                    );

                    await voiceChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            Connect: true
                        }
                    ).catch(
                        () => {}
                    );

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Permit",
                        `${member} permitted ${target} in ${voiceChannel}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Permitted",
                                `${target.user.tag} can now join this VC.`
                            )
                        ]
                    });
                }

                // ==============================================
                // STFU
                // ==============================================

                if (
                    sub ===
                    "stfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Access Denied",
                                    "Only God or Founder can use STFU."
                                )
                            ]
                        });
                    }

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc stfu @user."
                                )
                            ]
                        });
                    }

                    vcData.stfu.add(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .setMute(
                                true,
                                "Voice channel STFU"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC STFU",
                        `${member} muted ${target} in ${voiceChannel}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Muted",
                                `${target.user.tag} has been muted.`
                            )
                        ]
                    });
                }

                // ==============================================
                // UNSTFU
                // ==============================================

                if (
                    sub ===
                    "unstfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Access Denied",
                                    "Only God or Founder can use Unmute."
                                )
                            ]
                        });
                    }

                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc unstfu @user."
                                )
                            ]
                        });
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .setMute(
                                false,
                                "Voice channel unmute"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Unmute",
                        `${member} unmuted ${target} in ${voiceChannel}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Member Unmuted",
                                `${target.user.tag} has been unmuted.`
                            )
                        ]
                    });
                }

                // ==============================================
                // LOCK
                // ==============================================

                if (
                    sub ===
                    "lock"
                ) {
                    vcData.locked =
                        true;

                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    ).catch(
                        () => {}
                    );

                    for (
                        const user of voiceChannel.members.values()
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            user.id,
                            {
                                Connect: true
                            }
                        ).catch(
                            () => {}
                        );
                    }

                    for (
                        const userId of vcData.banned
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            userId,
                            {
                                Connect: false
                            }
                        ).catch(
                            () => {}
                        );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Locked",
                        `${member} locked ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Voice Locked",
                                "The VC is now locked."
                            )
                        ]
                    });
                }

                // ==============================================
                // UNLOCK
                // ==============================================

                if (
                    sub ===
                    "unlock"
                ) {
                    vcData.locked =
                        false;

                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: true
                        }
                    ).catch(
                        () => {}
                    );

                    for (
                        const userId of vcData.banned
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            userId,
                            {
                                Connect: false
                            }
                        ).catch(
                            () => {}
                        );
                    }

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Unlocked",
                        `${member} unlocked ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Voice Unlocked",
                                "The VC is now unlocked."
                            )
                        ]
                    });
                }

                // ==============================================
                // TRANSFER
                // ==============================================

                if (
                    sub ===
                    "transfer"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Use -vc transfer @user."
                                )
                            ]
                        });
                    }

                    vcData.ownerId =
                        target.id;

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Ownership Transfer",
                        `${member} transferred ${voiceChannel} to ${target}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Ownership Transferred",
                                `${target.user.tag} is now the VC owner.`
                            )
                        ]
                    });
                }

                // ==============================================
                // CLAIM
                // ==============================================

                if (
                    sub ===
                    "claim"
                ) {
                    if (
                        voiceChannel.members.has(
                            vcData.ownerId
                        )
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Claim Failed",
                                    "The current owner is still in the VC."
                                )
                            ]
                        });
                    }

                    vcData.ownerId =
                        member.id;

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Claimed",
                        `${member} claimed ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "VC Claimed",
                                "You are now the owner of this VC."
                            )
                        ]
                    });
                }

                // ==============================================
                // FORCE CLAIM
                // ==============================================

                if (
                    sub ===
                    "forceclaim"
                ) {
                    if (
                        !isFounder(member)
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Access Denied",
                                    "Only Founder can force claim a VC."
                                )
                            ]
                        });
                    }

                    vcData.ownerId =
                        member.id;

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Force Claimed",
                        `${member} force claimed ${voiceChannel}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "VC Force Claimed",
                                "You are now the owner of this VC."
                            )
                        ]
                    });
                }

                // ==============================================
                // RENAME
                // ==============================================

                if (
                    sub ===
                    "rename"
                ) {
                    const name =
                        args
                            .join(" ")
                            .trim();

                    if (!name) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing Name",
                                    "Use -vc rename name."
                                )
                            ]
                        });
                    }

                    const cleanName =
                        name
                            .replace(
                                /[^\p{L}\p{N}\s._-]/gu,
                                ""
                            )
                            .slice(
                                0,
                                100
                            )
                            .trim();

                    if (!cleanName) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Invalid Name",
                                    "That channel name is not valid."
                                )
                            ]
                        });
                    }

                    const oldName =
                        voiceChannel.name;

                    await voiceChannel.setName(
                        cleanName
                    );

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Renamed",
                        `${member} renamed a VC.`,
                        [
                            {
                                name: "Old Name",
                                value:
                                    oldName
                            },
                            {
                                name: "New Name",
                                value:
                                    cleanName
                            }
                        ]
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "VC Renamed",
                                `The VC is now named ${cleanName}.`
                            )
                        ]
                    });
                }

                // ==============================================
                // LIMIT
                // ==============================================

                if (
                    sub ===
                    "limit"
                ) {
                    const amount =
                        Number(
                            args[0]
                        );

                    if (
                        !Number.isInteger(
                            amount
                        ) ||
                        amount < 0 ||
                        amount > 99
                    ) {
                        return message.reply({
                            embeds: [
                                errorEmbed(
                                    "Invalid Limit",
                                    "Use a number from 0 to 99. 0 means unlimited."
                                )
                            ]
                        });
                    }

                    await voiceChannel.setUserLimit(
                        amount
                    );

                    await sendLog(
                        message.guild,
                        "voice",
                        "VC Limit Changed",
                        `${member} changed the limit of ${voiceChannel} to ${amount === 0 ? "unlimited" : amount}.`
                    );

                    await updateVCInterface(
                        voiceChannel
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "VC Limit Updated",
                                `The VC limit is now ${
                                    amount === 0
                                        ? "unlimited"
                                        : amount
                                }.`
                            )
                        ]
                    });
                }

                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Unknown VC Command",
                            "Use -help to see the available VC commands."
                        )
                    ]
                });
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command ===
                "ban"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user to ban."
                            )
                        ]
                    });
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Hierarchy",
                                "You cannot moderate that user."
                            )
                        ]
                    });
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "banned",
                    reason
                );

                const result =
                    await target.ban({
                        reason
                    }).catch(
                        () => null
                    );

                if (!result) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Ban Failed",
                                "Discord did not allow the bot to ban that user."
                            )
                        ]
                    });
                }

                await sendLog(
                    message.guild,
                    "mod",
                    "Member Banned",
                    `${member} banned ${target}.`,
                    [
                        {
                            name: "Reason",
                            value:
                                reason
                        }
                    ]
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Banned",
                            `${target.user.tag} has been banned.`
                        )
                    ]
                });
            }

            // ==================================================
            // UNBAN
            // ==================================================

            if (
                command ===
                "unban"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const userId =
                    args[0];

                if (
                    !userId ||
                    !/^\d{17,20}$/.test(
                        userId
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid User ID",
                                "Provide a valid Discord user ID."
                            )
                        ]
                    });
                }

                const ban =
                    await message.guild.bans
                        .fetch(
                            userId
                        )
                        .catch(
                            () => null
                        );

                if (!ban) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Not Banned",
                                "That user is not banned."
                            )
                        ]
                    });
                }

                await message.guild.members
                    .unban(
                        userId,
                        "Unbanned by moderator"
                    );

                data.foreverBanned =
                    data.foreverBanned.filter(
                        id =>
                            id !==
                            userId
                    );

                saveDB();

                await sendModerationDM(
                    ban.user,
                    message.guild,
                    "unbanned",
                    "Your ban was removed."
                );

                await sendLog(
                    message.guild,
                    "mod",
                    "Member Unbanned",
                    `${member} unbanned ${ban.user.tag}.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Unbanned",
                            `${ban.user.tag} has been unbanned.`
                        )
                    ]
                });
            }

            // ==================================================
            // BANLIST
            // ==================================================

            if (
                command ===
                "banlist"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const bans =
                    await message.guild.bans.fetch();

                if (!bans.size) {
                    return message.reply({
                        embeds: [
                            infoEmbed(
                                "Ban List",
                                "There are no banned users."
                            )
                        ]
                    });
                }

                const list =
                    [...bans.values()]
                        .slice(
                            0,
                            25
                        )
                        .map(
                            ban =>
                                `${ban.user.tag} (${ban.user.id})`
                        )
                        .join("\n");

                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Ban List",
                            list
                        )
                    ]
                });
            }

            // ==================================================
            // KICK
            // ==================================================

            if (
                command ===
                "kick"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user to kick."
                            )
                        ]
                    });
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Hierarchy",
                                "You cannot moderate that user."
                            )
                        ]
                    });
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "kicked",
                    reason
                );

                await target.kick(
                    reason
                ).catch(
                    () => {}
                );

                await sendLog(
                    message.guild,
                    "mod",
                    "Member Kicked",
                    `${member} kicked ${target}.`,
                    [
                        {
                            name:
                                "Reason",
                            value:
                                reason
                        }
                    ]
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Kicked",
                            `${target.user.tag} has been kicked.`
                        )
                    ]
                });
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command ===
                "timeout"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                const minutes =
                    Number(
                        args[1]
                    );

                if (
                    !target ||
                    !Number.isInteger(
                        minutes
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Usage",
                                "Use -timeout @user minutes reason."
                            )
                        ]
                    });
                }

                if (
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Duration",
                                "Timeout duration must be between 1 and 40320 minutes."
                            )
                        ]
                    });
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Hierarchy",
                                "You cannot moderate that user."
                            )
                        ]
                    });
                }

                const reason =
                    args
                        .slice(2)
                        .join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "timed out",
                    reason,
                    `${minutes} minutes`
                );

                await target.timeout(
                    minutes *
                        60 *
                        1000,
                    reason
                ).catch(
                    () => {}
                );

                await sendLog(
                    message.guild,
                    "mod",
                    "Member Timed Out",
                    `${member} timed out ${target}.`,
                    [
                        {
                            name:
                                "Duration",
                            value:
                                `${minutes} minutes`
                        },
                        {
                            name:
                                "Reason",
                            value:
                                reason
                        }
                    ]
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Timed Out",
                            `${target.user.tag} has been timed out for ${minutes} minutes.`
                        )
                    ]
                });
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command ===
                "untimeout"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Hierarchy",
                                "You cannot moderate that user."
                            )
                        ]
                    });
                }

                await target.timeout(
                    null,
                    "Timeout removed"
                ).catch(
                    () => {}
                );

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "untimeout",
                    "Your timeout was removed."
                );

                await sendLog(
                    message.guild,
                    "mod",
                    "Timeout Removed",
                    `${member} removed the timeout from ${target}.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Timeout Removed",
                            `${target.user.tag} is no longer timed out.`
                        )
                    ]
                });
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only Founder can use this command."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "Forever banned.";

                if (
                    !data.foreverBanned.includes(
                        target.id
                    )
                ) {
                    data.foreverBanned.push(
                        target.id
                    );
                }

                saveDB();

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "permanently banned",
                    reason
                );

                await target.ban({
                    reason
                }).catch(
                    () => {}
                );

                await sendLog(
                    message.guild,
                    "mod",
                    "Forever Ban",
                    `${member} permanently banned ${target}.`,
                    [
                        {
                            name:
                                "Reason",
                            value:
                                reason
                        }
                    ]
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Forever Ban",
                            `${target.user.tag} has been permanently banned.`
                        )
                    ]
                });
            }

            // ==================================================
            // RANK
            // ==================================================

            if (
                command ===
                "rank"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only Founder can change ranks."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                const rank =
                    normalizeRank(
                        args[1]
                    );

                if (
                    !target ||
                    !RANKS[rank]
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Rank",
                                "Use member, staff, moderator, admin, director, executive, coowner, owner, god, or founder."
                            )
                        ]
                    });
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDB();

                await sendLog(
                    message.guild,
                    "mod",
                    "Rank Changed",
                    `${member} changed ${target}'s rank to **${rank}**.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Rank Updated",
                            `${target.user.tag} is now ${rank}.`
                        )
                    ]
                });
            }

            // ==================================================
            // GODMODE
            // ==================================================

            if (
                command ===
                "godmode"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "Only Founder can manage godmode."
                            )
                        ]
                    });
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user."
                            )
                        ]
                    });
                }

                const index =
                    data.godmode.indexOf(
                        target.id
                    );

                if (
                    index ===
                    -1
                ) {
                    data.godmode.push(
                        target.id
                    );

                    saveDB();

                    await sendLog(
                        message.guild,
                        "mod",
                        "Godmode Enabled",
                        `${member} enabled godmode for ${target}.`
                    );

                    return message.reply({
                        embeds: [
                            successEmbed(
                                "Godmode Enabled",
                                `${target.user.tag} now has godmode.`
                            )
                        ]
                    });
                }

                data.godmode.splice(
                    index,
                    1
                );

                saveDB();

                await sendLog(
                    message.guild,
                    "mod",
                    "Godmode Disabled",
                    `${member} disabled godmode for ${target}.`
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Godmode Disabled",
                            `${target.user.tag} no longer has godmode.`
                        )
                    ]
                });
            }

            // ==================================================
            // PURGE
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    !isGod(member)
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Access Denied",
                                "You do not have permission to use this command."
                            )
                        ]
                    });
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
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Amount",
                                "Amount must be between 1 and 100."
                            )
                        ]
                    });
                }

                await message.channel
                    .bulkDelete(
                        amount,
                        true
                    )
                    .catch(
                        () => {}
                    );

                await sendLog(
                    message.guild,
                    "mod",
                    "Messages Purged",
                    `${member} purged **${amount}** messages from ${message.channel}.`
                );

                return;
            }

        } catch (error) {
            console.error(
                "Command error:",
                error
            );

            await message.reply({
                embeds: [
                    errorEmbed(
                        "Command Error",
                        "Something went wrong while running that command."
                    )
                ]
            }).catch(
                () => {}
            );
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

            if (!guild) {
                return;
            }

            const data =
                getGuildData(
                    guild.id
                );

            // ==================================================
            // JOIN TO CREATE
            // ==================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                if (
                    newState.member
                ) {
                    await createPersonalVC(
                        newState.member
                    );
                }

                return;
            }

            // ==================================================
            // ENTER PERSONAL VC
            // ==================================================

            if (
                newState.channelId
            ) {
                const channel =
                    guild.channels.cache.get(
                        newState.channelId
                    );

                const vcData =
                    channel
                        ? getVCData(
                            channel.id
                        )
                        : null;

                if (
                    channel &&
                    vcData &&
                    newState.member
                ) {
                    const userId =
                        newState.member.id;

                    if (
                        vcData.banned.has(
                            userId
                        ) ||
                        vcData.rejected.has(
                            userId
                        )
                    ) {
                        await sendLog(
                            guild,
                            "voice",
                            "VC Entry Rejected",
                            `${newState.member} attempted to join ${channel} but was rejected.`
                        );

                        await newState.member.voice
                            .disconnect()
                            .catch(
                                () => {}
                            );

                        return;
                    }

                    if (
                        vcData.stfu.has(
                            userId
                        )
                    ) {
                        await newState.member.voice
                            .setMute(
                                true,
                                "Persistent voice mute"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    await sendLog(
                        guild,
                        "voice",
                        "Member Joined VC",
                        `${newState.member} joined ${channel}.`
                    );

                    await updateVCInterface(
                        channel
                    );
                }
            }

            // ==================================================
            // LEAVE PERSONAL VC
            // ==================================================

            if (
                oldState.channelId
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel
                ) {
                    const vcData =
                        getVCData(
                            oldChannel.id
                        );

                    if (vcData) {
                        if (
                            oldState.member
                        ) {
                            await sendLog(
                                guild,
                                "voice",
                                "Member Left VC",
                                `${oldState.member} left ${oldChannel}.`
                            );
                        }

                        await updateVCInterface(
                            oldChannel
                        );

                        await deleteEmptyVC(
                            oldChannel
                        );
                    }
                }
            }

            // ==================================================
            // UPDATE NEW PERSONAL VC
            // ==================================================

            if (
                newState.channelId
            ) {
                const newChannel =
                    guild.channels.cache.get(
                        newState.channelId
                    );

                if (
                    newChannel &&
                    getVCData(
                        newChannel.id
                    )
                ) {
                    await updateVCInterface(
                        newChannel
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
// ANTI-NUKE
// ======================================================

const auditTracker =
    new Map();

function trackAudit(
    guildId,
    executorId,
    action
) {
    const key =
        `${guildId}:${executorId}:${action}`;

    const now =
        Date.now();

    const entries =
        auditTracker.get(
            key
        ) ?? [];

    const recent =
        entries.filter(
            time =>
                now - time <
                10000
        );

    recent.push(
        now
    );

    auditTracker.set(
        key,
        recent
    );

    return recent.length;
}

async function getAuditExecutor(
    guild,
    type
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 5
            });

        const entry =
            logs.entries.first();

        if (!entry) {
            return null;
        }

        if (
            Date.now() -
                entry.createdTimestamp >
            10000
        ) {
            return null;
        }

        return entry.executor;

    } catch {
        return null;
    }
}

async function securityPunish(
    guild,
    user,
    reason
) {
    if (!user) {
        return;
    }

    const member =
        await guild.members.fetch(
            user.id
        ).catch(
            () => null
        );

    if (!member) {
        return;
    }

    if (
        isFounder(member) ||
        isGod(member)
    ) {
        return;
    }

    await member.ban({
        reason
    }).catch(
        () => {}
    );

    const data =
        getGuildData(
            guild.id
        );

    if (
        !data.foreverBanned.includes(
            user.id
        )
    ) {
        data.foreverBanned.push(
            user.id
        );
    }

    saveDB();

    await sendLog(
        guild,
        "mod",
        "Anti-Nuke Action",
        `${user.tag} was banned by server protection.`,
        [
            {
                name:
                    "Reason",
                value:
                    reason
            }
        ]
    );
}

// ======================================================
// CHANNEL CREATE PROTECTION
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        if (!channel.guild) {
            return;
        }

        const data =
            getGuildData(
                channel.guild.id
            );

        if (
            !data.protection.enabled ||
            !data.protection.channelCreate
        ) {
            return;
        }

        const executor =
            await getAuditExecutor(
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

        const count =
            trackAudit(
                channel.guild.id,
                executor.id,
                "channelCreate"
            );

        await sendLog(
            channel.guild,
            "server",
            "Channel Created",
            `${executor} created ${channel}.`
        );

        if (
            count >= 5
        ) {
            await channel.delete()
                .catch(
                    () => {}
                );

            await securityPunish(
                channel.guild,
                executor,
                "Anti-nuke: excessive channel creation"
            );
        }
    }
);

// ======================================================
// CHANNEL DELETE PROTECTION
// ======================================================

client.on(
    "channelDelete",
    async channel => {
        if (!channel.guild) {
            return;
        }

        const data =
            getGuildData(
                channel.guild.id
            );

        if (
            !data.protection.enabled ||
            !data.protection.channelDelete
        ) {
            return;
        }

        const executor =
            await getAuditExecutor(
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

        const count =
            trackAudit(
                channel.guild.id,
                executor.id,
                "channelDelete"
            );

        await sendLog(
            channel.guild,
            "server",
            "Channel Deleted",
            `${executor} deleted a channel.`,
            [
                {
                    name:
                        "Channel",
                    value:
                        channel.name
                }
            ]
        );

        if (
            count >= 3
        ) {
            await securityPunish(
                channel.guild,
                executor,
                "Anti-nuke: excessive channel deletion"
            );
        }
    }
);

// ======================================================
// ROLE CREATE PROTECTION
// ======================================================

client.on(
    "roleCreate",
    async role => {
        const data =
            getGuildData(
                role.guild.id
            );

        if (
            !data.protection.enabled ||
            !data.protection.roleCreate
        ) {
            return;
        }

        const executor =
            await getAuditExecutor(
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

        const count =
            trackAudit(
                role.guild.id,
                executor.id,
                "roleCreate"
            );

        await sendLog(
            role.guild,
            "server",
            "Role Created",
            `${executor} created the role **${role.name}**.`
        );

        if (
            count >= 5
        ) {
            await role.delete()
                .catch(
                    () => {}
                );

            await securityPunish(
                role.guild,
                executor,
                "Anti-nuke: excessive role creation"
            );
        }
    }
);

// ======================================================
// ROLE DELETE PROTECTION
// ======================================================

client.on(
    "roleDelete",
    async role => {
        const data =
            getGuildData(
                role.guild.id
            );

        if (
            !data.protection.enabled ||
            !data.protection.roleDelete
        ) {
            return;
        }

        const executor =
            await getAuditExecutor(
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

        const count =
            trackAudit(
                role.guild.id,
                executor.id,
                "roleDelete"
            );

        await sendLog(
            role.guild,
            "server",
            "Role Deleted",
            `${executor} deleted the role **${role.name}**.`
        );

        if (
            count >= 3
        ) {
            await securityPunish(
                role.guild,
                executor,
                "Anti-nuke: excessive role deletion"
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
        const data =
            getGuildData(
                member.guild.id
            );

        if (
            !data.foreverBanned.includes(
                member.id
            )
        ) {
            return;
        }

        await member.ban({
            reason:
                "Forever ban protection"
        }).catch(
            () => {}
        );

        await sendLog(
            member.guild,
            "mod",
            "Forever Ban Triggered",
            `${member} attempted to join but is permanently banned.`
        );
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
// READY
// ======================================================

client.once(
    "ready",
    () => {
        console.log(
            `${BOT_NAME} is online as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        "VC+",
                    type:
                        ActivityType.Watching
                }
            ],

            status:
                "online"
        });
    }
);

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown() {
    try {
        saveDB();

        for (
            const [
                channelId
            ] of tempVCs
        ) {
            const channel =
                client.channels.cache.get(
                    channelId
                );

            if (channel) {
                await deleteEmptyVC(
                    channel
                ).catch(
                    () => {}
                );
            }
        }

        await client.destroy();

    } catch (error) {
        console.error(
            "Shutdown error:",
            error
        );
    }

    process.exit(0);
}

process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);

// ======================================================
// LOGIN
// ======================================================

if (
    !process.env.DISCORD_TOKEN
) {
    console.error(
        "DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
