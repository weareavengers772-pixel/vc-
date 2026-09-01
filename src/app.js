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

// ============================================================
// VC+ CONFIG
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("Missing DISCORD_TOKEN environment variable.");
    process.exit(1);
}

// ============================================================
// RANK HIERARCHY
// ============================================================

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

// ============================================================
// DATA
// ============================================================

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let database = {};

try {
    if (fs.existsSync(DATA_FILE)) {
        database = JSON.parse(
            fs.readFileSync(DATA_FILE, "utf8")
        );
    }
} catch (error) {
    console.error("[VC+] Failed to load database:", error);
    database = {};
}

function defaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        vouches: {},

        vouchRoleId: null,

        vouchLimit: 5,

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

function getGuildData(guildId) {
    if (!database[guildId]) {
        database[guildId] = defaultGuildData();
    }

    const defaults = defaultGuildData();

    database[guildId] = {
        ...defaults,
        ...database[guildId],

        ranks: {
            ...defaults.ranks,
            ...(database[guildId].ranks || {})
        },

        godmode: database[guildId].godmode || [],

        vouches: database[guildId].vouches || {},

        jtc: {
            ...defaults.jtc,
            ...(database[guildId].jtc || {})
        },

        logs: {
            ...defaults.logs,
            ...(database[guildId].logs || {})
        },

        roles: {
            ...defaults.roles,
            ...(database[guildId].roles || {})
        },

        protection: {
            ...defaults.protection,
            ...(database[guildId].protection || {})
        },

        filter: {
            ...defaults.filter,
            ...(database[guildId].filter || {})
        }
    };

    // Normalize vouch data.
    for (const userId of Object.keys(database[guildId].vouches)) {
        if (!Array.isArray(database[guildId].vouches[userId])) {
            database[guildId].vouches[userId] = [];
        }
    }

    return database[guildId];
}

function saveData() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 4),
            "utf8"
        );
    } catch (error) {
        console.error("[VC+] Failed to save database:", error);
    }
}

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
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
});

// ============================================================
// TEMP VC STORAGE
// ============================================================

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

function isVCOwner(member, channel) {
    const vcData = getVCData(channel.id);

    if (!vcData) {
        return false;
    }

    return (
        vcData.ownerId === member.id ||
        isFounder(member) ||
        isServerOwner(member)
    );
}

// ============================================================
// EMBEDS
// ============================================================

function vcEmbed(message) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: BOT_NAME
        })
        .setDescription(`✦ ${message}`)
        .setFooter({
            text: BOT_NAME
        })
        .setTimestamp();
}

async function replySuccess(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text)
        ]
    });
}

async function replyError(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(`ERROR\n${text}`)
        ]
    });
}

async function replyInfo(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(text)
        ]
    });
}

async function replyWarning(message, text) {
    return message.reply({
        embeds: [
            vcEmbed(`WARNING\n${text}`)
        ]
    });
}

// ============================================================
// SERVER OWNER
// ============================================================

function isServerOwner(member) {
    if (!member?.guild) {
        return false;
    }

    return member.guild.ownerId === member.id;
}

// ============================================================
// RANK SYSTEM
// ============================================================

function getRank(member) {
    if (!member?.guild) {
        return 0;
    }

    const data = getGuildData(member.guild.id);

    if (isServerOwner(member)) {
        return RANKS.founder;
    }

    const storedRank = data.ranks[member.id];

    if (storedRank && RANKS[storedRank]) {
        return RANKS[storedRank];
    }

    const roleMap = [
        ["founder", RANKS.founder],
        ["god", RANKS.god],
        ["owner", RANKS.owner],
        ["coowner", RANKS.coowner],
        ["executive", RANKS.executive],
        ["director", RANKS.director],
        ["admin", RANKS.admin],
        ["moderator", RANKS.moderator],
        ["staff", RANKS.staff]
    ];

    let highest = RANKS.member;

    for (const [key, rank] of roleMap) {
        const roleId = data.roles[key];

        if (
            roleId &&
            member.roles.cache.has(roleId)
        ) {
            highest = Math.max(highest, rank);
        }
    }

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

function getRankName(member) {
    const rank = getRank(member);

    for (const [name, value] of Object.entries(RANKS)) {
        if (value === rank) {
            return RANK_NAMES[name];
        }
    }

    return "Member";
}

function isFounder(member) {
    return getRank(member) >= RANKS.founder;
}

function isGod(member) {
    return getRank(member) >= RANKS.god;
}

function isStaff(member) {
    return getRank(member) >= RANKS.staff;
}

function canManageHighLevel(member) {
    return (
        isServerOwner(member) ||
        isGod(member)
    );
}

// ============================================================
// DISCORD ROLE HIERARCHY
// ============================================================

function getHighestGuildRole(guild) {
    return guild.roles.cache
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .first();
}

function isHighestRoleTarget(member) {
    const highestGuildRole = getHighestGuildRole(
        member.guild
    );

    if (!highestGuildRole) {
        return false;
    }

    return (
        member.roles.highest.id ===
        highestGuildRole.id
    );
}

// ============================================================
// MODERATION PERMISSION CHECKS
// ============================================================

function canModerate(executor, target) {
    if (!executor || !target) {
        return false;
    }

    // Server owner can moderate anyone.
    if (isServerOwner(executor)) {
        return true;
    }

    const executorRank = getRank(executor);
    const targetRank = getRank(target);

    if (executorRank <= RANKS.member) {
        return false;
    }

    if (targetRank >= executorRank) {
        return false;
    }

    if (
        target.roles.highest.position >=
        executor.roles.highest.position
    ) {
        return false;
    }

    return true;
}

function canBan(executor, target) {
    // Server owner can ban anyone.
    if (isServerOwner(executor)) {
        return true;
    }

    // ONLY server owner can ban highest role.
    if (isHighestRoleTarget(target)) {
        return false;
    }

    return canModerate(executor, target);
}

// ============================================================
// LOG SYSTEM
// ============================================================

async function createLogSystem(guild) {
    let logChannel = guild.channels.cache.find(
        channel =>
            channel.name === "jailed-logs" &&
            channel.type === ChannelType.GuildText
    );

    if (!logChannel) {
        try {
            logChannel = await guild.channels.create({
                name: "jailed-logs",
                type: ChannelType.GuildText,
                reason: "VC+ logging system"
            });

            await logChannel.permissionOverwrites.edit(
                guild.roles.everyone,
                {
                    ViewChannel: false
                }
            );

            if (guild.members.me) {
                await logChannel.permissionOverwrites.edit(
                    guild.members.me,
                    {
                        ViewChannel: true,
                        SendMessages: true,
                        EmbedLinks: true,
                        ReadMessageHistory: true
                    }
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Failed to create jailed-logs:",
                error
            );

            return null;
        }
    }

    const data = getGuildData(guild.id);

    data.logs.channelId = logChannel.id;

    saveData();

    return logChannel;
}

async function sendLog(guild, type, description) {
    try {
        const data = getGuildData(guild.id);

        let channel = null;

        if (data.logs.channelId) {
            channel =
                guild.channels.cache.get(
                    data.logs.channelId
                );
        }

        if (!channel) {
            channel = guild.channels.cache.find(
                c =>
                    c.name === "jailed-logs" &&
                    c.type === ChannelType.GuildText
            );
        }

        if (!channel) {
            channel = await createLogSystem(guild);
        }

        if (!channel) {
            return;
        }

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x000000)
                    .setAuthor({
                        name: `${BOT_NAME} • ${type}`
                    })
                    .setDescription(description)
                    .setFooter({
                        text: BOT_NAME
                    })
                    .setTimestamp()
            ]
        });
    } catch (error) {
        console.error(
            "[VC+] Log error:",
            error
        );
    }
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

function getVouches(guild, userId) {
    const data = getGuildData(guild.id);

    if (!Array.isArray(data.vouches[userId])) {
        data.vouches[userId] = [];
    }

    return data.vouches[userId];
}

function getVouchCount(guild, userId) {
    return getVouches(
        guild,
        userId
    ).length;
}

async function applyVouchRole(guild, userId) {
    try {
        const data = getGuildData(guild.id);

        if (!data.vouchRoleId) {
            return;
        }

        const role =
            guild.roles.cache.get(
                data.vouchRoleId
            );

        if (!role) {
            return;
        }

        if (
            role.managed ||
            role.position >=
            guild.members.me.roles.highest.position
        ) {
            await sendLog(
                guild,
                "VOUCH ROLE ERROR",
                `VC+ cannot manage the configured vouch role ${role}.`
            );

            return;
        }

        const member =
            await guild.members.fetch(userId)
                .catch(() => null);

        if (!member) {
            return;
        }

        const count =
            getVouchCount(
                guild,
                userId
            );

        if (count >= data.vouchLimit) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role,
                    `Reached ${data.vouchLimit} vouches`
                );

                await sendLog(
                    guild,
                    "VOUCH ROLE",
                    `${member} received ${role} after reaching **${count} vouches**.`
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
                    `Dropped below ${data.vouchLimit} vouches`
                );

                await sendLog(
                    guild,
                    "VOUCH ROLE",
                    `${member} lost ${role} because they now have **${count} vouches**.`
                );
            }
        }
    } catch (error) {
        console.error(
            "[VC+] applyVouchRole:",
            error
        );
    }
}

async function applyVouchRoleToEveryone(guild) {
    const data = getGuildData(guild.id);

    if (!data.vouchRoleId) {
        return;
    }

    const ids = Object.keys(
        data.vouches
    );

    for (const userId of ids) {
        await applyVouchRole(
            guild,
            userId
        );
    }
}

// ============================================================
// VC PANEL
// ============================================================

function buildVCButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_lock")
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unlock")
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_kick")
                .setLabel("Kick")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_ban")
                .setLabel("Ban")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_permit")
                .setLabel("Permit")
                .setStyle(ButtonStyle.Secondary)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_rename")
                .setLabel("Rename")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_limit")
                .setLabel("Limit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_transfer")
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_claim")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_delete")
                .setLabel("Delete")
                .setStyle(ButtonStyle.Danger)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_stfu")
                .setLabel("STFU")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_unstfu")
                .setLabel("UnSTFU")
                .setStyle(ButtonStyle.Success)
        )
    ];
}

function buildVCEmbed(channel, vcData) {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+ • Voice Control"
        })
        .setTitle(channel.name)
        .setDescription(
            [
                `**Owner:** <@${vcData.ownerId}>`,
                `**Members:** ${channel.members.size}`,
                `**Limit:** ${channel.userLimit || "Unlimited"}`,
                `**Status:** ${vcData.locked ? "Locked" : "Unlocked"}`,
                "",
                "Use the buttons below to control your voice channel."
            ].join("\n")
        )
        .setFooter({
            text: "VC+"
        });
}

async function refreshVCPanel(channel) {
    const vcData = getVCData(channel.id);

    if (!vcData) {
        return;
    }

    try {
        let message = null;

        if (vcData.interfaceMessageId) {
            message =
                await channel.messages.fetch(
                    vcData.interfaceMessageId
                ).catch(() => null);
        }

        if (message) {
            await message.edit({
                embeds: [
                    buildVCEmbed(
                        channel,
                        vcData
                    )
                ],
                components: buildVCButtons()
            });

            return;
        }

        const newMessage =
            await channel.send({
                embeds: [
                    buildVCEmbed(
                        channel,
                        vcData
                    )
                ],
                components: buildVCButtons()
            });

        vcData.interfaceMessageId =
            newMessage.id;
    } catch (error) {
        console.error(
            "[VC+] Failed to refresh VC panel:",
            error
        );
    }
}

// ============================================================
// MODAL HELPERS
// ============================================================

function targetModal(customId, title, label) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("target")
                    .setLabel(label)
                    .setPlaceholder("Enter a user ID or @mention")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

function textModal(customId, title, label, placeholder) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("value")
                    .setLabel(label)
                    .setPlaceholder(placeholder)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

// ============================================================
// TARGET RESOLVER
// ============================================================

async function resolveMember(guild, input, message = null) {
    if (message?.mentions?.members?.first()) {
        return message.mentions.members.first();
    }

    const cleaned = String(input || "")
        .replace(/[<@!>]/g, "")
        .trim();

    if (!cleaned) {
        return null;
    }

    return guild.members.fetch(
        cleaned
    ).catch(() => null);
}

async function resolveInteractionMember(
    guild,
    input
) {
    const cleaned = String(input || "")
        .replace(/[<@!>]/g, "")
        .trim();

    if (!cleaned) {
        return null;
    }

    return guild.members.fetch(
        cleaned
    ).catch(() => null);
}

// ============================================================
// JTC SETUP
// ============================================================

async function setupJTC(guild) {
    const data = getGuildData(guild.id);

    let category = null;

    if (data.jtc.categoryId) {
        category =
            guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    if (
        !category ||
        category.type !== ChannelType.GuildCategory
    ) {
        category =
            guild.channels.cache.find(
                channel =>
                    channel.name === "Voice Channels" &&
                    channel.type === ChannelType.GuildCategory
            );
    }

    if (!category) {
        category =
            await guild.channels.create({
                name: "Voice Channels",
                type: ChannelType.GuildCategory,
                reason: "VC+ Join To Create setup"
            });
    }

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
            guild.channels.cache.find(
                channel =>
                    channel.name === "Join To Create" &&
                    channel.type === ChannelType.GuildVoice
            );
    }

    if (!jtc) {
        jtc =
            await guild.channels.create({
                name: "Join To Create",
                type: ChannelType.GuildVoice,
                parent: category.id,
                reason: "VC+ Join To Create setup"
            });
    }

    data.jtc.enabled = true;
    data.jtc.categoryId = category.id;
    data.jtc.channelId = jtc.id;

    saveData();

    return {
        category,
        jtc
    };
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    if (!data.jtc.enabled) {
        return null;
    }

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (!category) {
        return null;
    }

    const channel =
        await guild.channels.create({
            name: `${member.user.username} VC`,
            type: ChannelType.GuildVoice,
            parent: category.id,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak
                    ]
                }
            ],

            reason: "VC+ Join To Create"
        });

    const vcData =
        createVCData(
            guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vcData
    );

    await member.voice.setChannel(
        channel
    ).catch(() => {});

    await refreshVCPanel(channel);

    await sendLog(
        guild,
        "VC CREATED",
        `${member} created **${channel.name}**.`
    );

    return channel;
}

// ============================================================
// COMMAND HELP
// ============================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({
            name: "VC+"
        })
        .setTitle("VC+ COMMANDS")
        .setDescription(
            [
                "**VOICE CHANNELS**",
                "`-vc setup` — Setup Join To Create",
                "`-vc count` — Show VC/member counts",
                "`-vc kick @user` — Kick from your VC",
                "`-vc disconnect @user` — Disconnect user",
                "`-vc ban @user` — Ban from your VC",
                "`-vc reject @user` — Reject from your VC",
                "`-vc permit @user` — Permit a user",
                "`-vc lock` — Lock your VC",
                "`-vc unlock` — Unlock your VC",
                "`-vc transfer @user` — Transfer ownership",
                "`-vc claim` — Claim an ownerless VC",
                "`-vc forceclaim` — Founder force claim",
                "`-vc rename <name>` — Rename VC",
                "`-vc limit <number>` — Set VC limit",
                "`-vc stfu @user` — Server mute",
                "`-vc unstfu @user` — Remove STFU",
                "",
                "**MODERATION**",
                "`-ban @user [reason]`",
                "`-unban <userId>`",
                "`-unbanall` — Server owner only",
                "`-banlist`",
                "`-kick @user [reason]`",
                "`-timeout @user <minutes> [reason]`",
                "`-untimeout @user`",
                "`-foreverban @user [reason]`",
                "`-purge <amount>`",
                "`-clear <amount>`",
                "",
                "**RANKS**",
                "`-rank @user <rank>`",
                "`-godmode on/off`",
                "`-godmode @user on/off`",
                "",
                "**VOUCHES**",
                "`-vouch give @user` — Give a vouch",
                "`-vouch take @user` — Take your vouch back",
                "`-vouch count [@user]` — Count vouches",
                "`-vouch list [@user]` — List everyone",
                "`-vouch clear @user` — Server owner only",
                "`-vouch role set @role` — Set reward role",
                "`-vouch limit <number>` — Set threshold",
                "`-vouchrole view` — View vouch settings",
                "",
                "**FILTER**",
                "`-filter on/off`",
                "`-filter add <word>`",
                "`-filter remove <word>`",
                "`-filter list`",
                "`-filter log on/off`",
                "`-filter strikes <number>`",
                "`-filter reset @user`",
                "",
                "**RANK HIERARCHY**",
                "Founder",
                "God",
                "Owner",
                "Co Owner",
                "Executive",
                "Director",
                "Admin",
                "Moderator",
                "Staff",
                "Member"
            ].join("\n")
        )
        .setFooter({
            text: "VC+"
        });
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on(
    "messageCreate",
    async message => {
        if (
            message.author.bot ||
            !message.guild
        ) {
            return;
        }

        if (
            !message.content.startsWith(PREFIX)
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

        const data =
            getGuildData(
                message.guild.id
            );

        try {

            // ====================================================
            // HELP
            // ====================================================

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

            // ====================================================
            // VOUCH SYSTEM
            // ====================================================

            if (command === "vouch") {
                const sub =
                    args.shift()?.toLowerCase();

                // -----------------------------------------------
                // VOUCH GIVE
                // -----------------------------------------------

                if (sub === "give") {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "You need to mention a valid member."
                        );
                    }

                    if (target.user.bot) {
                        return replyError(
                            message,
                            "Bots cannot receive vouches."
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
                            message.guild,
                            target.id
                        );

                    if (
                        vouches.includes(
                            message.author.id
                        )
                    ) {
                        return replyError(
                            message,
                            "You already vouched for this person."
                        );
                    }

                    vouches.push(
                        message.author.id
                    );

                    saveData();

                    await applyVouchRole(
                        message.guild,
                        target.id
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH GIVEN",
                        `${message.member} vouched for ${target}.\n\n**Total:** ${vouches.length}`
                    );

                    return replySuccess(
                        message,
                        `${message.member} vouched for ${target}.\n\n**${target.user.username} now has ${vouches.length} vouch${vouches.length === 1 ? "" : "es"}.**`
                    );
                }

                // -----------------------------------------------
                // VOUCH TAKE
                // -----------------------------------------------

                if (sub === "take") {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "You need to mention a valid member."
                        );
                    }

                    const vouches =
                        getVouches(
                            message.guild,
                            target.id
                        );

                    const index =
                        vouches.indexOf(
                            message.author.id
                        );

                    if (index === -1) {
                        return replyError(
                            message,
                            "You have not vouched for this person."
                        );
                    }

                    vouches.splice(
                        index,
                        1
                    );

                    saveData();

                    await applyVouchRole(
                        message.guild,
                        target.id
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH TAKEN",
                        `${message.member} removed their vouch from ${target}.\n\n**Total:** ${vouches.length}`
                    );

                    return replySuccess(
                        message,
                        `Your vouch for ${target} has been removed.\n\n**${target.user.username} now has ${vouches.length} vouch${vouches.length === 1 ? "" : "es"}.**`
                    );
                }

                // -----------------------------------------------
                // VOUCH COUNT
                // -----------------------------------------------

                if (sub === "count") {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
                        ) ||
                        message.member;

                    const count =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    return replyInfo(
                        message,
                        `**VOUCH COUNT**\n\n${target} has **${count}** vouch${count === 1 ? "" : "es"}.\n\n**Current limit:** ${data.vouchLimit}`
                    );
                }

                // -----------------------------------------------
                // VOUCH LIST
                // -----------------------------------------------

                if (sub === "list") {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
                        ) ||
                        message.member;

                    const giverIds =
                        getVouches(
                            message.guild,
                            target.id
                        );

                    if (!giverIds.length) {
                        return replyInfo(
                            message,
                            `**VOUCH LIST**\n\n${target} has no vouches yet.`
                        );
                    }

                    const lines = [];

                    for (
                        let i = 0;
                        i < giverIds.length;
                        i++
                    ) {
                        const giver =
                            await message.guild.members
                                .fetch(giverIds[i])
                                .catch(() => null);

                        if (giver) {
                            lines.push(
                                `${i + 1}. ${giver}`
                            );
                        } else {
                            lines.push(
                                `${i + 1}. <@${giverIds[i]}>`
                            );
                        }
                    }

                    const chunks = [];

                    for (
                        let i = 0;
                        i < lines.length;
                        i += 40
                    ) {
                        chunks.push(
                            lines.slice(
                                i,
                                i + 40
                            )
                        );
                    }

                    const first =
                        chunks[0].join("\n");

                    const extra =
                        chunks.length > 1
                            ? `\n\n**+${lines.length - 40} more**`
                            : "";

                    return replyInfo(
                        message,
                        `**VOUCH LIST — ${target.user.username}**\n\n${first}${extra}\n\n**Total: ${giverIds.length}**`
                    );
                }

                // -----------------------------------------------
                // VOUCH CLEAR
                // SERVER OWNER ONLY
                // -----------------------------------------------

                if (sub === "clear") {
                    if (
                        !isServerOwner(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the server owner can clear someone's vouchers."
                        );
                    }

                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "You need to mention a valid member."
                        );
                    }

                    const oldCount =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    data.vouches[target.id] = [];

                    saveData();

                    await applyVouchRole(
                        message.guild,
                        target.id
                    );

                    await sendLog(
                        message.guild,
                        "VOUCHES CLEARED",
                        `${message.member} cleared **all ${oldCount} vouches** from ${target}.`
                    );

                    return replySuccess(
                        message,
                        `Cleared **all ${oldCount} vouches** from ${target}.\n\nThe automatic vouch role has also been re-checked.`
                    );
                }

                // -----------------------------------------------
                // VOUCH ROLE SET
                // -----------------------------------------------

                if (
                    sub === "role" &&
                    args[0]?.toLowerCase() === "set"
                ) {
                    if (
                        !canManageHighLevel(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the server owner, Founder, or God can set the vouch role."
                        );
                    }

                    const role =
                        message.mentions.roles.first();

                    if (!role) {
                        return replyError(
                            message,
                            "Mention the role you want to use as the Vouch Role."
                        );
                    }

                    if (role.managed) {
                        return replyError(
                            message,
                            "That role is managed by Discord/integration and cannot be used."
                        );
                    }

                    if (
                        role.position >=
                        message.guild.members.me.roles.highest.position
                    ) {
                        return replyError(
                            message,
                            "The Vouch Role must be below VC+'s highest role."
                        );
                    }

                    data.vouchRoleId =
                        role.id;

                    saveData();

                    await applyVouchRoleToEveryone(
                        message.guild
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH ROLE SET",
                        `${message.member} set ${role} as the automatic Vouch Role.`
                    );

                    return replySuccess(
                        message,
                        `The automatic Vouch Role is now ${role}.\n\n**Vouch limit:** ${data.vouchLimit}\n\nAnyone who reaches the limit will automatically receive this role.`
                    );
                }

                // -----------------------------------------------
                // VOUCH LIMIT
                // -----------------------------------------------

                if (sub === "limit") {
                    if (
                        !canManageHighLevel(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the server owner, Founder, or God can change the vouch limit."
                        );
                    }

                    const limit =
                        Number(args[0]);

                    if (
                        !Number.isInteger(limit) ||
                        limit < 1 ||
                        limit > 1000
                    ) {
                        return replyError(
                            message,
                            "Vouch limit must be a whole number from 1 to 1000."
                        );
                    }

                    data.vouchLimit =
                        limit;

                    saveData();

                    await applyVouchRoleToEveryone(
                        message.guild
                    );

                    await sendLog(
                        message.guild,
                        "VOUCH LIMIT",
                        `${message.member} changed the Vouch Role limit to **${limit}**.`
                    );

                    return replySuccess(
                        message,
                        `The Vouch Role limit is now **${limit}**.`
                    );
                }

                return replyInfo(
                    message,
                    [
                        "**VOUCH COMMANDS**",
                        "`-vouch give @user`",
                        "`-vouch take @user`",
                        "`-vouch count [@user]`",
                        "`-vouch list [@user]`",
                        "`-vouch clear @user` — Server owner only",
                        "`-vouch role set @role`",
                        "`-vouch limit <number>`",
                        "`-vouchrole view`"
                    ].join("\n")
                );
            }

            // ====================================================
            // VOUCH ROLE VIEW
            // ====================================================

            if (
                command === "vouchrole"
            ) {
                const role =
                    data.vouchRoleId
                        ? message.guild.roles.cache.get(
                            data.vouchRoleId
                        )
                        : null;

                return replyInfo(
                    message,
                    [
                        "**VOUCH ROLE SETTINGS**",
                        "",
                        `**Role:** ${role || "Not configured"}`,
                        `**Limit:** ${data.vouchLimit}`,
                        "",
                        role
                            ? `Reach **${data.vouchLimit} vouches** to automatically receive ${role}.`
                            : "Use `-vouch role set @role` to configure the automatic role."
                    ].join("\n")
                );
            }

            // ====================================================
            // VC COMMAND
            // ====================================================

            if (command === "vc") {
                const sub =
                    args.shift()?.toLowerCase();

                // -----------------------------------------------
                // VC SETUP
                // -----------------------------------------------

                if (sub === "setup") {
                    if (
                        !canManageHighLevel(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the server owner, Founder, or God can setup Join To Create."
                        );
                    }

                    const result =
                        await setupJTC(
                            message.guild
                        );

                    await sendLog(
                        message.guild,
                        "JTC SETUP",
                        `${message.member} enabled Join To Create.`
                    );

                    return replySuccess(
                        message,
                        `Join To Create is ready.\n\n**Category:** ${result.category.name}\n**Channel:** ${result.jtc.name}`
                    );
                }

                // -----------------------------------------------
                // VC COUNT
                // -----------------------------------------------

                if (sub === "count") {
                    const active =
                        [...tempVCs.values()]
                            .filter(
                                vc =>
                                    vc.guildId ===
                                    message.guild.id
                            );

                    const current =
                        message.member.voice.channel;

                    if (
                        current &&
                        getVCData(
                            current.id
                        )
                    ) {
                        return replyInfo(
                            message,
                            `**VC COUNT**\n\nYour VC currently has **${current.members.size} member${current.members.size === 1 ? "" : "s"}**.\n\nThere are **${active.length} active personal VCs** in this server.`
                        );
                    }

                    return replyInfo(
                        message,
                        `**VC COUNT**\n\nThere are currently **${active.length} active personal VCs** in this server.`
                    );
                }

                // -----------------------------------------------
                // VC ACTIONS
                // -----------------------------------------------

                const vcChannel =
                    message.member.voice.channel;

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
                    if (!vcChannel) {
                        return replyError(
                            message,
                            "You must be inside a managed VC."
                        );
                    }

                    const vcData =
                        getVCData(
                            vcChannel.id
                        );

                    if (!vcData) {
                        return replyError(
                            message,
                            "This is not a VC+ managed voice channel."
                        );
                    }

                    // -------------------------------------------
                    // LOCK
                    // -------------------------------------------

                    if (sub === "lock") {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can lock this VC."
                            );
                        }

                        vcData.locked = true;

                        await vcChannel.permissionOverwrites.edit(
                            message.guild.roles.everyone,
                            {
                                Connect: false
                            }
                        );

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            "Your VC is now locked."
                        );
                    }

                    // -------------------------------------------
                    // UNLOCK
                    // -------------------------------------------

                    if (sub === "unlock") {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can unlock this VC."
                            );
                        }

                        vcData.locked = false;

                        await vcChannel.permissionOverwrites.edit(
                            message.guild.roles.everyone,
                            {
                                Connect: true
                            }
                        );

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            "Your VC is now unlocked."
                        );
                    }

                    // -------------------------------------------
                    // CLAIM
                    // -------------------------------------------

                    if (sub === "claim") {
                        if (
                            vcData.ownerId ===
                            message.author.id
                        ) {
                            return replyError(
                                message,
                                "You already own this VC."
                            );
                        }

                        const oldOwner =
                            await message.guild.members.fetch(
                                vcData.ownerId
                            ).catch(() => null);

                        if (
                            oldOwner?.voice.channelId ===
                            vcChannel.id
                        ) {
                            return replyError(
                                message,
                                "The current owner is still inside the VC."
                            );
                        }

                        vcData.ownerId =
                            message.author.id;

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            `You are now the owner of **${vcChannel.name}**.`
                        );
                    }

                    // -------------------------------------------
                    // FORCE CLAIM
                    // -------------------------------------------

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

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
                            );

                        if (target) {
                            vcData.ownerId =
                                target.id;
                        } else {
                            vcData.ownerId =
                                message.author.id;
                        }

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            `VC ownership has been transferred to <@${vcData.ownerId}>.`
                        );
                    }

                    // -------------------------------------------
                    // RENAME
                    // -------------------------------------------

                    if (
                        sub === "rename"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can rename this VC."
                            );
                        }

                        const newName =
                            args.join(" ")
                                .slice(0, 100);

                        if (!newName) {
                            return replyError(
                                message,
                                "Enter a new VC name."
                            );
                        }

                        await vcChannel.setName(
                            newName
                        );

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            `VC renamed to **${newName}**.`
                        );
                    }

                    // -------------------------------------------
                    // LIMIT
                    // -------------------------------------------

                    if (
                        sub === "limit"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can change the limit."
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
                                "VC limit must be a whole number from 0 to 99."
                            );
                        }

                        await vcChannel.setUserLimit(
                            limit
                        );

                        await refreshVCPanel(
                            vcChannel
                        );

                        return replySuccess(
                            message,
                            `VC user limit set to **${limit === 0 ? "Unlimited" : limit}**.`
                        );
                    }

                    // -------------------------------------------
                    // KICK / DISCONNECT
                    // -------------------------------------------

                    if (
                        sub === "kick" ||
                        sub === "disconnect"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can kick users."
                            );
                        }

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
                            );

                        if (!target) {
                            return replyError(
                                message,
                                "Mention a valid member."
                            );
                        }

                        if (
                            target.voice.channelId !==
                            vcChannel.id
                        ) {
                            return replyError(
                                message,
                                "That user is not in your VC."
                            );
                        }

                        await target.voice.disconnect(
                            "VC+ VC kick"
                        );

                        return replySuccess(
                            message,
                            `${target} has been disconnected from the VC.`
                        );
                    }

                    // -------------------------------------------
                    // VC BAN / REJECT
                    // -------------------------------------------

                    if (
                        sub === "ban" ||
                        sub === "reject"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can ban/reject users."
                            );
                        }

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
                            );

                        if (!target) {
                            return replyError(
                                message,
                                "Mention a valid member."
                            );
                        }

                        vcData.banned.add(
                            target.id
                        );

                        await vcChannel.permissionOverwrites.edit(
                            target.id,
                            {
                                ViewChannel: false,
                                Connect: false
                            }
                        );

                        if (
                            target.voice.channelId ===
                            vcChannel.id
                        ) {
                            await target.voice.disconnect(
                                "VC+ VC ban"
                            );
                        }

                        return replySuccess(
                            message,
                            `${target} has been banned from this VC.`
                        );
                    }

                    // -------------------------------------------
                    // PERMIT
                    // -------------------------------------------

                    if (
                        sub === "permit"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcChannel
                            )
                        ) {
                            return replyError(
                                message,
                                "Only the VC owner, Founder, or server owner can permit users."
                            );
                        }

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
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

                        await vcChannel.permissionOverwrites.edit(
                            target.id,
                            {
                                ViewChannel: true,
                                Connect: true,
                                Speak: true
                            }
                        );

                        return replySuccess(
                            message,
                            `${target} has been permitted to join the VC.`
                        );
                    }

                    // -------------------------------------------
                    // STFU
                    // -------------------------------------------

                    if (
                        sub === "stfu"
                    ) {
                        if (
                            !canManageHighLevel(
                                message.member
                            )
                        ) {
                            return replyError(
                                message,
                                "Only Founder, God, or the server owner can use STFU."
                            );
                        }

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
                            );

                        if (!target) {
                            return replyError(
                                message,
                                "Mention a valid member."
                            );
                        }

                        vcData.stfu.add(
                            target.id
                        );

                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        ).catch(() => {});

                        return replySuccess(
                            message,
                            `${target} has been STFU'd in this VC.`
                        );
                    }

                    // -------------------------------------------
                    // UNSTFU
                    // -------------------------------------------

                    if (
                        sub === "unstfu"
                    ) {
                        if (
                            !canManageHighLevel(
                                message.member
                            )
                        ) {
                            return replyError(
                                message,
                                "Only Founder, God, or the server owner can use UnSTFU."
                            );
                        }

                        const target =
                            await resolveMember(
                                message.guild,
                                args[0],
                                message
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

                        await target.voice.setMute(
                            false,
                            "VC+ UnSTFU"
                        ).catch(() => {});

                        return replySuccess(
                            message,
                            `${target} has been UnSTFU'd.`
                        );
                    }
                }

                return replyInfo(
                    message,
                    "Use `-help` to see all VC+ voice commands."
                );
            }

            // ====================================================
            // BAN
            // ====================================================

            if (command === "ban") {
                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                if (
                    target.id ===
                    message.author.id
                ) {
                    return replyError(
                        message,
                        "You cannot ban yourself."
                    );
                }

                if (
                    !canBan(
                        message.member,
                        target
                    )
                ) {
                    if (
                        isHighestRoleTarget(
                            target
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the server owner can ban the member with the highest server role."
                        );
                    }

                    return replyError(
                        message,
                        "You cannot ban someone with an equal or higher rank."
                    );
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided";

                try {
                    await target.ban({
                        reason
                    });

                    await sendLog(
                        message.guild,
                        "BAN",
                        `${message.member} banned ${target}.\n\n**Reason:** ${reason}`
                    );

                    return replySuccess(
                        message,
                        `${target} has been banned.\n\n**Reason:** ${reason}`
                    );
                } catch (error) {
                    console.error(
                        "[VC+] Ban error:",
                        error
                    );

                    return replyError(
                        message,
                        "Discord refused the ban. Make sure VC+'s bot role is higher than the target's highest role and that it has Ban Members permission."
                    );
                }
            }

            // ====================================================
            // UNBAN
            // ====================================================

            if (command === "unban") {
                if (
                    !canManageHighLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the server owner, Founder, or God can unban users."
                    );
                }

                const userId =
                    args[0];

                if (!/^\d{17,20}$/.test(userId || "")) {
                    return replyError(
                        message,
                        "Enter a valid Discord user ID."
                    );
                }

                try {
                    await message.guild.bans.remove(
                        userId,
                        "VC+ unban"
                    );

                    return replySuccess(
                        message,
                        `<@${userId}> has been unbanned.`
                    );
                } catch {
                    return replyError(
                        message,
                        "That user is not banned or the user ID is invalid."
                    );
                }
            }

            // ====================================================
            // UNBAN ALL
            // SERVER OWNER ONLY
            // ====================================================

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
                        "Only the server owner can use -unbanall."
                    );
                }

                const bans =
                    await message.guild.bans.fetch();

                let count = 0;

                for (const [userId] of bans) {
                    await message.guild.bans.remove(
                        userId,
                        "VC+ unbanall"
                    ).catch(() => {});

                    count++;
                }

                await sendLog(
                    message.guild,
                    "UNBAN ALL",
                    `${message.member} unbanned **${count} users**.`
                );

                return replySuccess(
                    message,
                    `Unbanned **${count} users** from the server.`
                );
            }

            // ====================================================
            // BANLIST
            // ====================================================

            if (
                command === "banlist"
            ) {
                const bans =
                    await message.guild.bans.fetch();

                if (!bans.size) {
                    return replyInfo(
                        message,
                        "There are no banned users."
                    );
                }

                const list =
                    [...bans.values()]
                        .slice(0, 50)
                        .map(
                            (ban, index) =>
                                `${index + 1}. ${ban.user.tag}`
                        )
                        .join("\n");

                return replyInfo(
                    message,
                    `**BAN LIST**\n\n${list}\n\n**Total:** ${bans.size}`
                );
            }

            // ====================================================
            // KICK
            // ====================================================

            if (
                command === "kick"
            ) {
                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot kick someone with an equal or higher rank."
                    );
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided";

                await target.kick(
                    reason
                ).catch(() => null);

                await sendLog(
                    message.guild,
                    "KICK",
                    `${message.member} kicked ${target}.\n\n**Reason:** ${reason}`
                );

                return replySuccess(
                    message,
                    `${target} has been kicked.\n\n**Reason:** ${reason}`
                );
            }

            // ====================================================
            // TIMEOUT
            // ====================================================

            if (
                command === "timeout"
            ) {
                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot timeout someone with an equal or higher rank."
                    );
                }

                const minutes =
                    Number(args[1]);

                if (
                    !Number.isInteger(minutes) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Timeout must be between 1 minute and 28 days."
                    );
                }

                const reason =
                    args.slice(2).join(" ") ||
                    "No reason provided";

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                await sendLog(
                    message.guild,
                    "TIMEOUT",
                    `${message.member} timed out ${target} for **${minutes} minutes**.\n\n**Reason:** ${reason}`
                );

                return replySuccess(
                    message,
                    `${target} has been timed out for **${minutes} minutes**.`
                );
            }

            // ====================================================
            // UNTIMEOUT
            // ====================================================

            if (
                command === "untimeout"
            ) {
                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot remove the timeout from someone with an equal or higher rank."
                    );
                }

                await target.timeout(
                    null,
                    "VC+ untimeout"
                );

                return replySuccess(
                    message,
                    `${target} is no longer timed out.`
                );
            }

            // ====================================================
            // FOREVER BAN
            // ====================================================

            if (
                command === "foreverban"
            ) {
                if (
                    !canManageHighLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the server owner, Founder, or God can use foreverban."
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "Forever banned";

                if (
                    !data.foreverBanned.includes(
                        target.id
                    )
                ) {
                    data.foreverBanned.push(
                        target.id
                    );
                }

                saveData();

                await target.ban({
                    reason
                }).catch(() => {});

                await sendLog(
                    message.guild,
                    "FOREVER BAN",
                    `${message.member} forever banned ${target}.\n\n**Reason:** ${reason}`
                );

                return replySuccess(
                    message,
                    `${target} is now permanently blocked from rejoining this server.`
                );
            }

            // ====================================================
            // PURGE / CLEAR
            // ====================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    getRank(
                        message.member
                    ) < RANKS.moderator &&
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You need Moderator rank or higher."
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
                        "Enter an amount from 1 to 100."
                    );
                }

                const deleted =
                    await message.channel.bulkDelete(
                        amount,
                        true
                    );

                return replySuccess(
                    message,
                    `Deleted **${deleted.size} messages**.`
                );
            }

            // ====================================================
            // RANK
            // ====================================================

            if (
                command === "rank"
            ) {
                if (
                    !canManageHighLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the server owner, Founder, or God can manage ranks."
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                const rank =
                    args[1]?.toLowerCase();

                if (!target) {
                    return replyError(
                        message,
                        "Mention a valid member."
                    );
                }

                if (
                    !rank ||
                    !RANKS[rank]
                ) {
                    return replyError(
                        message,
                        `Valid ranks:\n${Object.keys(RANKS).join(", ")}`
                    );
                }

                if (
                    RANKS[rank] >=
                    getRank(
                        message.member
                    ) &&
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot assign a rank equal to or higher than your own."
                    );
                }

                data.ranks[target.id] =
                    rank;

                saveData();

                await sendLog(
                    message.guild,
                    "RANK",
                    `${message.member} gave ${target} the **${RANK_NAMES[rank]}** rank.`
                );

                return replySuccess(
                    message,
                    `${target} is now ranked **${RANK_NAMES[rank]}**.`
                );
            }

            // ====================================================
            // GODMODE
            // ====================================================

            if (
                command === "godmode"
            ) {
                if (
                    !canManageHighLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the server owner, Founder, or God can manage godmode."
                    );
                }

                if (
                    args[0]?.toLowerCase() ===
                    "on"
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

                    saveData();

                    return replySuccess(
                        message,
                        "Godmode enabled for you."
                    );
                }

                if (
                    args[0]?.toLowerCase() ===
                    "off"
                ) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                message.author.id
                        );

                    saveData();

                    return replySuccess(
                        message,
                        "Godmode disabled for you."
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0],
                        message
                    );

                const setting =
                    args[1]?.toLowerCase();

                if (
                    target &&
                    ["on", "off"].includes(
                        setting
                    )
                ) {
                    if (
                        setting === "on" &&
                        !data.godmode.includes(
                            target.id
                        )
                    ) {
                        data.godmode.push(
                            target.id
                        );
                    }

                    if (
                        setting === "off"
                    ) {
                        data.godmode =
                            data.godmode.filter(
                                id =>
                                    id !==
                                    target.id
                            );
                    }

                    saveData();

                    return replySuccess(
                        message,
                        `Godmode ${setting === "on" ? "enabled" : "disabled"} for ${target}.`
                    );
                }

                return replyInfo(
                    message,
                    "`-godmode on`\n`-godmode off`\n`-godmode @user on`\n`-godmode @user off`"
                );
            }

            // ====================================================
            // FILTER
            // ====================================================

            if (
                command === "filter"
            ) {
                if (
                    !canManageHighLevel(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Only the server owner, Founder, or God can manage the filter."
                    );
                }

                const sub =
                    args.shift()?.toLowerCase();

                if (
                    sub === "on"
                ) {
                    data.filter.enabled =
                        true;

                    saveData();

                    return replySuccess(
                        message,
                        "Message filter enabled."
                    );
                }

                if (
                    sub === "off"
                ) {
                    data.filter.enabled =
                        false;

                    saveData();

                    return replySuccess(
                        message,
                        "Message filter disabled."
                    );
                }

                if (
                    sub === "add"
                ) {
                    const word =
                        args.join(" ").toLowerCase();

                    if (!word) {
                        return replyError(
                            message,
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

                    saveData();

                    return replySuccess(
                        message,
                        `Added **${word}** to the filter.`
                    );
                }

                if (
                    sub === "remove"
                ) {
                    const word =
                        args.join(" ").toLowerCase();

                    data.filter.words =
                        data.filter.words.filter(
                            x => x !== word
                        );

                    saveData();

                    return replySuccess(
                        message,
                        `Removed **${word}** from the filter.`
                    );
                }

                if (
                    sub === "list"
                ) {
                    return replyInfo(
                        message,
                        data.filter.words.length
                            ? `**FILTER WORDS**\n\n${data.filter.words.join("\n")}`
                            : "No filter words configured."
                    );
                }

                if (
                    sub === "log"
                ) {
                    const setting =
                        args[0]?.toLowerCase();

                    if (
                        setting !== "on" &&
                        setting !== "off"
                    ) {
                        return replyError(
                            message,
                            "Use `-filter log on` or `-filter log off`."
                        );
                    }

                    data.filter.log =
                        setting === "on";

                    saveData();

                    return replySuccess(
                        message,
                        `Filter logging turned ${setting}.`
                    );
                }

                if (
                    sub === "strikes"
                ) {
                    const number =
                        Number(args[0]);

                    if (
                        !Number.isInteger(number) ||
                        number < 1 ||
                        number > 20
                    ) {
                        return replyError(
                            message,
                            "Strike limit must be 1-20."
                        );
                    }

                    data.filter.maxStrikes =
                        number;

                    saveData();

                    return replySuccess(
                        message,
                        `Filter strike limit set to **${number}**.`
                    );
                }

                if (
                    sub === "reset"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0],
                            message
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

                    saveData();

                    return replySuccess(
                        message,
                        `Reset filter strikes for ${target}.`
                    );
                }

                return replyInfo(
                    message,
                    [
                        "`-filter on`",
                        "`-filter off`",
                        "`-filter add <word>`",
                        "`-filter remove <word>`",
                        "`-filter list`",
                        "`-filter log on/off`",
                        "`-filter strikes <number>`",
                        "`-filter reset @user`"
                    ].join("\n")
                );
            }

        } catch (error) {
            console.error(
                "[VC+] COMMAND ERROR:",
                error
            );

            return replyError(
                message,
                "Something went wrong while processing that command. The error was caught so VC+ can keep running."
            );
        }
    }
);

// ============================================================
// BUTTON INTERACTIONS
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        if (
            !interaction.isButton() &&
            !interaction.isModalSubmit()
        ) {
            return;
        }

        try {

            // ====================================================
            // BUTTONS
            // ====================================================

            if (interaction.isButton()) {
                const member =
                    await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                const channel =
                    member.voice.channel;

                if (!channel) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "You must be inside the managed VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const vcData =
                    getVCData(
                        channel.id
                    );

                if (!vcData) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This is not a VC+ managed VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const owner =
                    isVCOwner(
                        member,
                        channel
                    );

                // LOCK
                if (
                    interaction.customId ===
                    "vc_lock"
                ) {
                    if (!owner) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only the VC owner, Founder, or server owner can do this."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.locked = true;

                    await channel.permissionOverwrites.edit(
                        interaction.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "VC locked."
                            )
                        ],
                        ephemeral: true
                    });
                }

                // UNLOCK
                if (
                    interaction.customId ===
                    "vc_unlock"
                ) {
                    if (!owner) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only the VC owner, Founder, or server owner can do this."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.locked = false;

                    await channel.permissionOverwrites.edit(
                        interaction.guild.roles.everyone,
                        {
                            Connect: true
                        }
                    );

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "VC unlocked."
                            )
                        ],
                        ephemeral: true
                    });
                }

                // CLAIM
                if (
                    interaction.customId ===
                    "vc_claim"
                ) {
                    const oldOwner =
                        await interaction.guild.members.fetch(
                            vcData.ownerId
                        ).catch(() => null);

                    if (
                        oldOwner?.voice.channelId ===
                        channel.id
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "The current owner is still inside the VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.ownerId =
                        interaction.user.id;

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "You now own this VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                // DELETE
                if (
                    interaction.customId ===
                    "vc_delete"
                ) {
                    if (!owner) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only the VC owner, Founder, or server owner can delete this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    tempVCs.delete(
                        channel.id
                    );

                    await channel.delete(
                        "VC+ VC deleted"
                    );

                    return;
                }

                // MODAL BUTTONS
                const modalMap = {
                    vc_kick: [
                        "vc_modal_kick",
                        "Kick User",
                        "User",
                        "Enter user ID"
                    ],

                    vc_ban: [
                        "vc_modal_ban",
                        "Ban User",
                        "User",
                        "Enter user ID"
                    ],

                    vc_permit: [
                        "vc_modal_permit",
                        "Permit User",
                        "User",
                        "Enter user ID"
                    ],

                    vc_transfer: [
                        "vc_modal_transfer",
                        "Transfer VC",
                        "New Owner",
                        "Enter user ID"
                    ],

                    vc_stfu: [
                        "vc_modal_stfu",
                        "STFU User",
                        "User",
                        "Enter user ID"
                    ],

                    vc_unstfu: [
                        "vc_modal_unstfu",
                        "UnSTFU User",
                        "User",
                        "Enter user ID"
                    ],

                    vc_rename: [
                        "vc_modal_rename",
                        "Rename VC",
                        "New Name",
                        "Enter new VC name"
                    ],

                    vc_limit: [
                        "vc_modal_limit",
                        "VC Limit",
                        "Limit",
                        "Enter number"
                    ]
                };

                if (
                    modalMap[
                        interaction.customId
                    ]
                ) {
                    if (
                        !owner &&
                        ![
                            "vc_stfu",
                            "vc_unstfu"
                        ].includes(
                            interaction.customId
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only the VC owner, Founder, or server owner can use this."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (
                        [
                            "vc_stfu",
                            "vc_unstfu"
                        ].includes(
                            interaction.customId
                        ) &&
                        !canManageHighLevel(
                            member
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only Founder, God, or the server owner can use this."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const [
                        customId,
                        title,
                        label,
                        placeholder
                    ] =
                        modalMap[
                            interaction.customId
                        ];

                    return interaction.showModal(
                        targetModal(
                            customId,
                            title,
                            label
                        )
                    );
                }
            }

            // ====================================================
            // MODALS
            // ====================================================

            if (
                interaction.isModalSubmit()
            ) {
                const member =
                    await interaction.guild.members.fetch(
                        interaction.user.id
                    );

                const channel =
                    member.voice.channel;

                if (!channel) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "You must be inside your managed VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const vcData =
                    getVCData(
                        channel.id
                    );

                if (!vcData) {
                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                "This is not a VC+ managed VC."
                            )
                        ],
                        ephemeral: true
                    });
                }

                const value =
                    interaction.fields.getTextInputValue(
                        interaction.fields.fields.first().customId
                    );

                // KICK
                if (
                    interaction.customId ===
                    "vc_modal_kick"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await target.voice.disconnect(
                        "VC+ panel kick"
                    ).catch(() => {});

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} was disconnected.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // BAN
                if (
                    interaction.customId ===
                    "vc_modal_ban"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.banned.add(
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
                        await target.voice.disconnect(
                            "VC+ panel ban"
                        ).catch(() => {});
                    }

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} was banned from this VC.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // PERMIT
                if (
                    interaction.customId ===
                    "vc_modal_permit"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
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

                    await channel.permissionOverwrites.edit(
                        target.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true
                        }
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} can now join this VC.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // TRANSFER
                if (
                    interaction.customId ===
                    "vc_modal_transfer"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
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
                                    "The new owner must be inside this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.ownerId =
                        target.id;

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `Ownership transferred to ${target}.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // STFU
                if (
                    interaction.customId ===
                    "vc_modal_stfu"
                ) {
                    if (
                        !canManageHighLevel(
                            member
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only Founder, God, or the server owner can use STFU."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
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
                    ).catch(() => {});

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} is now STFU'd.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // UNSTFU
                if (
                    interaction.customId ===
                    "vc_modal_unstfu"
                ) {
                    if (
                        !canManageHighLevel(
                            member
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Only Founder, God, or the server owner can use UnSTFU."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const target =
                        await resolveInteractionMember(
                            interaction.guild,
                            value
                        );

                    if (!target) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Invalid user."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    vcData.stfu.delete(
                        target.id
                    );

                    await target.voice.setMute(
                        false,
                        "VC+ UnSTFU"
                    ).catch(() => {});

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `${target} is no longer STFU'd.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // RENAME
                if (
                    interaction.customId ===
                    "vc_modal_rename"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const newName =
                        value.slice(0, 100);

                    await channel.setName(
                        newName
                    );

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `VC renamed to **${newName}**.`
                            )
                        ],
                        ephemeral: true
                    });
                }

                // LIMIT
                if (
                    interaction.customId ===
                    "vc_modal_limit"
                ) {
                    if (
                        !isVCOwner(
                            member,
                            channel
                        )
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "You do not control this VC."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    const limit =
                        Number(value);

                    if (
                        !Number.isInteger(limit) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        return interaction.reply({
                            embeds: [
                                vcEmbed(
                                    "Limit must be from 0 to 99."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    await channel.setUserLimit(
                        limit
                    );

                    await refreshVCPanel(
                        channel
                    );

                    return interaction.reply({
                        embeds: [
                            vcEmbed(
                                `VC limit set to **${limit === 0 ? "Unlimited" : limit}**.`
                            )
                        ],
                        ephemeral: true
                    });
                }
            }

        } catch (error) {
            console.error(
                "[VC+] INTERACTION ERROR:",
                error
            );

            if (!interaction.replied) {
                await interaction.reply({
                    embeds: [
                        vcEmbed(
                            "Something went wrong, but VC+ caught the error and stayed online."
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ============================================================
// VOICE STATE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) {
                return;
            }

            // -----------------------------------------------
            // JTC
            // -----------------------------------------------

            const data =
                getGuildData(
                    guild.id
                );

            if (
                newState.channelId &&
                newState.channelId ===
                data.jtc.channelId
            ) {
                const member =
                    newState.member;

                if (member) {
                    await createPersonalVC(
                        member
                    );
                }
            }

            // -----------------------------------------------
            // STFU PROTECTION
            // -----------------------------------------------

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
                        newState.id
                    )
                ) {
                    if (
                        !newState.serverMute
                    ) {
                        await newState.setMute(
                            true,
                            "VC+ STFU protection"
                        ).catch(() => {});
                    }
                }
            }

            // -----------------------------------------------
            // DELETE EMPTY VC
            // -----------------------------------------------

            if (
                oldState.channelId
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (oldChannel) {
                    const vcData =
                        getVCData(
                            oldChannel.id
                        );

                    if (
                        vcData &&
                        oldChannel.members.size === 0
                    ) {
                        tempVCs.delete(
                            oldChannel.id
                        );

                        await oldChannel.delete(
                            "VC+ empty personal VC"
                        ).catch(() => {});
                    }
                }
            }

        } catch (error) {
            console.error(
                "[VC+] voiceStateUpdate:",
                error
            );
        }
    }
);

// ============================================================
// MESSAGE FILTER
// ============================================================

client.on(
    "messageCreate",
    async message => {
        if (
            message.author.bot ||
            !message.guild
        ) {
            return;
        }

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

        if (
            message.content.startsWith(
                PREFIX
            )
        ) {
            return;
        }

        const content =
            message.content.toLowerCase();

        const found =
            data.filter.words.find(
                word =>
                    content.includes(
                        word.toLowerCase()
                    )
            );

        if (!found) {
            return;
        }

        if (
            isStaff(
                message.member
            )
        ) {
            return;
        }

        await message.delete()
            .catch(() => {});

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

        saveData();

        if (
            data.filter.log
        ) {
            await sendLog(
                message.guild,
                "FILTER",
                `${message.member} triggered the message filter.\n\n**Word:** ||${found}||\n**Strike:** ${strikes}/${data.filter.maxStrikes}`
            );
        }

        if (
            strikes >=
            data.filter.maxStrikes
        ) {
            await message.member.timeout(
                10 * 60 * 1000,
                "VC+ message filter"
            ).catch(() => {});

            data.filter.strikes[
                message.author.id
            ] = 0;

            saveData();

            await sendLog(
                message.guild,
                "FILTER TIMEOUT",
                `${message.member} reached the maximum filter strikes and was timed out for 10 minutes.`
            );
        }
    }
);

// ============================================================
// FOREVER BAN PROTECTION
// ============================================================

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
                    reason: "VC+ Forever Ban"
                });

                await sendLog(
                    member.guild,
                    "FOREVER BAN BLOCK",
                    `${member.user.tag} attempted to rejoin and was automatically banned again.`
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Forever ban error:",
                error
            );
        }
    }
);

// ============================================================
// ANTI-NUKE AUDIT LOG HELPER
// ============================================================

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
                item =>
                    (!targetId ||
                        item.target?.id ===
                        targetId) &&
                    Date.now() -
                    item.createdTimestamp <
                    15000
            );

        return entry?.executor || null;
    } catch {
        return null;
    }
}

async function isTrustedExecutor(
    guild,
    userId
) {
    if (!userId) {
        return false;
    }

    if (
        userId ===
        client.user.id
    ) {
        return true;
    }

    const member =
        await guild.members.fetch(
            userId
        ).catch(() => null);

    if (!member) {
        return false;
    }

    return (
        isFounder(member) ||
        isGod(member) ||
        isServerOwner(member)
    );
}

// ============================================================
// ANTI-NUKE: CHANNEL CREATE
// ============================================================

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
            channel.name ===
            "jailed-logs"
        ) {
            return;
        }

        if (
            data.jtc.channelId ===
            channel.id
        ) {
            return;
        }

        if (
            channel.parentId ===
            data.jtc.categoryId
        ) {
            const vcData =
                getVCData(
                    channel.id
                );

            if (vcData) {
                return;
            }
        }

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

        if (
            await isTrustedExecutor(
                channel.guild,
                executor?.id
            )
        ) {
            return;
        }

        await channel.delete(
            "VC+ Anti-Nuke: unauthorized channel creation"
        ).catch(() => {});

        await sendLog(
            channel.guild,
            "ANTI-NUKE",
            `Unauthorized channel creation detected.\n\n**Executor:** ${executor ? `<@${executor.id}>` : "Unknown"}\n**Channel:** ${channel.name}\n\nVC+ removed the channel.`
        );
    }
);

// ============================================================
// ANTI-NUKE: CHANNEL DELETE
// ============================================================

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

        if (
            await isTrustedExecutor(
                channel.guild,
                executor?.id
            )
        ) {
            return;
        }

        await sendLog(
            channel.guild,
            "ANTI-NUKE",
            `Unauthorized channel deletion detected.\n\n**Executor:** ${executor ? `<@${executor.id}>` : "Unknown"}\n**Channel:** ${channel.name}`
        );
    }
);

// ============================================================
// ANTI-NUKE: ROLE CREATE
// ============================================================

client.on(
    "roleCreate",
    async role => {
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
            await getRecentExecutor(
                role.guild,
                AuditLogEvent.RoleCreate,
                role.id
            );

        if (
            await isTrustedExecutor(
                role.guild,
                executor?.id
            )
        ) {
            return;
        }

        await role.delete(
            "VC+ Anti-Nuke: unauthorized role creation"
        ).catch(() => {});

        await sendLog(
            role.guild,
            "ANTI-NUKE",
            `Unauthorized role creation detected.\n\n**Executor:** ${executor ? `<@${executor.id}>` : "Unknown"}\n**Role:** ${role.name}\n\nVC+ removed the role.`
        );
    }
);

// ============================================================
// ANTI-NUKE: ROLE DELETE
// ============================================================

client.on(
    "roleDelete",
    async role => {
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
            await getRecentExecutor(
                role.guild,
                AuditLogEvent.RoleDelete,
                role.id
            );

        if (
            await isTrustedExecutor(
                role.guild,
                executor?.id
            )
        ) {
            return;
        }

        await sendLog(
            role.guild,
            "ANTI-NUKE",
            `Unauthorized role deletion detected.\n\n**Executor:** ${executor ? `<@${executor.id}>` : "Unknown"}\n**Role:** ${role.name}`
        );
    }
);

// ============================================================
// WEBHOOK PROTECTION
// ============================================================

client.on(
    "webhooksUpdate",
    async channel => {
        if (!channel.guild) {
            return;
        }

        const data =
            getGuildData(
                channel.guild.id
            );

        if (
            !data.protection.webhookCreate
        ) {
            return;
        }

        const executor =
            await getRecentExecutor(
                channel.guild,
                AuditLogEvent.WebhookCreate
            );

        if (
            await isTrustedExecutor(
                channel.guild,
                executor?.id
            )
        ) {
            return;
        }

        await sendLog(
            channel.guild,
            "ANTI-NUKE",
            `Unauthorized webhook change detected.\n\n**Executor:** ${executor ? `<@${executor.id}>` : "Unknown"}\n**Channel:** ${channel}`
        );
    }
);

// ============================================================
// GUILD JOIN
// ============================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            getGuildData(
                guild.id
            );

            saveData();

            await createLogSystem(
                guild
            );

            const owner =
                await guild.members.fetch(
                    guild.ownerId
                ).catch(() => null);

            if (owner) {
                await owner.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x000000)
                            .setAuthor({
                                name: "VC+"
                            })
                            .setTitle(
                                "VC+ IS READY"
                            )
                            .setDescription(
                                [
                                    "Thanks for adding VC+.",
                                    "",
                                    "**Features:**",
                                    "• Join To Create",
                                    "• VC controls",
                                    "• Moderation",
                                    "• Vouch system",
                                    "• Automatic Vouch Role",
                                    "• Anti-Nuke protection",
                                    "• Persistent configuration",
                                    "",
                                    "Use `-help` to see the commands."
                                ].join("\n")
                            )
                            .setFooter({
                                text: "VC+"
                            })
                    ]
                }).catch(() => {});
            }

            await sendLog(
                guild,
                "BOT JOINED",
                `VC+ joined **${guild.name}**.`
            );

        } catch (error) {
            console.error(
                "[VC+] Guild join error:",
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
    async () => {
        console.log(
            `[VC+] Logged in as ${client.user.tag}`
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

        for (const guild of client.guilds.cache.values()) {
            try {
                getGuildData(
                    guild.id
                );

                await createLogSystem(
                    guild
                );

                saveData();
            } catch (error) {
                console.error(
                    `[VC+] Startup error in ${guild.name}:`,
                    error
                );
            }
        }

        console.log(
            `[VC+] Connected to ${client.guilds.cache.size} server(s).`
        );
    }
);

// ============================================================
// ERROR PROTECTION
// ============================================================

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+] UNHANDLED REJECTION:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[VC+] UNCAUGHT EXCEPTION:",
            error
        );
    }
);

process.on(
    "warning",
    warning => {
        console.warn(
            "[VC+] NODE WARNING:",
            warning
        );
    }
);

client.on(
    "error",
    error => {
        console.error(
            "[VC+] CLIENT ERROR:",
            error
        );
    }
);

client.on(
    "shardError",
    error => {
        console.error(
            "[VC+] SHARD ERROR:",
            error
        );
    }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
