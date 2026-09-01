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
// DATA
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
            channelId: null
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
    } catch (error) {
        console.error("Database load error:", error);
        database = {};
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 4)
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

    const defaults = defaultGuildData();

    database[guildId] = {
        ...defaults,
        ...database[guildId],

        ranks: {
            ...defaults.ranks,
            ...(database[guildId].ranks || {})
        },

        roles: {
            ...defaults.roles,
            ...(database[guildId].roles || {})
        },

        jtc: {
            ...defaults.jtc,
            ...(database[guildId].jtc || {})
        },

        logs: {
            ...defaults.logs,
            ...(database[guildId].logs || {})
        },

        protection: {
            ...defaults.protection,
            ...(database[guildId].protection || {})
        },

        filter: {
            ...defaults.filter,
            ...(database[guildId].filter || {}),
            strikes: {
                ...((database[guildId].filter || {}).strikes || {})
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
// BASIC HELPERS
// ======================================================

function normalizeRank(rank) {
    if (!rank) return "member";

    return String(rank)
        .toLowerCase()
        .replace(/[^a-z]/g, "");
}

function getRankLevel(member) {
    if (!member) return 0;

    // ==================================================
    // SERVER OWNER = ABSOLUTE HIGHEST
    // ==================================================

    if (member.guild.ownerId === member.id) {
        return 10;
    }

    const data = getGuildData(member.guild.id);

    // Explicit rank assignment
    if (data.ranks[member.id]) {
        const explicit = normalizeRank(data.ranks[member.id]);

        if (RANKS[explicit]) {
            return RANKS[explicit];
        }
    }

    let highest = 1;

    // Configured role IDs
    for (const [rankName, roleId] of Object.entries(data.roles)) {
        if (!roleId) continue;

        if (member.roles.cache.has(roleId)) {
            const level = RANKS[normalizeRank(rankName)] || 1;

            highest = Math.max(highest, level);
        }
    }

    // Role names
    for (const role of member.roles.cache.values()) {
        const normalized = normalizeRank(role.name);

        if (RANKS[normalized]) {
            highest = Math.max(
                highest,
                RANKS[normalized]
            );
        }
    }

    // Administrator = Admin level
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
    return getRankLevel(member);
}

function getRankName(member) {
    return RANK_NAMES[getRankLevel(member)] || "Member";
}

function isServerOwner(member) {
    return !!member &&
        member.guild.ownerId === member.id;
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGod(member) {
    if (!member) return false;

    if (isServerOwner(member)) {
        return true;
    }

    if (getRankLevel(member) >= RANKS.god) {
        return true;
    }

    const data = getGuildData(member.guild.id);

    return data.godmode.includes(member.id);
}

function canModerate(member) {
    return getRankLevel(member) >= RANKS.moderator;
}

function isTrustedExecutor(member) {
    return isGod(member);
}

// ======================================================
// IMPORTANT TARGET PROTECTION
// ======================================================

function canModerateTarget(executor, target) {
    if (!executor || !target) {
        return false;
    }

    // ==============================================
    // SERVER OWNER CAN MODERATE EVERYONE
    // ==============================================

    if (isServerOwner(executor)) {
        // Still cannot target themselves
        return executor.id !== target.id;
    }

    // ==============================================
    // NOBODY CAN MODERATE SERVER OWNER
    // ==============================================

    if (isServerOwner(target)) {
        return false;
    }

    const executorLevel = getRankLevel(executor);
    const targetLevel = getRankLevel(target);

    // Must be strictly higher
    return executorLevel > targetLevel;
}

function canManageHighRank(executor, target) {
    if (!executor || !target) {
        return false;
    }

    // Only Server Owner can manage Server Owner
    if (isServerOwner(target)) {
        return isServerOwner(executor);
    }

    if (isServerOwner(executor)) {
        return true;
    }

    return getRankLevel(executor) > getRankLevel(target);
}

// ======================================================
// EMBEDS
// ======================================================

function vcEmbed(message, title = "VC+") {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: title
        })
        .setDescription(`✦ ${message}`)
        .setFooter({
            text: "VC+"
        })
        .setTimestamp();
}

function replySuccess(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text, "VC+")
        ]
    });
}

function replyError(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text, "VC+ ERROR")
        ]
    });
}

function replyInfo(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text, "VC+ INFO")
        ]
    });
}

function replyWarning(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text, "VC+ WARNING")
        ]
    });
}

// ======================================================
// LOGGING
// ONLY jailed-logs
// ======================================================

async function createLogSystem(guild) {
    const data = getGuildData(guild.id);

    let logChannel = null;

    if (data.logs.channelId) {
        logChannel = guild.channels.cache.get(
            data.logs.channelId
        );
    }

    if (!logChannel) {
        logChannel = guild.channels.cache.find(
            channel =>
                channel.type === ChannelType.GuildText &&
                channel.name === "jailed-logs"
        );
    }

    if (!logChannel) {
        try {
            logChannel = await guild.channels.create({
                name: "jailed-logs",
                type: ChannelType.GuildText,

                permissionOverwrites: [
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
            });
        } catch (error) {
            console.error(
                `Could not create jailed-logs in ${guild.name}:`,
                error
            );

            return null;
        }
    }

    data.logs.channelId = logChannel.id;
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
            await createLogSystem(guild);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setAuthor({
                name: `VC+ • ${type}`
            })
            .setDescription(description)
            .setFooter({
                text: "Jailed Logs"
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
\`${PREFIX}vc delete\`

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
\`${PREFIX}godmode on\`
\`${PREFIX}godmode off\`
\`${PREFIX}godmode @user on\`
\`${PREFIX}godmode @user off\`

**FILTER**

\`${PREFIX}filter on\`
\`${PREFIX}filter off\`
\`${PREFIX}filter add <word>\`
\`${PREFIX}filter remove <word>\`
\`${PREFIX}filter list\`
\`${PREFIX}filter log on\`
\`${PREFIX}filter log off\`
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

━━━━━━━━━━━━━━━━━━━━

**SERVER OWNER**

The Server Owner is always the highest authority.

The Server Owner can moderate any role,
including the highest role in the server.

Nobody can moderate the Server Owner.
        `)
        .setFooter({
            text: "VC+"
        });
}

// ======================================================
// VC INTERFACE
// ======================================================

function buildVCInterface(channel) {
    const data = getVCData(channel.id);

    if (!data) {
        return {
            embeds: [
                vcEmbed(
                    "This voice channel is no longer managed by VC+."
                )
            ],
            components: []
        };
    }

    const owner = channel.guild.members.cache.get(
        data.ownerId
    );

    const status = data.locked
        ? "Locked"
        : "Unlocked";

    const ownerText = owner
        ? `<@${owner.id}>`
        : "Unknown";

    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+ • Voice Control"
        })
        .setDescription(`
**OWNER**
${ownerText}

**STATUS**
${status}

**MEMBERS**
${channel.members.size}

━━━━━━━━━━━━━━━━━━━━

Use the buttons below to manage this VC.
        `)
        .setFooter({
            text: "VC+"
        });

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `vcplus:lock:${channel.id}`
                )
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:unlock:${channel.id}`
                )
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:kick:${channel.id}`
                )
                .setLabel("Kick")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:ban:${channel.id}`
                )
                .setLabel("Ban")
                .setStyle(ButtonStyle.Danger)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `vcplus:permit:${channel.id}`
                )
                .setLabel("Permit")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:rename:${channel.id}`
                )
                .setLabel("Rename")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:limit:${channel.id}`
                )
                .setLabel("Limit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:transfer:${channel.id}`
                )
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Primary)
        );

    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `vcplus:claim:${channel.id}`
                )
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:stfu:${channel.id}`
                )
                .setLabel("STFU")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:unstfu:${channel.id}`
                )
                .setLabel("UnSTFU")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    `vcplus:delete:${channel.id}`
                )
                .setLabel("Delete VC")
                .setStyle(ButtonStyle.Danger)
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

async function sendVCInterface(channel) {
    try {
        if (
            !channel ||
            channel.type !== ChannelType.GuildVoice
        ) {
            return;
        }

        if (typeof channel.send !== "function") {
            console.error(
                `Voice channel ${channel.id} does not support text chat sending.`
            );
            return;
        }

        const data = getVCData(channel.id);

        if (!data) return;

        const message = await channel.send(
            buildVCInterface(channel)
        );

        data.interfaceMessageId = message.id;
    } catch (error) {
        console.error(
            "Could not send VC interface:",
            error
        );
    }
}

async function refreshVCInterface(channel) {
    try {
        const data = getVCData(channel.id);

        if (!data?.interfaceMessageId) {
            return;
        }

        if (
            !channel.messages ||
            typeof channel.messages.fetch !== "function"
        ) {
            return;
        }

        const message =
            await channel.messages.fetch(
                data.interfaceMessageId
            );

        await message.edit(
            buildVCInterface(channel)
        );
    } catch (error) {
        // Panel may have been deleted.
    }
}

// ======================================================
// USER RESOLUTION
// ======================================================

function extractUserId(input) {
    if (!input) return null;

    const match = String(input).match(
        /\d{17,20}/
    );

    return match ? match[0] : null;
}

async function resolveMember(guild, input) {
    if (!input) return null;

    const id = extractUserId(input);

    if (!id) return null;

    try {
        return await guild.members.fetch(id);
    } catch {
        return null;
    }
}

// ======================================================
// MODALS
// ======================================================

function createTargetModal(
    action,
    channelId,
    title
) {
    const modal = new ModalBuilder()
        .setCustomId(
            `vcplusmodal:${action}:${channelId}`
        )
        .setTitle(title);

    const input =
        new TextInputBuilder()
            .setCustomId("target")
            .setLabel("User ID or @mention")
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(true)
            .setPlaceholder(
                "123456789012345678"
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(input)
    );

    return modal;
}

function createRenameModal(channelId) {
    const modal = new ModalBuilder()
        .setCustomId(
            `vcplusmodal:rename:${channelId}`
        )
        .setTitle("Rename Voice Channel");

    const input =
        new TextInputBuilder()
            .setCustomId("name")
            .setLabel("New channel name")
            .setStyle(
                TextInputStyle.Short
            )
            .setMaxLength(100)
            .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(input)
    );

    return modal;
}

function createLimitModal(channelId) {
    const modal = new ModalBuilder()
        .setCustomId(
            `vcplusmodal:limit:${channelId}`
        )
        .setTitle("Set Voice Limit");

    const input =
        new TextInputBuilder()
            .setCustomId("limit")
            .setLabel("Limit 0-99")
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(true)
            .setPlaceholder("0");

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(input)
    );

    return modal;
}

// ======================================================
// JTC
// ======================================================

async function setupJTC(guild) {
    const data = getGuildData(guild.id);

    let category = null;

    if (data.jtc.categoryId) {
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
            await guild.channels.create({
                name: "Voice Channels",
                type: ChannelType.GuildCategory
            });
    }

    let joinChannel = null;

    if (data.jtc.channelId) {
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
            await guild.channels.create({
                name: "Join To Create",
                type: ChannelType.GuildVoice,
                parent: category.id
            });
    }

    data.jtc.enabled = true;
    data.jtc.channelId = joinChannel.id;
    data.jtc.categoryId = category.id;

    saveDatabase();

    await sendLog(
        guild,
        "JTC",
        `Join To Create was configured by VC+.`
    );

    return {
        category,
        joinChannel
    };
}

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (!category) return null;

    const safeName =
        member.user.username
            .replace(/[^\w\- ]/g, "")
            .slice(0, 70) || "User";

    const channel =
        await guild.channels.create({
            name: `${safeName} VC`,
            type: ChannelType.GuildVoice,
            parent: category.id,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect
                    ]
                },

                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect
                    ]
                }
            ]
        });

    const vcData = createVCData(
        guild.id,
        member.id
    );

    tempVCs.set(
        channel.id,
        vcData
    );

    await sendVCInterface(channel);

    try {
        await member.voice.setChannel(
            channel
        );
    } catch (error) {
        console.error(
            "Could not move member into VC:",
            error
        );
    }

    await sendLog(
        guild,
        "VC CREATE",
        `${member} created ${channel.name}.`
    );

    return channel;
}

// ======================================================
// VC PERMISSION HELPERS
// ======================================================

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

async function lockVC(channel, vcData) {
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

    for (const userId of vcData.permitted) {
        await permitUserInVC(
            channel,
            userId
        );
    }
}

async function unlockVC(channel, vcData) {
    vcData.locked = false;

    await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        {
            ViewChannel: true,
            Connect: true
        }
    );

    for (const userId of vcData.banned) {
        await denyUserFromVC(
            channel,
            userId
        );
    }

    for (const userId of vcData.rejected) {
        await denyUserFromVC(
            channel,
            userId
        );
    }
}

// ======================================================
// VC COMMAND PERMISSION
// ======================================================

function canControlVC(member, channel) {
    const data = getVCData(channel.id);

    if (!data) return false;

    if (isServerOwner(member)) {
        return true;
    }

    if (isFounder(member)) {
        return true;
    }

    return data.ownerId === member.id;
}

function canSTFU(member) {
    return isGod(member);
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

            const data =
                getGuildData(
                    message.guild.id
                );

            // ==========================================
            // FILTER
            // ==========================================

            if (
                data.filter.enabled &&
                !message.content.startsWith(PREFIX)
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

                    if (data.filter.log) {
                        await sendLog(
                            message.guild,
                            "FILTER",
                            `${message.author} triggered the word filter.\nWord: \`${matched}\`\nStrike: ${data.filter.strikes[message.author.id]}/${data.filter.maxStrikes}`
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
            // COMMAND CHECK
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
                args.shift()?.toLowerCase();

            if (!command) return;

            // ==========================================
            // HELP
            // ==========================================

            if (
                command === "help" ||
                command === "commands"
            ) {
                return message.reply({
                    embeds: [helpEmbed()]
                });
            }

            // ==========================================
            // VC COMMANDS
            // ==========================================

            if (command === "vc") {
                const sub =
                    args.shift()?.toLowerCase();

                // --------------------------------------
                // SETUP
                // --------------------------------------

                if (sub === "setup") {
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
                    !getVCData(channel.id)
                ) {
                    return replyError(
                        message,
                        "You must be inside a VC+ personal voice channel."
                    );
                }

                const vcData =
                    getVCData(channel.id);

                // --------------------------------------
                // LOCK
                // --------------------------------------

                if (sub === "lock") {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
                        );
                    }

                    await lockVC(
                        channel,
                        vcData
                    );

                    await refreshVCInterface(
                        channel
                    );

                    await sendLog(
                        message.guild,
                        "VC LOCK",
                        `${message.author} locked ${channel.name}.`
                    );

                    return replySuccess(
                        message,
                        "Voice channel locked."
                    );
                }

                // --------------------------------------
                // UNLOCK
                // --------------------------------------

                if (sub === "unlock") {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
                        );
                    }

                    await unlockVC(
                        channel,
                        vcData
                    );

                    await refreshVCInterface(
                        channel
                    );

                    await sendLog(
                        message.guild,
                        "VC UNLOCK",
                        `${message.author} unlocked ${channel.name}.`
                    );

                    return replySuccess(
                        message,
                        "Voice channel unlocked."
                    );
                }

                // --------------------------------------
                // RENAME
                // --------------------------------------

                if (sub === "rename") {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
                        );
                    }

                    const name =
                        args.join(" ").trim();

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

                // --------------------------------------
                // LIMIT
                // --------------------------------------

                if (sub === "limit") {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
                        );
                    }

                    const limit =
                        Number(args[0]);

                    if (
                        !Number.isInteger(limit) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        return replyError(
                            message,
                            "VC limit must be between **0 and 99**."
                        );
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    return replySuccess(
                        message,
                        `VC user limit set to **${limit}**.`
                    );
                }

                // --------------------------------------
                // CLAIM
                // --------------------------------------

                if (sub === "claim") {
                    if (
                        channel.members.has(
                            vcData.ownerId
                        )
                    ) {
                        return replyError(
                            message,
                            "The current VC owner is still inside the channel."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    await channel.permissionOverwrites.edit(
                        message.author.id,
                        {
                            ViewChannel: true,
                            Connect: true
                        }
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return replySuccess(
                        message,
                        "You are now the VC owner."
                    );
                }

                // --------------------------------------
                // FORCECLAIM
                // --------------------------------------

                if (sub === "forceclaim") {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only **Founder** can force claim a VC."
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

                // --------------------------------------
                // DELETE
                // --------------------------------------

                if (
                    sub === "delete" ||
                    sub === "destroy"
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
                        );
                    }

                    tempVCs.delete(
                        channel.id
                    );

                    await sendLog(
                        message.guild,
                        "VC DELETE",
                        `${message.author} deleted ${channel.name}.`
                    );

                    await channel.delete(
                        "VC+ VC deletion"
                    );

                    return;
                }

                // --------------------------------------
                // TARGET COMMANDS
                // --------------------------------------

                if (
                    [
                        "kick",
                        "disconnect",
                        "ban",
                        "reject",
                        "permit",
                        "transfer"
                    ].includes(sub)
                ) {
                    if (
                        !canControlVC(
                            message.member,
                            channel
                        )
                    ) {
                        return replyError(
                            message,
                            "You do not control this voice channel."
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

                    // KICK
                    if (
                        sub === "kick" ||
                        sub === "disconnect"
                    ) {
                        if (
                            !channel.members.has(
                                target.id
                            )
                        ) {
                            return replyError(
                                message,
                                "That member is not in this VC."
                            );
                        }

                        await target.voice.setChannel(
                            null
                        );

                        await sendLog(
                            message.guild,
                            "VC KICK",
                            `${message.author} kicked ${target} from ${channel.name}.`
                        );

                        return replySuccess(
                            message,
                            `${target} was disconnected.`
                        );
                    }

                    // BAN
                    if (sub === "ban") {
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

                        await sendLog(
                            message.guild,
                            "VC BAN",
                            `${message.author} banned ${target} from ${channel.name}.`
                        );

                        return replySuccess(
                            message,
                            `${target} is banned from this VC.`
                        );
                    }

                    // REJECT
                    if (sub === "reject") {
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

                    // PERMIT
                    if (sub === "permit") {
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
                            `${target} has been permitted to join this VC.`
                        );
                    }

                    // TRANSFER
                    if (sub === "transfer") {
                        if (
                            !channel.members.has(
                                target.id
                            )
                        ) {
                            return replyError(
                                message,
                                "The target must be inside your VC."
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

                // --------------------------------------
                // STFU
                // --------------------------------------

                if (sub === "stfu") {
                    if (
                        !canSTFU(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only **God** or **Founder** can use VC STFU."
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
                        `${target} is now server muted in this VC.`
                    );
                }

                // --------------------------------------
                // UNSTFU
                // --------------------------------------

                if (sub === "unstfu") {
                    if (
                        !canSTFU(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only **God** or **Founder** can use VC UnSTFU."
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

            if (command === "ban") {
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

                const reason =
                    args
                        .slice(
                            message.mentions.members.first()
                                ? 1
                                : 1
                        )
                        .join(" ") ||
                    "No reason provided";

                // ======================================
                // SERVER OWNER OVERRIDE
                // ======================================

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
                        `${message.author} banned ${target.user.tag}.\nReason: ${reason}`
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
                        "I could not ban that member. Make sure VC+ has the correct permissions and role position."
                    );
                }
            }

            // ==========================================
            // KICK
            // ==========================================

            if (command === "kick") {
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
                        "You cannot kick this member because their rank is equal to or higher than yours."
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
                        `${message.author} kicked ${target.user.tag}.\nReason: ${reason}`
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

            if (command === "timeout") {
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
                        "You cannot timeout this member because their rank is equal to or higher than yours."
                    );
                }

                const minutes =
                    Number(
                        args[
                            message.mentions.members.first()
                                ? 1
                                : 1
                        ]
                    );

                if (
                    !Number.isFinite(minutes) ||
                    minutes <= 0 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Timeout must be between 1 minute and 28 days."
                    );
                }

                const reason =
                    args
                        .slice(2)
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
                        `${message.author} timed out ${target.user.tag} for ${minutes} minutes.\nReason: ${reason}`
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

            if (command === "untimeout") {
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

            if (command === "foreverban") {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only **Founder** or **God** can use foreverban."
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
                        reason: `Foreverban: ${reason}`
                    });
                } catch {}

                await sendLog(
                    message.guild,
                    "FOREVERBAN",
                    `${message.author} foreverbanned ${target.user.tag}.\nReason: ${reason}`
                );

                return replySuccess(
                    message,
                    `**${target.user.tag}** has been permanently added to the foreverban list.`
                );
            }

            // ==========================================
            // UNBAN
            // ==========================================

            if (command === "unban") {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only **Founder** or **God** can unban users."
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
                                id !== userId
                        );

                    saveDatabase();

                    await sendLog(
                        message.guild,
                        "UNBAN",
                        `${message.author} unbanned ${userId}.`
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

            if (command === "banlist") {
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

                    if (!bans.size) {
                        return replyInfo(
                            message,
                            "The server has no banned users."
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
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
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
                            response
                                .delete()
                                .catch(() => {}),
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

            if (command === "rank") {
                // ONLY SERVER OWNER CAN ASSIGN RANKS
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

                const rank =
                    normalizeRank(
                        args[
                            message.mentions.members.first()
                                ? 1
                                : 1
                        ]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "I could not find that member."
                    );
                }

                if (
                    !RANKS[rank]
                ) {
                    return replyError(
                        message,
                        "Invalid rank. Use Founder, God, Owner, Co Owner, Executive, Director, Admin, Moderator, Staff, or Member."
                    );
                }

                // Nobody can assign Founder
                // because server owner is the true owner.
                if (
                    rank === "founder"
                ) {
                    return replyError(
                        message,
                        "The Founder position belongs to the Server Owner."
                    );
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDatabase();

                await sendLog(
                    message.guild,
                    "RANK",
                    `${message.author} assigned ${RANK_NAMES[RANKS[rank]]} to ${target}.`
                );

                return replySuccess(
                    message,
                    `${target} is now **${RANK_NAMES[RANKS[rank]]}**.`
                );
            }

            // ==========================================
            // GODMODE
            // ==========================================

            if (command === "godmode") {
                if (
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the **Server Owner** can give or remove Godmode."
                    );
                }

                const possibleTarget =
                    message.mentions.members.first();

                const target =
                    possibleTarget ||
                    message.member;

                let state;

                if (
                    possibleTarget
                ) {
                    state =
                        args[1]?.toLowerCase();
                } else {
                    state =
                        args[0]?.toLowerCase();
                }

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
                                id !== target.id
                        );
                }

                saveDatabase();

                await sendLog(
                    message.guild,
                    "GODMODE",
                    `${message.author} turned Godmode **${state}** for ${target}.`
                );

                return replySuccess(
                    message,
                    `Godmode **${state}** for ${target}.`
                );
            }

            // ==========================================
            // FILTER
            // ==========================================

            if (command === "filter") {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only **Founder** or **God** can manage the filter."
                    );
                }

                const sub =
                    args.shift()?.toLowerCase();

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
                            "Give me a word to add."
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
                                item !== word
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
                        Number(args[0]);

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
                        `Maximum strikes set to **${strikes}**.`
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
                    "Use `-help` to see filter commands."
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
// BUTTON INTERACTIONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isButton()
            ) {
                if (
                    !interaction.isModalSubmit()
                ) {
                    return;
                }
            }

            // ==========================================
            // BUTTONS
            // ==========================================

            if (
                interaction.isButton()
            ) {
                const parts =
                    interaction.customId.split(":");

                if (
                    parts[0] !==
                    "vcplus"
                ) {
                    return;
                }

                const action =
                    parts[1];

                const channelId =
                    parts[2];

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                if (
                    !channel ||
                    channel.type !==
                        ChannelType.GuildVoice
                ) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This VC no longer exists.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                }

                const vcData =
                    getVCData(channel.id);

                if (!vcData) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This is not a VC+ managed channel.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                }

                // ======================================
                // LOCK
                // ======================================

                if (
                    action === "lock"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await lockVC(
                        channel,
                        vcData
                    );

                    await interaction.update(
                        buildVCInterface(
                            channel
                        )
                    );

                    await sendLog(
                        interaction.guild,
                        "VC LOCK",
                        `${interaction.user} locked ${channel.name}.`
                    );

                    return;
                }

                // ======================================
                // UNLOCK
                // ======================================

                if (
                    action === "unlock"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await unlockVC(
                        channel,
                        vcData
                    );

                    await interaction.update(
                        buildVCInterface(
                            channel
                        )
                    );

                    return;
                }

                // ======================================
                // CLAIM
                // ======================================

                if (
                    action === "claim"
                ) {
                    if (
                        channel.members.has(
                            vcData.ownerId
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "The current owner is still in the VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.ownerId =
                        interaction.user.id;

                    await interaction.update(
                        buildVCInterface(
                            channel
                        )
                    );

                    return;
                }

                // ======================================
                // DELETE
                // ======================================

                if (
                    action === "delete"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "Deleting the VC...",
                                "VC+"
                            )
                        ],
                        ephemeral: true
                    });

                    tempVCs.delete(
                        channel.id
                    );

                    await sendLog(
                        interaction.guild,
                        "VC DELETE",
                        `${interaction.user} deleted ${channel.name}.`
                    );

                    await channel.delete(
                        "VC+ interface delete"
                    );

                    return;
                }

                // ======================================
                // MODALS
                // ======================================

                if (
                    [
                        "kick",
                        "ban",
                        "permit",
                        "transfer",
                        "stfu",
                        "unstfu"
                    ].includes(action)
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        ) &&
                        !(
                            [
                                "stfu",
                                "unstfu"
                            ].includes(action) &&
                            canSTFU(
                                interaction.member
                            )
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not have permission to use this control.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    return interaction.showModal(
                        createTargetModal(
                            action,
                            channel.id,
                            action.toUpperCase()
                        )
                    );
                }

                if (
                    action === "rename"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    return interaction.showModal(
                        createRenameModal(
                            channel.id
                        )
                    );
                }

                if (
                    action === "limit"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    return interaction.showModal(
                        createLimitModal(
                            channel.id
                        )
                    );
                }
            }

            // ==========================================
            // MODAL SUBMISSIONS
            // ==========================================

            if (
                interaction.isModalSubmit()
            ) {
                const parts =
                    interaction.customId.split(":");

                if (
                    parts[0] !==
                    "vcplusmodal"
                ) {
                    return;
                }

                const action =
                    parts[1];

                const channelId =
                    parts[2];

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                if (
                    !channel ||
                    channel.type !==
                        ChannelType.GuildVoice
                ) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This VC no longer exists.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                }

                const vcData =
                    getVCData(channel.id);

                if (!vcData) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This is not a VC+ channel.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                }

                // ======================================
                // TARGET
                // ======================================

                if (
                    [
                        "kick",
                        "ban",
                        "permit",
                        "transfer",
                        "stfu",
                        "unstfu"
                    ].includes(action)
                ) {
                    const input =
                        interaction.fields.getTextInputValue(
                            "target"
                        );

                    const target =
                        await resolveMember(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "I could not find that member.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // STFU
                    // ==================================

                    if (
                        action === "stfu"
                    ) {
                        if (
                            !canSTFU(
                                interaction.member
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "Only God or Founder can use STFU.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        if (
                            target.voice.channelId !==
                            channel.id
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "That member is not in this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        vcData.stfu.add(
                            target.id
                        );

                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        );

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `${target} is now server muted.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // UNSTFU
                    // ==================================

                    if (
                        action === "unstfu"
                    ) {
                        if (
                            !canSTFU(
                                interaction.member
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "Only God or Founder can use UnSTFU.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
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

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `${target} has been unmuted.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // KICK
                    // ==================================

                    if (
                        action === "kick"
                    ) {
                        if (
                            !canControlVC(
                                interaction.member,
                                channel
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "You do not control this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        if (
                            target.voice.channelId !==
                            channel.id
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "That member is not in this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        await target.voice.setChannel(
                            null
                        );

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `${target} was disconnected.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // BAN
                    // ==================================

                    if (
                        action === "ban"
                    ) {
                        if (
                            !canControlVC(
                                interaction.member,
                                channel
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "You do not control this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

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

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `${target} is now banned from this VC.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // PERMIT
                    // ==================================

                    if (
                        action === "permit"
                    ) {
                        if (
                            !canControlVC(
                                interaction.member,
                                channel
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "You do not control this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

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

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `${target} has been permitted.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    // ==================================
                    // TRANSFER
                    // ==================================

                    if (
                        action === "transfer"
                    ) {
                        if (
                            !canControlVC(
                                interaction.member,
                                channel
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "You do not control this VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        if (
                            !channel.members.has(
                                target.id
                            )
                        ) {
                            return interaction.reply({
                                embeds: [
                                    vcEmbed(
                                        "The target must be inside the VC.",
                                        "VC+ ERROR"
                                    )
                                ],
                                ephemeral: true
                            });
                        }

                        vcData.ownerId =
                            target.id;

                        await refreshVCInterface(
                            channel
                        );

                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    `Ownership transferred to ${target}.`,
                                    "VC+"
                                )
                            ],
                            ephemeral: true
                        });
                    }
                }

                // ======================================
                // RENAME
                // ======================================

                if (
                    action === "rename"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const name =
                        interaction.fields
                            .getTextInputValue(
                                "name"
                            )
                            .trim();

                    if (!name) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Enter a channel name.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await channel.setName(
                        name.slice(0, 100)
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `VC renamed to **${name.slice(0, 100)}**.`,
                                "VC+"
                            )
                        ],
                        ephemeral: true
                    });
                }

                // ======================================
                // LIMIT
                // ======================================

                if (
                    action === "limit"
                ) {
                    if (
                        !canControlVC(
                            interaction.member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const limit =
                        Number(
                            interaction.fields
                                .getTextInputValue(
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
                            embeds: [
                                vcEmbed(
                                    "Limit must be between 0 and 99.",
                                    "VC+ ERROR"
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    await refreshVCInterface(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `VC limit set to **${limit}**.`,
                                "VC+"
                            )
                        ],
                        ephemeral: true
                    });
                }
            }
        } catch (error) {
            console.error(
                "Interaction error:",
                error
            );

            try {
                if (
                    interaction.replied ||
                    interaction.deferred
                ) {
                    await interaction.followUp({
                        embeds: [
                            vcEmbed(
                                "Something went wrong while processing that action.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "Something went wrong while processing that action.",
                                "VC+ ERROR"
                            )
                        ],
                        ephemeral: true
                    });
                }
            } catch {}
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

            const member =
                newState.member ||
                oldState.member;

            if (!member) return;

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
            // ENTER MANAGED VC
            // ==========================================

            const newVCData =
                newState.channelId
                    ? getVCData(
                          newState.channelId
                      )
                    : null;

            if (newVCData) {
                const channel =
                    newState.channel;

                // Banned
                if (
                    newVCData.banned.has(
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

                // Rejected
                if (
                    newVCData.rejected.has(
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

                // Locked
                if (
                    newVCData.locked &&
                    member.id !==
                        newVCData.ownerId &&
                    !newVCData.permitted.has(
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

                // STFU
                if (
                    newVCData.stfu.has(
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

            // ==========================================
            // LEAVING MANAGED VC
            // ==========================================

            if (
                oldState.channelId
            ) {
                const oldVCData =
                    getVCData(
                        oldState.channelId
                    );

                if (oldVCData) {
                    const oldChannel =
                        oldState.channel;

                    // Delete when empty
                    if (
                        oldChannel &&
                        oldChannel.members.size === 0
                    ) {
                        tempVCs.delete(
                            oldChannel.id
                        );

                        await sendLog(
                            guild,
                            "VC DELETE",
                            `${oldChannel.name} was deleted because it became empty.`
                        );

                        try {
                            await oldChannel.delete(
                                "VC+ empty personal VC"
                            );
                        } catch {}
                    }
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
    async (oldState, newState) => {
        try {
            const channel =
                newState.channel;

            if (!channel) return;

            const vcData =
                getVCData(
                    channel.id
                );

            if (!vcData) return;

            if (
                vcData.stfu.has(
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
// FOREVERBAN JOIN PROTECTION
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
                    `${member.user.tag} attempted to join but was automatically banned.`
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
// GUILD BAN ADD
// ======================================================

client.on(
    "guildBanAdd",
    async ban => {
        try {
            const data =
                getGuildData(
                    ban.guild.id
                );

            if (
                data.foreverBanned.includes(
                    ban.user.id
                )
            ) {
                return;
            }

            await sendLog(
                ban.guild,
                "BAN",
                `${ban.user.tag} was banned from the server.`
            );
        } catch {}
    }
);

// ======================================================
// ANTI-NUKE AUDIT HELPER
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
    } catch (error) {
        console.error(
            "Audit log error:",
            error
        );

        return null;
    }
}

// ======================================================
// ANTI-NUKE: CHANNEL CREATE
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) return;

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
                await getRecentAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                isTrustedExecutor(member)
            ) {
                await sendLog(
                    channel.guild,
                    "SECURITY",
                    `${executor.tag} created channel **${channel.name}**.`
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
                "channelCreate protection error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE: CHANNEL DELETE
// ======================================================

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) return;

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
                await getRecentAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                isTrustedExecutor(member)
            ) {
                await sendLog(
                    channel.guild,
                    "SECURITY",
                    `${executor.tag} deleted channel **${channel.name}**.`
                );

                return;
            }

            await sendLog(
                channel.guild,
                "ANTI-NUKE",
                `Unauthorized channel deletion by **${executor.tag}**.\nChannel: \`${channel.name}\``
            );
        } catch (error) {
            console.error(
                "channelDelete protection error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE: ROLE CREATE
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

            if (
                !data.protection.roleCreate
            ) {
                return;
            }

            const executor =
                await getRecentAuditExecutor(
                    guild,
                    AuditLogEvent.RoleCreate
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                isTrustedExecutor(member)
            ) {
                await sendLog(
                    guild,
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
                guild,
                "ANTI-NUKE",
                `Unauthorized role creation by **${executor.tag}**.\nRole: \`${role.name}\`\nAction: Role deleted.`
            );
        } catch (error) {
            console.error(
                "roleCreate protection error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE: ROLE DELETE
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

            if (
                !data.protection.roleDelete
            ) {
                return;
            }

            const executor =
                await getRecentAuditExecutor(
                    guild,
                    AuditLogEvent.RoleDelete
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                isTrustedExecutor(member)
            ) {
                await sendLog(
                    guild,
                    "SECURITY",
                    `${executor.tag} deleted role **${role.name}**.`
                );

                return;
            }

            await sendLog(
                guild,
                "ANTI-NUKE",
                `Unauthorized role deletion by **${executor.tag}**.\nRole: \`${role.name}\``
            );
        } catch (error) {
            console.error(
                "roleDelete protection error:",
                error
            );
        }
    }
);

// ======================================================
// ANTI-NUKE: WEBHOOK
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

            const executor =
                await getRecentAuditExecutor(
                    guild,
                    AuditLogEvent.WebhookCreate
                );

            if (!executor) return;

            if (
                executor.id ===
                client.user.id
            ) {
                return;
            }

            const member =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                isTrustedExecutor(member)
            ) {
                await sendLog(
                    guild,
                    "SECURITY",
                    `${executor.tag} created or modified a webhook.`
                );

                return;
            }

            await sendLog(
                guild,
                "ANTI-NUKE",
                `Unauthorized webhook activity by **${executor.tag}**.\nChannel: ${channel}`
            );
        } catch (error) {
            console.error(
                "webhooksUpdate protection error:",
                error
            );
        }
    }
);

// ======================================================
// GUILD CREATE
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            const data =
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

Thank you for adding VC+.

**Get Started**

\`-help\`
View all commands.

\`-vc setup\`
Set up Join To Create.

**Security**

Only the Server Owner has absolute authority.

Founder/God have high-level security access.

All VC+ logs are sent to:
\`jailed-logs\`
                    `)
                    .setFooter({
                        text: "VC+"
                    });

            const system =
                guild.systemChannel;

            if (
                system &&
                system
                    .permissionsFor(
                        client.user
                    )
                    ?.has(
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
                    type: ActivityType.Watching
                }
            ],
            status: "online"
        });

        for (
            const guild of client.guilds.cache.values()
        ) {
            try {
                await createLogSystem(
                    guild
                );
            } catch (error) {
                console.error(
                    `Log setup failed in ${guild.name}:`,
                    error
                );
            }
        }
    }
);

// ======================================================
// CLIENT ERRORS
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

// ======================================================
// PROCESS CRASH PROTECTION
// ======================================================

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

client.login(TOKEN);
