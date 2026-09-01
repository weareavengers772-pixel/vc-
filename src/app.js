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
        Partials.GuildMember,
        Partials.User,
        Partials.Message
    ]
});

// ======================================================
// DATABASE
// ======================================================

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

function ensureDataFolder() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, {
            recursive: true
        });
    }
}

function loadDatabase() {
    ensureDataFolder();

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({}, null, 4)
        );

        return {};
    }

    try {
        return JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
    } catch (error) {
        console.error("Database error:", error);

        try {
            fs.copyFileSync(
                DATA_FILE,
                `${DATA_FILE}.backup-${Date.now()}`
            );
        } catch {}

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify({}, null, 4)
        );

        return {};
    }
}

let db = loadDatabase();

function saveDatabase() {
    try {
        ensureDataFolder();

        const tempFile = `${DATA_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(db, null, 4)
        );

        fs.renameSync(
            tempFile,
            DATA_FILE
        );
    } catch (error) {
        console.error(
            "Database save error:",
            error
        );
    }
}

function getGuildData(guildId) {
    if (!db[guildId]) {
        db[guildId] = defaultGuildData();
        saveDatabase();
    }

    const defaults = defaultGuildData();

    for (const key of Object.keys(defaults)) {
        if (
            db[guildId][key] === undefined ||
            db[guildId][key] === null
        ) {
            db[guildId][key] = defaults[key];
        }
    }

    if (!db[guildId].logs) {
        db[guildId].logs = {
            channelId: null
        };
    }

    return db[guildId];
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

const DISPLAY_RANKS = {
    member: "Member",
    staff: "Staff",
    moderator: "Moderator",
    admin: "Admin",
    director: "Director",
    executive: "Executive",
    coowner: "Co Owner",
    owner: "Owner",
    god: "God",
    founder: "Founder"
};

function normalizeRank(rank) {
    if (!rank) return null;

    return rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRank(member) {
    if (!member) {
        return "member";
    }

    if (
        member.guild &&
        member.guild.ownerId === member.id
    ) {
        return "founder";
    }

    const data = getGuildData(
        member.guild.id
    );

    if (data.ranks[member.id]) {
        return normalizeRank(
            data.ranks[member.id]
        );
    }

    let highestRank = "member";
    let highestLevel = 1;

    for (
        const [rank, roleId]
        of Object.entries(data.roles)
    ) {
        if (!roleId) continue;

        if (
            member.roles.cache.has(roleId)
        ) {
            const level =
                RANKS[rank] || 1;

            if (level > highestLevel) {
                highestLevel = level;
                highestRank = rank;
            }
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
    return RANKS[
        getRank(member)
    ] || 1;
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

function canModerate(member) {
    return (
        getRankLevel(member) >=
        RANKS.moderator
    );
}

function isTrustedExecutor(member) {
    return (
        isFounder(member) ||
        isGod(member)
    );
}

// ======================================================
// EMBEDS
// ======================================================

function vcEmbed(message) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+"
        })
        .setDescription(
            `✦ ${message}`
        )
        .setFooter({
            text: "VC+"
        });
}

function interfaceEmbed(vcData, channel) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+"
        })
        .setTitle("Voice Channel Control")
        .setDescription(`
**Owner**
<@${vcData.ownerId}>

**Channel**
${channel}

━━━━━━━━━━━━━━━━━━━━

Use the controls below to manage your voice channel.

**Lock** — Lock the VC
**Unlock** — Unlock the VC
**Kick** — Remove a member
**Ban** — Ban a member from the VC
**Permit** — Allow a member
**Rename** — Change the VC name
**Limit** — Change the user limit
**Transfer** — Transfer ownership
**Claim** — Claim an abandoned VC
**STFU** — Server mute a member
**UnSTFU** — Remove the server mute
**Delete** — Delete the VC

━━━━━━━━━━━━━━━━━━━━
**VC+**
        `)
        .setFooter({
            text: "VC+"
        });
}

// ======================================================
// REPLY HELPERS
// ======================================================

async function replySuccess(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(text)
        ]
    });
}

async function replyError(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(
                `**ERROR**\n${text}`
            )
        ]
    });
}

async function replyInfo(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(text)
        ]
    });
}

async function replyWarning(
    message,
    text
) {
    return message.reply({
        embeds: [
            vcEmbed(
                `**WARNING**\n${text}`
            )
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
\`${PREFIX}godmode @user on/off\`

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
// TEMP VC STORAGE
// ======================================================

const tempVCs = new Map();

function createVCData(
    guildId,
    ownerId,
    controlChannelId = null
) {
    return {
        guildId,
        ownerId,
        controlChannelId,

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

    if (!vcData) {
        return false;
    }

    return (
        vcData.ownerId === member.id ||
        isFounder(member)
    );
}

// ======================================================
// SAFE CHANNEL NAME
// ======================================================

function cleanChannelName(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 90)
        .trim() || "VC";
}

// ======================================================
// USER RESOLUTION
// ======================================================

async function resolveMember(
    message,
    input
) {
    if (!input) return null;

    const mention =
        input.match(
            /^<@!?(\d+)>$/
        );

    if (mention) {
        return message.guild.members
            .fetch(mention[1])
            .catch(() => null);
    }

    if (/^\d+$/.test(input)) {
        return message.guild.members
            .fetch(input)
            .catch(() => null);
    }

    const lower =
        input.toLowerCase();

    return (
        message.guild.members.cache.find(
            member =>
                member.user.username
                    .toLowerCase() === lower ||
                member.displayName
                    .toLowerCase() === lower
        ) || null
    );
}

async function resolveMemberFromInput(
    guild,
    input
) {
    if (!input) return null;

    const mention =
        input.match(
            /^<@!?(\d+)>$/
        );

    const id =
        mention
            ? mention[1]
            : input.trim();

    if (!/^\d+$/.test(id)) {
        return null;
    }

    return guild.members
        .fetch(id)
        .catch(() => null);
}

// ======================================================
// JAILED LOGS
// ======================================================

async function createLogSystem(guild) {
    const data =
        getGuildData(guild.id);

    let jailedLogs = null;

    if (data.logs.channelId) {
        jailedLogs =
            guild.channels.cache.get(
                data.logs.channelId
            );
    }

    if (
        !jailedLogs ||
        jailedLogs.type !== ChannelType.GuildText
    ) {
        jailedLogs =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildText &&
                    channel.name ===
                        "jailed-logs"
            );
    }

    if (!jailedLogs) {
        jailedLogs =
            await guild.channels.create({
                name: "jailed-logs",
                type: ChannelType.GuildText,

                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,

                        deny: [
                            PermissionFlagsBits.ViewChannel
                        ]
                    }
                ]
            });
    }

    data.logs = {
        channelId: jailedLogs.id
    };

    saveDatabase();

    return jailedLogs;
}

async function sendLog(
    guild,
    type,
    description
) {
    try {
        const data =
            getGuildData(guild.id);

        let channel = null;

        if (data.logs.channelId) {
            channel =
                guild.channels.cache.get(
                    data.logs.channelId
                );
        }

        if (!channel) {
            channel =
                await createLogSystem(
                    guild
                );
        }

        if (!channel) return;

        const embed =
            new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: "VC+"
                })
                .setDescription(
                    `**${type}**\n${description}`
                )
                .setTimestamp()
                .setFooter({
                    text: "VC+ • jailed logs"
                });

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "Jailed logs error:",
            error
        );
    }
}

// ======================================================
// MODERATION DM
// ======================================================

async function moderationDM(
    member,
    title,
    description
) {
    try {
        const embed =
            new EmbedBuilder()
                .setColor(0x000000)
                .setAuthor({
                    name: "VC+"
                })
                .setTitle(title)
                .setDescription(
                    description
                )
                .setFooter({
                    text: "VC+"
                });

        await member.send({
            embeds: [embed]
        });
    } catch {}
}

// ======================================================
// VC CONTROL PERMISSIONS
// ======================================================

async function grantControlAccess(
    controlChannel,
    member
) {
    if (!controlChannel || !member) {
        return;
    }

    try {
        await controlChannel.permissionOverwrites.edit(
            member.id,
            {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
            }
        );
    } catch {}
}

async function removeControlAccess(
    controlChannel,
    memberId
) {
    if (!controlChannel || !memberId) {
        return;
    }

    try {
        await controlChannel.permissionOverwrites.delete(
            memberId
        );
    } catch {}
}

// ======================================================
// UPDATE VC PERMISSIONS
// ======================================================

async function applyVCMemberPermissions(
    voiceChannel,
    vcData,
    member
) {
    if (!voiceChannel || !member) {
        return;
    }

    try {
        if (
            vcData.banned.has(member.id) ||
            vcData.rejected.has(member.id)
        ) {
            await voiceChannel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: false,
                    Connect: false
                }
            );

            return;
        }

        if (
            vcData.permitted.has(member.id)
        ) {
            await voiceChannel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: true,
                    Connect: true
                }
            );

            return;
        }

        if (vcData.locked) {
            await voiceChannel.permissionOverwrites.edit(
                member.id,
                {
                    ViewChannel: true,
                    Connect: false
                }
            );
        }
    } catch {}
}

// ======================================================
// VC INTERFACE BUTTONS
// ======================================================

function createInterfaceRows() {
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
                        "vc_kick"
                    )
                    .setLabel(
                        "Kick"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_ban"
                    )
                    .setLabel(
                        "Ban"
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    const row2 =
        new ActionRowBuilder()
            .addComponents(
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
                        "vc_rename"
                    )
                    .setLabel(
                        "Rename"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

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
                        "vc_transfer"
                    )
                    .setLabel(
                        "Transfer"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    const row3 =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_claim"
                    )
                    .setLabel(
                        "Claim"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_stfu"
                    )
                    .setLabel(
                        "STFU"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_unstfu"
                    )
                    .setLabel(
                        "UnSTFU"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_delete"
                    )
                    .setLabel(
                        "Delete"
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    return [
        row1,
        row2,
        row3
    ];
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

    let category = null;

    if (data.jtc.categoryId) {
        category =
            member.guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    if (
        !category ||
        category.type !==
            ChannelType.GuildCategory
    ) {
        category =
            await member.guild.channels.create(
                {
                    name: "Voice Channels",
                    type: ChannelType.GuildCategory
                }
            );

        data.jtc.categoryId =
            category.id;

        saveDatabase();
    }

    const vcName =
        `${member.user.username} VC`;

    const voiceChannel =
        await member.guild.channels.create({
            name: cleanChannelName(
                vcName
            ),
            type: ChannelType.GuildVoice,
            parent: category.id,

            permissionOverwrites: [
                {
                    id:
                        member.guild.roles
                            .everyone.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect
                    ]
                },

                {
                    id: member.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.Stream
                    ]
                }
            ]
        });

    const controlChannel =
        await member.guild.channels.create(
            {
                name: cleanChannelName(
                    `${member.user.username}-vc`
                ),
                type: ChannelType.GuildText,
                parent: category.id,

                permissionOverwrites: [
                    {
                        id:
                            member.guild.roles
                                .everyone.id,

                        deny: [
                            PermissionFlagsBits.ViewChannel
                        ]
                    },

                    {
                        id: member.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory
                        ],

                        deny: [
                            PermissionFlagsBits.SendMessages
                        ]
                    }
                ]
            }
        );

    const vcData =
        createVCData(
            member.guild.id,
            member.id,
            controlChannel.id
        );

    tempVCs.set(
        voiceChannel.id,
        vcData
    );

    await controlChannel.send({
        embeds: [
            interfaceEmbed(
                vcData,
                voiceChannel
            )
        ],

        components:
            createInterfaceRows()
    });

    await member.voice.setChannel(
        voiceChannel
    );

    await sendLog(
        member.guild,
        "VOICE CHANNEL CREATED",
        `${member} created ${voiceChannel}.`
    );

    return voiceChannel;
}

// ======================================================
// DELETE PERSONAL VC
// ======================================================

async function deletePersonalVC(
    channelId,
    reason = "Voice channel deleted"
) {
    const vcData =
        getVCData(channelId);

    if (!vcData) {
        return;
    }

    const guild =
        client.guilds.cache.get(
            vcData.guildId
        );

    if (!guild) {
        tempVCs.delete(channelId);
        return;
    }

    const voiceChannel =
        guild.channels.cache.get(
            channelId
        );

    const controlChannel =
        vcData.controlChannelId
            ? guild.channels.cache.get(
                  vcData.controlChannelId
              )
            : null;

    try {
        if (controlChannel) {
            await controlChannel.delete(
                reason
            );
        }
    } catch {}

    try {
        if (voiceChannel) {
            await voiceChannel.delete(
                reason
            );
        }
    } catch {}

    tempVCs.delete(
        channelId
    );

    await sendLog(
        guild,
        "VOICE CHANNEL DELETED",
        `A personal voice channel was deleted.\n**Reason:** ${reason}`
    );
}

// ======================================================
// GET USER'S PERSONAL VC
// ======================================================

function getMemberVC(member) {
    if (!member.voice.channel) {
        return null;
    }

    return getVCData(
        member.voice.channel.id
    )
        ? member.voice.channel
        : null;
}

// ======================================================
// REFRESH INTERFACE
// ======================================================

async function refreshInterface(
    vcData
) {
    if (!vcData) return;

    const guild =
        client.guilds.cache.get(
            vcData.guildId
        );

    if (!guild) return;

    const voiceChannel =
        guild.channels.cache.find(
            channel =>
                channel.id ===
                [...tempVCs.entries()]
                    .find(
                        ([, data]) =>
                            data === vcData
                    )?.[0]
        );

    if (!voiceChannel) return;

    const controlChannel =
        vcData.controlChannelId
            ? guild.channels.cache.get(
                  vcData.controlChannelId
              )
            : null;

    if (!controlChannel) return;

    try {
        const messages =
            await controlChannel.messages.fetch({
                limit: 10
            });

        const panel =
            messages.find(
                message =>
                    message.author.id ===
                    client.user.id &&
                    message.embeds.length > 0
            );

        const payload = {
            embeds: [
                interfaceEmbed(
                    vcData,
                    voiceChannel
                )
            ],
            components:
                createInterfaceRows()
        };

        if (panel) {
            await panel.edit(
                payload
            );
        } else {
            await controlChannel.send(
                payload
            );
        }
    } catch {}
}

// ======================================================
// BUTTON MODALS
// ======================================================

function targetModal(
    customId,
    title,
    label = "User ID or Mention"
) {
    const input =
        new TextInputBuilder()
            .setCustomId(
                "target"
            )
            .setLabel(label)
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(true)
            .setPlaceholder(
                "123456789012345678"
            );

    return new ModalBuilder()
        .setCustomId(
            customId
        )
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );
}

function renameModal() {
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
            .setRequired(true)
            .setMaxLength(90)
            .setPlaceholder(
                "My VC"
            );

    return new ModalBuilder()
        .setCustomId(
            "vc_rename_modal"
        )
        .setTitle(
            "Rename Voice Channel"
        )
        .addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );
}

function limitModal() {
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
            .setRequired(true)
            .setPlaceholder(
                "0 - 99"
            );

    return new ModalBuilder()
        .setCustomId(
            "vc_limit_modal"
        )
        .setTitle(
            "Change User Limit"
        )
        .addComponents(
            new ActionRowBuilder()
                .addComponents(input)
        );
}

// ======================================================
// BUTTON PERMISSION CHECK
// ======================================================

function buttonOwnerCheck(
    interaction,
    channel
) {
    const vcData =
        getVCData(channel.id);

    if (!vcData) {
        return false;
    }

    return (
        vcData.ownerId ===
            interaction.member.id ||
        isFounder(
            interaction.member
        )
    );
}

// ======================================================
// BUTTON INTERACTIONS
// ======================================================

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

            if (!interaction.guild) {
                return;
            }

            // ------------------------------------------
            // FIND PERSONAL VC
            // ------------------------------------------

            let voiceChannel = null;

            if (
                interaction.channel &&
                interaction.channel.type ===
                    ChannelType.GuildText
            ) {
                const vcData =
                    [...tempVCs.entries()]
                        .find(
                            ([, data]) =>
                                data.controlChannelId ===
                                interaction.channel.id
                        );

                if (vcData) {
                    voiceChannel =
                        interaction.guild.channels.cache.get(
                            vcData[0]
                        );
                }
            }

            if (!voiceChannel) {
                if (
                    interaction.isButton() ||
                    interaction.isModalSubmit()
                ) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "**ERROR**\nThis VC no longer exists."
                            )
                        ],
                        ephemeral: true
                    });
                }

                return;
            }

            const vcData =
                getVCData(
                    voiceChannel.id
                );

            if (!vcData) {
                return;
            }

            // ------------------------------------------
            // BUTTONS
            // ------------------------------------------

            if (interaction.isButton()) {

                // -------------------------------
                // OWNER CHECK
                // -------------------------------

                const ownerOnlyButtons = [
                    "vc_lock",
                    "vc_unlock",
                    "vc_kick",
                    "vc_ban",
                    "vc_permit",
                    "vc_rename",
                    "vc_limit",
                    "vc_transfer",
                    "vc_stfu",
                    "vc_unstfu",
                    "vc_delete"
                ];

                if (
                    ownerOnlyButtons.includes(
                        interaction.customId
                    ) &&
                    !buttonOwnerCheck(
                        interaction,
                        voiceChannel
                    )
                ) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "**ERROR**\nOnly the VC owner can use this control."
                            )
                        ],
                        ephemeral: true
                    });
                }

                // -------------------------------
                // LOCK
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_lock"
                ) {
                    vcData.locked = true;

                    await voiceChannel.permissionOverwrites.edit(
                        interaction.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    );

                    for (
                        const member
                        of voiceChannel.members.values()
                    ) {
                        if (
                            member.id !==
                                vcData.ownerId &&
                            !vcData.permitted.has(
                                member.id
                            )
                        ) {
                            await applyVCMemberPermissions(
                                voiceChannel,
                                vcData,
                                member
                            );
                        }
                    }

                    await refreshInterface(
                        vcData
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "The VC has been locked."
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC LOCKED",
                        `${interaction.user} locked ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // UNLOCK
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_unlock"
                ) {
                    vcData.locked = false;

                    await voiceChannel.permissionOverwrites.edit(
                        interaction.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    );

                    await refreshInterface(
                        vcData
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "The VC has been unlocked."
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC UNLOCKED",
                        `${interaction.user} unlocked ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // KICK
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_kick"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_kick_modal",
                            "Kick Member"
                        )
                    );

                    return;
                }

                // -------------------------------
                // BAN
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_ban"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_ban_modal",
                            "Ban From VC"
                        )
                    );

                    return;
                }

                // -------------------------------
                // PERMIT
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_permit"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_permit_modal",
                            "Permit Member"
                        )
                    );

                    return;
                }

                // -------------------------------
                // RENAME
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_rename"
                ) {
                    await interaction.showModal(
                        renameModal()
                    );

                    return;
                }

                // -------------------------------
                // LIMIT
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_limit"
                ) {
                    await interaction.showModal(
                        limitModal()
                    );

                    return;
                }

                // -------------------------------
                // TRANSFER
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_transfer"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_transfer_modal",
                            "Transfer Ownership"
                        )
                    );

                    return;
                }

                // -------------------------------
                // STFU
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_stfu"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_stfu_modal",
                            "Server Mute Member"
                        )
                    );

                    return;
                }

                // -------------------------------
                // UNSTFU
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_unstfu"
                ) {
                    await interaction.showModal(
                        targetModal(
                            "vc_unstfu_modal",
                            "Remove Server Mute"
                        )
                    );

                    return;
                }

                // -------------------------------
                // CLAIM
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_claim"
                ) {
                    const currentOwner =
                        interaction.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        currentOwner &&
                        voiceChannel.members.has(
                            currentOwner.id
                        ) &&
                        !isFounder(
                            interaction.member
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nThe current owner is still in the VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const oldOwner =
                        vcData.ownerId;

                    vcData.ownerId =
                        interaction.member.id;

                    await voiceChannel.permissionOverwrites.edit(
                        interaction.member.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true
                        }
                    );

                    if (
                        vcData.controlChannelId
                    ) {
                        const control =
                            interaction.guild.channels.cache.get(
                                vcData.controlChannelId
                            );

                        if (control) {
                            await grantControlAccess(
                                control,
                                interaction.member
                            );
                        }
                    }

                    await refreshInterface(
                        vcData
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `You are now the owner of ${voiceChannel}.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC CLAIMED",
                        `${interaction.user} claimed ${voiceChannel}.\nPrevious owner: <@${oldOwner}>`
                    );

                    return;
                }

                // -------------------------------
                // DELETE
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_delete"
                ) {
                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "Deleting your VC..."
                            )
                        ],
                        ephemeral: true
                    });

                    await deletePersonalVC(
                        voiceChannel.id,
                        `Deleted by ${interaction.user.tag}`
                    );

                    return;
                }
            }

            // ==================================================
            // MODALS
            // ==================================================

            if (
                interaction.isModalSubmit()
            ) {
                const input =
                    interaction.fields.getTextInputValue(
                        "target"
                    );

                // -------------------------------
                // KICK MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_kick_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        target.id ===
                        vcData.ownerId
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nYou cannot kick the VC owner."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        target.voice.channelId !==
                        voiceChannel.id
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nThat member is not in this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await target.voice.setChannel(
                        null,
                        "VC+ VC kick"
                    );

                    await removeControlAccess(
                        interaction.guild.channels.cache.get(
                            vcData.controlChannelId
                        ),
                        target.id
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has been kicked from the VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC KICK",
                        `${interaction.user} kicked ${target} from ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // BAN MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_ban_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        target.id ===
                        vcData.ownerId
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nYou cannot ban the VC owner."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.banned.add(
                        target.id
                    );

                    vcData.rejected.delete(
                        target.id
                    );

                    await voiceChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            ViewChannel: false,
                            Connect: false
                        }
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice.setChannel(
                            null,
                            "VC+ VC ban"
                        );
                    }

                    await removeControlAccess(
                        interaction.guild.channels.cache.get(
                            vcData.controlChannelId
                        ),
                        target.id
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has been banned from the VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC BAN",
                        `${interaction.user} banned ${target} from ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // PERMIT MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_permit_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
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

                    await voiceChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            ViewChannel: true,
                            Connect: true
                        }
                    );

                    const control =
                        interaction.guild.channels.cache.get(
                            vcData.controlChannelId
                        );

                    if (control) {
                        await grantControlAccess(
                            control,
                            target
                        );
                    }

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has been permitted in the VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC PERMIT",
                        `${interaction.user} permitted ${target} in ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // RENAME MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_rename_modal"
                ) {
                    const name =
                        interaction.fields.getTextInputValue(
                            "name"
                        );

                    const cleanName =
                        cleanChannelName(
                            name
                        );

                    await voiceChannel.setName(
                        cleanName
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `VC renamed to **${cleanName}**.`
                            )
                        ],
                        ephemeral: true
                    });

                    await refreshInterface(
                        vcData
                    );

                    await sendLog(
                        interaction.guild,
                        "VC RENAMED",
                        `${interaction.user} renamed a VC to **${cleanName}**.`
                    );

                    return;
                }

                // -------------------------------
                // LIMIT MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_limit_modal"
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
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nThe limit must be between 0 and 99."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await voiceChannel.setUserLimit(
                        limit
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `The VC user limit is now **${limit === 0 ? "Unlimited" : limit}**.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC LIMIT CHANGED",
                        `${interaction.user} changed ${voiceChannel}'s limit to **${limit}**.`
                    );

                    return;
                }

                // -------------------------------
                // TRANSFER MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_transfer_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        target.id ===
                        interaction.member.id
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nYou already own this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.ownerId =
                        target.id;

                    await voiceChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true
                        }
                    );

                    const control =
                        interaction.guild.channels.cache.get(
                            vcData.controlChannelId
                        );

                    if (control) {
                        await grantControlAccess(
                            control,
                            target
                        );
                    }

                    await refreshInterface(
                        vcData
                    );

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} is now the owner of the VC.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC TRANSFER",
                        `${interaction.user} transferred ${voiceChannel} to ${target}.`
                    );

                    return;
                }

                // -------------------------------
                // STFU MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_stfu_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        target.id ===
                        vcData.ownerId
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nYou cannot STFU the VC owner."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.stfu.add(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        try {
                            await target.voice.setMute(
                                true,
                                "VC+ STFU"
                            );
                        } catch {}
                    }

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has been server muted.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC STFU",
                        `${interaction.user} server muted ${target} in ${voiceChannel}.`
                    );

                    return;
                }

                // -------------------------------
                // UNSTFU MODAL
                // -------------------------------

                if (
                    interaction.customId ===
                    "vc_unstfu_modal"
                ) {
                    const target =
                        await resolveMemberFromInput(
                            interaction.guild,
                            input
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "**ERROR**\nI couldn't find that member."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        try {
                            await target.voice.setMute(
                                false,
                                "VC+ UnSTFU"
                            );
                        } catch {}
                    }

                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} has been unmuted.`
                            )
                        ],
                        ephemeral: true
                    });

                    await sendLog(
                        interaction.guild,
                        "VC UNSTFU",
                        `${interaction.user} removed the server mute from ${target}.`
                    );

                    return;
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
                                "**ERROR**\nSomething went wrong."
                            )
                        ],
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        embeds: [
                            vcEmbed(
                                "**ERROR**\nSomething went wrong."
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

            // ------------------------------------------
            // JOIN TO CREATE
            // ------------------------------------------

            if (
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                const vc =
                    await createPersonalVC(
                        member
                    );

                if (vc) {
                    return;
                }
            }

            // ------------------------------------------
            // LEFT TEMP VC
            // ------------------------------------------

            if (
                oldState.channelId &&
                tempVCs.has(
                    oldState.channelId
                )
            ) {
                const vcData =
                    getVCData(
                        oldState.channelId
                    );

                if (
                    vcData &&
                    vcData.controlChannelId
                ) {
                    const control =
                        guild.channels.cache.get(
                            vcData.controlChannelId
                        );

                    if (control) {
                        await removeControlAccess(
                            control,
                            member.id
                        );
                    }
                }

                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    oldChannel.members.size === 0
                ) {
                    await deletePersonalVC(
                        oldChannel.id,
                        "VC became empty"
                    );
                }
            }

            // ------------------------------------------
            // JOINED TEMP VC
            // ------------------------------------------

            if (
                newState.channelId &&
                tempVCs.has(
                    newState.channelId
                )
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                const voiceChannel =
                    newState.channel;

                const control =
                    vcData.controlChannelId
                        ? guild.channels.cache.get(
                              vcData.controlChannelId
                          )
                        : null;

                // Give control-channel access
                // to people actually inside VC
                if (control) {
                    await grantControlAccess(
                        control,
                        member
                    );
                }

                // BANNED
                if (
                    vcData.banned.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setChannel(
                            null,
                            "VC+ banned user"
                        );
                    } catch {}

                    return;
                }

                // REJECTED
                if (
                    vcData.rejected.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setChannel(
                            null,
                            "VC+ rejected user"
                        );
                    } catch {}

                    return;
                }

                // LOCKED
                if (
                    vcData.locked &&
                    member.id !==
                        vcData.ownerId &&
                    !vcData.permitted.has(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setChannel(
                            null,
                            "VC+ locked VC"
                        );
                    } catch {}

                    return;
                }

                // STFU
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

            // ------------------------------------------
            // STFU ENFORCEMENT
            // ------------------------------------------

            if (
                newState.channelId &&
                tempVCs.has(
                    newState.channelId
                )
            ) {
                const vcData =
                    getVCData(
                        newState.channelId
                    );

                if (
                    vcData &&
                    vcData.stfu.has(
                        member.id
                    ) &&
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

        } catch (error) {
            console.error(
                "Voice state error:",
                error
            );
        }
    }
);

// ======================================================
// MESSAGE COMMANDS
// ======================================================

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

            const content =
                message.content.trim();

            if (
                !content.startsWith(
                    PREFIX
                )
            ) {
                await handleFilter(
                    message
                );

                return;
            }

            const args =
                content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()
                    ?.toLowerCase();

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
            // VC COMMAND
            // ==================================================

            if (command === "vc") {
                return handleVCCommand(
                    message,
                    args
                );
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command === "ban"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to use this command."
                    );
                }

                const target =
                    await resolveMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
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
                        "You cannot moderate someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

                await moderationDM(
                    target,
                    "You have been banned",
                    `**Server:** ${message.guild.name}\n**Reason:** ${reason}`
                );

                await message.guild.members.ban(
                    target.id,
                    {
                        reason
                    }
                );

                await replySuccess(
                    message,
                    `${target} has been banned.`
                );

                await sendLog(
                    message.guild,
                    "BAN",
                    `${message.author} banned ${target}.\n**Reason:** ${reason}`
                );

                return;
            }

            // ==================================================
            // UNBAN
            // ==================================================

            if (
                command === "unban"
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You do not have permission to use this command."
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
                        "Give me a valid user ID."
                    );
                }

                try {
                    await message.guild.members.unban(
                        userId
                    );

                    await replySuccess(
                        message,
                        `<@${userId}> has been unbanned.`
                    );

                    await sendLog(
                        message.guild,
                        "UNBAN",
                        `${message.author} unbanned <@${userId}>.`
                    );
                } catch {
                    return replyError(
                        message,
                        "That user is not banned or could not be unbanned."
                    );
                }

                return;
            }

            // ==================================================
            // BAN LIST
            // ==================================================

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
                        "You do not have permission to use this command."
                    );
                }

                const bans =
                    await message.guild.bans.fetch();

                if (!bans.size) {
                    return replyInfo(
                        message,
                        "There are no banned users."
                    );
                }

                const list =
                    bans
                        .map(
                            ban =>
                                `<@${ban.user.id}> — ${ban.user.tag}`
                        )
                        .slice(0, 50)
                        .join("\n");

                return message.reply({
                    embeds: [
                        vcEmbed(
                            `**BAN LIST**\n\n${list}`
                        )
                    ]
                });
            }

            // ==================================================
            // KICK
            // ==================================================

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
                        "You do not have permission to use this command."
                    );
                }

                const target =
                    await resolveMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
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
                        "You cannot moderate someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

                await moderationDM(
                    target,
                    "You have been kicked",
                    `**Server:** ${message.guild.name}\n**Reason:** ${reason}`
                );

                await target.kick(
                    reason
                );

                await replySuccess(
                    message,
                    `${target} has been kicked.`
                );

                await sendLog(
                    message.guild,
                    "KICK",
                    `${message.author} kicked ${target}.\n**Reason:** ${reason}`
                );

                return;
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

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
                        "You do not have permission to use this command."
                    );
                }

                const target =
                    await resolveMember(
                        message,
                        args[0]
                    );

                const minutes =
                    Number(
                        args[1]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
                    );
                }

                if (
                    !Number.isFinite(
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

                if (
                    getRankLevel(target) >=
                    getRankLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot moderate someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(2)
                        .join(" ") ||
                    "No reason provided";

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                await moderationDM(
                    target,
                    "You have been timed out",
                    `**Server:** ${message.guild.name}\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}`
                );

                await replySuccess(
                    message,
                    `${target} has been timed out for ${minutes} minutes.`
                );

                await sendLog(
                    message.guild,
                    "TIMEOUT",
                    `${message.author} timed out ${target} for **${minutes} minutes**.\n**Reason:** ${reason}`
                );

                return;
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

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
                        "You do not have permission to use this command."
                    );
                }

                const target =
                    await resolveMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
                    );
                }

                await target.timeout(
                    null,
                    "VC+ timeout removed"
                );

                await replySuccess(
                    message,
                    `${target} is no longer timed out.`
                );

                await sendLog(
                    message.guild,
                    "UNTIMEOUT",
                    `${message.author} removed the timeout from ${target}.`
                );

                return;
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command ===
                "foreverban"
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
                    await resolveMember(
                        message,
                        args[0]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "Forever banned";

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

                await moderationDM(
                    target,
                    "You have been permanently banned",
                    `**Server:** ${message.guild.name}\n**Reason:** ${reason}`
                );

                await message.guild.members.ban(
                    target.id,
                    {
                        reason
                    }
                );

                await replySuccess(
                    message,
                    `${target} has been permanently banned.`
                );

                await sendLog(
                    message.guild,
                    "FOREVER BAN",
                    `${message.author} forever banned ${target}.\n**Reason:** ${reason}`
                );

                return;
            }

            // ==================================================
            // PURGE / CLEAR
            // ==================================================

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
                        "You do not have permission to use this command."
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
                        "Choose an amount from 1 to 100."
                    );
                }

                const deleted =
                    await message.channel.bulkDelete(
                        amount,
                        true
                    );

                const response =
                    await message.channel.send({
                        embeds: [
                            vcEmbed(
                                `Deleted **${deleted.size}** messages.`
                            )
                        ]
                    });

                setTimeout(
                    () =>
                        response
                            .delete()
                            .catch(
                                () => {}
                            ),
                    3000
                );

                await sendLog(
                    message.guild,
                    "PURGE",
                    `${message.author} deleted **${deleted.size}** messages in ${message.channel}.`
                );

                return;
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
                        "Only the Founder can change ranks."
                    );
                }

                const target =
                    await resolveMember(
                        message,
                        args[0]
                    );

                const rank =
                    normalizeRank(
                        args[1]
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Please mention a valid member."
                    );
                }

                if (
                    !rank ||
                    !RANKS[
                        rank
                    ]
                ) {
                    return replyError(
                        message,
                        "Invalid rank."
                    );
                }

                if (
                    rank === "founder"
                ) {
                    return replyError(
                        message,
                        "Founder is reserved for the server owner."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                data.ranks[
                    target.id
                ] = rank;

                saveDatabase();

                await replySuccess(
                    message,
                    `${target} is now **${DISPLAY_RANKS[rank]}**.`
                );

                await sendLog(
                    message.guild,
                    "RANK CHANGE",
                    `${message.author} made ${target} **${DISPLAY_RANKS[rank]}**.`
                );

                return;
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
                        "Only the Founder can manage Godmode."
                    );
                }

                let target =
                    message.member;

                let mode =
                    args[0]
                        ?.toLowerCase();

                if (
                    args[0] &&
                    (
                        args[0].startsWith(
                            "<@"
                        ) ||
                        /^\d+$/.test(
                            args[0]
                        )
                    )
                ) {
                    target =
                        await resolveMember(
                            message,
                            args[0]
                        );

                    mode =
                        args[1]
                            ?.toLowerCase();
                }

                if (
                    !target ||
                    !["on", "off"].includes(
                        mode
                    )
                ) {
                    return replyError(
                        message,
                        "Use `-godmode on`, `-godmode off`, or `-godmode @user on/off`."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    mode === "on"
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

                await replySuccess(
                    message,
                    `Godmode is now **${mode.toUpperCase()}** for ${target}.`
                );

                await sendLog(
                    message.guild,
                    "GODMODE",
                    `${message.author} set Godmode **${mode.toUpperCase()}** for ${target}.`
                );

                return;
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command ===
                "filter"
            ) {
                return handleFilterCommand(
                    message,
                    args
                );
            }

        } catch (error) {
            console.error(
                "Command error:",
                error
            );

            try {
                await replyError(
                    message,
                    "Something went wrong while running that command."
                );
            } catch {}
        }
    }
);

// ======================================================
// VC COMMANDS
// ======================================================

async function handleVCCommand(
    message,
    args
) {
    const sub =
        args.shift()
            ?.toLowerCase();

    if (!sub) {
        return message.reply({
            embeds: [
                helpEmbed()
            ]
        });
    }

    // ==================================================
    // SETUP
    // ==================================================

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
                "Only God or Founder can setup Join To Create."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        if (
            data.jtc.enabled &&
            data.jtc.channelId &&
            message.guild.channels.cache.get(
                data.jtc.channelId
            )
        ) {
            return replyInfo(
                message,
                "Join To Create is already setup."
            );
        }

        let category =
            message.guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name ===
                        "Voice Channels"
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
                    name: "Join To Create",
                    type: ChannelType.GuildVoice,
                    parent: category.id
                }
            );

        data.jtc = {
            enabled: true,
            channelId:
                joinChannel.id,
            categoryId:
                category.id
        };

        saveDatabase();

        await createLogSystem(
            message.guild
        );

        await replySuccess(
            message,
            `Join To Create has been setup.\n\nJoin **${joinChannel.name}** to automatically receive your own VC.`
        );

        await sendLog(
            message.guild,
            "JTC SETUP",
            `${message.author} setup Join To Create.`
        );

        return;
    }

    const channel =
        message.member.voice.channel;

    const vcData =
        channel
            ? getVCData(
                  channel.id
              )
            : null;

    // ==================================================
    // COMMANDS NEEDING A VC
    // ==================================================

    if (
        [
            "kick",
            "disconnect",
            "ban",
            "reject",
            "permit",
            "lock",
            "unlock",
            "transfer",
            "claim",
            "forceclaim",
            "rename",
            "limit",
            "stfu",
            "unstfu"
        ].includes(sub)
    ) {
        if (!channel || !vcData) {
            return replyError(
                message,
                "You must be inside your personal VC."
            );
        }
    }

    // ==================================================
    // OWNER CHECK
    // ==================================================

    const ownerCommands = [
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
        "stfu",
        "unstfu",
        "claim"
    ];

    if (
        ownerCommands.includes(
            sub
        ) &&
        !isVCOwner(
            message.member,
            channel
        )
    ) {
        return replyError(
            message,
            "Only the VC owner can use that command."
        );
    }

    // ==================================================
    // KICK
    // ==================================================

    if (
        sub === "kick" ||
        sub === "disconnect"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        if (
            target.id ===
            vcData.ownerId
        ) {
            return replyError(
                message,
                "You cannot kick the VC owner."
            );
        }

        if (
            target.voice.channelId !==
            channel.id
        ) {
            return replyError(
                message,
                "That member is not in your VC."
            );
        }

        await target.voice.setChannel(
            null,
            "VC+ VC kick"
        );

        await replySuccess(
            message,
            `${target} has been removed from the VC.`
        );

        await sendLog(
            message.guild,
            "VC KICK",
            `${message.author} removed ${target} from ${channel}.`
        );

        return;
    }

    // ==================================================
    // BAN
    // ==================================================

    if (
        sub === "ban"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        if (
            target.id ===
            vcData.ownerId
        ) {
            return replyError(
                message,
                "You cannot ban the VC owner."
            );
        }

        vcData.banned.add(
            target.id
        );

        vcData.rejected.delete(
            target.id
        );

        await channel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: false,
                Connect: false
            }
        );

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.setChannel(
                null,
                "VC+ VC ban"
            );
        }

        await replySuccess(
            message,
            `${target} has been banned from the VC.`
        );

        await sendLog(
            message.guild,
            "VC BAN",
            `${message.author} banned ${target} from ${channel}.`
        );

        return;
    }

    // ==================================================
    // REJECT
    // ==================================================

    if (
        sub === "reject"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        vcData.rejected.add(
            target.id
        );

        vcData.permitted.delete(
            target.id
        );

        await channel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: false,
                Connect: false
            }
        );

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.setChannel(
                null,
                "VC+ VC reject"
            );
        }

        await replySuccess(
            message,
            `${target} has been rejected from the VC.`
        );

        await sendLog(
            message.guild,
            "VC REJECT",
            `${message.author} rejected ${target} from ${channel}.`
        );

        return;
    }

    // ==================================================
    // PERMIT
    // ==================================================

    if (
        sub === "permit"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
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

        await channel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: true,
                Connect: true
            }
        );

        const control =
            message.guild.channels.cache.get(
                vcData.controlChannelId
            );

        if (control) {
            await grantControlAccess(
                control,
                target
            );
        }

        await replySuccess(
            message,
            `${target} has been permitted.`
        );

        await sendLog(
            message.guild,
            "VC PERMIT",
            `${message.author} permitted ${target} in ${channel}.`
        );

        return;
    }

    // ==================================================
    // LOCK
    // ==================================================

    if (
        sub === "lock"
    ) {
        vcData.locked = true;

        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone.id,
            {
                Connect: false
            }
        );

        await replySuccess(
            message,
            "The VC is now locked."
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC LOCKED",
            `${message.author} locked ${channel}.`
        );

        return;
    }

    // ==================================================
    // UNLOCK
    // ==================================================

    if (
        sub === "unlock"
    ) {
        vcData.locked = false;

        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone.id,
            {
                Connect: true
            }
        );

        await replySuccess(
            message,
            "The VC is now unlocked."
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC UNLOCKED",
            `${message.author} unlocked ${channel}.`
        );

        return;
    }

    // ==================================================
    // TRANSFER
    // ==================================================

    if (
        sub === "transfer"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        vcData.ownerId =
            target.id;

        await channel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true
            }
        );

        await replySuccess(
            message,
            `${target} is now the owner of the VC.`
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC TRANSFER",
            `${message.author} transferred ${channel} to ${target}.`
        );

        return;
    }

    // ==================================================
    // CLAIM
    // ==================================================

    if (
        sub === "claim"
    ) {
        const currentOwner =
            message.guild.members.cache.get(
                vcData.ownerId
            );

        if (
            currentOwner &&
            channel.members.has(
                currentOwner.id
            )
        ) {
            return replyError(
                message,
                "The current owner is still in the VC."
            );
        }

        const oldOwner =
            vcData.ownerId;

        vcData.ownerId =
            message.member.id;

        await channel.permissionOverwrites.edit(
            message.member.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true
            }
        );

        await replySuccess(
            message,
            "You now own this VC."
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC CLAIMED",
            `${message.author} claimed ${channel}.\nPrevious owner: <@${oldOwner}>`
        );

        return;
    }

    // ==================================================
    // FORCE CLAIM
    // ==================================================

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
                "Only Founder can forceclaim a VC."
            );
        }

        const target =
            args[0]
                ? await resolveMember(
                      message,
                      args[0]
                  )
                : message.member;

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        const oldOwner =
            vcData.ownerId;

        vcData.ownerId =
            target.id;

        await channel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true
            }
        );

        await replySuccess(
            message,
            `${target} now owns the VC.`
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC FORCECLAIM",
            `${message.author} forceclaimed ${channel} for ${target}.\nPrevious owner: <@${oldOwner}>`
        );

        return;
    }

    // ==================================================
    // RENAME
    // ==================================================

    if (
        sub === "rename"
    ) {
        const name =
            args.join(" ");

        if (!name) {
            return replyError(
                message,
                "Give the VC a name."
            );
        }

        const cleanName =
            cleanChannelName(
                name
            );

        await channel.setName(
            cleanName
        );

        await replySuccess(
            message,
            `VC renamed to **${cleanName}**.`
        );

        await refreshInterface(
            vcData
        );

        await sendLog(
            message.guild,
            "VC RENAMED",
            `${message.author} renamed a VC to **${cleanName}**.`
        );

        return;
    }

    // ==================================================
    // LIMIT
    // ==================================================

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
                "Use a number from 0 to 99."
            );
        }

        await channel.setUserLimit(
            limit
        );

        await replySuccess(
            message,
            `VC limit set to **${limit === 0 ? "Unlimited" : limit}**.`
        );

        await sendLog(
            message.guild,
            "VC LIMIT",
            `${message.author} changed ${channel}'s limit to **${limit}**.`
        );

        return;
    }

    // ==================================================
    // STFU
    // ==================================================

    if (
        sub === "stfu"
    ) {
        if (
            !isVCOwner(
                message.member,
                channel
            )
        ) {
            return replyError(
                message,
                "Only the VC owner can use STFU."
            );
        }

        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        if (
            target.id ===
            vcData.ownerId
        ) {
            return replyError(
                message,
                "You cannot STFU the VC owner."
            );
        }

        vcData.stfu.add(
            target.id
        );

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.setMute(
                true,
                "VC+ STFU"
            );
        }

        await replySuccess(
            message,
            `${target} has been server muted.`
        );

        await sendLog(
            message.guild,
            "VC STFU",
            `${message.author} server muted ${target} in ${channel}.`
        );

        return;
    }

    // ==================================================
    // UNSTFU
    // ==================================================

    if (
        sub === "unstfu"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
            );
        }

        vcData.stfu.delete(
            target.id
        );

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.setMute(
                false,
                "VC+ UnSTFU"
            );
        }

        await replySuccess(
            message,
            `${target} has been unmuted.`
        );

        await sendLog(
            message.guild,
            "VC UNSTFU",
            `${message.author} removed the server mute from ${target}.`
        );

        return;
    }

    return replyError(
        message,
        "Unknown VC command. Use `-help`."
    );
}

// ======================================================
// FILTER COMMANDS
// ======================================================

async function handleFilterCommand(
    message,
    args
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

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args.shift()
            ?.toLowerCase();

    if (
        sub === "on"
    ) {
        data.filter.enabled =
            true;

        saveDatabase();

        return replySuccess(
            message,
            "The word filter is now **ON**."
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
            "The word filter is now **OFF**."
        );
    }

    if (
        sub === "add"
    ) {
        const word =
            args.join(" ")
                .toLowerCase()
                .trim();

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
            `Added **${word}** to the filter.`
        );
    }

    if (
        sub === "remove"
    ) {
        const word =
            args.join(" ")
                .toLowerCase()
                .trim();

        data.filter.words =
            data.filter.words.filter(
                item =>
                    item !== word
            );

        saveDatabase();

        return replySuccess(
            message,
            `Removed **${word}** from the filter.`
        );
    }

    if (
        sub === "list"
    ) {
        const words =
            data.filter.words;

        return replyInfo(
            message,
            words.length
                ? `**FILTER WORDS**\n\n${words.join("\n")}`
                : "The filter list is empty."
        );
    }

    if (
        sub === "log"
    ) {
        const mode =
            args[0]
                ?.toLowerCase();

        if (
            !["on", "off"].includes(
                mode
            )
        ) {
            return replyError(
                message,
                "Use `-filter log on` or `-filter log off`."
            );
        }

        data.filter.log =
            mode === "on";

        saveDatabase();

        return replySuccess(
            message,
            `Filter logging is now **${mode.toUpperCase()}**.`
        );
    }

    if (
        sub === "strikes"
    ) {
        const amount =
            Number(
                args[0]
            );

        if (
            !Number.isInteger(
                amount
            ) ||
            amount < 1 ||
            amount > 20
        ) {
            return replyError(
                message,
                "Choose a strike limit from 1 to 20."
            );
        }

        data.filter.maxStrikes =
            amount;

        saveDatabase();

        return replySuccess(
            message,
            `Filter strike limit is now **${amount}**.`
        );
    }

    if (
        sub === "reset"
    ) {
        const target =
            await resolveMember(
                message,
                args[0]
            );

        if (!target) {
            return replyError(
                message,
                "Mention a valid member."
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

    return replyError(
        message,
        "Use `-filter on`, `off`, `add`, `remove`, `list`, `log`, `strikes`, or `reset`."
    );
}

// ======================================================
// MESSAGE FILTER
// ======================================================

async function handleFilter(
    message
) {
    const data =
        getGuildData(
            message.guild.id
        );

    if (
        !data.filter.enabled ||
        !data.filter.words.length
    ) {
        return;
    }

    // Trusted staff bypass
    if (
        isTrustedExecutor(
            message.member
        )
    ) {
        return;
    }

    const lower =
        message.content.toLowerCase();

    const matched =
        data.filter.words.find(
            word =>
                lower.includes(
                    word.toLowerCase()
                )
        );

    if (!matched) {
        return;
    }

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

    const strikes =
        data.filter.strikes[
            message.author.id
        ];

    saveDatabase();

    const warning =
        await message.channel.send({
            embeds: [
                vcEmbed(
                    `${message.author}, that message was removed by the server filter.\n\n**Strike:** ${strikes}/${data.filter.maxStrikes}`
                )
            ]
        });

    setTimeout(
        () =>
            warning
                .delete()
                .catch(
                    () => {}
                ),
        5000
    );

    if (
        data.filter.log
    ) {
        await sendLog(
            message.guild,
            "FILTER",
            `${message.author} triggered the word filter.\n**Strike:** ${strikes}/${data.filter.maxStrikes}`
        );
    }

    if (
        strikes >=
        data.filter.maxStrikes
    ) {
        try {
            await message.member.timeout(
                10 * 60 * 1000,
                "VC+ filter strike limit"
            );

            await sendLog(
                message.guild,
                "FILTER TIMEOUT",
                `${message.author} reached the filter strike limit and was timed out for 10 minutes.`
            );

            data.filter.strikes[
                message.author.id
            ] = 0;

            saveDatabase();
        } catch {}
    }
}

// ======================================================
// FOREVER BAN ENFORCEMENT
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
                        "VC+ Forever Ban"
                });

                await sendLog(
                    member.guild,
                    "FOREVER BAN ENFORCED",
                    `${member} attempted to join but is permanently banned.`
                );

                return;
            }
        } catch (error) {
            console.error(
                "Forever ban error:",
                error
            );
        }
    }
);

// ======================================================
// SECURITY AUDIT HELPER
// ======================================================

async function getRecentExecutor(
    guild,
    type,
    targetId
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 5
            });

        const entry =
            logs.entries.find(
                entry =>
                    !targetId ||
                    entry.target?.id ===
                        targetId
            );

        return entry?.executor || null;
    } catch {
        return null;
    }
}

// ======================================================
// CHANNEL CREATE PROTECTION
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
                !data.protection.channelCreate
            ) {
                return;
            }

            const executor =
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate,
                    channel.id
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
                await channel.guild.members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                return;
            }

            try {
                await channel.delete(
                    "VC+ unauthorized channel creation"
                );
            } catch {}

            await sendLog(
                channel.guild,
                "SECURITY",
                `${executor} created an unauthorized channel.\nThe channel was removed.`
            );
        } catch (error) {
            console.error(
                "Channel create security error:",
                error
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
        try {
            if (!channel.guild) {
                return;
            }

            // Ignore our temporary VC cleanup
            if (
                tempVCs.has(
                    channel.id
                )
            ) {
                return;
            }

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
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete,
                    channel.id
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
                await channel.guild.members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                return;
            }

            await sendLog(
                channel.guild,
                "SECURITY",
                `${executor} deleted a channel without Founder/God authorization.\n**Channel:** ${channel.name}`
            );
        } catch (error) {
            console.error(
                "Channel delete security error:",
                error
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
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleCreate,
                    role.id
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
                await guild.members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                return;
            }

            try {
                await role.delete(
                    "VC+ unauthorized role creation"
                );
            } catch {}

            await sendLog(
                guild,
                "SECURITY",
                `${executor} created an unauthorized role.\nThe role was removed.`
            );
        } catch (error) {
            console.error(
                "Role create security error:",
                error
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
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleDelete,
                    role.id
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
                await guild.members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                return;
            }

            await sendLog(
                guild,
                "SECURITY",
                `${executor} deleted a role without Founder/God authorization.\n**Role:** ${role.name}`
            );
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

            if (!guild) {
                return;
            }

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
                await getRecentExecutor(
                    guild,
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
                await guild.members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                member &&
                isTrustedExecutor(
                    member
                )
            ) {
                return;
            }

            await sendLog(
                guild,
                "SECURITY",
                `${executor} created or modified a webhook in ${channel} without Founder/God authorization.`
            );
        } catch (error) {
            console.error(
                "Webhook security error:",
                error
            );
        }
    }
);

// ======================================================
// BOT JOIN
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

            const embed =
                new EmbedBuilder()
                    .setColor(0x000000)
                    .setAuthor({
                        name: "VC+"
                    })
                    .setTitle(
                        "VC+ has arrived"
                    )
                    .setDescription(`
✦ **VC+**

Voice channels, moderation, security, ranks, logging, and server protection.

Use:

\`${PREFIX}vc setup\`

to create the Join To Create system.

Use:

\`${PREFIX}help\`

to view all commands.

━━━━━━━━━━━━━━━━━━━━

**Security**
Founder and God have the highest-level server controls.

**Logs**
All important actions are recorded in:

\`jailed-logs\`
                    `)
                    .setFooter({
                        text: "VC+"
                    });

            const systemChannel =
                guild.systemChannel;

            if (
                systemChannel &&
                systemChannel
                    .permissionsFor(
                        guild.members.me
                    )
                    ?.has(
                        PermissionFlagsBits.SendMessages
                    )
            ) {
                await systemChannel.send({
                    embeds: [
                        embed
                    ]
                });
            }

            await sendLog(
                guild,
                "BOT JOINED",
                `VC+ joined **${guild.name}**.`
            );
        } catch (error) {
            console.error(
                "Guild join error:",
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
            const guild
            of client.guilds.cache.values()
        ) {
            try {
                getGuildData(
                    guild.id
                );

                await createLogSystem(
                    guild
                );
            } catch (
                error
            ) {
                console.error(
                    `Startup setup error for ${guild.name}:`,
                    error
                );
            }
        }

        console.log(
            "VC+ startup checks complete."
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

process.on(
    "uncaughtExceptionMonitor",
    error => {
        console.error(
            "Uncaught exception monitor:",
            error
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
