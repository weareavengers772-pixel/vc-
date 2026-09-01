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

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify({ guilds: {} }, null, 2)
    );
}

let db;

try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
    db = { guilds: {} };
}

if (!db.guilds) {
    db.guilds = {};
}

// ======================================================
// DATABASE
// ======================================================

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

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
            serverLogChannelId: null,
            modLogChannelId: null
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
        db.guilds[guildId] = defaultGuildData();
        saveDB();
    }

    return db.guilds[guildId];
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

function normalizeRank(rank) {
    if (!rank) return null;

    const value = rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (value === "coowner") return "coowner";

    return Object.keys(RANKS).includes(value)
        ? value
        : null;
}

function getRank(member) {
    if (!member) return "member";

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    return data.ranks[member.id] || "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] ?? 1;
}

function isFounder(member) {
    if (!member) return false;

    return (
        member.guild.ownerId === member.id ||
        getRank(member) === "founder"
    );
}

function isGod(member) {
    if (!member) return false;

    const data = getGuildData(member.guild.id);

    return (
        isFounder(member) ||
        getRank(member) === "god" ||
        data.godmode.includes(member.id)
    );
}

function canModerate(actor, target) {
    if (!actor || !target) return false;

    if (actor.id === target.id) {
        return false;
    }

    if (isFounder(actor)) {
        return true;
    }

    if (isFounder(target)) {
        return false;
    }

    return getRankLevel(actor) > getRankLevel(target);
}

function isTrustedExecutor(member) {
    return isFounder(member) || isGod(member);
}

// ======================================================
// EMBEDS
// ======================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
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
// TEMP VC STORAGE
// ======================================================

const tempVCs = new Map();

function createVCData(guildId, ownerId) {
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
    return tempVCs.get(channelId);
}

// ======================================================
// LOGGING
// ======================================================

async function sendLog(guild, type, description, mod = false) {
    if (!guild) return;

    const data = getGuildData(guild.id);

    const channelId = mod
        ? data.logs.modLogChannelId
        : data.logs.serverLogChannelId;

    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);

    if (!channel || !channel.isTextBased()) {
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(type)
        .setDescription(description)
        .setTimestamp();

    await channel.send({
        embeds: [embed]
    }).catch(() => {});
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
    if (!user) return false;

    try {
        const embed = new EmbedBuilder()
            .setTitle(`You were ${action}`)
            .setDescription(
                `You have been **${action}** in **${guild.name}**.`
            )
            .addFields({
                name: "Reason",
                value: String(reason).slice(0, 1024)
            })
            .setTimestamp();

        if (duration) {
            embed.addFields({
                name: "Duration",
                value: String(duration)
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
// PRIVATE LOG PERMISSIONS
// ======================================================

function logPermissions(guild) {
    return [
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
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];
}

async function updateLogPermissions(guild, category) {
    if (!category) return;

    await category.permissionOverwrites.edit(
        guild.roles.everyone.id,
        {
            ViewChannel: false
        }
    ).catch(() => {});

    for (const role of guild.roles.cache.values()) {
        const roleName = role.name.toLowerCase();

        if (
            roleName === "founder" ||
            roleName === "god"
        ) {
            await category.permissionOverwrites.edit(
                role.id,
                {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                }
            ).catch(() => {});
        }
    }
}

// ======================================================
// CREATE LOG SYSTEM
// ======================================================

async function createLogSystem(guild) {
    const data = getGuildData(guild.id);

    let category = null;

    if (data.logs.categoryId) {
        category =
            guild.channels.cache.get(
                data.logs.categoryId
            );
    }

    if (!category) {
        category = await guild.channels.create({
            name: "VC+ Logs",
            type: ChannelType.GuildCategory,
            permissionOverwrites: logPermissions(guild)
        }).catch(error => {
            console.error("Log category error:", error);
            return null;
        });
    }

    if (!category) return;

    data.logs.categoryId = category.id;

    await updateLogPermissions(
        guild,
        category
    );

    let serverLogs = null;

    if (data.logs.serverLogChannelId) {
        serverLogs =
            guild.channels.cache.get(
                data.logs.serverLogChannelId
            );
    }

    if (!serverLogs) {
        serverLogs = await guild.channels.create({
            name: "server-logs",
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: logPermissions(guild)
        }).catch(() => null);
    }

    let modLogs = null;

    if (data.logs.modLogChannelId) {
        modLogs =
            guild.channels.cache.get(
                data.logs.modLogChannelId
            );
    }

    if (!modLogs) {
        modLogs = await guild.channels.create({
            name: "mod-logs",
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: logPermissions(guild)
        }).catch(() => null);
    }

    if (serverLogs) {
        data.logs.serverLogChannelId =
            serverLogs.id;
    }

    if (modLogs) {
        data.logs.modLogChannelId =
            modLogs.id;
    }

    saveDB();

    await sendLog(
        guild,
        "Logging System",
        "VC+ logging system has been configured."
    );
}

// ======================================================
// VC INTERFACE
// ======================================================

async function updateVCInterface(channel) {
    const data = getVCData(channel.id);

    if (!data) return;

    const owner =
        channel.guild.members.cache.get(
            data.ownerId
        );

    const ownerName =
        owner?.user?.username ?? "Unknown";

    const memberCount =
        channel.members.size;

    const limit =
        channel.userLimit === 0
            ? "Unlimited"
            : String(channel.userLimit);

    const status =
        data.locked
            ? "Locked"
            : "Open";

    const embed = new EmbedBuilder()
        .setTitle("Voice Channel")
        .setDescription(
            `Owner: **${ownerName}**\n` +
            `Members: **${memberCount}**\n` +
            `Limit: **${limit}**\n` +
            `Status: **${status}**\n\n` +

            `**Voice Commands**\n` +
            `-vc kick @user\n` +
            `-vc disconnect @user\n` +
            `-vc ban @user\n` +
            `-vc reject @user\n` +
            `-vc permit @user\n` +
            `-vc stfu @user\n` +
            `-vc unstfu @user\n` +
            `-vc lock\n` +
            `-vc unlock\n` +
            `-vc transfer @user\n` +
            `-vc claim\n` +
            `-vc forceclaim\n` +
            `-vc rename name\n` +
            `-vc limit amount`
        )
        .setTimestamp();

    try {
        // ============================================
        // NEVER CREATE DUPLICATE INTERFACES
        // ============================================

        if (data.interfaceMessageId) {
            const existing =
                await channel.messages
                    .fetch(data.interfaceMessageId)
                    .catch(() => null);

            if (existing) {
                await existing.edit({
                    embeds: [embed],
                    components: []
                });

                return;
            }

            data.interfaceMessageId = null;
        }

        // Search existing messages before creating one.
        const messages =
            await channel.messages.fetch({
                limit: 25
            }).catch(() => null);

        if (messages) {
            const existingInterface =
                messages.find(
                    message =>
                        message.author.id === client.user.id &&
                        message.embeds?.[0]?.title === "Voice Channel"
                );

            if (existingInterface) {
                data.interfaceMessageId =
                    existingInterface.id;

                await existingInterface.edit({
                    embeds: [embed],
                    components: []
                });

                saveDB();
                return;
            }
        }

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
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const data =
        getGuildData(member.guild.id);

    if (!data.jtc.enabled) {
        return null;
    }

    const jtc =
        member.guild.channels.cache.get(
            data.jtc.channelId
        );

    if (
        !jtc ||
        jtc.type !== ChannelType.GuildVoice
    ) {
        return null;
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
            .slice(0, 90) || "User";

    const channel =
        await member.guild.channels.create({
            name: `${username} VC`,
            type: ChannelType.GuildVoice,

            parent:
                category?.type === ChannelType.GuildCategory
                    ? category.id
                    : undefined,

            permissionOverwrites: [
                {
                    id: member.id,
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
        }).catch(error => {
            console.error(
                "VC creation error:",
                error
            );

            return null;
        });

    if (!channel) return null;

    const vcData =
        createVCData(
            member.guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await member.voice
        .setChannel(channel)
        .catch(() => {});

    await updateVCInterface(channel);

    await sendLog(
        member.guild,
        "Voice Channel Created",
        `${member} created **${channel.name}**.`
    );

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    const data =
        getVCData(channel.id);

    if (!data) return;

    if (channel.members.size > 0) {
        return;
    }

    await sendLog(
        channel.guild,
        "Voice Channel Deleted",
        `Temporary voice channel **${channel.name}** was deleted because it became empty.`
    );

    await channel.delete().catch(() => {});

    tempVCs.delete(channel.id);
}

// ======================================================
// VC BAN
// ======================================================

async function applyVCBan(
    channel,
    userId
) {
    const data =
        getVCData(channel.id);

    if (!data) return;

    data.banned.add(userId);
    data.rejected.delete(userId);

    await channel.permissionOverwrites.edit(
        userId,
        {
            Connect: false,
            Speak: false
        }
    ).catch(() => {});

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
            .catch(() => {});
    }
}

async function removeVCBan(
    channel,
    userId
) {
    const data =
        getVCData(channel.id);

    if (!data) return;

    data.banned.delete(userId);

    await channel.permissionOverwrites
        .delete(userId)
        .catch(() => {});
}

// ======================================================
// VC TARGET
// ======================================================

function getVCTarget(message) {
    return message.mentions.members.first();
}

// ======================================================
// VC COMMAND PERMISSION
// ======================================================

function isVCOwner(member, vcData) {
    if (!member || !vcData) return false;

    return (
        member.id === vcData.ownerId ||
        isFounder(member)
    );
}

// ======================================================
// WELCOME MESSAGE
// ======================================================

async function sendWelcomeMessage(guild) {
    const embed = new EmbedBuilder()
        .setTitle("VC+")
        .setDescription(
            `VC+ is now active in **${guild.name}**.\n\n` +

            `**About VC+**\n` +
            `VC+ is a voice channel and server moderation bot built around Join To Create voice channels, server protection, moderation, logging, and rank permissions.\n\n` +

            `**Getting Started**\n` +
            `Use **-vc setup** to configure the voice channel and private logging system.\n\n` +

            `**General Commands**\n` +
            `-help\n` +
            `-vc setup\n\n` +

            `**Voice Commands**\n` +
            `-vc kick @user\n` +
            `-vc disconnect @user\n` +
            `-vc ban @user\n` +
            `-vc reject @user\n` +
            `-vc permit @user\n` +
            `-vc stfu @user\n` +
            `-vc unstfu @user\n` +
            `-vc lock\n` +
            `-vc unlock\n` +
            `-vc transfer @user\n` +
            `-vc claim\n` +
            `-vc forceclaim\n` +
            `-vc rename name\n` +
            `-vc limit amount\n\n` +

            `**Moderation**\n` +
            `-ban @user [reason]\n` +
            `-unban userID\n` +
            `-banlist\n` +
            `-kick @user [reason]\n` +
            `-timeout @user minutes [reason]\n` +
            `-untimeout @user\n` +
            `-foreverban @user [reason]\n` +
            `-purge amount\n\n` +

            `**Ranks**\n` +
            `-rank @user rank\n` +
            `-godmode @user\n\n` +

            `Founder has the highest permission level.`
        )
        .setTimestamp();

    const channels =
        guild.channels.cache
            .filter(
                channel =>
                    channel.type === ChannelType.GuildText &&
                    channel.permissionsFor(guild.members.me)?.has(
                        [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    )
            )
            .sort(
                (a, b) =>
                    a.position - b.position
            );

    const channel =
        channels.first();

    if (!channel) return;

    await channel.send({
        embeds: [embed]
    }).catch(() => {});
}

// ======================================================
// SETUP
// ======================================================

async function setupVC(guild) {
    const data =
        getGuildData(guild.id);

    // ============================================
    // LOG SYSTEM
    // ============================================

    await createLogSystem(guild);

    // ============================================
    // CHECK EXISTING JTC
    // ============================================

    let jtc = null;

    if (data.jtc.channelId) {
        jtc =
            guild.channels.cache.get(
                data.jtc.channelId
            );
    }

    if (
        !jtc ||
        jtc.type !== ChannelType.GuildVoice
    ) {
        jtc =
            await guild.channels.create({
                name: "Join To Create",
                type: ChannelType.GuildVoice
            }).catch(error => {
                console.error(
                    "JTC creation error:",
                    error
                );

                return null;
            });
    }

    if (!jtc) {
        return false;
    }

    data.jtc.channelId =
        jtc.id;

    data.jtc.enabled = true;

    // ============================================
    // CATEGORY
    // ============================================

    if (
        !data.jtc.categoryId ||
        !guild.channels.cache.get(
            data.jtc.categoryId
        )
    ) {
        const category =
            await guild.channels.create({
                name: "Voice Channels",
                type: ChannelType.GuildCategory
            }).catch(() => null);

        if (category) {
            data.jtc.categoryId =
                category.id;

            await jtc.setParent(
                category.id
            ).catch(() => {});
        }
    }

    saveDB();

    await sendLog(
        guild,
        "VC+ Setup",
        `VC+ setup was completed by the server administrator.`
    );

    return true;
}

// ======================================================
// FILTER
// ======================================================

async function handleFilteredMessage(message) {
    if (!message.guild) return false;
    if (message.author.bot) return false;

    const data =
        getGuildData(
            message.guild.id
        );

    if (!data.filters.enabled) {
        return false;
    }

    if (isGod(message.member)) {
        return false;
    }

    const content =
        message.content.toLowerCase();

    const matched =
        data.filters.words.some(
            word =>
                content.includes(
                    String(word).toLowerCase()
                )
        );

    if (!matched) {
        return false;
    }

    await message.delete()
        .catch(() => {});

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
            .catch(() => {});

        data.filters.strikes[
            message.author.id
        ] = 0;
    }

    saveDB();

    await sendLog(
        message.guild,
        "Filter Triggered",
        `${message.author} triggered the server filter.\nStrikes: **${strikes}**`
    );

    return true;
}

// ======================================================
// HELP
// ======================================================

async function sendHelp(message) {
    const embed = new EmbedBuilder()
        .setTitle("VC+ Commands")
        .setDescription(
            `**General**\n` +
            `-help\n\n` +

            `**Voice Commands**\n` +
            `-vc setup\n` +
            `-vc kick @user\n` +
            `-vc disconnect @user\n` +
            `-vc ban @user\n` +
            `-vc reject @user\n` +
            `-vc permit @user\n` +
            `-vc stfu @user\n` +
            `-vc unstfu @user\n` +
            `-vc lock\n` +
            `-vc unlock\n` +
            `-vc transfer @user\n` +
            `-vc claim\n` +
            `-vc forceclaim\n` +
            `-vc rename name\n` +
            `-vc limit amount\n\n` +

            `**Moderation**\n` +
            `-ban @user [reason]\n` +
            `-unban userID\n` +
            `-banlist\n` +
            `-kick @user [reason]\n` +
            `-timeout @user minutes [reason]\n` +
            `-untimeout @user\n` +
            `-foreverban @user [reason]\n` +
            `-purge amount\n\n` +

            `**Ranks**\n` +
            `-rank @user rank\n` +
            `-godmode @user\n\n` +

            `**Filter**\n` +
            `-filter on\n` +
            `-filter off\n` +
            `-filter add word\n` +
            `-filter remove word\n` +
            `-filter list\n` +
            `-filter log #channel\n` +
            `-filter strikes @user\n` +
            `-filter reset @user`
        )
        .setTimestamp();

    await message.reply({
        embeds: [embed]
    });
}

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (!message.guild) return;
            if (message.author.bot) return;

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
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()?.toLowerCase();

            const member =
                message.member;

            const data =
                getGuildData(
                    message.guild.id
                );

            // ============================================
            // HELP
            // ============================================

            if (
                command === "help" ||
                command === "commands"
            ) {
                await sendHelp(message);
                return;
            }

            // ============================================
            // VC
            // ============================================

            if (command === "vc") {
                const sub =
                    args.shift()?.toLowerCase();

                // ----------------------------------------
                // SETUP
                // ----------------------------------------

                if (sub === "setup") {
                    if (!isGod(member)) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Permission Denied",
                                    "You need God or Founder permission to run this command."
                                )
                            ]
                        });

                        return;
                    }

                    const success =
                        await setupVC(
                            message.guild
                        );

                    if (!success) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Setup Failed",
                                    "VC+ could not complete the setup."
                                )
                            ]
                        });

                        return;
                    }

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC+ Setup Complete",
                                `Join To Create has been configured.\n\n` +
                                `Private **server-logs** and **mod-logs** were created.\n\n` +
                                `Members cannot view the log channels.`
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // REQUIRE VC
                // ----------------------------------------

                const voiceChannel =
                    member.voice.channel;

                if (!voiceChannel) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "No Voice Channel",
                                "You must be inside your VC to use this command."
                            )
                        ]
                    });

                    return;
                }

                const vcData =
                    getVCData(
                        voiceChannel.id
                    );

                if (!vcData) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Not A VC+ Channel",
                                "This is not a VC+ temporary voice channel."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // OWNER COMMANDS
                // ----------------------------------------

                const ownerOnlyCommands = [
                    "kick",
                    "disconnect",
                    "ban",
                    "reject",
                    "permit",
                    "lock",
                    "unlock",
                    "transfer",
                    "rename",
                    "limit",
                    "claim"
                ];

                if (
                    ownerOnlyCommands.includes(sub) &&
                    !isVCOwner(member, vcData)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only the VC owner or Founder can use this command."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // TARGET
                // ----------------------------------------

                if (
                    [
                        "kick",
                        "disconnect",
                        "ban",
                        "reject",
                        "permit",
                        "stfu",
                        "unstfu",
                        "transfer"
                    ].includes(sub)
                ) {
                    const target =
                        getVCTarget(message);

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing User",
                                    "Mention a user."
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // KICK
                    // ------------------------------

                    if (sub === "kick") {
                        if (
                            target.voice.channelId !==
                            voiceChannel.id
                        ) {
                            await message.reply({
                                embeds: [
                                    errorEmbed(
                                        "User Not In VC",
                                        "That user is not in your voice channel."
                                    )
                                ]
                            });

                            return;
                        }

                        await target.voice
                            .disconnect()
                            .catch(() => {});

                        await sendLog(
                            message.guild,
                            "VC Kick",
                            `${member} kicked ${target} from **${voiceChannel.name}**.`,
                            true
                        );

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Kicked",
                                    `${target} was disconnected.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // DISCONNECT
                    // ------------------------------

                    if (sub === "disconnect") {
                        await target.voice
                            .disconnect()
                            .catch(() => {});

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "Disconnected",
                                    `${target} was disconnected.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // BAN
                    // ------------------------------

                    if (sub === "ban") {
                        await applyVCBan(
                            voiceChannel,
                            target.id
                        );

                        await sendLog(
                            message.guild,
                            "VC Ban",
                            `${member} banned ${target} from **${voiceChannel.name}**.`,
                            true
                        );

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Banned",
                                    `${target} can no longer join this VC.`
                                )
                            ]
                        });

                        await updateVCInterface(
                            voiceChannel
                        );

                        return;
                    }

                    // ------------------------------
                    // REJECT
                    // ------------------------------

                    if (sub === "reject") {
                        vcData.rejected.add(
                            target.id
                        );

                        await voiceChannel
                            .permissionOverwrites
                            .edit(
                                target.id,
                                {
                                    Connect: false
                                }
                            )
                            .catch(() => {});

                        if (
                            target.voice.channelId ===
                            voiceChannel.id
                        ) {
                            await target.voice
                                .disconnect()
                                .catch(() => {});
                        }

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Rejected",
                                    `${target} has been rejected from this VC.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // PERMIT
                    // ------------------------------

                    if (sub === "permit") {
                        vcData.rejected.delete(
                            target.id
                        );

                        vcData.banned.delete(
                            target.id
                        );

                        await voiceChannel
                            .permissionOverwrites
                            .delete(
                                target.id
                            )
                            .catch(() => {});

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Permitted",
                                    `${target} can join this VC again.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // STFU
                    // ------------------------------

                    if (sub === "stfu") {
                        if (!isGod(member)) {
                            await message.reply({
                                embeds: [
                                    errorEmbed(
                                        "Permission Denied",
                                        "Only God or Founder can use STFU."
                                    )
                                ]
                            });

                            return;
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
                                    "VC+ STFU"
                                )
                                .catch(() => {});
                        }

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Muted",
                                    `${target} has been server muted.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // UNSTFU
                    // ------------------------------

                    if (sub === "unstfu") {
                        if (!isGod(member)) {
                            await message.reply({
                                embeds: [
                                    errorEmbed(
                                        "Permission Denied",
                                        "Only God or Founder can use UNSTFU."
                                    )
                                ]
                            });

                            return;
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
                                    "VC+ UNSTFU"
                                )
                                .catch(() => {});
                        }

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "User Unmuted",
                                    `${target} has been server unmuted.`
                                )
                            ]
                        });

                        return;
                    }

                    // ------------------------------
                    // TRANSFER
                    // ------------------------------

                    if (sub === "transfer") {
                        vcData.ownerId =
                            target.id;

                        await sendLog(
                            message.guild,
                            "VC Ownership Transfer",
                            `${member} transferred **${voiceChannel.name}** to ${target}.`,
                            true
                        );

                        await updateVCInterface(
                            voiceChannel
                        );

                        await message.reply({
                            embeds: [
                                successEmbed(
                                    "Ownership Transferred",
                                    `${target} is now the owner of this VC.`
                                )
                            ]
                        });

                        return;
                    }
                }

                // ----------------------------------------
                // LOCK
                // ----------------------------------------

                if (sub === "lock") {
                    vcData.locked = true;

                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    ).catch(() => {});

                    for (
                        const vcMember
                        of voiceChannel.members.values()
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            vcMember.id,
                            {
                                Connect: true
                            }
                        ).catch(() => {});
                    }

                    for (
                        const id
                        of vcData.banned
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            id,
                            {
                                Connect: false
                            }
                        ).catch(() => {});
                    }

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Locked",
                                "Your voice channel is now locked."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // UNLOCK
                // ----------------------------------------

                if (sub === "unlock") {
                    vcData.locked = false;

                    await voiceChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    ).catch(() => {});

                    for (
                        const id
                        of vcData.banned
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            id,
                            {
                                Connect: false
                            }
                        ).catch(() => {});
                    }

                    for (
                        const id
                        of vcData.rejected
                    ) {
                        await voiceChannel.permissionOverwrites.edit(
                            id,
                            {
                                Connect: false
                            }
                        ).catch(() => {});
                    }

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Unlocked",
                                "Your voice channel is now unlocked."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // CLAIM
                // ----------------------------------------

                if (sub === "claim") {
                    const oldOwner =
                        voiceChannel.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        oldOwner &&
                        oldOwner.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Cannot Claim",
                                    "The current owner is still inside the VC."
                                )
                            ]
                        });

                        return;
                    }

                    vcData.ownerId =
                        member.id;

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Claimed",
                                "You are now the owner of this VC."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // FORCE CLAIM
                // ----------------------------------------

                if (sub === "forceclaim") {
                    if (!isFounder(member)) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Permission Denied",
                                    "Only Founder can force claim a VC."
                                )
                            ]
                        });

                        return;
                    }

                    vcData.ownerId =
                        member.id;

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Force Claimed",
                                "You are now the owner of this VC."
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // RENAME
                // ----------------------------------------

                if (sub === "rename") {
                    const newName =
                        args.join(" ")
                            .replace(
                                /[^\p{L}\p{N}\s._-]/gu,
                                ""
                            )
                            .trim()
                            .slice(0, 100);

                    if (!newName) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Invalid Name",
                                    "Enter a valid VC name."
                                )
                            ]
                        });

                        return;
                    }

                    await voiceChannel.setName(
                        newName
                    ).catch(() => {});

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Renamed",
                                `The VC is now named **${newName}**.`
                            )
                        ]
                    });

                    return;
                }

                // ----------------------------------------
                // LIMIT
                // ----------------------------------------

                if (sub === "limit") {
                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(amount) ||
                        amount < 0 ||
                        amount > 99
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Invalid Limit",
                                    "Use a number from 0 to 99. Use 0 for unlimited."
                                )
                            ]
                        });

                        return;
                    }

                    await voiceChannel.setUserLimit(
                        amount
                    ).catch(() => {});

                    await updateVCInterface(
                        voiceChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Limit Updated",
                                amount === 0
                                    ? "The VC is now unlimited."
                                    : `The VC limit is now **${amount}**.`
                            )
                        ]
                    });

                    return;
                }

                return;
            }

            // ============================================
            // BAN
            // ============================================

            if (command === "ban") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention a user to ban."
                            )
                        ]
                    });

                    return;
                }

                if (!canModerate(
                    member,
                    target
                )) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You cannot moderate that rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "banned",
                    reason
                );

                await target.ban({
                    reason
                }).catch(() => {});

                await sendLog(
                    message.guild,
                    "Member Banned",
                    `${member} banned ${target}.\nReason: ${reason}`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "User Banned",
                            `${target} was banned.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // UNBAN
            // ============================================

            if (command === "unban") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const userId =
                    args[0];

                if (!userId) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User ID",
                                "Provide the user's ID."
                            )
                        ]
                    });

                    return;
                }

                await message.guild.bans
                    .remove(
                        userId,
                        "VC+ unban"
                    )
                    .catch(() => null);

                data.foreverBanned =
                    data.foreverBanned.filter(
                        id => id !== userId
                    );

                saveDB();

                await sendLog(
                    message.guild,
                    "Member Unbanned",
                    `${member} unbanned user ID **${userId}**.`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "User Unbanned",
                            `User ID **${userId}** has been unbanned.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // BANLIST
            // ============================================

            if (command === "banlist") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const bans =
                    await message.guild.bans
                        .fetch()
                        .catch(() => null);

                if (!bans) return;

                const list =
                    bans
                        .map(
                            ban =>
                                `${ban.user.tag} — ${ban.user.id}`
                        )
                        .slice(0, 25)
                        .join("\n");

                await message.reply({
                    embeds: [
                        infoEmbed(
                            "Ban List",
                            list || "No banned users."
                        )
                    ]
                });

                return;
            }

            // ============================================
            // KICK
            // ============================================

            if (command === "kick") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) return;

                if (!canModerate(
                    member,
                    target
                )) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You cannot moderate that rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "kicked",
                    reason
                );

                await target.kick(
                    reason
                ).catch(() => {});

                await sendLog(
                    message.guild,
                    "Member Kicked",
                    `${member} kicked ${target}.\nReason: ${reason}`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "User Kicked",
                            `${target} was kicked.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // TIMEOUT
            // ============================================

            if (command === "timeout") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                const minutes =
                    Number(
                        args[0]
                    );

                if (
                    !target ||
                    !Number.isInteger(minutes) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Timeout",
                                "Use: -timeout @user minutes reason"
                            )
                        ]
                    });

                    return;
                }

                if (!canModerate(
                    member,
                    target
                )) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You cannot moderate that rank."
                            )
                        ]
                    });

                    return;
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "timed out",
                    reason,
                    `${minutes} minutes`
                );

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                ).catch(() => {});

                await sendLog(
                    message.guild,
                    "Member Timed Out",
                    `${member} timed out ${target} for **${minutes} minutes**.\nReason: ${reason}`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "User Timed Out",
                            `${target} was timed out for **${minutes} minutes**.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // UNTIMEOUT
            // ============================================

            if (command === "untimeout") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) return;

                if (!canModerate(
                    member,
                    target
                )) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You cannot moderate that rank."
                            )
                        ]
                    });

                    return;
                }

                await target.timeout(
                    null,
                    "VC+ untimeout"
                ).catch(() => {});

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Timeout Removed",
                            `${target} is no longer timed out.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // FOREVERBAN
            // ============================================

            if (command === "foreverban") {
                if (!isFounder(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only Founder can use foreverban."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) return;

                const reason =
                    args.join(" ") ||
                    "No reason provided.";

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
                }).catch(() => {});

                await sendLog(
                    message.guild,
                    "Forever Ban",
                    `${member} permanently banned ${target}.\nReason: ${reason}`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Forever Ban",
                            `${target} has been permanently banned.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // PURGE
            // ============================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Amount",
                                "Use a number from 1 to 100."
                            )
                        ]
                    });

                    return;
                }

                await message.channel
                    .bulkDelete(
                        amount,
                        true
                    )
                    .catch(() => {});

                await sendLog(
                    message.guild,
                    "Messages Purged",
                    `${member} purged **${amount} messages** from ${message.channel}.`,
                    true
                );

                return;
            }

            // ============================================
            // RANK
            // ============================================

            if (command === "rank") {
                if (!isFounder(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only Founder can change ranks."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                const rank =
                    normalizeRank(
                        args[0]
                    );

                if (
                    !target ||
                    !rank
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Rank",
                                "Available ranks: member, staff, moderator, admin, director, executive, coowner, owner, god, founder."
                            )
                        ]
                    });

                    return;
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Cannot Change Owner",
                                "The server owner cannot have their rank changed."
                            )
                        ]
                    });

                    return;
                }

                data.ranks[target.id] =
                    rank;

                saveDB();

                await sendLog(
                    message.guild,
                    "Rank Changed",
                    `${member} gave ${target} the **${rank}** rank.`,
                    true
                );

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Rank Updated",
                            `${target} is now **${rank}**.`
                        )
                    ]
                });

                return;
            }

            // ============================================
            // GODMODE
            // ============================================

            if (command === "godmode") {
                if (!isFounder(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only Founder can change Godmode."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) return;

                if (
                    data.godmode.includes(
                        target.id
                    )
                ) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !== target.id
                        );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Godmode Removed",
                                `${target} no longer has Godmode.`
                            )
                        ]
                    });

                } else {
                    data.godmode.push(
                        target.id
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Godmode Enabled",
                                `${target} now has Godmode.`
                            )
                        ]
                    });
                }

                saveDB();

                await sendLog(
                    message.guild,
                    "Godmode Changed",
                    `${member} changed Godmode for ${target}.`,
                    true
                );

                return;
            }

            // ============================================
            // FILTER
            // ============================================

            if (command === "filter") {
                if (!isGod(member)) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need God or Founder permission."
                            )
                        ]
                    });

                    return;
                }

                const sub =
                    args.shift()?.toLowerCase();

                if (sub === "on") {
                    data.filters.enabled =
                        true;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Enabled",
                                "The server filter is now enabled."
                            )
                        ]
                    });

                    return;
                }

                if (sub === "off") {
                    data.filters.enabled =
                        false;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Disabled",
                                "The server filter is now disabled."
                            )
                        ]
                    });

                    return;
                }

                if (sub === "add") {
                    const word =
                        args.join(" ")
                            .trim();

                    if (!word) return;

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

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Word Added",
                                `Added **${word}** to the filter.`
                            )
                        ]
                    });

                    return;
                }

                if (sub === "remove") {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    data.filters.words =
                        data.filters.words.filter(
                            item =>
                                item !== word
                        );

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Word Removed",
                                `Removed **${word}** from the filter.`
                            )
                        ]
                    });

                    return;
                }

                if (sub === "list") {
                    await message.reply({
                        embeds: [
                            infoEmbed(
                                "Filter Words",
                                data.filters.words.length
                                    ? data.filters.words.join("\n")
                                    : "No filter words configured."
                            )
                        ]
                    });

                    return;
                }

                if (sub === "log") {
                    const channel =
                        message.mentions.channels.first();

                    if (!channel) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Missing Channel",
                                    "Mention a channel."
                                )
                            ]
                        });

                        return;
                    }

                    data.filters.logChannelId =
                        channel.id;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Log Updated",
                                `Filter logs will be sent to ${channel}.`
                            )
                        ]
                    });

                    return;
                }

                if (sub === "strikes") {
                    const target =
                        message.mentions.members.first();

                    if (!target) return;

                    const strikes =
                        data.filters.strikes[
                            target.id
                        ] || 0;

                    await message.reply({
                        embeds: [
                            infoEmbed(
                                "Filter Strikes",
                                `${target} has **${strikes}** strike(s).`
                            )
                        ]
                    });

                    return;
                }

                if (sub === "reset") {
                    const target =
                        message.mentions.members.first();

                    if (!target) return;

                    data.filters.strikes[
                        target.id
                    ] = 0;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Strikes Reset",
                                `${target}'s filter strikes have been reset.`
                            )
                        ]
                    });

                    return;
                }

                return;
            }

            // ============================================
            // LOG EVERY COMMAND
            // ============================================

            await sendLog(
                message.guild,
                "Command Used",
                `${message.author} used \`${message.content.slice(0, 500)}\` in ${message.channel}.`
            );

        } catch (error) {
            console.error(
                "Command error:",
                error
            );

            await message.reply({
                embeds: [
                    errorEmbed(
                        "Command Error",
                        "VC+ encountered an error while processing that command."
                    )
                ]
            }).catch(() => {});
        }
    }
);

// ======================================================
// VOICE STATE
// ======================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) return;

            const data =
                getGuildData(
                    guild.id
                );

            // ============================================
            // JOIN TO CREATE
            // ============================================

            if (
                data.jtc.enabled &&
                newState.channelId ===
                data.jtc.channelId
            ) {
                await createPersonalVC(
                    newState.member
                );

                return;
            }

            // ============================================
            // ENTER VC+
            // ============================================

            if (newState.channelId) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (vcData) {
                    const channel =
                        newState.channel;

                    if (
                        vcData.banned.has(
                            newState.id
                        ) ||
                        vcData.rejected.has(
                            newState.id
                        )
                    ) {
                        await newState.member.voice
                            .disconnect()
                            .catch(() => {});

                        return;
                    }

                    if (
                        vcData.locked &&
                        newState.id !==
                        vcData.ownerId &&
                        !isFounder(
                            newState.member
                        )
                    ) {
                        await newState.member.voice
                            .disconnect()
                            .catch(() => {});

                        return;
                    }

                    if (
                        vcData.stfu.has(
                            newState.id
                        )
                    ) {
                        await newState.member.voice
                            .setMute(
                                true,
                                "VC+ STFU"
                            )
                            .catch(() => {});
                    }

                    await updateVCInterface(
                        channel
                    );

                    await sendLog(
                        guild,
                        "Voice Channel Join",
                        `${newState.member} joined **${channel.name}**.`
                    );
                }
            }

            // ============================================
            // LEFT OLD VC
            // ============================================

            if (oldState.channelId) {
                const oldVCData =
                    getVCData(
                        oldState.channelId
                    );

                if (oldVCData) {
                    const oldChannel =
                        oldState.channel;

                    if (oldChannel) {
                        await updateVCInterface(
                            oldChannel
                        );

                        await deleteEmptyVC(
                            oldChannel
                        );
                    }

                    await sendLog(
                        guild,
                        "Voice Channel Leave",
                        `${oldState.member} left **${oldChannel?.name ?? "voice channel"}**.`
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
// MEMBER JOIN
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        await sendLog(
            member.guild,
            "Member Joined",
            `${member} joined the server.`
        );
    }
);

// ======================================================
// MEMBER LEAVE
// ======================================================

client.on(
    "guildMemberRemove",
    async member => {
        await sendLog(
            member.guild,
            "Member Left",
            `${member.user?.tag ?? member.id} left the server.`
        );
    }
);

// ======================================================
// CHANNEL CREATE
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        if (!channel.guild) return;

        await sendLog(
            channel.guild,
            "Channel Created",
            `Channel **${channel.name}** was created.`
        );

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

        if (!executor) return;

        const member =
            await channel.guild.members
                .fetch(executor.id)
                .catch(() => null);

        if (
            member &&
            isTrustedExecutor(member)
        ) {
            return;
        }

        if (
            recordSecurityAction(
                channel.guild.id,
                executor.id,
                "channelCreate",
                5
            )
        ) {
            await securityPunish(
                channel.guild,
                executor,
                "Mass channel creation"
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
        if (!channel.guild) return;

        await sendLog(
            channel.guild,
            "Channel Deleted",
            `Channel **${channel.name}** was deleted.`
        );

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

        if (!executor) return;

        const member =
            await channel.guild.members
                .fetch(executor.id)
                .catch(() => null);

        if (
            member &&
            isTrustedExecutor(member)
        ) {
            return;
        }

        if (
            recordSecurityAction(
                channel.guild.id,
                executor.id,
                "channelDelete",
                3
            )
        ) {
            await securityPunish(
                channel.guild,
                executor,
                "Mass channel deletion"
            );
        }
    }
);

// ======================================================
// ROLE CREATE
// ======================================================

client.on(
    "roleCreate",
    async role => {
        await sendLog(
            role.guild,
            "Role Created",
            `Role **${role.name}** was created.`
        );

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

        if (!executor) return;

        const member =
            await role.guild.members
                .fetch(executor.id)
                .catch(() => null);

        if (
            member &&
            isTrustedExecutor(member)
        ) {
            return;
        }

        if (
            recordSecurityAction(
                role.guild.id,
                executor.id,
                "roleCreate",
                5
            )
        ) {
            await securityPunish(
                role.guild,
                executor,
                "Mass role creation"
            );
        }
    }
);

// ======================================================
// ROLE DELETE
// ======================================================

client.on(
    "roleDelete",
    async role => {
        await sendLog(
            role.guild,
            "Role Deleted",
            `Role **${role.name}** was deleted.`
        );

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

        if (!executor) return;

        const member =
            await role.guild.members
                .fetch(executor.id)
                .catch(() => null);

        if (
            member &&
            isTrustedExecutor(member)
        ) {
            return;
        }

        if (
            recordSecurityAction(
                role.guild.id,
                executor.id,
                "roleDelete",
                3
            )
        ) {
            await securityPunish(
                role.guild,
                executor,
                "Mass role deletion"
            );
        }
    }
);

// ======================================================
// AUDIT LOG SECURITY
// ======================================================

const auditTracker = new Map();

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

        if (!entry) return null;

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

function recordSecurityAction(
    guildId,
    userId,
    action,
    threshold
) {
    const key =
        `${guildId}:${userId}:${action}`;

    const now =
        Date.now();

    if (!auditTracker.has(key)) {
        auditTracker.set(
            key,
            []
        );
    }

    const timestamps =
        auditTracker.get(key);

    timestamps.push(now);

    const recent =
        timestamps.filter(
            time =>
                now - time <
                10000
        );

    auditTracker.set(
        key,
        recent
    );

    return recent.length >= threshold;
}

async function securityPunish(
    guild,
    user,
    reason
) {
    if (!user) return;

    const member =
        await guild.members
            .fetch(user.id)
            .catch(() => null);

    if (!member) return;

    if (isTrustedExecutor(member)) {
        return;
    }

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

    await member.ban({
        reason
    }).catch(() => {});

    await sendLog(
        guild,
        "Security Action",
        `${user} was banned by VC+ security.\nReason: ${reason}`,
        true
    );
}

// ======================================================
// BOT JOINS SERVER
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        console.log(
            `VC+ joined ${guild.name}`
        );

        getGuildData(
            guild.id
        );

        await sendWelcomeMessage(
            guild
        );

        await sendLog(
            guild,
            "VC+ Joined Server",
            `VC+ has joined **${guild.name}**.`
        ).catch(() => {});
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
                    type: ActivityType.Watching
                }
            ],
            status: "online"
        });

        // ============================================
        // RESTORE VC+ SETUPS
        // ============================================

        for (
            const guild
            of client.guilds.cache.values()
        ) {
            getGuildData(
                guild.id
            );
        }

        saveDB();
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

async function shutdown() {
    console.log(
        "VC+ shutting down..."
    );

    saveDB();

    for (
        const channel
        of client.channels.cache.values()
    ) {
        if (
            channel.type ===
            ChannelType.GuildVoice
        ) {
            const data =
                getVCData(
                    channel.id
                );

            if (
                data &&
                channel.members.size === 0
            ) {
                await channel.delete()
                    .catch(() => {});
            }
        }
    }

    client.destroy();

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

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
