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

let db = {
    guilds: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            saveDB();
            return;
        }

        const raw = fs.readFileSync(DATA_FILE, "utf8");

        if (!raw.trim()) {
            saveDB();
            return;
        }

        db = JSON.parse(raw);

        if (!db.guilds) {
            db.guilds = {};
        }
    } catch (error) {
        console.error("[DATABASE LOAD ERROR]", error);

        db = {
            guilds: {}
        };

        saveDB();
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 4)
        );
    } catch (error) {
        console.error("[DATABASE SAVE ERROR]", error);
    }
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaultGuildData();
        saveDB();
    }

    return db.guilds[guildId];
}

loadDB();

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

    if (data.ranks[member.id]) {
        return normalizeRank(data.ranks[member.id]);
    }

    if (
        member.permissions &&
        member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
        return "admin";
    }

    let highest = "member";
    let highestLevel = 1;

    for (const [rank, roleId] of Object.entries(data.roles)) {
        if (!roleId) continue;

        const role = member.guild.roles.cache.get(roleId);

        if (!role) continue;

        if (member.roles.cache.has(role.id)) {
            const level = RANKS[rank] || 1;

            if (level > highestLevel) {
                highestLevel = level;
                highest = rank;
            }
        }
    }

    return highest;
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
    return getRankLevel(member) >= RANKS.god;
}

// ======================================================
// AESTHETIC BOT EMBEDS
// ======================================================

function baseEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setFooter({
            text: "VC+ • Text Commands"
        })
        .setTimestamp();
}

function successEmbed(title, description) {
    return baseEmbed()
        .setTitle(`✓  ${title}`)
        .setDescription(description);
}

function errorEmbed(title, description) {
    return baseEmbed()
        .setColor(0xED4245)
        .setTitle(`✕  ${title}`)
        .setDescription(description);
}

function infoEmbed(title, description) {
    return baseEmbed()
        .setTitle(`◆  ${title}`)
        .setDescription(description);
}

function warningEmbed(title, description) {
    return baseEmbed()
        .setColor(0xFEE75C)
        .setTitle(`!  ${title}`)
        .setDescription(description);
}

async function replySuccess(message, title, description) {
    return message.reply({
        embeds: [
            successEmbed(title, description)
        ]
    });
}

async function replyError(message, title, description) {
    return message.reply({
        embeds: [
            errorEmbed(title, description)
        ]
    });
}

async function replyInfo(message, title, description) {
    return message.reply({
        embeds: [
            infoEmbed(title, description)
        ]
    });
}

async function replyWarning(message, title, description) {
    return message.reply({
        embeds: [
            warningEmbed(title, description)
        ]
    });
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
// TEMP VC SYSTEM
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

        locked: false
    };
}

// ======================================================
// LOGGING
// ======================================================

async function sendLog(
    guild,
    type,
    description,
    mod = false
) {
    try {
        const data = getGuildData(guild.id);

        const channelId = mod
            ? data.logs.modLogChannelId
            : data.logs.serverLogChannelId;

        if (!channelId) return;

        const channel =
            guild.channels.cache.get(channelId);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor(mod ? 0xED4245 : 0x5865F2)
            .setTitle(`◆ ${type}`)
            .setDescription(description)
            .setFooter({
                text: "VC+ • Private Logs"
            })
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error("[LOG ERROR]", error);
    }
}

// ======================================================
// PRIVATE LOG PERMISSIONS
// ======================================================

async function updateLogPermissions(channel) {
    try {
        await channel.permissionOverwrites.edit(
            channel.guild.roles.everyone,
            {
                ViewChannel: false
            }
        );

        await channel.permissionOverwrites.edit(
            client.user.id,
            {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            }
        );

        const data = getGuildData(channel.guild.id);

        for (const roleName of ["founder", "god"]) {
            const roleId = data.roles[roleName];

            if (!roleId) continue;

            const role =
                channel.guild.roles.cache.get(roleId);

            if (!role) continue;

            await channel.permissionOverwrites.edit(
                role,
                {
                    ViewChannel: true,
                    ReadMessageHistory: true,
                    SendMessages: true
                }
            );
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
        category =
            guild.channels.cache.get(
                data.logs.categoryId
            );
    }

    if (!category) {
        category =
            await guild.channels.create({
                name: "VC+ Logs",
                type: ChannelType.GuildCategory
            });

        data.logs.categoryId = category.id;
    }

    let serverLogs =
        data.logs.serverLogChannelId
            ? guild.channels.cache.get(
                data.logs.serverLogChannelId
            )
            : null;

    if (!serverLogs) {
        serverLogs =
            await guild.channels.create({
                name: "server-logs",
                type: ChannelType.GuildText,
                parent: category.id
            });

        data.logs.serverLogChannelId =
            serverLogs.id;
    }

    let modLogs =
        data.logs.modLogChannelId
            ? guild.channels.cache.get(
                data.logs.modLogChannelId
            )
            : null;

    if (!modLogs) {
        modLogs =
            await guild.channels.create({
                name: "mod-logs",
                type: ChannelType.GuildText,
                parent: category.id
            });

        data.logs.modLogChannelId =
            modLogs.id;
    }

    await updateLogPermissions(serverLogs);
    await updateLogPermissions(modLogs);

    saveDB();
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
    try {
        const embed =
            new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`VC+ • ${action}`)
                .setDescription(
`You received a moderation action in **${guild.name}**.

**Action**
${action}

**Reason**
${reason}

${duration ? `**Duration**\n${duration}` : ""}`
                )
                .setTimestamp();

        await user.send({
            embeds: [embed]
        });
    } catch {
        // DMs disabled
    }
}

// ======================================================
// VC INTERFACE
// ======================================================

async function updateVCInterface(channel) {
    // Intentionally disabled.
    // VC+ uses normal bot command responses only.
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(member) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    if (!data.jtc.enabled) return;

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (!category) return;

    const safeName =
        member.user.username
            .replace(/[^a-zA-Z0-9_-]/g, "")
            .slice(0, 20) || "User";

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
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.UseVAD
                    ]
                },

                {
                    id: member.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
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
        await member.voice.setChannel(channel);
    } catch {}

    await sendLog(
        guild,
        "Voice Channel Created",
        `${member} created ${channel}.`
    );
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(channel) {
    if (!channel) return;

    const data =
        tempVCs.get(channel.id);

    if (!data) return;

    if (channel.members.size > 0) return;

    tempVCs.delete(channel.id);

    await sendLog(
        channel.guild,
        "Voice Channel Deleted",
        `Temporary VC **${channel.name}** was deleted because it became empty.`
    );

    try {
        await channel.delete(
            "VC+ temporary channel cleanup"
        );
    } catch {}
}

// ======================================================
// VC TARGET
// ======================================================

function getVCTarget(message) {
    return message.mentions.members.first();
}

function isVCOwner(member, vcData) {
    return (
        vcData &&
        (
            vcData.ownerId === member.id ||
            isFounder(member)
        )
    );
}

// ======================================================
// VC BAN
// ======================================================

async function applyVCBan(
    channel,
    target
) {
    const data =
        tempVCs.get(channel.id);

    if (!data) return;

    data.banned.add(target.id);
    data.rejected.delete(target.id);
    data.permitted.delete(target.id);

    try {
        await target.voice.disconnect(
            "Banned from VC"
        );
    } catch {}

    await channel.permissionOverwrites.edit(
        target.id,
        {
            Connect: false
        }
    );
}

async function removeVCBan(
    channel,
    target
) {
    const data =
        tempVCs.get(channel.id);

    if (!data) return;

    data.banned.delete(target.id);

    await channel.permissionOverwrites.delete(
        target.id
    ).catch(() => {});
}

// ======================================================
// WELCOME MESSAGE
// ======================================================

async function sendWelcomeMessage(guild) {
    try {
        const channel =
            guild.channels.cache.find(
                c =>
                    c.type === ChannelType.GuildText &&
                    c.permissionsFor(
                        guild.members.me
                    )?.has(
                        PermissionFlagsBits.SendMessages
                    )
            );

        if (!channel) return;

        const embed =
            new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("VC+")
                .setDescription(
`**Welcome to VC+**

A private voice-channel and moderation system built for your server.

━━━━━━━━━━━━━━━━━━━━

**VOICE CHANNELS**

\`${PREFIX}vc setup\`
Create the Join To Create system.

\`${PREFIX}vc lock\`
Lock your personal VC.

\`${PREFIX}vc unlock\`
Unlock your personal VC.

\`${PREFIX}vc rename name\`
Rename your VC.

\`${PREFIX}vc limit 10\`
Set the member limit.

━━━━━━━━━━━━━━━━━━━━

**MODERATION**

\`${PREFIX}ban @user\`
\`${PREFIX}kick @user\`
\`${PREFIX}timeout @user 10\`
\`${PREFIX}purge 10\`

━━━━━━━━━━━━━━━━━━━━

**RANK SYSTEM**

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

**SECURITY**

VC+ includes private logs, moderation logs, filtering, rank permissions and anti-nuke protection.

> Use \`${PREFIX}help\` for the full command list.`
                )
                .setFooter({
                    text: "VC+ • Server Management"
                })
                .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "[WELCOME ERROR]",
            error
        );
    }
}

// ======================================================
// SETUP VC
// ======================================================

async function setupVC(guild) {
    const data =
        getGuildData(guild.id);

    await createLogSystem(guild);

    let category =
        data.jtc.categoryId
            ? guild.channels.cache.get(
                data.jtc.categoryId
            )
            : null;

    if (!category) {
        category =
            await guild.channels.create({
                name: "Voice Channels",
                type: ChannelType.GuildCategory
            });

        data.jtc.categoryId =
            category.id;
    }

    let jtc =
        data.jtc.channelId
            ? guild.channels.cache.get(
                data.jtc.channelId
            )
            : null;

    if (!jtc) {
        jtc =
            await guild.channels.create({
                name: "Join To Create",
                type: ChannelType.GuildVoice,
                parent: category.id
            });

        data.jtc.channelId =
            jtc.id;
    }

    data.jtc.enabled = true;

    saveDB();

    await sendLog(
        guild,
        "VC System Setup",
        "The Join To Create system was configured."
    );

    return {
        category,
        jtc
    };
}

// ======================================================
// FILTER SYSTEM
// ======================================================

async function handleFilteredMessage(message) {
    if (
        !message.guild ||
        message.author.bot
    ) return;

    const data =
        getGuildData(
            message.guild.id
        );

    if (!data.filter.enabled) return;

    if (isGod(message.member)) return;

    const content =
        message.content.toLowerCase();

    const matched =
        data.filter.words.find(
            word =>
                word &&
                content.includes(
                    word.toLowerCase()
                )
        );

    if (!matched) return;

    try {
        await message.delete();
    } catch {}

    const userId =
        message.author.id;

    data.filter.strikes[userId] =
        (data.filter.strikes[userId] || 0) + 1;

    const strikes =
        data.filter.strikes[userId];

    await sendLog(
        message.guild,
        "Filter Triggered",
        `${message.author} triggered the word filter.\n\n**Matched:** \`${matched}\`\n**Strikes:** ${strikes}/${data.filter.maxStrikes}`,
        true
    );

    if (
        strikes >=
        data.filter.maxStrikes
    ) {
        try {
            await message.member.timeout(
                10 * 60 * 1000,
                "VC+ automatic filter"
            );

            await sendModerationDM(
                message.author,
                message.guild,
                "Automatic Timeout",
                "Exceeded the server's filter strike limit.",
                "10 minutes"
            );
        } catch {}
    }
}

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return baseEmbed()
        .setTitle("VC+ • Commands")
        .setDescription(
`**VOICE CHANNELS**

\`${PREFIX}vc setup\`
Setup Join To Create.

\`${PREFIX}vc kick @user\`
Kick someone from your VC.

\`${PREFIX}vc disconnect @user\`
Disconnect someone.

\`${PREFIX}vc ban @user\`
Ban someone from your VC.

\`${PREFIX}vc reject @user\`
Reject someone.

\`${PREFIX}vc permit @user\`
Permit someone.

\`${PREFIX}vc lock\`
Lock your VC.

\`${PREFIX}vc unlock\`
Unlock your VC.

\`${PREFIX}vc transfer @user\`
Transfer ownership.

\`${PREFIX}vc claim\`
Claim an abandoned VC.

\`${PREFIX}vc forceclaim\`
Founder-only force claim.

\`${PREFIX}vc rename name\`
Rename your VC.

\`${PREFIX}vc limit amount\`
Set the member limit.

\`${PREFIX}vc stfu @user\`
Server mute someone.

\`${PREFIX}vc unstfu @user\`
Remove server mute.

━━━━━━━━━━━━━━━━━━━━

**MODERATION**

\`${PREFIX}ban @user reason\`
Ban a member.

\`${PREFIX}unban userID\`
Unban a member.

\`${PREFIX}banlist\`
View banned members.

\`${PREFIX}kick @user reason\`
Kick a member.

\`${PREFIX}timeout @user minutes reason\`
Timeout a member.

\`${PREFIX}untimeout @user\`
Remove timeout.

\`${PREFIX}foreverban @user reason\`
Permanent protected ban.

\`${PREFIX}purge amount\`
Delete messages.

\`${PREFIX}clear amount\`
Delete messages.

━━━━━━━━━━━━━━━━━━━━

**RANKS**

\`${PREFIX}rank @user rank\`
Set a server rank.

\`${PREFIX}godmode on/off\`
Enable or disable Godmode.

━━━━━━━━━━━━━━━━━━━━

**FILTER**

\`${PREFIX}filter on/off\`
Enable or disable filter.

\`${PREFIX}filter add word\`
Add a filtered word.

\`${PREFIX}filter remove word\`
Remove a filtered word.

\`${PREFIX}filter list\`
View filtered words.

\`${PREFIX}filter log on/off\`
Filter logging.

\`${PREFIX}filter strikes amount\`
Set strike limit.

\`${PREFIX}filter reset @user\`
Reset strikes.

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
Member`
        );
}

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                !message.guild ||
                message.author.bot
            ) return;

            await handleFilteredMessage(
                message
            );

            if (
                !message.content.startsWith(
                    PREFIX
                )
            ) return;

            const args =
                message.content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()?.toLowerCase();

            if (!command) return;

            // ==================================================
            // COMMAND LOG
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
                    embeds: [
                        helpEmbed()
                    ]
                });
            }

            // ==================================================
            // VC COMMANDS
            // ==================================================

            if (command === "vc") {
                const sub =
                    args.shift()?.toLowerCase();

                if (!sub) {
                    return message.reply({
                        embeds: [
                            helpEmbed()
                        ]
                    });
                }

                // ==============================================
                // SETUP
                // ==============================================

                if (sub === "setup") {
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

                    const result =
                        await setupVC(
                            message.guild
                        );

                    return replySuccess(
                        message,
                        "VC System Ready",
                        `Join To Create is now active.\n\n**Join Channel**\n${result.jtc}\n\n**Category**\n${result.category}`
                    );
                }

                const channel =
                    message.member.voice.channel;

                const vcData =
                    channel
                        ? tempVCs.get(
                            channel.id
                        )
                        : null;

                if (!channel || !vcData) {
                    return replyError(
                        message,
                        "No Personal VC",
                        "You need to be inside a **VC+ personal voice channel** to use this command."
                    );
                }

                // ==============================================
                // KICK
                // ==============================================

                if (sub === "kick") {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc kick @user\``
                        );
                    }

                    try {
                        await target.voice.disconnect(
                            "VC+ kick"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "User Kicked",
                        `${target} was disconnected from the voice channel.`
                    );
                }

                // ==============================================
                // DISCONNECT
                // ==============================================

                if (
                    sub === "disconnect"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc disconnect @user\``
                        );
                    }

                    try {
                        await target.voice.disconnect(
                            "VC+ disconnect"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "User Disconnected",
                        `${target} has been disconnected.`
                    );
                }

                // ==============================================
                // BAN
                // ==============================================

                if (sub === "ban") {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc ban @user\``
                        );
                    }

                    await applyVCBan(
                        channel,
                        target
                    );

                    return replySuccess(
                        message,
                        "User Banned",
                        `${target} is now banned from this personal VC.`
                    );
                }

                // ==============================================
                // REJECT
                // ==============================================

                if (
                    sub === "reject"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc reject @user\``
                        );
                    }

                    vcData.rejected.add(
                        target.id
                    );

                    try {
                        await target.voice.disconnect(
                            "Rejected from VC"
                        );
                    } catch {}

                    return replySuccess(
                        message,
                        "User Rejected",
                        `${target} has been rejected from this VC.`
                    );
                }

                // ==============================================
                // PERMIT
                // ==============================================

                if (
                    sub === "permit"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc permit @user\``
                        );
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

                    return replySuccess(
                        message,
                        "User Permitted",
                        `${target} is now permitted to join this VC.`
                    );
                }

                // ==============================================
                // LOCK
                // ==============================================

                if (sub === "lock") {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    vcData.locked = true;

                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: false
                        }
                    );

                    return replySuccess(
                        message,
                        "VC Locked",
                        "Your personal voice channel is now **locked**."
                    );
                }

                // ==============================================
                // UNLOCK
                // ==============================================

                if (sub === "unlock") {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can use this command."
                        );
                    }

                    vcData.locked = false;

                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: true
                        }
                    );

                    return replySuccess(
                        message,
                        "VC Unlocked",
                        "Your personal voice channel is now **open**."
                    );
                }

                // ==============================================
                // TRANSFER
                // ==============================================

                if (
                    sub === "transfer"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can transfer ownership."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc transfer @user\``
                        );
                    }

                    vcData.ownerId =
                        target.id;

                    return replySuccess(
                        message,
                        "Ownership Transferred",
                        `${target} is now the owner of this personal VC.`
                    );
                }

                // ==============================================
                // CLAIM
                // ==============================================

                if (sub === "claim") {
                    if (
                        channel.members.size === 0
                    ) {
                        return replyError(
                            message,
                            "Cannot Claim",
                            "This VC is empty."
                        );
                    }

                    if (
                        channel.members.has(
                            vcData.ownerId
                        )
                    ) {
                        return replyError(
                            message,
                            "VC Still Owned",
                            "The current owner is still in the voice channel."
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    return replySuccess(
                        message,
                        "VC Claimed",
                        "You are now the owner of this personal VC."
                    );
                }

                // ==============================================
                // FORCECLAIM
                // ==============================================

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
                            "Founder Only",
                            "Only the **Founder** can force claim a VC."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (target) {
                        vcData.ownerId =
                            target.id;

                        return replySuccess(
                            message,
                            "Ownership Forced",
                            `${target} is now the owner of this VC.`
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    return replySuccess(
                        message,
                        "VC Claimed",
                        "You have force claimed this VC."
                    );
                }

                // ==============================================
                // RENAME
                // ==============================================

                if (
                    sub === "rename"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can rename this VC."
                        );
                    }

                    const newName =
                        args.join(" ").trim();

                    if (!newName) {
                        return replyError(
                            message,
                            "Missing Name",
                            `Usage: \`${PREFIX}vc rename My VC\``
                        );
                    }

                    const finalName =
                        newName.slice(0, 100);

                    await channel.setName(
                        finalName
                    );

                    return replySuccess(
                        message,
                        "VC Renamed",
                        `Your VC is now named **${finalName}**.`
                    );
                }

                // ==============================================
                // LIMIT
                // ==============================================

                if (
                    sub === "limit"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return replyError(
                            message,
                            "Permission Denied",
                            "Only the **VC owner** or **Founder** can change the limit."
                        );
                    }

                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(amount) ||
                        amount < 0 ||
                        amount > 99
                    ) {
                        return replyError(
                            message,
                            "Invalid Limit",
                            "Choose a number from **0–99**.\n\n`0` means unlimited."
                        );
                    }

                    await channel.setUserLimit(
                        amount
                    );

                    return replySuccess(
                        message,
                        "Limit Updated",
                        `The VC member limit is now **${amount === 0 ? "Unlimited" : amount}**.`
                    );
                }

                // ==============================================
                // STFU
                // ==============================================

                if (sub === "stfu") {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return replyError(
                            message,
                            "God Only",
                            "Only **God** or **Founder** can use STFU."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc stfu @user\``
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
                        "User Muted",
                        `${target} has been server muted.`
                    );
                }

                // ==============================================
                // UNSTFU
                // ==============================================

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
                            "God Only",
                            "Only **God** or **Founder** can use UNSTFU."
                        );
                    }

                    const target =
                        getVCTarget(message);

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}vc unstfu @user\``
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
                        "Mute Removed",
                        `${target} has been unmuted.`
                    );
                }

                return replyError(
                    message,
                    "Unknown VC Command",
                    `Use \`${PREFIX}help\` to see all available VC commands.`
                );
            }

            // ==================================================
            // MODERATION
            // ==================================================

            if (
                [
                    "ban",
                    "unban",
                    "banlist",
                    "kick",
                    "timeout",
                    "untimeout",
                    "foreverban",
                    "purge",
                    "clear"
                ].includes(command)
            ) {
                if (
                    !canModerate(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "Permission Denied",
                        "You do not have a high enough rank to use moderation commands."
                    );
                }
            }

            // ==================================================
            // BAN
            // ==================================================

            if (command === "ban") {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        `Usage: \`${PREFIX}ban @user reason\``
                    );
                }

                if (
                    target.id === message.author.id
                ) {
                    return replyError(
                        message,
                        "Invalid Target",
                        "You cannot ban yourself."
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(message.member)
                ) {
                    return replyError(
                        message,
                        "Rank Protection",
                        "You cannot moderate someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Banned",
                    reason
                );

                await target.ban({
                    reason
                });

                await sendLog(
                    message.guild,
                    "Member Banned",
                    `${target.user.tag} was banned by ${message.author}.\n\n**Reason:** ${reason}`,
                    true
                );

                return replySuccess(
                    message,
                    "Member Banned",
                    `${target} has been banned.\n\n**Reason:** ${reason}`
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
                        "Missing User ID",
                        `Usage: \`${PREFIX}unban userID\``
                    );
                }

                try {
                    const user =
                        await client.users.fetch(
                            userId
                        );

                    await message.guild.members.unban(
                        user.id
                    );

                    return replySuccess(
                        message,
                        "Member Unbanned",
                        `${user.tag} has been unbanned.`
                    );
                } catch {
                    return replyError(
                        message,
                        "Unban Failed",
                        "That user could not be unbanned."
                    );
                }
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
                        "There are currently no banned members."
                    );
                }

                const list =
                    bans
                        .map(
                            ban =>
                                `• ${ban.user.tag} \`${ban.user.id}\``
                        )
                        .slice(0, 50)
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
                command === "kick"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        `Usage: \`${PREFIX}kick @user reason\``
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(message.member)
                ) {
                    return replyError(
                        message,
                        "Rank Protection",
                        "You cannot kick someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Kicked",
                    reason
                );

                await target.kick(
                    reason
                );

                return replySuccess(
                    message,
                    "Member Kicked",
                    `${target} has been kicked.\n\n**Reason:** ${reason}`
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

                const minutes =
                    Number(args[1]);

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        `Usage: \`${PREFIX}timeout @user 10 reason\``
                    );
                }

                if (
                    !Number.isInteger(minutes) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Invalid Duration",
                        "Timeout must be between **1 minute** and **28 days**."
                    );
                }

                if (
                    getRankLevel(target) >=
                    getRankLevel(message.member)
                ) {
                    return replyError(
                        message,
                        "Rank Protection",
                        "You cannot timeout someone with an equal or higher rank."
                    );
                }

                const reason =
                    args
                        .slice(2)
                        .join(" ") ||
                    "No reason provided.";

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Timed Out",
                    reason,
                    `${minutes} minute(s)`
                );

                return replySuccess(
                    message,
                    "Member Timed Out",
                    `${target} has been timed out for **${minutes} minute(s)**.\n\n**Reason:** ${reason}`
                );
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command === "untimeout"
            ) {
                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        `Usage: \`${PREFIX}untimeout @user\``
                    );
                }

                await target.timeout(
                    null,
                    "VC+ timeout removed"
                );

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
                command === "foreverban"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return replyError(
                        message,
                        "God Only",
                        "Only **God** or **Founder** can use Forever Ban."
                    );
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    return replyError(
                        message,
                        "Missing User",
                        `Usage: \`${PREFIX}foreverban @user reason\``
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided.";

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

                saveDB();

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Forever Banned",
                    reason
                );

                await target.ban({
                    reason
                });

                return replySuccess(
                    message,
                    "Forever Ban Applied",
                    `${target} has been permanently protected from returning to this server.`
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
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return replyError(
                        message,
                        "Invalid Amount",
                        "Choose a number from **1–100**."
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
                            successEmbed(
                                "Messages Deleted",
                                `Deleted **${deleted.size}** message(s).`
                            )
                        ]
                    });

                setTimeout(
                    () =>
                        response.delete()
                            .catch(() => {}),
                    5000
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
                        "Founder Only",
                        "Only the **Founder** can change server ranks."
                    );
                }

                const target =
                    message.mentions.members.first();

                const rank =
                    normalizeRank(
                        args[1]
                    );

                if (!target || !rank) {
                    return replyError(
                        message,
                        "Invalid Usage",
                        `Usage: \`${PREFIX}rank @user rank\`\n\nAvailable ranks:\nFounder • God • Owner • Co Owner • Executive • Director • Admin • Moderator • Staff • Member`
                    );
                }

                if (
                    !Object.hasOwn(
                        RANKS,
                        rank
                    )
                ) {
                    return replyError(
                        message,
                        "Invalid Rank",
                        "That rank does not exist."
                    );
                }

                if (
                    rank === "founder" &&
                    target.id !==
                    message.guild.ownerId
                ) {
                    return replyError(
                        message,
                        "Protected Rank",
                        "The Founder rank is reserved for the server owner."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                data.ranks[target.id] =
                    rank;

                saveDB();

                return replySuccess(
                    message,
                    "Rank Updated",
                    `${target} is now **${rank}**.`
                );
            }

            // ==================================================
            // GODMODE
            // ==================================================

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
                        "Founder Only",
                        "Only the **Founder** can manage Godmode."
                    );
                }

                const state =
                    args[0]?.toLowerCase();

                if (
                    state !== "on" &&
                    state !== "off"
                ) {
                    return replyError(
                        message,
                        "Invalid Usage",
                        `Usage: \`${PREFIX}godmode on\` or \`${PREFIX}godmode off\``
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (state === "on") {
                    if (
                        !data.godmode.includes(
                            message.author.id
                        )
                    ) {
                        data.godmode.push(
                            message.author.id
                        );
                    }
                } else {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                message.author.id
                        );
                }

                saveDB();

                return replySuccess(
                    message,
                    "Godmode Updated",
                    `Godmode is now **${state.toUpperCase()}** for you.`
                );
            }

            // ==================================================
            // FILTER
            // ==================================================

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
                        "God Only",
                        "Only **God** or **Founder** can manage the filter."
                    );
                }

                const sub =
                    args.shift()?.toLowerCase();

                const data =
                    getGuildData(
                        message.guild.id
                    );

                // ON / OFF
                if (
                    sub === "on" ||
                    sub === "off"
                ) {
                    data.filter.enabled =
                        sub === "on";

                    saveDB();

                    return replySuccess(
                        message,
                        "Filter Updated",
                        `The word filter is now **${sub.toUpperCase()}**.`
                    );
                }

                // ADD
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
                            `Usage: \`${PREFIX}filter add word\``
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

                    saveDB();

                    return replySuccess(
                        message,
                        "Word Added",
                        `\`${word}\` was added to the filter.`
                    );
                }

                // REMOVE
                if (
                    sub === "remove"
                ) {
                    const word =
                        args.join(" ")
                            .trim()
                            .toLowerCase();

                    data.filter.words =
                        data.filter.words.filter(
                            w => w !== word
                        );

                    saveDB();

                    return replySuccess(
                        message,
                        "Word Removed",
                        `\`${word}\` was removed from the filter.`
                    );
                }

                // LIST
                if (
                    sub === "list"
                ) {
                    const words =
                        data.filter.words.length
                            ? data.filter.words
                                .map(
                                    word =>
                                        `• \`${word}\``
                                )
                                .join("\n")
                            : "No filtered words have been added.";

                    return message.reply({
                        embeds: [
                            infoEmbed(
                                "Filtered Words",
                                words
                            )
                        ]
                    });
                }

                // LOG
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
                            "Invalid Usage",
                            `Usage: \`${PREFIX}filter log on\``
                        );
                    }

                    data.filter.log =
                        state === "on";

                    saveDB();

                    return replySuccess(
                        message,
                        "Filter Logging",
                        `Filter logging is now **${state.toUpperCase()}**.`
                    );
                }

                // STRIKES
                if (
                    sub === "strikes"
                ) {
                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(amount) ||
                        amount < 1 ||
                        amount > 20
                    ) {
                        return replyError(
                            message,
                            "Invalid Strike Limit",
                            "Choose a number from **1–20**."
                        );
                    }

                    data.filter.maxStrikes =
                        amount;

                    saveDB();

                    return replySuccess(
                        message,
                        "Strike Limit Updated",
                        `The filter now allows **${amount} strike(s)** before timeout.`
                    );
                }

                // RESET
                if (
                    sub === "reset"
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "Missing User",
                            `Usage: \`${PREFIX}filter reset @user\``
                        );
                    }

                    delete data.filter.strikes[
                        target.id
                    ];

                    saveDB();

                    return replySuccess(
                        message,
                        "Strikes Reset",
                        `${target}'s filter strikes have been reset.`
                    );
                }

                return replyError(
                    message,
                    "Unknown Filter Command",
                    `Use \`${PREFIX}filter on\`, \`${PREFIX}filter add\`, \`${PREFIX}filter remove\`, or \`${PREFIX}filter list\`.`
                );
            }

            return replyError(
                message,
                "Unknown Command",
                `I couldn't find that command.\n\nUse \`${PREFIX}help\` to see all VC+ commands.`
            );

        } catch (error) {
            console.error(
                "[MESSAGE COMMAND ERROR]",
                error
            );

            try {
                await message.reply({
                    embeds: [
                        errorEmbed(
                            "Command Error",
                            "Something went wrong while running that command. Check the bot console for details."
                        )
                    ]
                });
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

            const data =
                getGuildData(
                    guild.id
                );

            // ==============================================
            // JOIN TO CREATE
            // ==============================================

            if (
                newState.channelId &&
                newState.channelId ===
                data.jtc.channelId
            ) {
                await createPersonalVC(
                    newState.member
                );

                return;
            }

            // ==============================================
            // JOIN TEMP VC
            // ==============================================

            if (newState.channelId) {
                const vcData =
                    tempVCs.get(
                        newState.channelId
                    );

                if (vcData) {
                    const member =
                        newState.member;

                    if (
                        vcData.banned.has(
                            member.id
                        ) ||
                        vcData.rejected.has(
                            member.id
                        )
                    ) {
                        try {
                            await member.voice.disconnect(
                                "VC+ access denied"
                            );
                        } catch {}

                        return;
                    }

                    if (
                        vcData.locked &&
                        !vcData.permitted.has(
                            member.id
                        ) &&
                        member.id !==
                        vcData.ownerId &&
                        !isFounder(member)
                    ) {
                        try {
                            await member.voice.disconnect(
                                "VC+ VC locked"
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

                    await sendLog(
                        guild,
                        "Voice Channel Join",
                        `${member} joined ${newState.channel}.`
                    );
                }
            }

            // ==============================================
            // LEAVE TEMP VC
            // ==============================================

            if (oldState.channelId) {
                const vcData =
                    tempVCs.get(
                        oldState.channelId
                    );

                if (vcData) {
                    await sendLog(
                        guild,
                        "Voice Channel Leave",
                        `${oldState.member} left <#${oldState.channelId}>.`
                    );

                    await deleteEmptyVC(
                        oldState.channel
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
        await sendLog(
            member.guild,
            "Member Left",
            `**${member.user.tag}** left the server.`
        ).catch(() => {});
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
            `A channel was created: **${channel.name}**`
        );
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
            `A channel was deleted: **${channel.name}**`,
            true
        );
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
            `Role **${role.name}** was created.`,
            true
        );
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
            `Role **${role.name}** was deleted.`,
            true
        );
    }
);

// ======================================================
// ANTI-NUKE
// ======================================================

const securityTracker =
    new Map();

const SECURITY_LIMITS = {
    channelCreate: 5,
    channelDelete: 3,
    roleCreate: 5,
    roleDelete: 3
};

async function securityPunish(
    guild,
    user,
    action
) {
    try {
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

        const member =
            guild.members.cache.get(
                user.id
            ) ||
            await guild.members
                .fetch(user.id)
                .catch(() => null);

        if (member) {
            await member.ban({
                reason:
                    `VC+ Anti-Nuke: ${action}`
            }).catch(() => {});
        }

        await sendLog(
            guild,
            "ANTI-NUKE",
            `**${user.tag}** triggered protection for **${action}** and was banned.`,
            true
        );

    } catch (error) {
        console.error(
            "[SECURITY PUNISH ERROR]",
            error
        );
    }
}

async function trackSecurityAction(
    guild,
    action
) {
    try {
        const data =
            getGuildData(
                guild.id
            );

        if (
            data.protection[action] === false
        ) return;

        const logs =
            await guild.fetchAuditLogs({
                limit: 1,
                type:
                    action ===
                    "channelCreate"
                        ? AuditLogEvent.ChannelCreate
                        : action ===
                          "channelDelete"
                            ? AuditLogEvent.ChannelDelete
                            : action ===
                              "roleCreate"
                                ? AuditLogEvent.RoleCreate
                                : AuditLogEvent.RoleDelete
            });

        const entry =
            logs.entries.first();

        if (!entry) return;

        const executor =
            entry.executor;

        if (!executor) return;

        const member =
            guild.members.cache.get(
                executor.id
            );

        if (
            member &&
            isTrustedExecutor(member)
        ) {
            return;
        }

        const key =
            `${guild.id}:${executor.id}:${action}`;

        const now =
            Date.now();

        let record =
            securityTracker.get(key);

        if (
            !record ||
            now - record.first >
            10000
        ) {
            record = {
                count: 0,
                first: now
            };
        }

        record.count++;

        securityTracker.set(
            key,
            record
        );

        if (
            record.count >=
            SECURITY_LIMITS[action]
        ) {
            await securityPunish(
                guild,
                executor,
                action
            );

            securityTracker.delete(
                key
            );
        }
    } catch (error) {
        console.error(
            "[SECURITY ERROR]",
            error
        );
    }
}

// ======================================================
// SECURITY EVENTS
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        if (!channel.guild) return;

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    750
                )
        );

        await trackSecurityAction(
            channel.guild,
            "channelCreate"
        );
    }
);

client.on(
    "channelDelete",
    async channel => {
        if (!channel.guild) return;

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    750
                )
        );

        await trackSecurityAction(
            channel.guild,
            "channelDelete"
        );
    }
);

client.on(
    "roleCreate",
    async role => {
        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    750
                )
        );

        await trackSecurityAction(
            role.guild,
            "roleCreate"
        );
    }
);

client.on(
    "roleDelete",
    async role => {
        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    750
                )
        );

        await trackSecurityAction(
            role.guild,
            "roleDelete"
        );
    }
);

// ======================================================
// BOT JOIN SERVER
// ======================================================

client.on(
    "guildCreate",
    async guild => {
        getGuildData(
            guild.id
        );

        await sendWelcomeMessage(
            guild
        );

        await sendLog(
            guild,
            "VC+ Added",
            `VC+ was added to **${guild.name}**.`
        );
    }
);

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    async () => {
        console.log(
            `================================`
        );

        console.log(
            `${BOT_NAME} is online as ${client.user.tag}`
        );

        console.log(
            `Serving ${client.guilds.cache.size} server(s)`
        );

        console.log(
            `================================`
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
            "[CLIENT ERROR]",
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
        "[VC+] Saving database..."
    );

    saveDB();

    for (
        const channel
        of client.channels.cache.values()
    ) {
        if (
            channel.isVoiceBased() &&
            tempVCs.has(channel.id) &&
            channel.members.size === 0
        ) {
            await channel.delete().catch(
                () => {}
            );
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

const TOKEN =
    process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error(
        "Missing DISCORD_TOKEN environment variable."
    );

    process.exit(1);
}

client.login(TOKEN);
