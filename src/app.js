// ============================================================
// VC+ — ALL-IN-ONE DISCORD BOT
// discord.js v14
// ============================================================

import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    AuditLogEvent,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN || "PUT_BOT_TOKEN_HERE";

const PREFIX = "-";
const BOT_NAME = "VC+";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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
        GatewayIntentBits.GuildVoiceStates
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember
    ]
});

// ============================================================
// DATABASE
// ============================================================

let db = {
    guilds: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            saveDB();
            return;
        }

        const raw = fs.readFileSync(DB_FILE, "utf8");

        if (!raw.trim()) {
            saveDB();
            return;
        }

        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === "object") {
            db = parsed;

            if (!db.guilds || typeof db.guilds !== "object") {
                db.guilds = {};
            }
        }
    } catch (error) {
        console.error("[DATABASE] Failed to load:", error);

        db = {
            guilds: {}
        };

        try {
            saveDB();
        } catch (saveError) {
            console.error("[DATABASE] Failed to recreate DB:", saveError);
        }
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("[DATABASE] Save failed:", error);
    }
}

loadDB();

// ============================================================
// DEFAULT GUILD DATA
// ============================================================

function defaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        vouches: {},

        vouchLimit: 1,

        jtc: {
            categoryId: null,
            channelId: null
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

    const defaults = defaultGuildData();
    const current = db.guilds[guildId];

    db.guilds[guildId] = {
        ...defaults,
        ...current,

        jtc: {
            ...defaults.jtc,
            ...(current.jtc || {})
        },

        roles: {
            ...defaults.roles,
            ...(current.roles || {})
        },

        protection: {
            ...defaults.protection,
            ...(current.protection || {})
        },

        filters: {
            ...defaults.filters,
            ...(current.filters || {})
        },

        vouches:
            current.vouches &&
            typeof current.vouches === "object"
                ? current.vouches
                : {},

        ranks:
            current.ranks &&
            typeof current.ranks === "object"
                ? current.ranks
                : {},

        godmode:
            Array.isArray(current.godmode)
                ? current.godmode
                : [],

        foreverBanned:
            Array.isArray(current.foreverBanned)
                ? current.foreverBanned
                : []
    };

    return db.guilds[guildId];
}

// ============================================================
// RANK SYSTEM
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

function normalizeRank(rank) {
    if (!rank) return null;

    const value = rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (value === "coowner") return "coowner";

    return Object.prototype.hasOwnProperty.call(
        RANKS,
        value
    )
        ? value
        : null;
}

function getRank(member) {
    if (!member || !member.guild) {
        return "member";
    }

    if (member.id === member.guild.ownerId) {
        return "founder";
    }

    const data = getGuildData(member.guild.id);

    const stored = normalizeRank(data.ranks[member.id]);

    if (stored) {
        return stored;
    }

    if (data.godmode.includes(member.id)) {
        return "god";
    }

    return "member";
}

function getRankLevel(member) {
    return RANKS[getRank(member)] || 1;
}

function isServerOwner(member) {
    return Boolean(
        member &&
        member.guild &&
        member.id === member.guild.ownerId
    );
}

function isFounder(member) {
    return (
        isServerOwner(member) ||
        getRank(member) === "founder"
    );
}

function isGod(member) {
    return (
        isFounder(member) ||
        getRank(member) === "god" ||
        getGuildData(member.guild.id)
            .godmode
            .includes(member.id)
    );
}

function isTrustedExecutor(member) {
    return isFounder(member) || isGod(member);
}

function canModerate(actor, target) {
    if (!actor || !target) return false;

    if (actor.id === target.id) {
        return false;
    }

    if (isFounder(actor)) {
        return !isFounder(target);
    }

    return getRankLevel(actor) > getRankLevel(target);
}

// ============================================================
// EMBEDS
// ============================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`${BOT_NAME} • Error`)
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setTimestamp();
}

// ============================================================
// SAFE REPLY
// ============================================================

async function safeReply(target, payload) {
    try {
        if (!target) return;

        if (target.replied || target.deferred) {
            return await target.followUp(payload);
        }

        return await target.reply(payload);
    } catch (error) {
        console.error("[SAFE REPLY]", error);
    }
}

// ============================================================
// SAFE DM
// ============================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided.",
    duration = null
) {
    try {
        if (!user || !guild) return;

        const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle(`${BOT_NAME} • ${action}`)
            .setDescription(
                `You were **${action.toLowerCase()}** in **${guild.name}**.`
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
        }).catch(() => {});
    } catch (error) {
        console.error("[DM ERROR]", error);
    }
}

// ============================================================
// PARSE USER
// ============================================================

function extractId(input) {
    if (!input) return null;

    const match = String(input).match(/\d{15,25}/);

    return match ? match[0] : null;
}

async function resolveMember(guild, input) {
    const id = extractId(input);

    if (!id) return null;

    try {
        return await guild.members.fetch(id);
    } catch {
        return null;
    }
}

async function resolveUser(input) {
    const id = extractId(input);

    if (!id) return null;

    try {
        return await client.users.fetch(id);
    } catch {
        return null;
    }
}

// ============================================================
// VC SYSTEM
// ============================================================

const tempVCs = new Map();

function createVCData(guildId, ownerId) {
    return {
        guildId,
        ownerId,

        banned: [],
        rejected: [],
        permitted: [],
        stfu: [],

        locked: false,

        interfaceMessageId: null,
        interfaceChannelId: null
    };
}

function getMemberVC(member) {
    if (!member?.voice?.channel) {
        return null;
    }

    return tempVCs.get(member.voice.channel.id) || null;
}

function isVCOwner(member, vcData) {
    return (
        vcData &&
        (
            member.id === vcData.ownerId ||
            isFounder(member)
        )
    );
}

// ============================================================
// VC PERMISSION APPLICATION
// ============================================================

async function applyVCBan(channel, userId) {
    try {
        await channel.permissionOverwrites.edit(
            userId,
            {
                Connect: false
            }
        );
    } catch (error) {
        console.error("[VC BAN]", error);
    }
}

async function removeVCBan(channel, userId) {
    try {
        await channel.permissionOverwrites.delete(
            userId
        ).catch(() => {});
    } catch (error) {
        console.error("[VC UNBAN]", error);
    }
}

// ============================================================
// VC INTERFACE
// ============================================================

function vcButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_kick")
                .setLabel("Kick")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_disconnect")
                .setLabel("Disconnect")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_ban")
                .setLabel("Ban")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_reject")
                .setLabel("Reject")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_permit")
                .setLabel("Permit")
                .setStyle(ButtonStyle.Success)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_stfu")
                .setLabel("STFU")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_unstfu")
                .setLabel("UnSTFU")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("vc_lock")
                .setLabel("Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unlock")
                .setLabel("Unlock")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId("vc_claim")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary)
        ),

        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vc_transfer")
                .setLabel("Transfer")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_forceclaim")
                .setLabel("Force Claim")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId("vc_rename")
                .setLabel("Rename")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_limit")
                .setLabel("Limit")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId("vc_refresh")
                .setLabel("Refresh")
                .setStyle(ButtonStyle.Secondary)
        )
    ];
}

async function ensureVCInterfaceChannel(channel) {
    try {
        const vcData = tempVCs.get(channel.id);

        if (!vcData) return null;

        if (vcData.interfaceChannelId) {
            const existing = channel.guild.channels.cache.get(
                vcData.interfaceChannelId
            );

            if (existing?.isTextBased()) {
                return existing;
            }
        }

        const control = await channel.guild.channels.create({
            name: `vc-control-${channel.id.slice(-6)}`,
            type: ChannelType.GuildText,
            parent: channel.parentId || undefined,

            permissionOverwrites: [
                {
                    id: channel.guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel
                    ],
                    deny: [
                        PermissionFlagsBits.SendMessages
                    ]
                }
            ]
        });

        vcData.interfaceChannelId = control.id;

        saveDB();

        return control;
    } catch (error) {
        console.error("[VC INTERFACE CREATE]", error);
        return null;
    }
}

async function updateVCInterface(channel) {
    try {
        if (!channel) return;

        const vcData = tempVCs.get(channel.id);

        if (!vcData) return;

        const control = await ensureVCInterfaceChannel(channel);

        if (!control) return;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🎛️ ${channel.name} • VC Control`)
            .setDescription(
                [
                    `**Owner:** <@${vcData.ownerId}>`,
                    `**Members:** ${channel.members.size}`,
                    `**Limit:** ${
                        channel.userLimit === 0
                            ? "Unlimited"
                            : channel.userLimit
                    }`,
                    `**Status:** ${
                        vcData.locked
                            ? "🔒 Locked"
                            : "🔓 Unlocked"
                    }`,
                    "",
                    "Use the buttons below to control your VC.",
                    "",
                    "Targeted actions will ask you to select a user."
                ].join("\n")
            )
            .setTimestamp();

        let message = null;

        if (vcData.interfaceMessageId) {
            try {
                message = await control.messages.fetch(
                    vcData.interfaceMessageId
                );
            } catch {
                message = null;
            }
        }

        if (message) {
            await message.edit({
                embeds: [embed],
                components: vcButtons()
            });
        } else {
            const sent = await control.send({
                embeds: [embed],
                components: vcButtons()
            });

            vcData.interfaceMessageId = sent.id;

            saveDB();
        }
    } catch (error) {
        console.error("[VC INTERFACE UPDATE]", error);
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member) {
    try {
        const guild = member.guild;

        const categoryId = getGuildData(guild.id).jtc.categoryId;

        const channel = await guild.channels.create({
            name: `${member.user.username}'s VC`,
            type: ChannelType.GuildVoice,
            parent: categoryId || undefined,

            userLimit: 0,

            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak
                    ]
                },

                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.MoveMembers,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ]
        });

        tempVCs.set(
            channel.id,
            createVCData(guild.id, member.id)
        );

        await member.voice.setChannel(channel).catch(() => {});

        await updateVCInterface(channel);

        return channel;
    } catch (error) {
        console.error("[CREATE VC]", error);
        return null;
    }
}

// ============================================================
// DELETE EMPTY VC
// ============================================================

async function deleteEmptyVC(channel) {
    try {
        if (!channel) return;

        const data = tempVCs.get(channel.id);

        if (!data) return;

        if (channel.members.size > 0) {
            return;
        }

        const interfaceId = data.interfaceChannelId;

        tempVCs.delete(channel.id);

        if (interfaceId) {
            const interfaceChannel =
                channel.guild.channels.cache.get(interfaceId);

            if (interfaceChannel) {
                await interfaceChannel.delete().catch(() => {});
            }
        }

        await channel.delete().catch(() => {});
    } catch (error) {
        console.error("[DELETE VC]", error);
    }
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

function getVouchCount(data, userId) {
    return Number(data.vouches[userId] || 0);
}

function getVouchRole(guild) {
    const data = getGuildData(guild.id);

    if (!data.roles.vouch) {
        return null;
    }

    return guild.roles.cache.get(data.roles.vouch) || null;
}

async function syncVouchRole(member) {
    try {
        if (!member || !member.guild) return;

        const data = getGuildData(member.guild.id);

        const role = getVouchRole(member.guild);

        if (!role) return;

        if (role.managed) return;

        const botMember = member.guild.members.me;

        if (
            !botMember ||
            role.position >= botMember.roles.highest.position
        ) {
            return;
        }

        const count = getVouchCount(
            data,
            member.id
        );

        const threshold = Math.max(
            1,
            Number(data.vouchLimit || 1)
        );

        if (count >= threshold) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(
                    role,
                    "Vouch requirement reached"
                ).catch(() => {});
            }
        } else {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(
                    role,
                    "Vouch requirement no longer reached"
                ).catch(() => {});
            }
        }
    } catch (error) {
        console.error("[VOUCH ROLE SYNC]", error);
    }
}

async function syncAllVouchRoles(guild) {
    try {
        const data = getGuildData(guild.id);

        for (const [userId] of Object.entries(data.vouches)) {
            const member = guild.members.cache.get(userId);

            if (member) {
                await syncVouchRole(member);
            }
        }
    } catch (error) {
        console.error("[SYNC VOUCH ROLES]", error);
    }
}

function parseRoleMention(input) {
    if (!input) return null;

    const match = String(input).match(
        /<@&(\d{15,25})>/
    );

    if (match) return match[1];

    if (/^\d{15,25}$/.test(String(input))) {
        return String(input);
    }

    return null;
}

// ============================================================
// ANTI-NUKE
// ============================================================

const securityTracker = new Map();

function trackSecurity(guildId, executorId, action) {
    const key = `${guildId}:${executorId}:${action}`;

    const now = Date.now();

    const existing = securityTracker.get(key) || [];

    const recent = existing.filter(
        timestamp => now - timestamp < 10000
    );

    recent.push(now);

    securityTracker.set(key, recent);

    return recent.length;
}

async function getAuditExecutor(guild, type) {
    try {
        const logs = await guild.fetchAuditLogs({
            type,
            limit: 1
        });

        return logs.entries.first()?.executor || null;
    } catch {
        return null;
    }
}

async function securityPunish(guild, executor, reason) {
    try {
        if (!executor) return;

        const member = await guild.members
            .fetch(executor.id)
            .catch(() => null);

        if (!member) return;

        if (isTrustedExecutor(member)) {
            return;
        }

        const data = getGuildData(guild.id);

        if (!data.protection.enabled) {
            return;
        }

        await sendModerationDM(
            executor,
            guild,
            "Security Action",
            reason
        );

        await member.ban({
            reason: `${BOT_NAME} Anti-Nuke: ${reason}`,
            deleteMessageSeconds: 0
        }).catch(() => {});

        console.log(
            `[SECURITY] Banned ${executor.tag} - ${reason}`
        );
    } catch (error) {
        console.error("[SECURITY PUNISH]", error);
    }
}

// ============================================================
// AUTOMOD
// ============================================================

async function handleAutoMod(message) {
    try {
        if (!message.guild) return false;

        if (message.author.bot) {
            return false;
        }

        const data = getGuildData(
            message.guild.id
        );

        if (!data.filters.enabled) {
            return false;
        }

        if (!data.filters.words.length) {
            return false;
        }

        const content =
            message.content.toLowerCase();

        const found = data.filters.words.find(
            word =>
                word &&
                content.includes(
                    String(word).toLowerCase()
                )
        );

        if (!found) {
            return false;
        }

        await message.delete().catch(() => {});

        const userId = message.author.id;

        data.filters.strikes[userId] =
            Number(
                data.filters.strikes[userId] || 0
            ) + 1;

        const strikes =
            data.filters.strikes[userId];

        saveDB();

        const warning = await message.channel.send({
            embeds: [
                errorEmbed(
                    `<@${userId}>, that message was removed.\n\n` +
                    `Strike: **${strikes}/${data.filters.maxStrikes}**`
                )
            ]
        }).catch(() => null);

        if (warning) {
            setTimeout(() => {
                warning.delete().catch(() => {});
            }, data.filters.warningDeleteMs);
        }

        if (
            strikes >=
            Number(data.filters.maxStrikes || 3)
        ) {
            const member =
                message.guild.members.cache.get(
                    userId
                );

            if (member) {
                const duration =
                    Number(
                        data.filters.timeoutMinutes || 10
                    );

                await sendModerationDM(
                    message.author,
                    message.guild,
                    "Timeout",
                    "Automatic moderation strike limit reached.",
                    `${duration} minutes`
                );

                await member.timeout(
                    duration * 60 * 1000,
                    "AutoMod strike limit reached"
                ).catch(() => {});

                data.filters.strikes[userId] = 0;

                saveDB();
            }
        }

        if (data.filters.logChannelId) {
            const logChannel =
                message.guild.channels.cache.get(
                    data.filters.logChannelId
                );

            if (logChannel?.isTextBased()) {
                await logChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xed4245)
                            .setTitle(
                                "AutoMod Action"
                            )
                            .addFields(
                                {
                                    name: "User",
                                    value: `${message.author} (${message.author.id})`
                                },
                                {
                                    name: "Matched",
                                    value: String(found)
                                },
                                {
                                    name: "Strikes",
                                    value: String(strikes)
                                }
                            )
                            .setTimestamp()
                    ]
                }).catch(() => {});
            }
        }

        return true;
    } catch (error) {
        console.error("[AUTOMOD]", error);
        return false;
    }
}

// ============================================================
// HELP
// ============================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${BOT_NAME} • Commands`)
        .setDescription(
            [
                "**GENERAL**",
                "`-help` — Show commands",
                "`-rank @user` — View rank",
                "",
                "**VOUCH**",
                "`-vouch give @user` — Founder/Owner gives a vouch",
                "`-vouch self` — Give yourself the configured vouch role",
                "`-vouch take @user` — Founder/Owner removes one vouch",
                "`-vouch clear @user` — Founder/Owner clears vouches",
                "`-vouch list` — View vouch leaderboard",
                "`-vouch role set @role` — Founder/Owner sets vouch role",
                "`-vouch limit <number>` — Founder/Owner sets required vouches",
                "`-vouchrole view` — View vouch role settings",
                "",
                "**VC**",
                "`-vc setup` — Setup Join-To-Create",
                "`-vc count` — Count active temporary VCs",
                "`-vc panel` — Open/refresh VC panel",
                "`-vc kick @user`",
                "`-vc disconnect @user`",
                "`-vc ban @user`",
                "`-vc reject @user`",
                "`-vc permit @user`",
                "`-vc lock`",
                "`-vc unlock`",
                "`-vc limit <number>`",
                "`-vc rename <name>`",
                "`-vc transfer @user`",
                "`-vc claim`",
                "`-vc forceclaim`",
                "`-vc stfu @user`",
                "`-vc unstfu @user`",
                "",
                "**MODERATION**",
                "`-kick @user [reason]`",
                "`-ban @user [reason]`",
                "`-unban <userID>`",
                "`-banlist`",
                "`-unbanall confirm`",
                "`-timeout @user <minutes> [reason]`",
                "`-untimeout @user`",
                "`-purge <amount>`",
                "",
                "**SECURITY**",
                "`-rank @user <rank>`",
                "`-godmode @user`",
                "`-foreverban @user`",
                "`-foreverunban @user`",
                "",
                "**AUTOMOD**",
                "`-filter on`",
                "`-filter off`",
                "`-filter add <word>`",
                "`-filter remove <word>`",
                "`-filter list`",
                "`-filter strikes @user`",
                "`-filter reset @user`",
                "`-filter log #channel`"
            ].join("\n")
        );
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
    console.log(
        `[READY] ${client.user.tag} is online.`
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

    // Restore Join-To-Create systems.
    for (const guild of client.guilds.cache.values()) {
        try {
            const data = getGuildData(guild.id);

            if (
                data.jtc?.channelId
            ) {
                const channel =
                    guild.channels.cache.get(
                        data.jtc.channelId
                    );

                if (!channel) {
                    data.jtc.channelId = null;
                    saveDB();
                }
            }

            await syncAllVouchRoles(guild);
        } catch (error) {
            console.error(
                `[READY GUILD ${guild.id}]`,
                error
            );
        }
    }
});

// ============================================================
// GUILD MEMBER JOIN
// ============================================================

client.on("guildMemberAdd", async member => {
    try {
        const data = getGuildData(
            member.guild.id
        );

        if (
            data.foreverBanned.includes(
                member.id
            )
        ) {
            await member.ban({
                reason: `${BOT_NAME} Forever Ban`
            }).catch(() => {});
        }

        await syncVouchRole(member);
    } catch (error) {
        console.error("[MEMBER JOIN]", error);
    }
});

// ============================================================
// VOICE STATE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const member =
                newState.member ||
                oldState.member;

            if (!member) return;

            // JOIN TO CREATE
            if (
                newState.channelId &&
                newState.channelId ===
                    getGuildData(
                        member.guild.id
                    ).jtc.channelId
            ) {
                const created =
                    await createPersonalVC(
                        member
                    );

                if (!created) {
                    return;
                }
            }

            // Remove empty temporary VC
            if (
                oldState.channelId &&
                tempVCs.has(
                    oldState.channelId
                )
            ) {
                const oldChannel =
                    oldState.guild.channels.cache.get(
                        oldState.channelId
                    );

                if (oldChannel) {
                    await deleteEmptyVC(
                        oldChannel
                    );
                }
            }

            // STFU protection
            if (
                newState.channelId &&
                tempVCs.has(
                    newState.channelId
                )
            ) {
                const vcData =
                    tempVCs.get(
                        newState.channelId
                    );

                if (
                    vcData.stfu.includes(
                        member.id
                    )
                ) {
                    await member.voice.setMute(
                        true,
                        "VC STFU"
                    ).catch(() => {});
                }
            }
        } catch (error) {
            console.error(
                "[VOICE STATE]",
                error
            );
        }
    }
);

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                interaction.isButton()
            ) {
                await handleVCButton(
                    interaction
                );

                return;
            }

            if (
                interaction.isUserSelectMenu()
            ) {
                await handleVCTargetSelect(
                    interaction
                );

                return;
            }

            if (
                interaction.isModalSubmit()
            ) {
                await handleVCModal(
                    interaction
                );

                return;
            }
        } catch (error) {
            console.error(
                "[INTERACTION]",
                error
            );

            await safeReply(
                interaction,
                {
                    embeds: [
                        errorEmbed(
                            "Something went wrong, but the bot stayed online."
                        )
                    ],
                    ephemeral: true
                }
            );
        }
    }
);

// ============================================================
// VC BUTTON HANDLER
// ============================================================

async function handleVCButton(interaction) {
    const member =
        await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);

    if (!member) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "Could not find your member data."
                )
            ],
            ephemeral: true
        });
    }

    const vcData =
        getMemberVC(member);

    if (!vcData) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "You are not inside a managed VC."
                )
            ],
            ephemeral: true
        });
    }

    const channel =
        member.voice.channel;

    if (!channel) {
        return;
    }

    const action =
        interaction.customId;

    // REFRESH
    if (action === "vc_refresh") {
        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Refreshed",
                    "The VC control panel has been refreshed."
                )
            ],
            ephemeral: true
        });
    }

    // CLAIM
    if (action === "vc_claim") {
        if (vcData.ownerId === member.id) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "You already own this VC."
                    )
                ],
                ephemeral: true
            });
        }

        const oldOwner =
            channel.guild.members.cache.get(
                vcData.ownerId
            );

        if (
            oldOwner?.voice?.channelId ===
            channel.id
        ) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "The current owner is still inside the VC."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.ownerId = member.id;

        await channel.permissionOverwrites.edit(
            member.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                MoveMembers: true,
                ManageChannels: true
            }
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "VC Claimed",
                    `You now own ${channel}.`
                )
            ],
            ephemeral: true
        });
    }

    // FORCE CLAIM
    if (action === "vc_forceclaim") {
        if (!isGod(member)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only Founder/God can force claim VCs."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.ownerId = member.id;

        await channel.permissionOverwrites.edit(
            member.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                MoveMembers: true,
                ManageChannels: true
            }
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Force Claimed",
                    `You now own ${channel}.`
                )
            ],
            ephemeral: true
        });
    }

    // LOCK
    if (action === "vc_lock") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can lock this VC."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.locked = true;

        await channel.permissionOverwrites.edit(
            channel.guild.roles.everyone,
            {
                Connect: false
            }
        ).catch(() => {});

        await channel.permissionOverwrites.edit(
            vcData.ownerId,
            {
                Connect: true
            }
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Locked",
                    `${channel} is now locked.`
                )
            ],
            ephemeral: true
        });
    }

    // UNLOCK
    if (action === "vc_unlock") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can unlock this VC."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.locked = false;

        await channel.permissionOverwrites.edit(
            channel.guild.roles.everyone,
            {
                Connect: true
            }
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Unlocked",
                    `${channel} is now unlocked.`
                )
            ],
            ephemeral: true
        });
    }

    // MODAL RENAME
    if (action === "vc_rename") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can rename this VC."
                    )
                ],
                ephemeral: true
            });
        }

        const modal =
            new ModalBuilder()
                .setCustomId("vc_rename_modal")
                .setTitle("Rename VC");

        const input =
            new TextInputBuilder()
                .setCustomId("vc_name")
                .setLabel("New VC name")
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(100)
                .setValue(channel.name);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                input
            )
        );

        return interaction.showModal(modal);
    }

    // MODAL LIMIT
    if (action === "vc_limit") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can change the limit."
                    )
                ],
                ephemeral: true
            });
        }

        const modal =
            new ModalBuilder()
                .setCustomId("vc_limit_modal")
                .setTitle("Change VC Limit");

        const input =
            new TextInputBuilder()
                .setCustomId("vc_limit_value")
                .setLabel("Limit (0 = unlimited)")
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(3)
                .setValue(
                    String(
                        channel.userLimit || 0
                    )
                );

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                input
            )
        );

        return interaction.showModal(modal);
    }

    // TARGETED BUTTONS
    const targetActions = [
        "vc_kick",
        "vc_disconnect",
        "vc_ban",
        "vc_reject",
        "vc_permit",
        "vc_stfu",
        "vc_unstfu",
        "vc_transfer"
    ];

    if (targetActions.includes(action)) {
        const select =
            new UserSelectMenuBuilder()
                .setCustomId(
                    `vc_target_${action.replace("vc_", "")}`
                )
                .setPlaceholder(
                    "Select a user..."
                )
                .setMinValues(1)
                .setMaxValues(1);

        return safeReply(interaction, {
            embeds: [
                infoEmbed(
                    "Select User",
                    "Choose the member you want to apply this action to."
                )
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    select
                )
            ],
            ephemeral: true
        });
    }

    return safeReply(interaction, {
        embeds: [
            errorEmbed(
                "Unknown VC action."
            )
        ],
        ephemeral: true
    });
}

// ============================================================
// VC TARGET SELECT
// ============================================================

async function handleVCTargetSelect(interaction) {
    const member =
        await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);

    if (!member) return;

    const vcData =
        getMemberVC(member);

    if (!vcData) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "You are not inside a managed VC."
                )
            ],
            ephemeral: true
        });
    }

    const channel =
        member.voice.channel;

    if (!channel) return;

    const action =
        interaction.customId
            .replace("vc_target_", "");

    const targetId =
        interaction.values?.[0];

    if (!targetId) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "No user selected."
                )
            ],
            ephemeral: true
        });
    }

    const target =
        await interaction.guild.members
            .fetch(targetId)
            .catch(() => null);

    if (!target) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "That user could not be found."
                )
            ],
            ephemeral: true
        });
    }

    if (target.id === member.id) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "You cannot target yourself."
                )
            ],
            ephemeral: true
        });
    }

    // STFU
    if (
        action === "stfu" ||
        action === "unstfu"
    ) {
        if (!isGod(member)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only Founder/God can use STFU."
                    )
                ],
                ephemeral: true
            });
        }

        if (isFounder(target)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Founder cannot be STFU'd."
                    )
                ],
                ephemeral: true
            });
        }

        if (action === "stfu") {
            if (!vcData.stfu.includes(target.id)) {
                vcData.stfu.push(target.id);
            }

            await target.voice
                .setMute(true, "VC STFU")
                .catch(() => {});

            return safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "STFU",
                        `${target} has been server muted in the VC.`
                    )
                ],
                ephemeral: true
            });
        }

        vcData.stfu =
            vcData.stfu.filter(
                id => id !== target.id
            );

        await target.voice
            .setMute(false, "VC UnSTFU")
            .catch(() => {});

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "UnSTFU",
                    `${target} has been unmuted.`
                )
            ],
            ephemeral: true
        });
    }

    // TRANSFER
    if (action === "transfer") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can transfer ownership."
                    )
                ],
                ephemeral: true
            });
        }

        if (isFounder(target)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "You cannot transfer ownership to another Founder."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.ownerId = target.id;

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Ownership Transferred",
                    `${target} now owns ${channel}.`
                )
            ],
            ephemeral: true
        });
    }

    // PERMIT
    if (action === "permit") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can permit users."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.permitted.push(target.id);

        await removeVCBan(
            channel,
            target.id
        );

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Permitted",
                    `${target} is permitted to join this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // REJECT
    if (action === "reject") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can reject users."
                    )
                ],
                ephemeral: true
            });
        }

        if (!vcData.rejected.includes(target.id)) {
            vcData.rejected.push(target.id);
        }

        await applyVCBan(
            channel,
            target.id
        );

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Rejected",
                    `${target} has been rejected from this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // BAN
    if (action === "ban") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can VC ban."
                    )
                ],
                ephemeral: true
            });
        }

        if (!canModerate(member, target)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "You cannot VC ban someone above or equal to your rank."
                    )
                ],
                ephemeral: true
            });
        }

        if (!vcData.banned.includes(target.id)) {
            vcData.banned.push(target.id);
        }

        await sendModerationDM(
            target.user,
            interaction.guild,
            "VC Ban",
            `You were banned from **${channel.name}**.`
        );

        await applyVCBan(
            channel,
            target.id
        );

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice
                .disconnect(
                    "VC banned"
                )
                .catch(() => {});
        }

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "VC Banned",
                    `${target} has been banned from this VC.`
                )
            ],
            ephemeral: true
        });
    }

    // KICK
    if (action === "kick") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can kick users."
                    )
                ],
                ephemeral: true
            });
        }

        if (!canModerate(member, target)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "You cannot kick someone above or equal to your rank."
                    )
                ],
                ephemeral: true
            });
        }

        await sendModerationDM(
            target.user,
            interaction.guild,
            "VC Kick",
            `You were kicked from **${channel.name}**.`
        );

        await target.voice
            .disconnect(
                "VC kicked"
            )
            .catch(() => {});

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Kicked",
                    `${target} was disconnected from the VC.`
                )
            ],
            ephemeral: true
        });
    }

    // DISCONNECT
    if (action === "disconnect") {
        if (!isVCOwner(member, vcData)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can disconnect users."
                    )
                ],
                ephemeral: true
            });
        }

        if (!canModerate(member, target)) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "You cannot disconnect someone above or equal to your rank."
                    )
                ],
                ephemeral: true
            });
        }

        await target.voice
            .disconnect(
                "VC disconnect"
            )
            .catch(() => {});

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Disconnected",
                    `${target} was disconnected.`
                )
            ],
            ephemeral: true
        });
    }

    return safeReply(interaction, {
        embeds: [
            errorEmbed(
                "Unknown VC target action."
            )
        ],
        ephemeral: true
    });
}

// ============================================================
// VC MODALS
// ============================================================

async function handleVCModal(interaction) {
    const member =
        await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);

    if (!member) return;

    const vcData =
        getMemberVC(member);

    if (!vcData) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "You are not inside a managed VC."
                )
            ],
            ephemeral: true
        });
    }

    const channel =
        member.voice.channel;

    if (!channel) return;

    if (
        !isVCOwner(member, vcData)
    ) {
        return safeReply(interaction, {
            embeds: [
                errorEmbed(
                    "Only the VC owner or Founder can do this."
                )
            ],
            ephemeral: true
        });
    }

    if (
        interaction.customId ===
        "vc_rename_modal"
    ) {
        const name =
            interaction.fields.getTextInputValue(
                "vc_name"
            ).trim();

        if (!name) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "VC name cannot be empty."
                    )
                ],
                ephemeral: true
            });
        }

        await channel.setName(
            name,
            "VC renamed"
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Renamed",
                    `VC renamed to **${name}**.`
                )
            ],
            ephemeral: true
        });
    }

    if (
        interaction.customId ===
        "vc_limit_modal"
    ) {
        const raw =
            interaction.fields.getTextInputValue(
                "vc_limit_value"
            ).trim();

        const limit =
            Number(raw);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Enter a whole number from 0 to 99. 0 means unlimited."
                    )
                ],
                ephemeral: true
            });
        }

        await channel.setUserLimit(
            limit
        ).catch(() => {});

        await updateVCInterface(channel);

        return safeReply(interaction, {
            embeds: [
                successEmbed(
                    "Limit Changed",
                    `VC limit is now **${
                        limit === 0
                            ? "Unlimited"
                            : limit
                    }**.`
                )
            ],
            ephemeral: true
        });
    }
}

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (!message.guild) return;

            if (message.author.bot) return;

            const automod =
                await handleAutoMod(message);

            if (automod) return;

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
                String(
                    args.shift() || ""
                ).toLowerCase();

            if (!command) return;

            // ==================================================
            // HELP
            // ==================================================

            if (
                command === "help" ||
                command === "commands"
            ) {
                return safeReply(message, {
                    embeds: [
                        helpEmbed()
                    ]
                });
            }

            // ==================================================
            // RANK
            // ==================================================

            if (command === "rank") {
                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                const user =
                    target || message.member;

                return safeReply(message, {
                    embeds: [
                        infoEmbed(
                            "Rank",
                            `<@${user.id}> is **${getRank(user).toUpperCase()}**.`
                        )
                    ]
                });
            }

            // ==================================================
            // VOUCH SYSTEM
            // ==================================================

            if (command === "vouch") {
                const sub =
                    String(
                        args.shift() || ""
                    ).toLowerCase();

                const data =
                    getGuildData(
                        message.guild.id
                    );

                // ----------------------------------------------
                // VOUCH GIVE
                // ONLY FOUNDER OR SERVER OWNER
                // ----------------------------------------------

                if (sub === "give") {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the Founder or Server Owner can give vouches."
                                    )
                                ]
                            }
                        );
                    }

                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-vouch give @user`"
                                    )
                                ]
                            }
                        );
                    }

                    if (target.user.bot) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Bots cannot receive vouches."
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "You cannot vouch yourself with `-vouch give`. Use `-vouch self` if you want to claim the configured vouch role."
                                    )
                                ]
                            }
                        );
                    }

                    data.vouches[target.id] =
                        getVouchCount(
                            data,
                            target.id
                        ) + 1;

                    saveDB();

                    await syncVouchRole(
                        target
                    );

                    const count =
                        getVouchCount(
                            data,
                            target.id
                        );

                    const threshold =
                        Math.max(
                            1,
                            Number(
                                data.vouchLimit || 1
                            )
                        );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouch Given",
                                    [
                                        `${target} now has **${count}** vouch${count === 1 ? "" : "es"}.`,
                                        "",
                                        `Required for role: **${threshold}**`,
                                        getVouchRole(message.guild)
                                            ? `Role: ${getVouchRole(message.guild)}`
                                            : "No vouch role has been configured."
                                    ].join("\n")
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH SELF
                // USER CAN GIVE THEMSELF THE CONFIGURED ROLE
                // ----------------------------------------------

                if (
                    sub === "self" ||
                    sub === "me"
                ) {
                    const role =
                        getVouchRole(
                            message.guild
                        );

                    if (!role) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "No vouch role has been configured yet."
                                    )
                                ]
                            }
                        );
                    }

                    if (role.managed) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "The configured vouch role is managed by another integration and cannot be assigned."
                                    )
                                ]
                            }
                        );
                    }

                    const botMember =
                        message.guild.members.me;

                    if (
                        !botMember ||
                        role.position >=
                            botMember.roles.highest.position
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "I cannot assign that vouch role because it is above my highest role."
                                    )
                                ]
                            }
                        );
                    }

                    await message.member.roles.add(
                        role,
                        "User claimed configured vouch role"
                    ).catch(() => {});

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouch Role",
                                    `You have been given ${role}.`
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH TAKE
                // ----------------------------------------------

                if (sub === "take") {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the Founder or Server Owner can take vouches."
                                    )
                                ]
                            }
                        );
                    }

                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-vouch take @user`"
                                    )
                                ]
                            }
                        );
                    }

                    const current =
                        getVouchCount(
                            data,
                            target.id
                        );

                    if (current <= 0) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        `${target} has no vouches.`
                                    )
                                ]
                            }
                        );
                    }

                    data.vouches[target.id] =
                        current - 1;

                    saveDB();

                    await syncVouchRole(
                        target
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouch Removed",
                                    `${target} now has **${current - 1}** vouches.`
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH CLEAR
                // ----------------------------------------------

                if (sub === "clear") {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the Founder or Server Owner can clear vouches."
                                    )
                                ]
                            }
                        );
                    }

                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-vouch clear @user`"
                                    )
                                ]
                            }
                        );
                    }

                    data.vouches[target.id] =
                        0;

                    saveDB();

                    const role =
                        getVouchRole(
                            message.guild
                        );

                    if (
                        role &&
                        target.roles.cache.has(
                            role.id
                        )
                    ) {
                        await target.roles.remove(
                            role,
                            "Vouches cleared"
                        ).catch(() => {});
                    }

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouches Cleared",
                                    `${target}'s vouches have been reset to **0**.`
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH LIST
                // ----------------------------------------------

                if (sub === "list") {
                    const entries =
                        Object.entries(
                            data.vouches
                        )
                            .filter(
                                ([, count]) =>
                                    Number(count) > 0
                            )
                            .sort(
                                (a, b) =>
                                    Number(b[1]) -
                                    Number(a[1])
                            )
                            .slice(0, 20);

                    if (!entries.length) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    infoEmbed(
                                        "Vouch List",
                                        "There are currently no vouches."
                                    )
                                ]
                            }
                        );
                    }

                    const lines =
                        entries.map(
                            ([userId, count], index) =>
                                `**${index + 1}.** <@${userId}> — **${count}**`
                        );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                infoEmbed(
                                    "Vouch Leaderboard",
                                    lines.join("\n")
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH ROLE SET
                // ----------------------------------------------

                if (
                    sub === "role" &&
                    String(
                        args[0] || ""
                    ).toLowerCase() === "set"
                ) {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the Founder or Server Owner can set the vouch role."
                                    )
                                ]
                            }
                        );
                    }

                    const roleId =
                        parseRoleMention(
                            args[1]
                        );

                    if (!roleId) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-vouch role set @role`"
                                    )
                                ]
                            }
                        );
                    }

                    const role =
                        message.guild.roles.cache.get(
                            roleId
                        );

                    if (!role) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "That role does not exist."
                                    )
                                ]
                            }
                        );
                    }

                    if (role.managed) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Managed/integration roles cannot be used as the vouch role."
                                    )
                                ]
                            }
                        );
                    }

                    const botMember =
                        message.guild.members.me;

                    if (
                        !botMember ||
                        role.position >=
                            botMember.roles.highest.position
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "That role must be below my highest role."
                                    )
                                ]
                            }
                        );
                    }

                    data.roles.vouch =
                        role.id;

                    saveDB();

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouch Role Set",
                                    [
                                        `Vouch role: ${role}`,
                                        "",
                                        `Required vouches: **${Math.max(1, Number(data.vouchLimit || 1))}**`,
                                        "",
                                        "Users who reach the requirement will automatically receive this role."
                                    ].join("\n")
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VOUCH LIMIT
                // ----------------------------------------------

                if (sub === "limit") {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the Founder or Server Owner can change the vouch limit."
                                    )
                                ]
                            }
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
                        amount > 100000
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Use a whole number from 1 to 100000."
                                    )
                                ]
                            }
                        );
                    }

                    data.vouchLimit =
                        amount;

                    saveDB();

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Vouch Limit Updated",
                                    `Users now need **${amount}** vouch${amount === 1 ? "" : "es"} to automatically receive the configured vouch role.`
                                )
                            ]
                        }
                    );
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            errorEmbed(
                                "Unknown vouch command. Use `-help`."
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // VOUCH ROLE VIEW
            // ==================================================

            if (
                command === "vouchrole"
            ) {
                const data =
                    getGuildData(
                        message.guild.id
                    );

                const role =
                    getVouchRole(
                        message.guild
                    );

                return safeReply(
                    message,
                    {
                        embeds: [
                            infoEmbed(
                                "Vouch Role",
                                [
                                    `**Role:** ${
                                        role
                                            ? role.toString()
                                            : "Not set"
                                    }`,
                                    `**Required Vouches:** **${Math.max(1, Number(data.vouchLimit || 1))}**`,
                                    "",
                                    role
                                        ? "Users reaching the requirement are automatically given the role."
                                        : "Founder/Server Owner can set one with `-vouch role set @role`."
                                ].join("\n")
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // VC COMMANDS
            // ==================================================

            if (command === "vc") {
                const sub =
                    String(
                        args.shift() || ""
                    ).toLowerCase();

                // ----------------------------------------------
                // VC SETUP
                // ----------------------------------------------

                if (sub === "setup") {
                    if (!isFounder(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only Founder or Server Owner can setup Join-To-Create."
                                    )
                                ]
                            }
                        );
                    }

                    let category =
                        message.guild.channels.cache.find(
                            c =>
                                c.type ===
                                    ChannelType.GuildCategory &&
                                c.name
                                    .toLowerCase() ===
                                    "voice system"
                        );

                    if (!category) {
                        category =
                            await message.guild.channels.create(
                                {
                                    name: "Voice System",
                                    type: ChannelType.GuildCategory
                                }
                            );
                    }

                    let joinChannel =
                        message.guild.channels.cache.find(
                            c =>
                                c.type ===
                                    ChannelType.GuildVoice &&
                                c.name
                                    .toLowerCase() ===
                                    "join to create"
                        );

                    if (!joinChannel) {
                        joinChannel =
                            await message.guild.channels.create(
                                {
                                    name: "Join To Create",
                                    type: ChannelType.GuildVoice,
                                    parent: category.id
                                }
                            );
                    }

                    const data =
                        getGuildData(
                            message.guild.id
                        );

                    data.jtc.categoryId =
                        category.id;

                    data.jtc.channelId =
                        joinChannel.id;

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "VC Setup",
                                    `Join ${joinChannel} to automatically create a personal VC.`
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VC COUNT
                // ----------------------------------------------

                if (sub === "count") {
                    const count =
                        Array.from(
                            tempVCs.values()
                        ).filter(
                            vc =>
                                vc.guildId ===
                                message.guild.id
                        ).length;

                    return safeReply(
                        message,
                        {
                            embeds: [
                                infoEmbed(
                                    "VC Count",
                                    `There are currently **${count}** active temporary VC${count === 1 ? "" : "s"} in this server.`
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VC PANEL
                // ----------------------------------------------

                if (sub === "panel") {
                    const vcData =
                        getMemberVC(
                            message.member
                        );

                    if (!vcData) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "You are not inside a managed VC."
                                    )
                                ]
                            }
                        );
                    }

                    await updateVCInterface(
                        message.member.voice.channel
                    );

                    const control =
                        message.guild.channels.cache.get(
                            vcData.interfaceChannelId
                        );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "VC Panel",
                                    control
                                        ? `Your control panel is ${control}.`
                                        : "The panel was refreshed."
                                )
                            ]
                        }
                    );
                }

                // ----------------------------------------------
                // VC TEXT COMMAND HELPER
                // ----------------------------------------------

                const vcData =
                    getMemberVC(
                        message.member
                    );

                if (!vcData) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "You must be inside a managed VC."
                                )
                            ]
                        }
                    );
                }

                const channel =
                    message.member.voice.channel;

                if (!channel) return;

                if (
                    sub === "lock" ||
                    sub === "unlock"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the VC owner or Founder can do that."
                                    )
                                ]
                            }
                        );
                    }

                    const lock =
                        sub === "lock";

                    vcData.locked =
                        lock;

                    await channel.permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            Connect: !lock
                        }
                    ).catch(() => {});

                    await updateVCInterface(
                        channel
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    lock
                                        ? "Locked"
                                        : "Unlocked",
                                    lock
                                        ? "The VC is now locked."
                                        : "The VC is now unlocked."
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "limit"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the VC owner or Founder can change the limit."
                                    )
                                ]
                            }
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
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Limit must be 0-99."
                                    )
                                ]
                            }
                        );
                    }

                    await channel.setUserLimit(
                        limit
                    ).catch(() => {});

                    await updateVCInterface(
                        channel
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Limit",
                                    `VC limit set to **${limit === 0 ? "Unlimited" : limit}**.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "rename"
                ) {
                    if (
                        !isVCOwner(
                            message.member,
                            vcData
                        )
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only the VC owner or Founder can rename the VC."
                                    )
                                ]
                            }
                        );
                    }

                    const name =
                        args.join(" ")
                            .trim();

                    if (!name) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-vc rename New Name`"
                                    )
                                ]
                            }
                        );
                    }

                    await channel.setName(
                        name
                    ).catch(() => {});

                    await updateVCInterface(
                        channel
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Renamed",
                                    `VC renamed to **${name}**.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "claim"
                ) {
                    const oldOwner =
                        message.guild.members.cache.get(
                            vcData.ownerId
                        );

                    if (
                        oldOwner?.voice
                            ?.channelId ===
                        channel.id
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "The current owner is still in the VC."
                                    )
                                ]
                            }
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    await updateVCInterface(
                        channel
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Claimed",
                                    "You now own the VC."
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "forceclaim"
                ) {
                    if (!isGod(message.member)) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Only Founder/God can force claim."
                                    )
                                ]
                            }
                        );
                    }

                    vcData.ownerId =
                        message.author.id;

                    await updateVCInterface(
                        channel
                    );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Force Claimed",
                                    "You now own the VC."
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "kick" ||
                    sub === "disconnect" ||
                    sub === "ban" ||
                    sub === "reject" ||
                    sub === "permit" ||
                    sub === "transfer" ||
                    sub === "stfu" ||
                    sub === "unstfu"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        `Usage: \`-vc ${sub} @user\``
                                    )
                                ]
                            }
                        );
                    }

                    // Reuse the actual logic by direct execution.
                    if (
                        sub === "kick" ||
                        sub === "disconnect"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcData
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only the VC owner or Founder can do that."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            !canModerate(
                                message.member,
                                target
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "You cannot target someone above or equal to your rank."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            sub === "kick"
                        ) {
                            await sendModerationDM(
                                target.user,
                                message.guild,
                                "VC Kick",
                                `You were kicked from **${channel.name}**.`
                            );
                        }

                        await target.voice
                            .disconnect(
                                `VC ${sub}`
                            )
                            .catch(() => {});

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        sub === "kick"
                                            ? "Kicked"
                                            : "Disconnected",
                                        `${target} was removed from the VC.`
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        sub === "ban"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcData
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only the VC owner or Founder can VC ban."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            !canModerate(
                                message.member,
                                target
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "You cannot target someone above or equal to your rank."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            !vcData.banned.includes(
                                target.id
                            )
                        ) {
                            vcData.banned.push(
                                target.id
                            );
                        }

                        await sendModerationDM(
                            target.user,
                            message.guild,
                            "VC Ban",
                            `You were banned from **${channel.name}**.`
                        );

                        await applyVCBan(
                            channel,
                            target.id
                        );

                        if (
                            target.voice.channelId ===
                            channel.id
                        ) {
                            await target.voice
                                .disconnect(
                                    "VC banned"
                                )
                                .catch(() => {});
                        }

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        "VC Banned",
                                        `${target} is now banned from this VC.`
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        sub === "reject"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcData
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only the VC owner or Founder can reject."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            !vcData.rejected.includes(
                                target.id
                            )
                        ) {
                            vcData.rejected.push(
                                target.id
                            );
                        }

                        await applyVCBan(
                            channel,
                            target.id
                        );

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        "Rejected",
                                        `${target} was rejected from the VC.`
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        sub === "permit"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcData
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only the VC owner or Founder can permit."
                                        )
                                    ]
                                }
                            );
                        }

                        await removeVCBan(
                            channel,
                            target.id
                        );

                        vcData.rejected =
                            vcData.rejected.filter(
                                id =>
                                    id !==
                                    target.id
                            );

                        vcData.banned =
                            vcData.banned.filter(
                                id =>
                                    id !==
                                    target.id
                            );

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        "Permitted",
                                        `${target} can now join the VC.`
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        sub === "transfer"
                    ) {
                        if (
                            !isVCOwner(
                                message.member,
                                vcData
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only the VC owner or Founder can transfer ownership."
                                        )
                                    ]
                                }
                            );
                        }

                        vcData.ownerId =
                            target.id;

                        await updateVCInterface(
                            channel
                        );

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        "Transferred",
                                        `${target} now owns the VC.`
                                    )
                                ]
                            }
                        );
                    }

                    if (
                        sub === "stfu" ||
                        sub === "unstfu"
                    ) {
                        if (
                            !isGod(
                                message.member
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Only Founder/God can use STFU."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            isFounder(
                                target
                            )
                        ) {
                            return safeReply(
                                message,
                                {
                                    embeds: [
                                        errorEmbed(
                                            "Founder cannot be STFU'd."
                                        )
                                    ]
                                }
                            );
                        }

                        if (
                            sub === "stfu"
                        ) {
                            if (
                                !vcData.stfu.includes(
                                    target.id
                                )
                            ) {
                                vcData.stfu.push(
                                    target.id
                                );
                            }

                            await target.voice
                                .setMute(
                                    true,
                                    "VC STFU"
                                )
                                .catch(() => {});
                        } else {
                            vcData.stfu =
                                vcData.stfu.filter(
                                    id =>
                                        id !==
                                        target.id
                                );

                            await target.voice
                                .setMute(
                                    false,
                                    "VC UnSTFU"
                                )
                                .catch(() => {});
                        }

                        return safeReply(
                            message,
                            {
                                embeds: [
                                    successEmbed(
                                        sub === "stfu"
                                            ? "STFU"
                                            : "UnSTFU",
                                        `${target} has been ${
                                            sub === "stfu"
                                                ? "muted"
                                                : "unmuted"
                                        }.`
                                    )
                                ]
                            }
                        );
                    }
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            errorEmbed(
                                "Unknown VC command. Use `-help`."
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // BAN
            // ==================================================

            if (command === "ban") {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can use this command."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-ban @user [reason]`"
                                )
                            ]
                        }
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "You cannot ban someone above or equal to your rank."
                                )
                            ]
                        }
                    );
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Ban",
                    reason
                );

                await target.ban({
                    reason
                }).catch(() => {});

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Banned",
                                `${target.user.tag} was banned.\n**Reason:** ${reason}`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // KICK
            // ==================================================

            if (command === "kick") {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can use this command."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-kick @user [reason]`"
                                )
                            ]
                        }
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "You cannot kick someone above or equal to your rank."
                                )
                            ]
                        }
                    );
                }

                const reason =
                    args.slice(1).join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Kick",
                    reason
                );

                await target.kick(
                    reason
                ).catch(() => {});

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Kicked",
                                `${target.user.tag} was kicked.\n**Reason:** ${reason}`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // UNBAN
            // ==================================================

            if (command === "unban") {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can unban users."
                                )
                            ]
                        }
                    );
                }

                const id =
                    extractId(
                        args[0]
                    );

                if (!id) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-unban <userID>`"
                                )
                            ]
                        }
                    );
                }

                const user =
                    await resolveUser(
                        id
                    );

                if (!user) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Could not find that user."
                                )
                            ]
                        }
                    );
                }

                await message.guild.members
                    .unban(
                        id,
                        "Unbanned by VC+"
                    )
                    .catch(() => {});

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Unbanned",
                                `${user.tag} has been unbanned.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // BAN LIST
            // ==================================================

            if (
                command === "banlist"
            ) {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can view the ban list."
                                )
                            ]
                        }
                    );
                }

                const bans =
                    await message.guild.bans
                        .fetch()
                        .catch(() => null);

                if (!bans) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "I could not fetch the ban list."
                                )
                            ]
                        }
                    );
                }

                if (!bans.size) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                infoEmbed(
                                    "Ban List",
                                    "There are no banned users."
                                )
                            ]
                        }
                    );
                }

                const entries =
                    [...bans.values()]
                        .slice(0, 25)
                        .map(
                            (ban, index) =>
                                `**${index + 1}.** ${ban.user.tag} — \`${ban.user.id}\``
                        );

                return safeReply(
                    message,
                    {
                        embeds: [
                            infoEmbed(
                                `Ban List • ${bans.size}`,
                                entries.join("\n")
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // UNBAN ALL
            // ==================================================

            if (
                command === "unbanall"
            ) {
                if (!isFounder(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only the Founder or Server Owner can use `-unbanall`."
                                )
                            ]
                        }
                    );
                }

                if (
                    String(args[0] || "")
                        .toLowerCase() !==
                    "confirm"
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "This is a mass action. If you really want to unban everyone, use `-unbanall confirm`."
                                )
                            ]
                        }
                    );
                }

                const bans =
                    await message.guild.bans
                        .fetch()
                        .catch(() => null);

                if (!bans) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Could not fetch the ban list."
                                )
                            ]
                        }
                    );
                }

                let success = 0;
                let failed = 0;

                for (
                    const ban of bans.values()
                ) {
                    try {
                        await message.guild.members.unban(
                            ban.user.id,
                            "Mass unban by Founder"
                        );

                        success++;
                    } catch {
                        failed++;
                    }
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Mass Unban Complete",
                                [
                                    `Unbanned: **${success}**`,
                                    `Failed: **${failed}**`
                                ].join("\n")
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command === "timeout"
            ) {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can timeout users."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                const minutes =
                    Number(args[1]);

                if (
                    !target ||
                    !Number.isInteger(minutes) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-timeout @user <minutes> [reason]`"
                                )
                            ]
                        }
                    );
                }

                if (
                    !canModerate(
                        message.member,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "You cannot timeout someone above or equal to your rank."
                                )
                            ]
                        }
                    );
                }

                const reason =
                    args.slice(2).join(" ") ||
                    "No reason provided.";

                await sendModerationDM(
                    target.user,
                    message.guild,
                    "Timeout",
                    reason,
                    `${minutes} minutes`
                );

                await target.timeout(
                    minutes * 60 * 1000,
                    reason
                ).catch(() => {});

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Timed Out",
                                `${target} was timed out for **${minutes} minutes**.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command === "untimeout"
            ) {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can remove timeouts."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-untimeout @user`"
                                )
                            ]
                        }
                    );
                }

                await target.timeout(
                    null,
                    "Timeout removed"
                ).catch(() => {});

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Timeout Removed",
                                `${target} is no longer timed out.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // PURGE
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can purge messages."
                                )
                            ]
                        }
                    );
                }

                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Amount must be between 1 and 100."
                                )
                            ]
                        }
                    );
                }

                if (
                    !message.channel
                        ?.isTextBased()
                ) {
                    return;
                }

                const deleted =
                    await message.channel
                        .bulkDelete(
                            amount,
                            true
                        )
                        .catch(() => null);

                if (!deleted) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "I could not delete those messages."
                                )
                            ]
                        }
                    );
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Purged",
                                `Deleted **${deleted.size}** messages.`
                            )
                        ],
                        ephemeral: true
                    }
                );
            }

            // ==================================================
            // RANK SET
            // ==================================================

            if (
                command === "rankset" ||
                command === "setrank"
            ) {
                if (!isFounder(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/Server Owner can set ranks."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                const rank =
                    normalizeRank(
                        args[1]
                    );

                if (!target || !rank) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-rankset @user <rank>`"
                                )
                            ]
                        }
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "The server owner's rank cannot be changed."
                                )
                            ]
                        }
                    );
                }

                getGuildData(
                    message.guild.id
                ).ranks[target.id] =
                    rank;

                saveDB();

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Rank Updated",
                                `${target} is now **${rank.toUpperCase()}**.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // GODMODE
            // ==================================================

            if (
                command === "godmode"
            ) {
                if (!isFounder(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/Server Owner can manage Godmode."
                                )
                            ]
                        }
                    );
                }

                const target =
                    await resolveMember(
                        message.guild,
                        args[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-godmode @user`"
                                )
                            ]
                        }
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                const index =
                    data.godmode.indexOf(
                        target.id
                    );

                if (index === -1) {
                    data.godmode.push(
                        target.id
                    );

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Godmode Enabled",
                                    `${target} now has Godmode.`
                                )
                            ]
                        }
                    );
                }

                data.godmode.splice(
                    index,
                    1
                );

                saveDB();

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Godmode Disabled",
                                `${target} no longer has Godmode.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command === "foreverban"
            ) {
                if (!isFounder(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/Server Owner can forever-ban users."
                                )
                            ]
                        }
                    );
                }

                const id =
                    extractId(
                        args[0]
                    );

                if (!id) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-foreverban @user`"
                                )
                            ]
                        }
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    !data.foreverBanned.includes(
                        id
                    )
                ) {
                    data.foreverBanned.push(
                        id
                    );
                }

                saveDB();

                const member =
                    await resolveMember(
                        message.guild,
                        id
                    );

                if (member) {
                    await sendModerationDM(
                        member.user,
                        message.guild,
                        "Forever Ban",
                        "You have been permanently banned from this server."
                    );

                    await member.ban({
                        reason:
                            "VC+ Forever Ban"
                    }).catch(() => {});
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Forever Ban",
                                `<@${id}> has been added to the permanent ban list.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // FOREVER UNBAN
            // ==================================================

            if (
                command === "foreverunban"
            ) {
                if (!isFounder(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/Server Owner can remove forever bans."
                                )
                            ]
                        }
                    );
                }

                const id =
                    extractId(
                        args[0]
                    );

                if (!id) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Usage: `-foreverunban <userID>`"
                                )
                            ]
                        }
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                data.foreverBanned =
                    data.foreverBanned.filter(
                        userId =>
                            userId !== id
                    );

                saveDB();

                return safeReply(
                    message,
                    {
                        embeds: [
                            successEmbed(
                                "Forever Ban Removed",
                                `<@${id}> has been removed from the permanent ban list.`
                            )
                        ]
                    }
                );
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command === "filter"
            ) {
                if (!isTrustedExecutor(message.member)) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                errorEmbed(
                                    "Only Founder/God can manage AutoMod."
                                )
                            ]
                        }
                    );
                }

                const sub =
                    String(
                        args.shift() || ""
                    ).toLowerCase();

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    sub === "on"
                ) {
                    data.filters.enabled =
                        true;

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "AutoMod",
                                    "AutoMod is now enabled."
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "off"
                ) {
                    data.filters.enabled =
                        false;

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "AutoMod",
                                    "AutoMod is now disabled."
                                )
                            ]
                        }
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
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-filter add <word>`"
                                    )
                                ]
                            }
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

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Filter Added",
                                    `Added \`${word}\` to the AutoMod filter.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "remove"
                ) {
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

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Filter Removed",
                                    `Removed \`${word}\`.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "list"
                ) {
                    return safeReply(
                        message,
                        {
                            embeds: [
                                infoEmbed(
                                    "AutoMod Words",
                                    data.filters.words.length
                                        ? data.filters.words
                                              .map(
                                                  word =>
                                                      `• \`${word}\``
                                              )
                                              .join("\n")
                                        : "No filtered words."
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "strikes"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-filter strikes @user`"
                                    )
                                ]
                            }
                        );
                    }

                    const strikes =
                        Number(
                            data.filters.strikes[
                                target.id
                            ] || 0
                        );

                    return safeReply(
                        message,
                        {
                            embeds: [
                                infoEmbed(
                                    "AutoMod Strikes",
                                    `${target} has **${strikes}** strike${strikes === 1 ? "" : "s"}.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "reset"
                ) {
                    const target =
                        await resolveMember(
                            message.guild,
                            args[0]
                        );

                    if (!target) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-filter reset @user`"
                                    )
                                ]
                            }
                        );
                    }

                    delete data.filters.strikes[
                        target.id
                    ];

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "Strikes Reset",
                                    `${target}'s AutoMod strikes were reset.`
                                )
                            ]
                        }
                    );
                }

                if (
                    sub === "log"
                ) {
                    const channel =
                        message.mentions.channels.first();

                    if (
                        !channel ||
                        !channel.isTextBased()
                    ) {
                        return safeReply(
                            message,
                            {
                                embeds: [
                                    errorEmbed(
                                        "Usage: `-filter log #channel`"
                                    )
                                ]
                            }
                        );
                    }

                    data.filters.logChannelId =
                        channel.id;

                    saveDB();

                    return safeReply(
                        message,
                        {
                            embeds: [
                                successEmbed(
                                    "AutoMod Log",
                                    `AutoMod logs will now go to ${channel}.`
                                )
                            ]
                        }
                    );
                }

                return safeReply(
                    message,
                    {
                        embeds: [
                            errorEmbed(
                                "Unknown filter command. Use `-help`."
                            )
                        ]
                    }
                );
            }
        } catch (error) {
            console.error(
                "[COMMAND ERROR]",
                error
            );

            await safeReply(
                message,
                {
                    embeds: [
                        errorEmbed(
                            "The command failed safely. The bot is still running."
                        )
                    ]
                }
            );
        }
    }
);

// ============================================================
// ANTI-NUKE EVENTS
// ============================================================

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

            const count =
                trackSecurity(
                    channel.guild.id,
                    executor.id,
                    "channelCreate"
                );

            if (count >= 5) {
                await channel.delete().catch(
                    () => {}
                );

                await securityPunish(
                    channel.guild,
                    executor,
                    "Too many channels created in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[CHANNEL CREATE SECURITY]",
                error
            );
        }
    }
);

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

            const count =
                trackSecurity(
                    channel.guild.id,
                    executor.id,
                    "channelDelete"
                );

            if (count >= 3) {
                await securityPunish(
                    channel.guild,
                    executor,
                    "Too many channels deleted in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[CHANNEL DELETE SECURITY]",
                error
            );
        }
    }
);

client.on(
    "roleCreate",
    async role => {
        try {
            if (!role.guild) return;

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

            const count =
                trackSecurity(
                    role.guild.id,
                    executor.id,
                    "roleCreate"
                );

            if (count >= 5) {
                await role.delete().catch(
                    () => {}
                );

                await securityPunish(
                    role.guild,
                    executor,
                    "Too many roles created in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[ROLE CREATE SECURITY]",
                error
            );
        }
    }
);

client.on(
    "roleDelete",
    async role => {
        try {
            if (!role.guild) return;

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

            const count =
                trackSecurity(
                    role.guild.id,
                    executor.id,
                    "roleDelete"
                );

            if (count >= 3) {
                await securityPunish(
                    role.guild,
                    executor,
                    "Too many roles deleted in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[ROLE DELETE SECURITY]",
                error
            );
        }
    }
);

// ============================================================
// WEBHOOK SECURITY
// ============================================================

client.on(
    "webhooksUpdate",
    async channel => {
        try {
            if (!channel.guild) return;

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.webhookCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.WebhookCreate
                );

            if (!executor) return;

            const count =
                trackSecurity(
                    channel.guild.id,
                    executor.id,
                    "webhookCreate"
                );

            if (count >= 3) {
                await securityPunish(
                    channel.guild,
                    executor,
                    "Too many webhooks were created in a short period."
                );
            }
        } catch (error) {
            console.error(
                "[WEBHOOK SECURITY]",
                error
            );
        }
    }
);

// ============================================================
// CLIENT ERROR HANDLERS
// ============================================================

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
    "warn",
    warning => {
        console.warn(
            "[CLIENT WARN]",
            warning
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

        // Do NOT immediately process.exit().
        // Keeping the process alive prevents one bad
        // promise/error from killing the bot.
    }
);

process.on(
    "SIGINT",
    () => {
        console.log(
            "[SHUTDOWN] Saving database..."
        );

        saveDB();

        client.destroy();

        process.exit(0);
    }
);

process.on(
    "SIGTERM",
    () => {
        console.log(
            "[SHUTDOWN] Saving database..."
        );

        saveDB();

        client.destroy();

        process.exit(0);
    }
);

// ============================================================
// LOGIN
// ============================================================

if (
    !TOKEN ||
    TOKEN === "PUT_BOT_TOKEN_HERE"
) {
    console.error(
        "[LOGIN] Put your Discord bot token in DISCORD_TOKEN or replace PUT_BOT_TOKEN_HERE."
    );
} else {
    client.login(TOKEN).catch(error => {
        console.error(
            "[LOGIN ERROR]",
            error
        );
    });
}
