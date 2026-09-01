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
        JSON.stringify({ guilds: {} }, null, 4)
    );
}

// ======================================================
// DATABASE
// ======================================================

let db;

try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
    db = { guilds: {} };
}

if (!db.guilds) {
    db.guilds = {};
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 4)
        );
    } catch (error) {
        console.error("[DATABASE ERROR]", error);
    }
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

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaultGuildData();
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
    if (!rank) return "member";

    return rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRank(member) {
    if (!member) return "member";

    if (member.guild.ownerId === member.id) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    const configuredRank = data.ranks[member.id];

    if (configuredRank) {
        return normalizeRank(configuredRank);
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        return "admin";
    }

    const roleNames = member.roles.cache
        .filter(role => role.name !== "@everyone")
        .map(role => normalizeRank(role.name));

    const availableRanks = Object.keys(RANKS)
        .filter(rank => roleNames.includes(rank))
        .sort((a, b) => RANKS[b] - RANKS[a]);

    return availableRanks[0] || "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] || 1;
}

function isFounder(member) {
    if (!member) return false;

    return (
        member.guild.ownerId === member.id ||
        getRankLevel(member) >= RANKS.founder
    );
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
// EMBEDS
// ======================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`✓ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`✕ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0x5865F2)
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
// TEMPORARY VC STORAGE
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

// ======================================================
// VC INTERFACE LOCKS
// ======================================================

const vcInterfaceLocks = new Map();

// ======================================================
// LOGGING
// ======================================================

async function sendLog(guild, type, description, mod = false) {
    try {
        const data = getGuildData(guild.id);

        const channelId = mod
            ? data.logs.modLogChannelId
            : data.logs.serverLogChannelId;

        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(mod ? 0xED4245 : 0x5865F2)
            .setTitle(type)
            .setDescription(description)
            .setFooter({
                text: BOT_NAME
            })
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    } catch (error) {
        console.error("[LOG ERROR]", error);
    }
}

// ======================================================
// PRIVATE LOG PERMISSIONS
// ======================================================

async function logPermissions(guild) {
    try {
        const everyone = guild.roles.everyone;

        const botMember = guild.members.me;

        const overwrites = [
            {
                id: everyone.id,
                deny: [
                    PermissionFlagsBits.ViewChannel
                ]
            }
        ];

        if (botMember) {
            overwrites.push({
                id: botMember.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        return overwrites;
    } catch {
        return [];
    }
}

async function updateLogPermissions(guild, category) {
    try {
        const overwrites = await logPermissions(guild);

        const founderRole = guild.roles.cache.find(
            role => normalizeRank(role.name) === "founder"
        );

        const godRole = guild.roles.cache.find(
            role => normalizeRank(role.name) === "god"
        );

        if (founderRole) {
            overwrites.push({
                id: founderRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        if (godRole) {
            overwrites.push({
                id: godRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        await category.permissionOverwrites.set(overwrites);

        for (const channel of category.children.cache.values()) {
            await channel.permissionOverwrites.set(overwrites).catch(() => {});
        }

    } catch (error) {
        console.error("[LOG PERMISSION ERROR]", error);
    }
}

// ======================================================
// CREATE LOG SYSTEM
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
            type: ChannelType.GuildCategory
        });
    }

    data.logs.categoryId = category.id;

    const overwrites = await logPermissions(guild);

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
            permissionOverwrites: overwrites
        });
    }

    data.logs.serverLogChannelId = serverLogs.id;

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
            permissionOverwrites: overwrites
        });
    }

    data.logs.modLogChannelId = modLogs.id;

    await updateLogPermissions(guild, category);

    saveDB();

    return {
        category,
        serverLogs,
        modLogs
    };
}

// ======================================================
// MODERATION DM
// ======================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided",
    duration = null
) {
    try {
        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`Moderation Action — ${action}`)
            .setDescription(
                `You received a moderation action in **${guild.name}**.`
            )
            .addFields(
                {
                    name: "Action",
                    value: action,
                    inline: true
                },
                {
                    name: "Reason",
                    value: reason,
                    inline: true
                }
            )
            .setTimestamp();

        if (duration) {
            embed.addFields({
                name: "Duration",
                value: duration,
                inline: true
            });
        }

        await user.send({
            embeds: [embed]
        });
    } catch {
        // DMs can be disabled.
    }
}

// ======================================================
// VC INTERFACE
// ======================================================

async function updateVCInterface(channel) {
    if (!channel || !channel.isVoiceBased()) return;

    const channelId = channel.id;

    // Prevent multiple simultaneous updates.
    if (vcInterfaceLocks.has(channelId)) {
        return vcInterfaceLocks.get(channelId);
    }

    const updatePromise = (async () => {
        try {
            const data = tempVCs.get(channelId);

            if (!data) return;

            const owner = await channel.guild.members
                .fetch(data.ownerId)
                .catch(() => null);

            const ownerName = owner
                ? owner.user.username
                : "Unknown";

            const memberCount = channel.members.size;

            const limit = channel.userLimit > 0
                ? `${channel.userLimit}`
                : "Unlimited";

            const status = data.locked
                ? "Locked"
                : "Open";

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("Voice Channel")
                .setDescription(
`**Owner:** ${ownerName}
**Members:** ${memberCount}
**Limit:** ${limit}
**Status:** ${status}

### Voice Commands

\`-vc kick @user\`
\`-vc disconnect @user\`
\`-vc ban @user\`
\`-vc reject @user\`
\`-vc permit @user\`
\`-vc stfu @user\`
\`-vc unstfu @user\`
\`-vc lock\`
\`-vc unlock\`
\`-vc transfer @user\`
\`-vc claim\`
\`-vc forceclaim\`
\`-vc rename name\`
\`-vc limit amount\``
                )
                .setFooter({
                    text: "VC+ • Text commands only"
                })
                .setTimestamp();

            let interfaceMessage = null;

            // ==================================================
            // STEP 1 — SAVED MESSAGE
            // ==================================================

            if (data.interfaceMessageId) {
                interfaceMessage = await channel.messages
                    .fetch(data.interfaceMessageId)
                    .catch(() => null);

                if (interfaceMessage) {
                    if (
                        interfaceMessage.author.id !==
                        channel.client.user.id
                    ) {
                        interfaceMessage = null;
                    }
                }
            }

            // ==================================================
            // STEP 2 — SEARCH FOR EXISTING INTERFACE
            // ==================================================

            if (!interfaceMessage) {
                const messages = await channel.messages
                    .fetch({
                        limit: 50
                    })
                    .catch(() => null);

                if (messages) {
                    interfaceMessage = messages.find(message =>
                        message.author.id === channel.client.user.id &&
                        message.embeds.length > 0 &&
                        message.embeds[0].title === "Voice Channel"
                    );

                    if (interfaceMessage) {
                        data.interfaceMessageId =
                            interfaceMessage.id;
                    }
                }
            }

            // ==================================================
            // STEP 3 — EDIT EXISTING
            // ==================================================

            if (interfaceMessage) {
                await interfaceMessage.edit({
                    embeds: [embed],
                    components: []
                });

                saveDB();

                return;
            }

            // ==================================================
            // STEP 4 — CREATE ONE
            // ==================================================

            const newMessage = await channel.send({
                embeds: [embed],
                components: []
            });

            data.interfaceMessageId =
                newMessage.id;

            saveDB();

        } catch (error) {
            console.error(
                `[VC INTERFACE ERROR] ${channel?.name || "Unknown VC"}:`,
                error
            );
        }
    })();

    vcInterfaceLocks.set(
        channelId,
        updatePromise
    );

    try {
        await updatePromise;
    } finally {
        vcInterfaceLocks.delete(channelId);
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    try {
        const guild = member.guild;
        const data = getGuildData(guild.id);

        if (!data.jtc.enabled) return null;

        const jtcChannel = guild.channels.cache.get(
            data.jtc.channelId
        );

        if (!jtcChannel) return null;

        let category = null;

        if (data.jtc.categoryId) {
            category = guild.channels.cache.get(
                data.jtc.categoryId
            );
        }

        const safeName = member.user.username
            .replace(/[^a-zA-Z0-9-_]/g, "")
            .slice(0, 70) || "User";

        const permissionOverwrites = [
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
        ];

        const channel = await guild.channels.create({
            name: `${safeName} VC`,
            type: ChannelType.GuildVoice,
            parent: category?.id || null,
            permissionOverwrites
        });

        const vcData = createVCData(
            guild.id,
            member.id
        );

        tempVCs.set(
            channel.id,
            vcData
        );

        await member.voice.setChannel(channel).catch(() => {});

        await updateVCInterface(channel);

        await sendLog(
            guild,
            "Voice Channel Created",
            `${member} created **${channel.name}**.`
        );

        return channel;

    } catch (error) {
        console.error("[CREATE VC ERROR]", error);
        return null;
    }
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    if (!channel) return;

    const data = tempVCs.get(channel.id);

    if (!data) return;

    if (channel.members.size > 0) return;

    try {
        vcInterfaceLocks.delete(channel.id);

        await channel.delete(
            "Temporary VC became empty"
        );

        tempVCs.delete(channel.id);

        await sendLog(
            channel.guild,
            "Voice Channel Deleted",
            `Deleted empty temporary VC **${channel.name}**.`
        );

    } catch (error) {
        console.error("[VC DELETE ERROR]", error);

        tempVCs.delete(channel.id);
        vcInterfaceLocks.delete(channel.id);
    }
}

// ======================================================
// VC BAN
// ======================================================

async function applyVCBan(channel, userId) {
    const data = tempVCs.get(channel.id);

    if (!data) return;

    data.banned.add(userId);
    data.rejected.delete(userId);
    data.permitted.delete(userId);

    const member = channel.guild.members.cache.get(userId);

    if (member?.voice?.channelId === channel.id) {
        await member.voice.disconnect(
            "Banned from temporary VC"
        ).catch(() => {});
    }

    await channel.permissionOverwrites.edit(
        userId,
        {
            Connect: false
        }
    ).catch(() => {});

    saveDB();
}

async function removeVCBan(channel, userId) {
    const data = tempVCs.get(channel.id);

    if (!data) return;

    data.banned.delete(userId);

    await channel.permissionOverwrites.delete(
        userId
    ).catch(() => {});

    saveDB();
}

// ======================================================
// VC TARGET
// ======================================================

function getVCTarget(message) {
    return message.mentions.members.first() || null;
}

// ======================================================
// VC OWNER
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
    try {
        const channels = guild.channels.cache
            .filter(channel =>
                channel.type === ChannelType.GuildText &&
                channel.permissionsFor(guild.members.me)?.has(
                    PermissionFlagsBits.SendMessages
                )
            )
            .sort((a, b) => a.position - b.position);

        const channel = channels.first();

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("VC+")
            .setDescription(
`**VC+ has joined the server.**

A powerful voice-channel and moderation bot built around text commands.

### About VC+

VC+ provides:
• Join To Create voice channels
• Private VC controls
• Moderation
• Server logs
• Moderation logs
• Anti-nuke protection
• Word filtering
• Rank permissions
• Security protection

### Getting Started

\`${PREFIX}vc setup\`

Creates the Join To Create system and private logs.

### General

\`${PREFIX}help\`
\`${PREFIX}commands\`

### Voice Commands

\`${PREFIX}vc kick @user\`
\`${PREFIX}vc disconnect @user\`
\`${PREFIX}vc ban @user\`
\`${PREFIX}vc reject @user\`
\`${PREFIX}vc permit @user\`
\`${PREFIX}vc stfu @user\`
\`${PREFIX}vc unstfu @user\`
\`${PREFIX}vc lock\`
\`${PREFIX}vc unlock\`
\`${PREFIX}vc transfer @user\`
\`${PREFIX}vc claim\`
\`${PREFIX}vc forceclaim\`
\`${PREFIX}vc rename name\`
\`${PREFIX}vc limit amount\`

### Moderation

\`${PREFIX}ban @user reason\`
\`${PREFIX}unban userID\`
\`${PREFIX}banlist\`
\`${PREFIX}kick @user reason\`
\`${PREFIX}timeout @user minutes reason\`
\`${PREFIX}untimeout @user\`
\`${PREFIX}foreverban @user reason\`
\`${PREFIX}purge amount\`

### Ranks

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

### Filter

\`${PREFIX}filter on\`
\`${PREFIX}filter off\`
\`${PREFIX}filter add word\`
\`${PREFIX}filter remove word\`
\`${PREFIX}filter list\`

**Founder has the highest permission level.**`
            )
            .setFooter({
                text: "VC+ • Text commands only"
            })
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });

    } catch (error) {
        console.error("[WELCOME ERROR]", error);
    }
}

// ======================================================
// SETUP VC
// ======================================================

async function setupVC(guild) {
    const data = getGuildData(guild.id);

    await createLogSystem(guild);

    let existingJTC = null;

    if (data.jtc.channelId) {
        existingJTC = guild.channels.cache.get(
            data.jtc.channelId
        );
    }

    if (
        existingJTC &&
        existingJTC.type === ChannelType.GuildVoice
    ) {
        data.jtc.enabled = true;

        saveDB();

        return existingJTC;
    }

    let category = null;

    if (data.jtc.categoryId) {
        category = guild.channels.cache.get(
            data.jtc.categoryId
        );
    }

    if (!category) {
        category = await guild.channels.create({
            name: "Voice Channels",
            type: ChannelType.GuildCategory
        });

        data.jtc.categoryId = category.id;
    }

    const jtcChannel = await guild.channels.create({
        name: "Join To Create",
        type: ChannelType.GuildVoice,
        parent: category.id
    });

    data.jtc.enabled = true;
    data.jtc.channelId = jtcChannel.id;
    data.jtc.categoryId = category.id;

    saveDB();

    await sendLog(
        guild,
        "VC+ Setup",
        `Join To Create was configured by VC+ in **${guild.name}**.`
    );

    return jtcChannel;
}

// ======================================================
// FILTER SYSTEM
// ======================================================

async function handleFilteredMessage(message) {
    if (!message.guild) return false;

    if (message.author.bot) return false;

    const data = getGuildData(
        message.guild.id
    );

    if (!data.filter.enabled) return false;

    if (isGod(message.member)) return false;

    const content = message.content.toLowerCase();

    const matchedWord = data.filter.words.find(
        word =>
            word &&
            content.includes(word.toLowerCase())
    );

    if (!matchedWord) return false;

    await message.delete().catch(() => {});

    const userId = message.author.id;

    if (!data.filter.strikes[userId]) {
        data.filter.strikes[userId] = 0;
    }

    data.filter.strikes[userId]++;

    const strikes =
        data.filter.strikes[userId];

    if (data.filter.log) {
        await sendLog(
            message.guild,
            "Filter Triggered",
            `${message.author} triggered the word filter.\n\n` +
            `**Word:** \`${matchedWord}\`\n` +
            `**Strikes:** ${strikes}`,
            true
        );
    }

    if (
        strikes >= data.filter.maxStrikes
    ) {
        const member =
            message.guild.members.cache.get(userId);

        if (member) {
            await member.timeout(
                10 * 60 * 1000,
                "Exceeded VC+ filter strike limit"
            ).catch(() => {});

            await sendModerationDM(
                member.user,
                message.guild,
                "Timeout",
                "Exceeded the VC+ word filter strike limit.",
                "10 minutes"
            );
        }

        data.filter.strikes[userId] = 0;
    }

    saveDB();

    return true;
}

// ======================================================
// HELP
// ======================================================

function getHelpEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("VC+ Commands")
        .setDescription(
`## General

\`${PREFIX}help\`
\`${PREFIX}commands\`

## Voice

\`${PREFIX}vc setup\`
\`${PREFIX}vc kick @user\`
\`${PREFIX}vc disconnect @user\`
\`${PREFIX}vc ban @user\`
\`${PREFIX}vc reject @user\`
\`${PREFIX}vc permit @user\`
\`${PREFIX}vc stfu @user\`
\`${PREFIX}vc unstfu @user\`
\`${PREFIX}vc lock\`
\`${PREFIX}vc unlock\`
\`${PREFIX}vc transfer @user\`
\`${PREFIX}vc claim\`
\`${PREFIX}vc forceclaim\`
\`${PREFIX}vc rename name\`
\`${PREFIX}vc limit amount\`

## Moderation

\`${PREFIX}ban @user reason\`
\`${PREFIX}unban userID\`
\`${PREFIX}banlist\`
\`${PREFIX}kick @user reason\`
\`${PREFIX}timeout @user minutes reason\`
\`${PREFIX}untimeout @user\`
\`${PREFIX}foreverban @user reason\`
\`${PREFIX}purge amount\`

## Ranks

\`${PREFIX}rank @user rank\`
\`${PREFIX}godmode on/off\`

## Filter

\`${PREFIX}filter on\`
\`${PREFIX}filter off\`
\`${PREFIX}filter add word\`
\`${PREFIX}filter remove word\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on/off\`
\`${PREFIX}filter strikes amount\`
\`${PREFIX}filter reset @user\`

### Rank Hierarchy

Founder
God
Owner
Co Owner
Executive
Director
Admin
Moderator
Staff
Member`
        )
        .setFooter({
            text: "VC+ • Text commands only"
        });
}

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on("messageCreate", async message => {
    try {
        if (!message.guild) return;

        if (message.author.bot) return;

        // FILTER FIRST
        const filtered =
            await handleFilteredMessage(message);

        if (filtered) return;

        if (!message.content.startsWith(PREFIX)) {
            return;
        }

        const args = message.content
            .slice(PREFIX.length)
            .trim()
            .split(/\s+/);

        const command = args
            .shift()
            ?.toLowerCase();

        if (!command) return;

        // ==================================================
        // LOG EVERY COMMAND
        // ==================================================

        await sendLog(
            message.guild,
            "Command Used",
            `${message.author} used \`${PREFIX}${command}${args.length ? " " + args.join(" ") : ""}\` in ${message.channel}.`
        );

        // ==================================================
        // HELP
        // ==================================================

        if (
            command === "help" ||
            command === "commands"
        ) {
            return message.reply({
                embeds: [getHelpEmbed()]
            });
        }

        // ==================================================
        // VC COMMANDS
        // ==================================================

        if (command === "vc") {
            const subcommand =
                args.shift()?.toLowerCase();

            // ----------------------------------------------
            // VC SETUP
            // ----------------------------------------------

            if (subcommand === "setup") {
                if (!isGod(message.member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "You need **God** or **Founder** rank to use this command."
                            )
                        ]
                    });
                }

                const channel =
                    await setupVC(message.guild);

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC+ Setup Complete",
                            `Join To Create is ready: ${channel}`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // GET CURRENT VC
            // ----------------------------------------------

            const currentVC =
                message.member.voice.channel;

            const vcData =
                currentVC
                    ? tempVCs.get(currentVC.id)
                    : null;

            if (!currentVC || !vcData) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Not In A VC",
                            "You must be inside your personal VC to use this command."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // OWNER COMMAND CHECK
            // ----------------------------------------------

            const ownerCommands = [
                "kick",
                "disconnect",
                "ban",
                "reject",
                "permit",
                "lock",
                "unlock",
                "transfer",
                "claim",
                "rename",
                "limit"
            ];

            if (
                ownerCommands.includes(subcommand) &&
                !isVCOwner(message.member, vcData)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // TARGET
            // ----------------------------------------------

            const target =
                getVCTarget(message);

            // ----------------------------------------------
            // KICK
            // ----------------------------------------------

            if (subcommand === "kick") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the user you want to kick."
                            )
                        ]
                    });
                }

                await target.voice.disconnect(
                    "Kicked from VC"
                ).catch(() => {});

                await sendLog(
                    message.guild,
                    "VC Kick",
                    `${message.author} kicked ${target} from **${currentVC.name}**.`,
                    true
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Kicked",
                            `${target} was disconnected.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // DISCONNECT
            // ----------------------------------------------

            if (subcommand === "disconnect") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the user you want to disconnect."
                            )
                        ]
                    });
                }

                await target.voice.disconnect(
                    "Disconnected from VC"
                ).catch(() => {});

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Disconnected",
                            `${target} was disconnected.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // BAN
            // ----------------------------------------------

            if (subcommand === "ban") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the user you want to ban."
                            )
                        ]
                    });
                }

                await applyVCBan(
                    currentVC,
                    target.id
                );

                await sendLog(
                    message.guild,
                    "VC Ban",
                    `${message.author} banned ${target} from **${currentVC.name}**.`,
                    true
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Banned",
                            `${target} can no longer join this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // REJECT
            // ----------------------------------------------

            if (subcommand === "reject") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the user you want to reject."
                            )
                        ]
                    });
                }

                vcData.rejected.add(
                    target.id
                );

                await currentVC.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                if (
                    target.voice.channelId ===
                    currentVC.id
                ) {
                    await target.voice.disconnect(
                        "Rejected from VC"
                    ).catch(() => {});
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Rejected",
                            `${target} was rejected from this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // PERMIT
            // ----------------------------------------------

            if (subcommand === "permit") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the user you want to permit."
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

                vcData.permitted.add(
                    target.id
                );

                await currentVC.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect: true
                    }
                ).catch(() => {});

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Permitted",
                            `${target} can join this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // STFU
            // ----------------------------------------------

            if (subcommand === "stfu") {
                if (!isGod(message.member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only **God** or **Founder** can use STFU."
                            )
                        ]
                    });
                }

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

                vcData.stfu.add(
                    target.id
                );

                if (
                    target.voice.channelId ===
                    currentVC.id
                ) {
                    await target.voice.setMute(
                        true,
                        "VC+ STFU"
                    ).catch(() => {});
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Muted",
                            `${target} has been STFU'd.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNSTFU
            // ----------------------------------------------

            if (subcommand === "unstfu") {
                if (!isGod(message.member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only **God** or **Founder** can use UNSTFU."
                            )
                        ]
                    });
                }

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

                vcData.stfu.delete(
                    target.id
                );

                await target.voice.setMute(
                    false,
                    "VC+ UNSTFU"
                ).catch(() => {});

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "User Unmuted",
                            `${target} can speak again.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LOCK
            // ----------------------------------------------

            if (subcommand === "lock") {
                vcData.locked = true;

                await currentVC.permissionOverwrites.edit(
                    message.guild.roles.everyone.id,
                    {
                        Connect: false
                    }
                ).catch(() => {});

                await updateVCInterface(
                    currentVC
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Locked",
                            "New users can no longer join this VC."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // UNLOCK
            // ----------------------------------------------

            if (subcommand === "unlock") {
                vcData.locked = false;

                await currentVC.permissionOverwrites.delete(
                    message.guild.roles.everyone.id
                ).catch(() => {});

                await updateVCInterface(
                    currentVC
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Unlocked",
                            "Users can join the VC again."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // TRANSFER
            // ----------------------------------------------

            if (subcommand === "transfer") {
                if (!target) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing User",
                                "Mention the new VC owner."
                            )
                        ]
                    });
                }

                vcData.ownerId =
                    target.id;

                await updateVCInterface(
                    currentVC
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Ownership Transferred",
                            `${target} is now the owner of this VC.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // CLAIM
            // ----------------------------------------------

            if (subcommand === "claim") {
                if (
                    currentVC.members.has(
                        vcData.ownerId
                    )
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Cannot Claim",
                                "The current owner is still in the VC."
                            )
                        ]
                    });
                }

                vcData.ownerId =
                    message.member.id;

                await updateVCInterface(
                    currentVC
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Claimed",
                            "You are now the owner of this VC."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // FORCECLAIM
            // ----------------------------------------------

            if (subcommand === "forceclaim") {
                if (!isFounder(message.member)) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Permission Denied",
                                "Only **Founder** can force claim a VC."
                            )
                        ]
                    });
                }

                vcData.ownerId =
                    message.member.id;

                await updateVCInterface(
                    currentVC
                );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Force Claimed",
                            "You are now the owner of this VC."
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // RENAME
            // ----------------------------------------------

            if (subcommand === "rename") {
                const newName =
                    args.join(" ").trim();

                if (!newName) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Missing Name",
                                "Enter a new VC name."
                            )
                        ]
                    });
                }

                const safeName =
                    newName.slice(0, 100);

                await currentVC.setName(
                    safeName
                );

                await updateVCInterface(
                    currentVC
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Renamed",
                            `The VC is now **${safeName}**.`
                        )
                    ]
                });
            }

            // ----------------------------------------------
            // LIMIT
            // ----------------------------------------------

            if (subcommand === "limit") {
                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Limit",
                                "Use a number from **0 to 99**. Use `0` for unlimited."
                            )
                        ]
                    });
                }

                await currentVC.setUserLimit(
                    amount
                );

                await updateVCInterface(
                    currentVC
                );

                return message.reply({
                    embeds: [
                        successEmbed(
                            "VC Limit Updated",
                            amount === 0
                                ? "The VC is now unlimited."
                                : `The VC limit is now **${amount}**.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    errorEmbed(
                        "Unknown VC Command",
                        `Use \`${PREFIX}help\` to see all VC commands.`
                    )
                ]
            });
        }

        // ==================================================
        // BAN
        // ==================================================

        if (command === "ban") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
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
                getRankLevel(target) >=
                getRankLevel(message.member)
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Cannot Moderate",
                            "You cannot ban someone with an equal or higher rank."
                        )
                    ]
                });
            }

            const reason =
                args.slice(1).join(" ") ||
                "No reason provided";

            await sendModerationDM(
                target.user,
                message.guild,
                "Ban",
                reason
            );

            await target.ban({
                reason
            });

            await sendLog(
                message.guild,
                "Member Banned",
                `${message.author} banned ${target}.\n**Reason:** ${reason}`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Banned",
                        `${target} was banned.`
                    )
                ]
            });
        }

        // ==================================================
        // UNBAN
        // ==================================================

        if (command === "unban") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
                        )
                    ]
                });
            }

            const userId =
                args[0];

            if (!userId) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Missing User ID",
                            "Provide the user's ID."
                        )
                    ]
                });
            }

            await message.guild.members.unban(
                userId
            ).catch(() => null);

            await sendLog(
                message.guild,
                "Member Unbanned",
                `${message.author} unbanned **${userId}**.`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Unbanned",
                        `User ID **${userId}** was unbanned.`
                    )
                ]
            });
        }

        // ==================================================
        // BAN LIST
        // ==================================================

        if (command === "banlist") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
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
                            "There are currently no banned users."
                        )
                    ]
                });
            }

            const list =
                bans.map(
                    ban =>
                        `• ${ban.user.tag} — \`${ban.user.id}\``
                );

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Ban List",
                        list.slice(0, 50).join("\n")
                    )
                ]
            });
        }

        // ==================================================
        // KICK
        // ==================================================

        if (command === "kick") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
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

            const reason =
                args.slice(1).join(" ") ||
                "No reason provided";

            await sendModerationDM(
                target.user,
                message.guild,
                "Kick",
                reason
            );

            await target.kick(reason);

            await sendLog(
                message.guild,
                "Member Kicked",
                `${message.author} kicked ${target}.\n**Reason:** ${reason}`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Kicked",
                        `${target} was kicked.`
                    )
                ]
            });
        }

        // ==================================================
        // TIMEOUT
        // ==================================================

        if (command === "timeout") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
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

            const minutes =
                Number(args[1]);

            if (
                !Number.isFinite(minutes) ||
                minutes <= 0 ||
                minutes > 40320
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Duration",
                            "Enter a timeout from **1 to 40320 minutes**."
                        )
                    ]
                });
            }

            const reason =
                args.slice(2).join(" ") ||
                "No reason provided";

            await target.timeout(
                minutes * 60 * 1000,
                reason
            );

            await sendModerationDM(
                target.user,
                message.guild,
                "Timeout",
                reason,
                `${minutes} minutes`
            );

            await sendLog(
                message.guild,
                "Member Timed Out",
                `${message.author} timed out ${target} for **${minutes} minutes**.\n**Reason:** ${reason}`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "User Timed Out",
                        `${target} was timed out for **${minutes} minutes**.`
                    )
                ]
            });
        }

        // ==================================================
        // UNTIMEOUT
        // ==================================================

        if (command === "untimeout") {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
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

            await target.timeout(
                null,
                "Timeout removed by VC+"
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "Timeout Removed",
                        `${target} can speak normally again.`
                    )
                ]
            });
        }

        // ==================================================
        // FOREVER BAN
        // ==================================================

        if (command === "foreverban") {
            if (!isGod(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can use Forever Ban."
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

            const data =
                getGuildData(message.guild.id);

            if (
                !data.foreverBanned.includes(
                    target.id
                )
            ) {
                data.foreverBanned.push(
                    target.id
                );
            }

            const reason =
                args.slice(1).join(" ") ||
                "Forever banned by VC+";

            await sendModerationDM(
                target.user,
                message.guild,
                "Forever Ban",
                reason
            );

            await target.ban({
                reason
            });

            saveDB();

            await sendLog(
                message.guild,
                "Forever Ban",
                `${message.author} forever banned ${target}.\n**Reason:** ${reason}`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "Forever Ban Applied",
                        `${target} is now permanently blocked by VC+.`
                    )
                ]
            });
        }

        // ==================================================
        // PURGE / CLEAR
        // ==================================================

        if (
            command === "purge" ||
            command === "clear"
        ) {
            if (!canModerate(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need Moderator rank or higher."
                        )
                    ]
                });
            }

            const amount =
                Number(args[0]);

            if (
                !Number.isInteger(amount) ||
                amount < 1 ||
                amount > 100
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Amount",
                            "Choose a number from **1 to 100**."
                        )
                    ]
                });
            }

            const deleted =
                await message.channel.bulkDelete(
                    amount,
                    true
                );

            const response =
                await message.channel.send({
                    embeds: [
                        successEmbed(
                            "Messages Deleted",
                            `Deleted **${deleted.size}** messages.`
                        )
                    ]
                });

            setTimeout(() => {
                response.delete().catch(() => {});
            }, 5000);

            await sendLog(
                message.guild,
                "Messages Purged",
                `${message.author} deleted **${deleted.size}** messages in ${message.channel}.`,
                true
            );

            return;
        }

        // ==================================================
        // RANK
        // ==================================================

        if (command === "rank") {
            if (!isFounder(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **Founder** can assign ranks."
                        )
                    ]
                });
            }

            const target =
                message.mentions.members.first();

            const rank =
                normalizeRank(args[1]);

            if (!target || !rank) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage",
                            `Use \`${PREFIX}rank @user rank\``
                        )
                    ]
                });
            }

            if (!RANKS[rank]) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Invalid Rank",
                            "Available ranks:\n\n" +
                            Object.keys(RANKS)
                                .reverse()
                                .map(r => `• ${r}`)
                                .join("\n")
                        )
                    ]
                });
            }

            if (
                target.id === message.guild.ownerId
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Cannot Change",
                            "The server owner already has Founder-level authority."
                        )
                    ]
                });
            }

            getGuildData(
                message.guild.id
            ).ranks[target.id] = rank;

            saveDB();

            await sendLog(
                message.guild,
                "Rank Updated",
                `${message.author} gave ${target} the **${rank}** rank.`,
                true
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "Rank Updated",
                        `${target} is now **${rank}**.`
                    )
                ]
            });
        }

        // ==================================================
        // GODMODE
        // ==================================================

        if (command === "godmode") {
            if (!isFounder(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **Founder** can manage Godmode."
                        )
                    ]
                });
            }

            const state =
                args[0]?.toLowerCase();

            const data =
                getGuildData(
                    message.guild.id
                );

            if (
                state !== "on" &&
                state !== "off"
            ) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Usage",
                            `Use \`${PREFIX}godmode on\` or \`${PREFIX}godmode off\``
                        )
                    ]
                });
            }

            if (state === "on") {
                if (
                    !data.godmode.includes(
                        message.member.id
                    )
                ) {
                    data.godmode.push(
                        message.member.id
                    );
                }
            } else {
                data.godmode =
                    data.godmode.filter(
                        id =>
                            id !==
                            message.member.id
                    );
            }

            saveDB();

            return message.reply({
                embeds: [
                    successEmbed(
                        "Godmode Updated",
                        `Godmode is now **${state.toUpperCase()}**.`
                    )
                ]
            });
        }

        // ==================================================
        // FILTER
        // ==================================================

        if (command === "filter") {
            if (!isGod(message.member)) {
                return message.reply({
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "Only **God** or **Founder** can manage the filter."
                        )
                    ]
                });
            }

            const action =
                args.shift()?.toLowerCase();

            const data =
                getGuildData(
                    message.guild.id
                );

            // ON
            if (action === "on") {
                data.filter.enabled = true;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Filter Enabled",
                            "The word filter is now active."
                        )
                    ]
                });
            }

            // OFF
            if (action === "off") {
                data.filter.enabled = false;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Filter Disabled",
                            "The word filter is now disabled."
                        )
                    ]
                });
            }

            // ADD
            if (action === "add") {
                const word =
                    args.join(" ").trim().toLowerCase();

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
                    !data.filter.words.includes(
                        word
                    )
                ) {
                    data.filter.words.push(
                        word
                    );
                }

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Added",
                            `Added \`${word}\` to the filter.`
                        )
                    ]
                });
            }

            // REMOVE
            if (action === "remove") {
                const word =
                    args.join(" ").trim().toLowerCase();

                data.filter.words =
                    data.filter.words.filter(
                        item => item !== word
                    );

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Word Removed",
                            `Removed \`${word}\` from the filter.`
                        )
                    ]
                });
            }

            // LIST
            if (action === "list") {
                const words =
                    data.filter.words;

                return message.reply({
                    embeds: [
                        infoEmbed(
                            "Filtered Words",
                            words.length
                                ? words
                                    .map(
                                        word =>
                                            `• \`${word}\``
                                    )
                                    .join("\n")
                                : "No filtered words configured."
                        )
                    ]
                });
            }

            // LOG
            if (action === "log") {
                const state =
                    args[0]?.toLowerCase();

                if (
                    state !== "on" &&
                    state !== "off"
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage",
                                `Use \`${PREFIX}filter log on\` or \`${PREFIX}filter log off\``
                            )
                        ]
                    });
                }

                data.filter.log =
                    state === "on";

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Filter Logging Updated",
                            `Filter logging is now **${state.toUpperCase()}**.`
                        )
                    ]
                });
            }

            // STRIKES
            if (action === "strikes") {
                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 20
                ) {
                    return message.reply({
                        embeds: [
                            errorEmbed(
                                "Invalid Amount",
                                "Choose between **1 and 20** strikes."
                            )
                        ]
                    });
                }

                data.filter.maxStrikes =
                    amount;

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Strike Limit Updated",
                            `Users will be timed out after **${amount} strikes**.`
                        )
                    ]
                });
            }

            // RESET
            if (action === "reset") {
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

                delete data.filter.strikes[
                    target.id
                ];

                saveDB();

                return message.reply({
                    embeds: [
                        successEmbed(
                            "Strikes Reset",
                            `${target}'s filter strikes were reset.`
                        )
                    ]
                });
            }

            return message.reply({
                embeds: [
                    infoEmbed(
                        "Filter Commands",
` \`${PREFIX}filter on\`
\`${PREFIX}filter off\`
\`${PREFIX}filter add word\`
\`${PREFIX}filter remove word\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on/off\`
\`${PREFIX}filter strikes amount\`
\`${PREFIX}filter reset @user\``
                    )
                ]
            });
        }

    } catch (error) {
        console.error("[MESSAGE COMMAND ERROR]", error);

        try {
            await message.reply({
                embeds: [
                    errorEmbed(
                        "Command Error",
                        "Something went wrong while running that command."
                    )
                ]
            });
        } catch {}
    }
});

// ======================================================
// VOICE STATE HANDLER
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
                getGuildData(guild.id);

            // ==================================================
            // JOIN TO CREATE
            // ==================================================

            if (
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId &&
                oldState.channelId !==
                    newState.channelId
            ) {
                await createPersonalVC(
                    newState.member
                );

                return;
            }

            // ==================================================
            // JOINING A TEMP VC
            // ==================================================

            if (
                newState.channelId &&
                newState.channelId !==
                    data.jtc.channelId
            ) {
                const channel =
                    newState.channel;

                const vcData =
                    tempVCs.get(channel?.id);

                if (vcData) {
                    const member =
                        newState.member;

                    // BANNED
                    if (
                        vcData.banned.has(
                            member.id
                        )
                    ) {
                        await member.voice.disconnect(
                            "Banned from VC"
                        ).catch(() => {});

                        return;
                    }

                    // REJECTED
                    if (
                        vcData.rejected.has(
                            member.id
                        )
                    ) {
                        await member.voice.disconnect(
                            "Rejected from VC"
                        ).catch(() => {});

                        return;
                    }

                    // LOCKED
                    if (
                        vcData.locked &&
                        member.id !==
                            vcData.ownerId &&
                        !isFounder(member)
                    ) {
                        await member.voice.disconnect(
                            "VC is locked"
                        ).catch(() => {});

                        return;
                    }

                    // STFU
                    if (
                        vcData.stfu.has(
                            member.id
                        )
                    ) {
                        await member.voice.setMute(
                            true,
                            "VC+ STFU"
                        ).catch(() => {});
                    }

                    await updateVCInterface(
                        channel
                    );

                    await sendLog(
                        guild,
                        "VC Join",
                        `${member} joined **${channel.name}**.`
                    );
                }
            }

            // ==================================================
            // LEAVING A TEMP VC
            // ==================================================

            if (oldState.channelId) {
                const oldChannel =
                    oldState.channel;

                const oldData =
                    tempVCs.get(
                        oldState.channelId
                    );

                if (oldData) {
                    await updateVCInterface(
                        oldChannel
                    );

                    await sendLog(
                        guild,
                        "VC Leave",
                        `${oldState.member} left **${oldChannel.name}**.`
                    );

                    await deleteEmptyVC(
                        oldChannel
                    );
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

// ======================================================
// MEMBER JOIN
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
                await member.ban({
                    reason:
                        "VC+ Forever Ban protection"
                }).catch(() => {});

                await sendLog(
                    member.guild,
                    "Forever Ban Blocked",
                    `${member} attempted to join but is permanently blocked.`,
                    true
                );

                return;
            }

            await sendLog(
                member.guild,
                "Member Joined",
                `${member} joined the server.`
            );

        } catch (error) {
            console.error(
                "[MEMBER JOIN ERROR]",
                error
            );
        }
    }
);

// ======================================================
// MEMBER LEAVE
// ======================================================

client.on(
    "guildMemberRemove",
    async member => {
        try {
            await sendLog(
                member.guild,
                "Member Left",
                `**${member.user.tag}** left the server.`
            );
        } catch (error) {
            console.error(
                "[MEMBER LEAVE ERROR]",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL CREATE
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) return;

            await sendLog(
                channel.guild,
                "Channel Created",
                `A new channel was created: **${channel.name}**.`
            );

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
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

            await recordSecurityAction(
                channel.guild,
                executor,
                "channelCreate"
            );

        } catch (error) {
            console.error(
                "[CHANNEL CREATE ERROR]",
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
            if (!channel.guild) return;

            await sendLog(
                channel.guild,
                "Channel Deleted",
                `A channel was deleted: **${channel.name}**.`,
                true
            );

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
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

            await recordSecurityAction(
                channel.guild,
                executor,
                "channelDelete"
            );

        } catch (error) {
            console.error(
                "[CHANNEL DELETE ERROR]",
                error
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
        try {
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

            await recordSecurityAction(
                role.guild,
                executor,
                "roleCreate"
            );

        } catch (error) {
            console.error(
                "[ROLE CREATE ERROR]",
                error
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
        try {
            await sendLog(
                role.guild,
                "Role Deleted",
                `Role **${role.name}** was deleted.`,
                true
            );

            const data =
                getGuildData(
                    role.guild.id
                );

            if (
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

            await recordSecurityAction(
                role.guild,
                executor,
                "roleDelete"
            );

        } catch (error) {
            console.error(
                "[ROLE DELETE ERROR]",
                error
            );
        }
    }
);

// ======================================================
// AUDIT LOG EXECUTOR
// ======================================================

async function getAuditExecutor(
    guild,
    action
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type: action,
                limit: 1
            });

        const entry =
            logs.entries.first();

        if (!entry) return null;

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
// SECURITY TRACKER
// ======================================================

const auditTracker = new Map();

const SECURITY_LIMITS = {
    channelCreate: 5,
    channelDelete: 3,
    roleCreate: 5,
    roleDelete: 3
};

async function recordSecurityAction(
    guild,
    executor,
    action
) {
    if (!executor) return;

    const member =
        await guild.members
            .fetch(executor.id)
            .catch(() => null);

    if (!member) return;

    if (isTrustedExecutor(member)) {
        return;
    }

    const key =
        `${guild.id}:${executor.id}:${action}`;

    const now = Date.now();

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
            timestamp =>
                now - timestamp <
                30000
        );

    auditTracker.set(
        key,
        recent
    );

    const limit =
        SECURITY_LIMITS[action];

    if (
        limit &&
        recent.length >= limit
    ) {
        await securityPunish(
            guild,
            member,
            action
        );

        auditTracker.delete(key);
    }
}

// ======================================================
// SECURITY PUNISHMENT
// ======================================================

async function securityPunish(
    guild,
    member,
    action
) {
    try {
        const data =
            getGuildData(
                guild.id
            );

        if (
            !data.foreverBanned.includes(
                member.id
            )
        ) {
            data.foreverBanned.push(
                member.id
            );
        }

        saveDB();

        await sendLog(
            guild,
            "ANTI-NUKE TRIGGERED",
            `${member} triggered VC+ security protection.\n\n` +
            `**Action:** ${action}\n` +
            `**User:** ${member.user.tag}\n\n` +
            `The user has been permanently blocked.`,
            true
        );

        await member.ban({
            reason:
                `VC+ Anti-Nuke protection: ${action}`
        }).catch(() => {});

    } catch (error) {
        console.error(
            "[SECURITY PUNISH ERROR]",
            error
        );
    }
}

// ======================================================
// GUILD CREATE
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            getGuildData(guild.id);

            await sendWelcomeMessage(
                guild
            );

        } catch (error) {
            console.error(
                "[GUILD CREATE ERROR]",
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
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Serving ${client.guilds.cache.size} server(s)`
        );

        for (const guild of client.guilds.cache.values()) {
            getGuildData(guild.id);
        }

        client.user.setPresence({
            activities: [
                {
                    name: "VC+",
                    type: ActivityType.Watching
                }
            ],
            status: "online"
        });
    }
);

// ======================================================
// ERROR PROTECTION
// ======================================================

client.on(
    "error",
    error => {
        console.error(
            "[DISCORD CLIENT ERROR]",
            error
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

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

async function shutdown() {
    console.log(
        "[VC+] Shutting down..."
    );

    saveDB();

    for (
        const [channelId] of tempVCs
    ) {
        try {
            const channel =
                client.channels.cache.get(
                    channelId
                );

            if (
                channel &&
                channel.members.size === 0
            ) {
                await channel.delete(
                    "VC+ shutdown cleanup"
                ).catch(() => {});
            }
        } catch {}
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

const TOKEN =
    process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error(
        "ERROR: DISCORD_TOKEN is not set."
    );

    process.exit(1);
}

client.login(TOKEN);
