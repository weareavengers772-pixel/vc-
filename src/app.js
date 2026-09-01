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
import "dotenv/config";

// ============================================================
// CONFIG
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
    console.error("Missing TOKEN in .env");
    process.exit(1);
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

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {
    guilds: {}
};

try {
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );
    }
} catch (error) {
    console.error("Database load error:", error);

    db = {
        guilds: {}
    };
}

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

function createDefaultGuildData() {
    return {
        ranks: {},

        foreverBanned: [],

        godmode: [],

        vouches: {},

        // Number of vouches required for vouch role
        vouchLimit: 5,

        jtc: {
            enabled: false,
            channelId: null,
            categoryId: null
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
    const defaults = createDefaultGuildData();

    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaults;
        saveDB();
    }

    const old = db.guilds[guildId];

    db.guilds[guildId] = {
        ...defaults,
        ...old,

        jtc: {
            ...defaults.jtc,
            ...(old.jtc || {})
        },

        roles: {
            ...defaults.roles,
            ...(old.roles || {})
        },

        protection: {
            ...defaults.protection,
            ...(old.protection || {})
        },

        filters: {
            ...defaults.filters,
            ...(old.filters || {})
        },

        vouches: {
            ...defaults.vouches,
            ...(old.vouches || {})
        }
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
    if (!rank) return "member";

    return rank
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRank(member) {
    if (!member?.guild) return "member";

    if (
        member.guild.ownerId === member.id
    ) {
        return "founder";
    }

    const data = getGuildData(
        member.guild.id
    );

    return normalizeRank(
        data.ranks[member.id] || "member"
    );
}

function getRankLevel(member) {
    const rank = getRank(member);

    return RANKS[rank] || 1;
}

function isFounder(member) {
    return (
        member?.guild &&
        (
            member.guild.ownerId === member.id ||
            getRank(member) === "founder"
        )
    );
}

function isGod(member) {
    if (!member?.guild) return false;

    if (isFounder(member)) {
        return true;
    }

    const data = getGuildData(
        member.guild.id
    );

    return (
        getRank(member) === "god" ||
        data.godmode.includes(member.id)
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

    if (isFounder(target)) {
        return false;
    }

    if (isFounder(actor)) {
        return true;
    }

    return (
        getRankLevel(actor) >
        getRankLevel(target)
    );
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
// MODERATION DM
// ============================================================

async function sendModerationDM(
    user,
    guild,
    action,
    reason = "No reason provided.",
    duration = null
) {
    if (!user) return;

    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`${BOT_NAME} • ${action}`)
        .setDescription(
            `You were **${action.toLowerCase()}** in **${guild.name}**.`
        )
        .addFields({
            name: "Reason",
            value: reason.slice(0, 1024)
        })
        .setTimestamp();

    if (duration) {
        embed.addFields({
            name: "Duration",
            value: duration
        });
    }

    try {
        await user.send({
            embeds: [embed]
        });
    } catch {
        // DMs disabled
    }
}

// ============================================================
// TEMP VC SYSTEM
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

        interfaceMessageId: null,
        interfaceChannelId: null
    };
}

function getTempVC(channelId) {
    return tempVCs.get(channelId);
}

function getMemberTempVC(member) {
    if (!member?.voice?.channel) {
        return null;
    }

    return getTempVC(
        member.voice.channel.id
    );
}

function isVCOwner(member, vcData) {
    if (!member || !vcData) {
        return false;
    }

    return (
        vcData.ownerId === member.id ||
        isFounder(member)
    );
}

function canControlVC(member, vcData) {
    return isVCOwner(member, vcData);
}

async function ensureVCInterfaceChannel(
    voiceChannel
) {
    const vcData =
        getTempVC(voiceChannel.id);

    if (!vcData) return null;

    if (vcData.interfaceChannelId) {
        const existing =
            voiceChannel.guild.channels.cache.get(
                vcData.interfaceChannelId
            );

        if (
            existing &&
            existing.isTextBased()
        ) {
            return existing;
        }
    }

    try {
        const control =
            await voiceChannel.guild.channels.create({
                name: `vc-control-${voiceChannel.id.slice(-6)}`,
                type: ChannelType.GuildText,
                parent: voiceChannel.parentId || undefined,

                permissionOverwrites: [
                    {
                        id:
                            voiceChannel.guild.roles.everyone.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel
                        ],

                        deny: [
                            PermissionFlagsBits.SendMessages
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

        vcData.interfaceChannelId =
            control.id;

        return control;
    } catch (error) {
        console.error(
            "VC interface creation error:",
            error
        );

        return null;
    }
}

function createVCButtons() {
    const row1 =
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
        );

    const row2 =
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
        );

    const row3 =
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
        );

    return [
        row1,
        row2,
        row3
    ];
}

async function updateVCInterface(
    voiceChannel
) {
    const vcData =
        getTempVC(voiceChannel.id);

    if (!vcData) return;

    const control =
        await ensureVCInterfaceChannel(
            voiceChannel
        );

    if (!control) return;

    const embed =
        new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(
                `${BOT_NAME} • Voice Control`
            )
            .setDescription(
                [
                    `**Voice Channel:** ${voiceChannel}`,
                    `**Owner:** <@${vcData.ownerId}>`,
                    `**Members:** ${voiceChannel.members.size}`,
                    `**Status:** ${
                        vcData.locked
                            ? "🔒 Locked"
                            : "🔓 Unlocked"
                    }`,
                    "",
                    "Use the buttons below to control your VC."
                ].join("\n")
            )
            .setFooter({
                text: "Permissions are checked by the bot."
            })
            .setTimestamp();

    const payload = {
        embeds: [embed],
        components: createVCButtons()
    };

    try {
        if (vcData.interfaceMessageId) {
            const oldMessage =
                await control.messages.fetch(
                    vcData.interfaceMessageId
                ).catch(() => null);

            if (oldMessage) {
                await oldMessage.edit(payload);
                return;
            }
        }

        const newMessage =
            await control.send(payload);

        vcData.interfaceMessageId =
            newMessage.id;
    } catch (error) {
        console.error(
            "VC interface update error:",
            error
        );
    }
}

async function createPersonalVC(
    member,
    jtcChannel
) {
    const guild = member.guild;
    const data = getGuildData(guild.id);

    let parent =
        data.jtc.categoryId
            ? guild.channels.cache.get(
                  data.jtc.categoryId
              )
            : jtcChannel?.parent;

    const channel =
        await guild.channels.create({
            name: `${member.user.username}'s VC`,
            type: ChannelType.GuildVoice,
            parent: parent?.id || undefined,

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
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.DeafenMembers
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

    await updateVCInterface(channel);

    try {
        await member.voice.setChannel(channel);
    } catch {
        // User may have left
    }

    return channel;
}

async function deleteEmptyVC(channel) {
    if (!channel) return;

    const vcData =
        getTempVC(channel.id);

    if (!vcData) return;

    if (channel.members.size > 0) {
        return;
    }

    const interfaceId =
        vcData.interfaceChannelId;

    tempVCs.delete(channel.id);

    if (interfaceId) {
        const control =
            channel.guild.channels.cache.get(
                interfaceId
            );

        if (control) {
            await control.delete(
                "Temporary VC became empty"
            ).catch(() => {});
        }
    }

    await channel.delete(
        "Temporary VC became empty"
    ).catch(() => {});
}

async function applyVCBan(
    voiceChannel,
    target,
    moderator
) {
    const vcData =
        getTempVC(voiceChannel.id);

    if (!vcData) {
        return false;
    }

    vcData.banned.add(target.id);

    vcData.rejected.delete(target.id);
    vcData.permitted.delete(target.id);

    await sendModerationDM(
        target.user,
        voiceChannel.guild,
        "VC Ban",
        `You were banned from **${voiceChannel.name}** by ${moderator.user.tag}.`
    );

    if (
        target.voice.channelId ===
        voiceChannel.id
    ) {
        await target.voice.disconnect(
            "VC banned"
        ).catch(() => {});
    }

    return true;
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

function canManageVouches(member) {
    return isFounder(member);
}

function getVouchCount(
    guildId,
    userId
) {
    const data =
        getGuildData(guildId);

    return Number(
        data.vouches[userId] || 0
    );
}

function setVouchCount(
    guildId,
    userId,
    amount
) {
    const data =
        getGuildData(guildId);

    amount = Math.max(
        0,
        Number(amount) || 0
    );

    if (amount <= 0) {
        delete data.vouches[userId];
    } else {
        data.vouches[userId] =
            amount;
    }

    saveDB();
}

function getVouchLimit(guild) {
    const data =
        getGuildData(guild.id);

    const limit =
        Number(data.vouchLimit);

    if (
        !Number.isFinite(limit) ||
        limit < 1
    ) {
        return 1;
    }

    return Math.floor(limit);
}

function getVouchRole(guild) {
    const data =
        getGuildData(guild.id);

    if (!data.roles.vouch) {
        return null;
    }

    return (
        guild.roles.cache.get(
            data.roles.vouch
        ) || null
    );
}

async function syncVouchRole(member) {
    if (!member?.guild) {
        return false;
    }

    const role =
        getVouchRole(member.guild);

    if (!role) {
        return false;
    }

    if (
        role.id === member.guild.id ||
        role.managed
    ) {
        return false;
    }

    const botMember =
        member.guild.members.me;

    if (!botMember) {
        return false;
    }

    if (
        role.position >=
        botMember.roles.highest.position
    ) {
        return false;
    }

    const count =
        getVouchCount(
            member.guild.id,
            member.id
        );

    const limit =
        getVouchLimit(member.guild);

    try {
        if (count >= limit) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role,
                    `Reached ${limit} vouches`
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
                    `Below ${limit} vouches`
                );
            }
        }

        return true;
    } catch (error) {
        console.error(
            "Vouch role error:",
            error
        );

        return false;
    }
}

async function syncAllVouchRoles(
    guild
) {
    const data =
        getGuildData(guild.id);

    let updated = 0;
    let failed = 0;

    for (
        const userId of Object.keys(
            data.vouches
        )
    ) {
        const member =
            guild.members.cache.get(
                userId
            );

        if (!member) continue;

        const result =
            await syncVouchRole(member);

        if (result) {
            updated++;
        } else {
            failed++;
        }
    }

    return {
        updated,
        failed
    };
}

async function handleVouchCommand(
    message,
    args
) {
    if (!message.guild) return;

    const data =
        getGuildData(
            message.guild.id
        );

    if (!args.length) {
        return message.reply({
            embeds: [
                infoEmbed(
                    "Vouch Commands",
                    [
                        `\`${PREFIX}vouch give @user\` — Founder/Owner`,
                        `\`${PREFIX}vouch take @user\` — Founder/Owner`,
                        `\`${PREFIX}vouch clear @user\` — Founder/Owner`,
                        `\`${PREFIX}vouch list\` — View leaderboard`,
                        `\`${PREFIX}vouch role set @role\` — Founder/Owner`,
                        `\`${PREFIX}vouch limit <number>\` — Founder/Owner`,
                        "",
                        `\`${PREFIX}vouchrole view\``,
                        `\`${PREFIX}vouchrole claim\``
                    ].join("\n")
                )
            ]
        });
    }

    const sub =
        args[0].toLowerCase();

    // GIVE
    if (sub === "give") {
        if (!canManageVouches(message.member)) {
            return message.reply(
                "❌ Only the **Founder or Server Owner** can give vouches."
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vouch give @user\``
            );
        }

        if (target.user.bot) {
            return message.reply(
                "❌ Bots cannot receive vouches."
            );
        }

        const newCount =
            getVouchCount(
                message.guild.id,
                target.id
            ) + 1;

        setVouchCount(
            message.guild.id,
            target.id,
            newCount
        );

        const limit =
            getVouchLimit(message.guild);

        await syncVouchRole(target);

        const role =
            getVouchRole(message.guild);

        return message.reply({
            embeds: [
                successEmbed(
                    "Vouch Added",
                    [
                        `**${target.user.tag}** now has **${newCount}** vouch(es).`,
                        "",
                        `Required: **${limit}**`,
                        `Role: ${role || "Not configured"}`,
                        "",
                        newCount >= limit && role
                            ? `✅ ${role} was automatically assigned.`
                            : `They need **${Math.max(
                                  0,
                                  limit - newCount
                              )}** more.`
                    ].join("\n")
                )
            ]
        });
    }

    // TAKE
    if (sub === "take") {
        if (!canManageVouches(message.member)) {
            return message.reply(
                "❌ Only the **Founder or Server Owner** can take vouches."
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vouch take @user\``
            );
        }

        const current =
            getVouchCount(
                message.guild.id,
                target.id
            );

        if (current <= 0) {
            return message.reply(
                "❌ That user has no vouches."
            );
        }

        setVouchCount(
            message.guild.id,
            target.id,
            current - 1
        );

        await syncVouchRole(target);

        return message.reply({
            embeds: [
                successEmbed(
                    "Vouch Removed",
                    `**${target.user.tag}** now has **${current - 1}** vouch(es).`
                )
            ]
        });
    }

    // CLEAR
    if (sub === "clear") {
        if (!canManageVouches(message.member)) {
            return message.reply(
                "❌ Only the **Founder or Server Owner** can clear vouches."
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vouch clear @user\``
            );
        }

        setVouchCount(
            message.guild.id,
            target.id,
            0
        );

        await syncVouchRole(target);

        return message.reply(
            `✅ Cleared all vouches from **${target.user.tag}** and removed their vouch role if applicable.`
        );
    }

    // LIST
    if (sub === "list") {
        const entries =
            Object.entries(data.vouches)
                .map(([userId, count]) => ({
                    userId,
                    count: Number(count)
                }))
                .filter(x => x.count > 0)
                .sort(
                    (a, b) =>
                        b.count - a.count
                )
                .slice(0, 20);

        if (!entries.length) {
            return message.reply(
                "📋 There are no vouches yet."
            );
        }

        const lines =
            entries.map(
                (entry, index) =>
                    `**${index + 1}.** <@${entry.userId}> — **${entry.count}**`
            );

        return message.reply({
            embeds: [
                infoEmbed(
                    "Vouch Leaderboard",
                    [
                        lines.join("\n"),
                        "",
                        `Required: **${getVouchLimit(message.guild)}**`,
                        `Role: ${
                            getVouchRole(message.guild) ||
                            "Not configured"
                        }`
                    ].join("\n")
                )
            ]
        });
    }

    // ROLE
    if (sub === "role") {
        if (!canManageVouches(message.member)) {
            return message.reply(
                "❌ Only the **Founder or Server Owner** can set the vouch role."
            );
        }

        if (
            args[1]?.toLowerCase() !==
            "set"
        ) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vouch role set @role\``
            );
        }

        const role =
            message.mentions.roles.first();

        if (!role) {
            return message.reply(
                "❌ Mention the role."
            );
        }

        if (
            role.managed ||
            role.id === message.guild.id
        ) {
            return message.reply(
                "❌ That role cannot be used."
            );
        }

        const botMember =
            message.guild.members.me;

        if (
            !botMember ||
            role.position >=
                botMember.roles.highest.position
        ) {
            return message.reply(
                "❌ My bot role must be above the vouch role."
            );
        }

        data.roles.vouch =
            role.id;

        saveDB();

        const result =
            await syncAllVouchRoles(
                message.guild
            );

        return message.reply({
            embeds: [
                successEmbed(
                    "Vouch Role Set",
                    [
                        `Vouch role: ${role}`,
                        `Required vouches: **${getVouchLimit(message.guild)}**`,
                        `Existing users checked: **${result.updated}**`
                    ].join("\n")
                )
            ]
        });
    }

    // LIMIT
    if (sub === "limit") {
        if (!canManageVouches(message.member)) {
            return message.reply(
                "❌ Only the **Founder or Server Owner** can change the vouch limit."
            );
        }

        const limit =
            Number(args[1]);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100000
        ) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vouch limit <1-100000>\``
            );
        }

        data.vouchLimit =
            limit;

        saveDB();

        await syncAllVouchRoles(
            message.guild
        );

        return message.reply({
            embeds: [
                successEmbed(
                    "Vouch Limit Updated",
                    `Users now need **${limit}** vouches to receive the configured vouch role.`
                )
            ]
        });
    }

    return message.reply(
        `❌ Unknown vouch command. Use \`${PREFIX}vouch\` for help.`
    );
}

// ============================================================
// VOUCH ROLE
// ============================================================

async function handleVouchRoleCommand(
    message,
    args
) {
    if (!message.guild) return;

    const role =
        getVouchRole(message.guild);

    const limit =
        getVouchLimit(message.guild);

    const count =
        getVouchCount(
            message.guild.id,
            message.author.id
        );

    const sub =
        args[0]?.toLowerCase() ||
        "view";

    if (sub === "view") {
        return message.reply({
            embeds: [
                infoEmbed(
                    "Vouch Role",
                    [
                        `Role: ${
                            role || "Not configured"
                        }`,
                        `Required: **${limit}**`,
                        `Your vouches: **${count}**`,
                        "",
                        count >= limit
                            ? "✅ You qualify for the role."
                            : `❌ You need **${limit - count}** more vouch(es).`
                    ].join("\n")
                )
            ]
        });
    }

    if (sub === "claim") {
        if (!role) {
            return message.reply(
                "❌ A vouch role has not been configured."
            );
        }

        if (count < limit) {
            return message.reply(
                `❌ You need **${limit}** vouches. You currently have **${count}**.`
            );
        }

        const botMember =
            message.guild.members.me;

        if (
            !botMember ||
            role.position >=
                botMember.roles.highest.position
        ) {
            return message.reply(
                "❌ I can't assign that role. Move my bot role above the vouch role."
            );
        }

        try {
            await message.member.roles.add(
                role,
                "Qualified for vouch role"
            );

            return message.reply({
                embeds: [
                    successEmbed(
                        "Vouch Role Claimed",
                        `✅ You now have ${role}.`
                    )
                ]
            });
        } catch (error) {
            console.error(
                "Vouch claim error:",
                error
            );

            return message.reply(
                "❌ I couldn't assign the role."
            );
        }
    }

    return message.reply(
        `❌ Usage: \`${PREFIX}vouchrole view\` or \`${PREFIX}vouchrole claim\``
    );
}

// ============================================================
// VC TARGET SELECTOR
// ============================================================

async function showVCTargetSelector(
    interaction,
    action
) {
    const select =
        new UserSelectMenuBuilder()
            .setCustomId(
                `vc_target_${action}`
            )
            .setPlaceholder(
                `Select a user to ${action}`
            )
            .setMinValues(1)
            .setMaxValues(1);

    const row =
        new ActionRowBuilder()
            .addComponents(select);

    await interaction.reply({
        embeds: [
            infoEmbed(
                "VC Control",
                `Select the user you want to **${action}**.`
            )
        ],
        components: [row],
        ephemeral: true
    });
}

// ============================================================
// VC BUTTON HANDLER
// ============================================================

async function handleVCButton(
    interaction
) {
    const member =
        interaction.member;

    const voiceChannel =
        member.voice?.channel;

    if (!voiceChannel) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "You must be inside your temporary VC."
                )
            ],
            ephemeral: true
        });
    }

    const vcData =
        getTempVC(voiceChannel.id);

    if (!vcData) {
        return interaction.reply({
            embeds: [
                errorEmbed(
                    "This is not a VC+ temporary voice channel."
                )
            ],
            ephemeral: true
        });
    }

    const id =
        interaction.customId;

    if (
        [
            "vc_kick",
            "vc_disconnect",
            "vc_ban",
            "vc_reject",
            "vc_permit",
            "vc_stfu",
            "vc_unstfu",
            "vc_transfer"
        ].includes(id)
    ) {
        const action =
            id.replace("vc_", "");

        if (
            !canControlVC(
                member,
                vcData
            ) &&
            !(
                ["stfu", "unstfu"].includes(
                    action
                ) && isGod(member)
            )
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "You don't have permission to control this VC."
                    )
                ],
                ephemeral: true
            });
        }

        return showVCTargetSelector(
            interaction,
            action
        );
    }

    if (id === "vc_lock") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can lock this VC."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.locked = true;

        await voiceChannel.permissionOverwrites.edit(
            voiceChannel.guild.roles.everyone,
            {
                Connect: false
            }
        );

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                "🔒 VC locked.",
            ephemeral: true
        });
    }

    if (id === "vc_unlock") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                embeds: [
                    errorEmbed(
                        "Only the VC owner or Founder can unlock this VC."
                    )
                ],
                ephemeral: true
            });
        }

        vcData.locked = false;

        await voiceChannel.permissionOverwrites.edit(
            voiceChannel.guild.roles.everyone,
            {
                Connect: true
            }
        );

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                "🔓 VC unlocked.",
            ephemeral: true
        });
    }

    if (id === "vc_claim") {
        if (voiceChannel.members.size === 0) {
            return interaction.reply({
                content:
                    "❌ Nobody is inside this VC.",
                ephemeral: true
            });
        }

        if (
            voiceChannel.members.has(
                vcData.ownerId
            )
        ) {
            return interaction.reply({
                content:
                    "❌ The current owner is still inside the VC.",
                ephemeral: true
            });
        }

        vcData.ownerId =
            member.id;

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                "👑 You claimed the VC.",
            ephemeral: true
        });
    }

    if (id === "vc_forceclaim") {
        if (!isGod(member)) {
            return interaction.reply({
                content:
                    "❌ Only God or Founder can force-claim a VC.",
                ephemeral: true
            });
        }

        vcData.ownerId =
            member.id;

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                "👑 VC force-claimed.",
            ephemeral: true
        });
    }

    if (id === "vc_rename") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ Only the VC owner or Founder can rename it.",
                ephemeral: true
            });
        }

        const modal =
            new ModalBuilder()
                .setCustomId(
                    "vc_rename_modal"
                )
                .setTitle(
                    "Rename Voice Channel"
                );

        const input =
            new TextInputBuilder()
                .setCustomId(
                    "vc_name"
                )
                .setLabel(
                    "New VC Name"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(100)
                .setValue(
                    voiceChannel.name
                );

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                input
            )
        );

        return interaction.showModal(
            modal
        );
    }

    if (id === "vc_limit") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ Only the VC owner or Founder can change the limit.",
                ephemeral: true
            });
        }

        const modal =
            new ModalBuilder()
                .setCustomId(
                    "vc_limit_modal"
                )
                .setTitle(
                    "Change VC Limit"
                );

        const input =
            new TextInputBuilder()
                .setCustomId(
                    "vc_limit_value"
                )
                .setLabel(
                    "User Limit (0 = unlimited)"
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true)
                .setMaxLength(3)
                .setValue(
                    String(
                        voiceChannel.userLimit
                    )
                );

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                input
            )
        );

        return interaction.showModal(
            modal
        );
    }

    if (id === "vc_refresh") {
        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                "🔄 VC panel refreshed.",
            ephemeral: true
        });
    }
}

// ============================================================
// VC TARGET SELECT ACTION
// ============================================================

async function handleVCTarget(
    interaction
) {
    const member =
        interaction.member;

    const voiceChannel =
        member.voice?.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content:
                "❌ You must be inside a temporary VC.",
            ephemeral: true
        });
    }

    const vcData =
        getTempVC(
            voiceChannel.id
        );

    if (!vcData) {
        return interaction.reply({
            content:
                "❌ This isn't a VC+ temporary VC.",
            ephemeral: true
        });
    }

    const action =
        interaction.customId.replace(
            "vc_target_",
            ""
        );

    const targetId =
        interaction.values[0];

    const target =
        await voiceChannel.guild.members
            .fetch(targetId)
            .catch(() => null);

    if (!target) {
        return interaction.reply({
            content:
                "❌ User not found.",
            ephemeral: true
        });
    }

    if (
        target.id === member.id
    ) {
        return interaction.reply({
            content:
                "❌ You can't target yourself.",
            ephemeral: true
        });
    }

    if (
        isFounder(target) &&
        !isFounder(member)
    ) {
        return interaction.reply({
            content:
                "❌ You cannot target the Founder.",
            ephemeral: true
        });
    }

    // KICK
    if (action === "kick") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ No permission.",
                ephemeral: true
            });
        }

        await sendModerationDM(
            target.user,
            voiceChannel.guild,
            "VC Kick",
            `You were kicked from **${voiceChannel.name}**.`
        );

        await target.voice.disconnect(
            "VC kick"
        ).catch(() => {});

        return interaction.reply({
            content:
                `✅ ${target.user.tag} was kicked.`,
            ephemeral: true
        });
    }

    // DISCONNECT
    if (action === "disconnect") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ No permission.",
                ephemeral: true
            });
        }

        await target.voice.disconnect(
            "VC disconnect"
        ).catch(() => {});

        return interaction.reply({
            content:
                `✅ ${target.user.tag} was disconnected.`,
            ephemeral: true
        });
    }

    // BAN
    if (action === "ban") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ No permission.",
                ephemeral: true
            });
        }

        await applyVCBan(
            voiceChannel,
            target,
            member
        );

        return interaction.reply({
            content:
                `🔨 ${target.user.tag} was VC banned.`,
            ephemeral: true
        });
    }

    // REJECT
    if (action === "reject") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ No permission.",
                ephemeral: true
            });
        }

        vcData.rejected.add(
            target.id
        );

        vcData.permitted.delete(
            target.id
        );

        await target.voice.disconnect(
            "VC rejected"
        ).catch(() => {});

        return interaction.reply({
            content:
                `🚫 ${target.user.tag} was rejected.`,
            ephemeral: true
        });
    }

    // PERMIT
    if (action === "permit") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ No permission.",
                ephemeral: true
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

        await voiceChannel.permissionOverwrites.edit(
            target.id,
            {
                ViewChannel: true,
                Connect: true,
                Speak: true
            }
        );

        return interaction.reply({
            content:
                `✅ ${target.user.tag} was permitted.`,
            ephemeral: true
        });
    }

    // STFU
    if (action === "stfu") {
        if (!isGod(member)) {
            return interaction.reply({
                content:
                    "❌ Only God or Founder can use STFU.",
                ephemeral: true
            });
        }

        vcData.stfu.add(
            target.id
        );

        await target.voice.setMute(
            true,
            "VC STFU"
        ).catch(() => {});

        return interaction.reply({
            content:
                `🔇 ${target.user.tag} was STFU.`,
            ephemeral: true
        });
    }

    // UNSTFU
    if (action === "unstfu") {
        if (!isGod(member)) {
            return interaction.reply({
                content:
                    "❌ Only God or Founder can use UnSTFU.",
                ephemeral: true
            });
        }

        vcData.stfu.delete(
            target.id
        );

        await target.voice.setMute(
            false,
            "VC UnSTFU"
        ).catch(() => {});

        return interaction.reply({
            content:
                `🔊 ${target.user.tag} was un-STFU.`,
            ephemeral: true
        });
    }

    // TRANSFER
    if (action === "transfer") {
        if (
            !canControlVC(
                member,
                vcData
            )
        ) {
            return interaction.reply({
                content:
                    "❌ Only the owner or Founder can transfer ownership.",
                ephemeral: true
            });
        }

        if (
            !target.voice.channel ||
            target.voice.channel.id !==
                voiceChannel.id
        ) {
            return interaction.reply({
                content:
                    "❌ That user must be inside your VC.",
                ephemeral: true
            });
        }

        vcData.ownerId =
            target.id;

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                `👑 VC ownership transferred to ${target.user.tag}.`,
            ephemeral: true
        });
    }
}

// ============================================================
// MODALS
// ============================================================

async function handleVCModal(
    interaction
) {
    const member =
        interaction.member;

    const voiceChannel =
        member.voice?.channel;

    if (!voiceChannel) {
        return interaction.reply({
            content:
                "❌ You must be inside the VC.",
            ephemeral: true
        });
    }

    const vcData =
        getTempVC(
            voiceChannel.id
        );

    if (!vcData) {
        return interaction.reply({
            content:
                "❌ This isn't a temporary VC.",
            ephemeral: true
        });
    }

    if (
        !canControlVC(
            member,
            vcData
        )
    ) {
        return interaction.reply({
            content:
                "❌ You don't control this VC.",
            ephemeral: true
        });
    }

    if (
        interaction.customId ===
        "vc_rename_modal"
    ) {
        const name =
            interaction.fields
                .getTextInputValue(
                    "vc_name"
                )
                .trim();

        if (!name) {
            return interaction.reply({
                content:
                    "❌ Invalid name.",
                ephemeral: true
            });
        }

        await voiceChannel.setName(
            name,
            "VC owner renamed channel"
        );

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                `✅ VC renamed to **${name}**.`,
            ephemeral: true
        });
    }

    if (
        interaction.customId ===
        "vc_limit_modal"
    ) {
        const raw =
            interaction.fields
                .getTextInputValue(
                    "vc_limit_value"
                )
                .trim();

        const limit =
            Number(raw);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return interaction.reply({
                content:
                    "❌ Enter a number from 0-99.",
                ephemeral: true
            });
        }

        await voiceChannel.setUserLimit(
            limit
        );

        await updateVCInterface(
            voiceChannel
        );

        return interaction.reply({
            content:
                `✅ VC limit set to **${limit === 0 ? "Unlimited" : limit}**.`,
            ephemeral: true
        });
    }
}

// ============================================================
// SECURITY / ANTI-NUKE
// ============================================================

const securityTracker = new Map();

function securityKey(
    guildId,
    type
) {
    return `${guildId}:${type}`;
}

function registerSecurityAction(
    guildId,
    type
) {
    const key =
        securityKey(
            guildId,
            type
        );

    const now =
        Date.now();

    const existing =
        securityTracker.get(
            key
        ) || [];

    const recent =
        existing.filter(
            timestamp =>
                now - timestamp <
                10000
        );

    recent.push(now);

    securityTracker.set(
        key,
        recent
    );

    return recent.length;
}

async function securityPunish(
    guild,
    executorId,
    reason
) {
    if (!executorId) return;

    const member =
        guild.members.cache.get(
            executorId
        );

    if (!member) return;

    if (isTrustedExecutor(member)) {
        return;
    }

    await sendModerationDM(
        member.user,
        guild,
        "Security Action",
        reason
    );

    await member.ban({
        reason
    }).catch(() => {});
}

async function inspectAudit(
    guild,
    type,
    reason,
    threshold
) {
    const data =
        getGuildData(guild.id);

    if (!data.protection.enabled) {
        return;
    }

    const entry =
        await guild.fetchAuditLogs({
            type,
            limit: 1
        }).then(
            logs =>
                logs.entries.first()
        ).catch(() => null);

    if (!entry) return;

    const count =
        registerSecurityAction(
            guild.id,
            String(type)
        );

    if (count >= threshold) {
        await securityPunish(
            guild,
            entry.executor?.id,
            reason
        );
    }
}

// ============================================================
// COMMAND HELP
// ============================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`${BOT_NAME} • Commands`)
        .setDescription(
            [
                "**VC**",
                `\`${PREFIX}vc setup\``,
                `\`${PREFIX}vc count\``,
                `\`${PREFIX}vc panel\``,
                `\`${PREFIX}vc kick @user\``,
                `\`${PREFIX}vc disconnect @user\``,
                `\`${PREFIX}vc ban @user\``,
                `\`${PREFIX}vc reject @user\``,
                `\`${PREFIX}vc permit @user\``,
                `\`${PREFIX}vc lock\``,
                `\`${PREFIX}vc unlock\``,
                `\`${PREFIX}vc limit <number>\``,
                `\`${PREFIX}vc rename <name>\``,
                `\`${PREFIX}vc transfer @user\``,
                `\`${PREFIX}vc claim\``,
                `\`${PREFIX}vc forceclaim\``,
                `\`${PREFIX}vc stfu @user\``,
                `\`${PREFIX}vc unstfu @user\``,
                "",
                "**VOUCHES**",
                `\`${PREFIX}vouch give @user\``,
                `\`${PREFIX}vouch take @user\``,
                `\`${PREFIX}vouch clear @user\``,
                `\`${PREFIX}vouch list\``,
                `\`${PREFIX}vouch role set @role\``,
                `\`${PREFIX}vouch limit <number>\``,
                `\`${PREFIX}vouchrole view\``,
                `\`${PREFIX}vouchrole claim\``,
                "",
                "**MODERATION**",
                `\`${PREFIX}ban @user [reason]\``,
                `\`${PREFIX}kick @user [reason]\``,
                `\`${PREFIX}timeout @user <minutes> [reason]\``,
                `\`${PREFIX}untimeout @user\``,
                `\`${PREFIX}unban <userId>\``,
                `\`${PREFIX}banlist\``,
                `\`${PREFIX}unbanall confirm\``,
                `\`${PREFIX}purge <amount>\``,
                "",
                "**SECURITY / RANKS**",
                `\`${PREFIX}rank @user <rank>\``,
                `\`${PREFIX}godmode @user\``,
                `\`${PREFIX}foreverban @user\``,
                `\`${PREFIX}automod on/off\``,
                `\`${PREFIX}automod add <word>\``,
                `\`${PREFIX}automod remove <word>\``,
                `\`${PREFIX}automod list\``
            ].join("\n")
        )
        .setTimestamp();
}

// ============================================================
// VC COMMANDS
// ============================================================

async function handleVCCommand(
    message,
    args
) {
    if (!message.guild) return;

    const sub =
        args[0]?.toLowerCase();

    // SETUP
    if (sub === "setup") {
        if (!isFounder(message.member)) {
            return message.reply(
                "❌ Only the Founder or Server Owner can setup VC+."
            );
        }

        const category =
            await message.guild.channels.create({
                name: "VC+",
                type: ChannelType.GuildCategory
            });

        const join =
            await message.guild.channels.create({
                name: "Join To Create",
                type: ChannelType.GuildVoice,
                parent: category.id
            });

        const data =
            getGuildData(
                message.guild.id
            );

        data.jtc.enabled = true;
        data.jtc.channelId =
            join.id;
        data.jtc.categoryId =
            category.id;

        saveDB();

        return message.reply({
            embeds: [
                successEmbed(
                    "VC+ Setup",
                    `Join channel created: ${join}`
                )
            ]
        });
    }

    // COUNT
    if (sub === "count") {
        const count =
            [...tempVCs.values()]
                .filter(
                    vc =>
                        vc.guildId ===
                        message.guild.id
                ).length;

        return message.reply(
            `🎙️ There are currently **${count}** active temporary VC(s).`
        );
    }

    const voiceChannel =
        message.member.voice?.channel;

    if (!voiceChannel) {
        return message.reply(
            "❌ You must be inside a VC."
        );
    }

    const vcData =
        getTempVC(
            voiceChannel.id
        );

    if (!vcData) {
        return message.reply(
            "❌ This is not a VC+ temporary VC."
        );
    }

    // PANEL
    if (sub === "panel") {
        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            "✅ VC control panel refreshed."
        );
    }

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
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vc ${sub} @user\``
            );
        }

        if (
            ["stfu", "unstfu"].includes(sub)
        ) {
            if (!isGod(message.member)) {
                return message.reply(
                    "❌ Only God or Founder can use this."
                );
            }
        } else if (
            !canControlVC(
                message.member,
                vcData
            )
        ) {
            return message.reply(
                "❌ You don't control this VC."
            );
        }

        if (
            isFounder(target) &&
            !isFounder(message.member)
        ) {
            return message.reply(
                "❌ You cannot target the Founder."
            );
        }

        if (sub === "kick") {
            await target.voice.disconnect(
                "VC kick"
            ).catch(() => {});

            await sendModerationDM(
                target.user,
                message.guild,
                "VC Kick",
                `You were kicked from **${voiceChannel.name}**.`
            );

            return message.reply(
                `✅ ${target.user.tag} was kicked.`
            );
        }

        if (sub === "disconnect") {
            await target.voice.disconnect(
                "VC disconnect"
            ).catch(() => {});

            return message.reply(
                `✅ ${target.user.tag} was disconnected.`
            );
        }

        if (sub === "ban") {
            await applyVCBan(
                voiceChannel,
                target,
                message.member
            );

            return message.reply(
                `🔨 ${target.user.tag} was VC banned.`
            );
        }

        if (sub === "reject") {
            vcData.rejected.add(
                target.id
            );

            await target.voice.disconnect(
                "VC rejected"
            ).catch(() => {});

            return message.reply(
                `🚫 ${target.user.tag} was rejected.`
            );
        }

        if (sub === "permit") {
            vcData.permitted.add(
                target.id
            );

            vcData.rejected.delete(
                target.id
            );

            vcData.banned.delete(
                target.id
            );

            await voiceChannel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: true,
                    ViewChannel: true,
                    Speak: true
                }
            );

            return message.reply(
                `✅ ${target.user.tag} was permitted.`
            );
        }

        if (sub === "stfu") {
            vcData.stfu.add(
                target.id
            );

            await target.voice.setMute(
                true,
                "VC STFU"
            ).catch(() => {});

            return message.reply(
                `🔇 ${target.user.tag} was STFU.`
            );
        }

        if (sub === "unstfu") {
            vcData.stfu.delete(
                target.id
            );

            await target.voice.setMute(
                false,
                "VC UnSTFU"
            ).catch(() => {});

            return message.reply(
                `🔊 ${target.user.tag} was un-STFU.`
            );
        }

        if (sub === "transfer") {
            if (
                !target.voice.channel ||
                target.voice.channel.id !==
                    voiceChannel.id
            ) {
                return message.reply(
                    "❌ Target must be inside your VC."
                );
            }

            vcData.ownerId =
                target.id;

            await updateVCInterface(
                voiceChannel
            );

            return message.reply(
                `👑 Ownership transferred to ${target.user.tag}.`
            );
        }
    }

    // LOCK
    if (sub === "lock") {
        if (
            !canControlVC(
                message.member,
                vcData
            )
        ) {
            return message.reply(
                "❌ No permission."
            );
        }

        vcData.locked = true;

        await voiceChannel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: false
            }
        );

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            "🔒 VC locked."
        );
    }

    // UNLOCK
    if (sub === "unlock") {
        if (
            !canControlVC(
                message.member,
                vcData
            )
        ) {
            return message.reply(
                "❌ No permission."
            );
        }

        vcData.locked = false;

        await voiceChannel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: true
            }
        );

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            "🔓 VC unlocked."
        );
    }

    // LIMIT
    if (sub === "limit") {
        if (
            !canControlVC(
                message.member,
                vcData
            )
        ) {
            return message.reply(
                "❌ No permission."
            );
        }

        const limit =
            Number(args[1]);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return message.reply(
                "❌ Limit must be 0-99."
            );
        }

        await voiceChannel.setUserLimit(
            limit
        );

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            `✅ VC limit set to **${
                limit === 0
                    ? "Unlimited"
                    : limit
            }**.`
        );
    }

    // RENAME
    if (sub === "rename") {
        if (
            !canControlVC(
                message.member,
                vcData
            )
        ) {
            return message.reply(
                "❌ No permission."
            );
        }

        const name =
            args.slice(1).join(" ");

        if (!name) {
            return message.reply(
                `❌ Usage: \`${PREFIX}vc rename <name>\``
            );
        }

        await voiceChannel.setName(
            name.slice(0, 100)
        );

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            `✅ VC renamed to **${name.slice(0, 100)}**.`
        );
    }

    // CLAIM
    if (sub === "claim") {
        if (
            voiceChannel.members.has(
                vcData.ownerId
            )
        ) {
            return message.reply(
                "❌ The current owner is still inside."
            );
        }

        vcData.ownerId =
            message.author.id;

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            "👑 You claimed the VC."
        );
    }

    // FORCE CLAIM
    if (sub === "forceclaim") {
        if (!isGod(message.member)) {
            return message.reply(
                "❌ Only God or Founder can force-claim."
            );
        }

        vcData.ownerId =
            message.author.id;

        await updateVCInterface(
            voiceChannel
        );

        return message.reply(
            "👑 VC force-claimed."
        );
    }

    return message.reply(
        `❌ Unknown VC command. Use \`${PREFIX}commands\`.`
    );
}

// ============================================================
// MODERATION COMMANDS
// ============================================================

async function handleModerationCommand(
    message,
    command,
    args
) {
    if (!message.guild) return;

    const target =
        message.mentions.members.first();

    // BAN
    if (command === "ban") {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.BanMembers
            ) &&
            !isTrustedExecutor(
                message.member
            )
        ) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}ban @user [reason]\``
            );
        }

        if (
            !canModerate(
                message.member,
                target
            )
        ) {
            return message.reply(
                "❌ You cannot ban that member."
            );
        }

        const reason =
            args.slice(1).join(" ") ||
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

        return message.reply(
            `🔨 **${target.user.tag}** was banned.`
        );
    }

    // KICK
    if (command === "kick") {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.KickMembers
            ) &&
            !isTrustedExecutor(
                message.member
            )
        ) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}kick @user [reason]\``
            );
        }

        if (
            !canModerate(
                message.member,
                target
            )
        ) {
            return message.reply(
                "❌ You cannot kick that member."
            );
        }

        const reason =
            args.slice(1).join(" ") ||
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

        return message.reply(
            `👢 **${target.user.tag}** was kicked.`
        );
    }

    // TIMEOUT
    if (command === "timeout") {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ModerateMembers
            ) &&
            !isTrustedExecutor(
                message.member
            )
        ) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}timeout @user <minutes> [reason]\``
            );
        }

        if (
            !canModerate(
                message.member,
                target
            )
        ) {
            return message.reply(
                "❌ You cannot timeout that member."
            );
        }

        const minutes =
            Number(args[1]);

        if (
            !Number.isFinite(minutes) ||
            minutes <= 0 ||
            minutes > 40320
        ) {
            return message.reply(
                "❌ Timeout must be between 1 and 40320 minutes."
            );
        }

        const reason =
            args.slice(2).join(" ") ||
            "No reason provided.";

        await sendModerationDM(
            target.user,
            message.guild,
            "Timed Out",
            reason,
            `${minutes} minute(s)`
        );

        await target.timeout(
            minutes * 60 * 1000,
            reason
        );

        return message.reply(
            `⏱️ **${target.user.tag}** was timed out for **${minutes} minute(s)**.`
        );
    }

    // UNTIMEOUT
    if (command === "untimeout") {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ModerateMembers
            ) &&
            !isTrustedExecutor(
                message.member
            )
        ) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}untimeout @user\``
            );
        }

        await target.timeout(
            null,
            "Timeout removed"
        );

        return message.reply(
            `✅ Timeout removed from **${target.user.tag}**.`
        );
    }

    // UNBAN
    if (command === "unban") {
        if (!isTrustedExecutor(message.member)) {
            return message.reply(
                "❌ Only Founder or God can unban."
            );
        }

        const id =
            args[0]?.replace(
                /[^0-9]/g,
                ""
            );

        if (!id) {
            return message.reply(
                `❌ Usage: \`${PREFIX}unban <userId>\``
            );
        }

        const bans =
            await message.guild.bans.fetch();

        const ban =
            bans.get(id);

        if (!ban) {
            return message.reply(
                "❌ That user isn't banned."
            );
        }

        await message.guild.members.unban(
            id,
            "Unbanned by VC+"
        );

        await sendModerationDM(
            ban.user,
            message.guild,
            "Unbanned",
            "Your server ban was removed."
        );

        return message.reply(
            `✅ **${ban.user.tag}** was unbanned.`
        );
    }

    // BANLIST
    if (command === "banlist") {
        if (!message.member.permissions.has(
            PermissionFlagsBits.BanMembers
        ) && !isTrustedExecutor(message.member)) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        const bans =
            await message.guild.bans.fetch();

        if (!bans.size) {
            return message.reply(
                "📋 The server has no bans."
            );
        }

        const lines =
            [...bans.values()]
                .slice(0, 25)
                .map(
                    (ban, index) =>
                        `**${index + 1}.** ${ban.user.tag} — \`${ban.user.id}\``
                );

        return message.reply({
            embeds: [
                infoEmbed(
                    "Ban List",
                    lines.join("\n")
                )
            ]
        });
    }

    // UNBAN ALL
    if (command === "unbanall") {
        if (!isFounder(message.member)) {
            return message.reply(
                "❌ Only the Founder or Server Owner can use this."
            );
        }

        if (
            args[0]?.toLowerCase() !==
            "confirm"
        ) {
            return message.reply(
                `⚠️ This will unban **everyone**. Use \`${PREFIX}unbanall confirm\` to continue.`
            );
        }

        const bans =
            await message.guild.bans.fetch();

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

        return message.reply({
            embeds: [
                successEmbed(
                    "Mass Unban Complete",
                    `Unbanned: **${success}**\nFailed: **${failed}**`
                )
            ]
        });
    }

    // PURGE
    if (command === "purge") {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ManageMessages
            ) &&
            !isTrustedExecutor(
                message.member
            )
        ) {
            return message.reply(
                "❌ You don't have permission."
            );
        }

        const amount =
            Number(args[0]);

        if (
            !Number.isInteger(amount) ||
            amount < 1 ||
            amount > 100
        ) {
            return message.reply(
                `❌ Usage: \`${PREFIX}purge <1-100>\``
            );
        }

        if (
            !message.channel.isTextBased()
        ) {
            return;
        }

        await message.channel.bulkDelete(
            amount,
            true
        );

        const msg =
            await message.channel.send(
                `🧹 Deleted **${amount}** message(s).`
            );

        setTimeout(
            () =>
                msg.delete().catch(() => {}),
            3000
        );
    }
}

// ============================================================
// RANK COMMANDS
// ============================================================

async function handleRankCommand(
    message,
    command,
    args
) {
    if (!message.guild) return;

    if (command === "rank") {
        if (!isFounder(message.member)) {
            return message.reply(
                "❌ Only the Founder or Server Owner can change ranks."
            );
        }

        const target =
            message.mentions.members.first();

        const requested =
            args[1];

        if (!target || !requested) {
            return message.reply(
                `❌ Usage: \`${PREFIX}rank @user <rank>\``
            );
        }

        const rank =
            normalizeRank(
                requested
            );

        if (!(rank in RANKS)) {
            return message.reply(
                `❌ Invalid rank.\nAvailable: ${Object.keys(RANKS).join(", ")}`
            );
        }

        if (
            target.id ===
            message.guild.ownerId
        ) {
            return message.reply(
                "❌ The server owner cannot have their rank changed."
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        data.ranks[target.id] =
            rank;

        saveDB();

        return message.reply(
            `✅ **${target.user.tag}** is now **${rank}**.`
        );
    }

    if (command === "godmode") {
        if (!isFounder(message.member)) {
            return message.reply(
                "❌ Only Founder or Server Owner can use godmode."
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}godmode @user\``
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

            return message.reply(
                `🛡️ Godmode enabled for **${target.user.tag}**.`
            );
        }

        data.godmode.splice(
            index,
            1
        );

        saveDB();

        return message.reply(
            `🛡️ Godmode disabled for **${target.user.tag}**.`
        );
    }

    if (command === "foreverban") {
        if (!isFounder(message.member)) {
            return message.reply(
                "❌ Only Founder or Server Owner can use foreverban."
            );
        }

        const target =
            message.mentions.members.first();

        if (!target) {
            return message.reply(
                `❌ Usage: \`${PREFIX}foreverban @user\``
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

        saveDB();

        await sendModerationDM(
            target.user,
            message.guild,
            "Forever Ban",
            "You were permanently banned by the server security system."
        );

        await target.ban({
            reason:
                "VC+ Forever Ban"
        });

        return message.reply(
            `🔨 **${target.user.tag}** was added to the forever-ban list.`
        );
    }
}

// ============================================================
// AUTOMOD
// ============================================================

async function handleAutomodCommand(
    message,
    args
) {
    if (!isTrustedExecutor(message.member)) {
        return message.reply(
            "❌ Only God or Founder can manage AutoMod."
        );
    }

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (sub === "on") {
        data.filters.enabled =
            true;

        saveDB();

        return message.reply(
            "🛡️ AutoMod enabled."
        );
    }

    if (sub === "off") {
        data.filters.enabled =
            false;

        saveDB();

        return message.reply(
            "🛡️ AutoMod disabled."
        );
    }

    if (sub === "add") {
        const word =
            args.slice(1)
                .join(" ")
                .toLowerCase()
                .trim();

        if (!word) {
            return message.reply(
                `❌ Usage: \`${PREFIX}automod add <word>\``
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

        return message.reply(
            `✅ Added \`${word}\` to AutoMod.`
        );
    }

    if (sub === "remove") {
        const word =
            args.slice(1)
                .join(" ")
                .toLowerCase()
                .trim();

        const index =
            data.filters.words.indexOf(
                word
            );

        if (index === -1) {
            return message.reply(
                "❌ Word isn't in the filter."
            );
        }

        data.filters.words.splice(
            index,
            1
        );

        saveDB();

        return message.reply(
            `✅ Removed \`${word}\`.`
        );
    }

    if (sub === "list") {
        return message.reply({
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
        });
    }

    return message.reply(
        `❌ Usage: \`${PREFIX}automod on/off/add/remove/list\``
    );
}

async function handleFilteredMessage(
    message
) {
    if (
        !message.guild ||
        message.author.bot
    ) {
        return false;
    }

    const data =
        getGuildData(
            message.guild.id
        );

    if (
        !data.filters.enabled ||
        !data.filters.words.length
    ) {
        return false;
    }

    const content =
        message.content.toLowerCase();

    const found =
        data.filters.words.find(
            word =>
                content.includes(word)
        );

    if (!found) {
        return false;
    }

    if (
        isTrustedExecutor(
            message.member
        )
    ) {
        return false;
    }

    await message.delete()
        .catch(() => {});

    const userId =
        message.author.id;

    data.filters.strikes[userId] =
        Number(
            data.filters.strikes[userId] ||
            0
        ) + 1;

    const strikes =
        data.filters.strikes[userId];

    saveDB();

    const warning =
        await message.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xed4245)
                    .setTitle(
                        `${BOT_NAME} • AutoMod`
                    )
                    .setDescription(
                        `<@${userId}>, that message was removed. Strike **${strikes}/${data.filters.maxStrikes}**.`
                    )
            ]
        }).catch(() => null);

    if (warning) {
        setTimeout(
            () =>
                warning.delete()
                    .catch(() => {}),
            data.filters.warningDeleteMs
        );
    }

    if (
        strikes >=
        data.filters.maxStrikes
    ) {
        const member =
            message.member;

        if (member) {
            await sendModerationDM(
                member.user,
                message.guild,
                "AutoMod Timeout",
                "You reached the maximum number of AutoMod strikes.",
                `${data.filters.timeoutMinutes} minutes`
            );

            await member.timeout(
                data.filters.timeoutMinutes *
                    60 *
                    1000,
                "AutoMod maximum strikes"
            ).catch(() => {});

            data.filters.strikes[userId] =
                0;

            saveDB();
        }
    }

    return true;
}

// ============================================================
// MESSAGE COMMAND HANDLER
// ============================================================

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

            const filtered =
                await handleFilteredMessage(
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
                args.shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            // HELP
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

            // VC
            if (command === "vc") {
                return handleVCCommand(
                    message,
                    args
                );
            }

            // VOUCH
            if (command === "vouch") {
                return handleVouchCommand(
                    message,
                    args
                );
            }

            // VOUCH ROLE
            if (
                command ===
                "vouchrole"
            ) {
                return handleVouchRoleCommand(
                    message,
                    args
                );
            }

            // MODERATION
            if (
                [
                    "ban",
                    "kick",
                    "timeout",
                    "untimeout",
                    "unban",
                    "banlist",
                    "unbanall",
                    "purge"
                ].includes(command)
            ) {
                return handleModerationCommand(
                    message,
                    command,
                    args
                );
            }

            // RANKS
            if (
                [
                    "rank",
                    "godmode",
                    "foreverban"
                ].includes(command)
            ) {
                return handleRankCommand(
                    message,
                    command,
                    args
                );
            }

            // AUTOMOD
            if (
                command ===
                "automod"
            ) {
                return handleAutomodCommand(
                    message,
                    args
                );
            }

            // SHOW OWN RANK
            if (command === "myrank") {
                return message.reply(
                    `🛡️ Your rank is **${getRank(message.member)}**.`
                );
            }

        } catch (error) {
            console.error(
                "messageCreate error:",
                error
            );

            try {
                await message.reply(
                    "❌ Something went wrong while processing that command."
                );
            } catch {}
        }
    }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                interaction.isButton()
            ) {
                return handleVCButton(
                    interaction
                );
            }

            if (
                interaction.isUserSelectMenu()
            ) {
                if (
                    interaction.customId.startsWith(
                        "vc_target_"
                    )
                ) {
                    return handleVCTarget(
                        interaction
                    );
                }
            }

            if (
                interaction.isModalSubmit()
            ) {
                if (
                    interaction.customId ===
                        "vc_rename_modal" ||
                    interaction.customId ===
                        "vc_limit_modal"
                ) {
                    return handleVCModal(
                        interaction
                    );
                }
            }

        } catch (error) {
            console.error(
                "interactionCreate error:",
                error
            );

            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        "❌ Something went wrong.",
                    ephemeral: true
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content:
                        "❌ Something went wrong.",
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
            const member =
                newState.member ||
                oldState.member;

            if (!member?.guild) {
                return;
            }

            // JTC
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                data.jtc.enabled &&
                newState.channelId ===
                    data.jtc.channelId
            ) {
                const existing =
                    [...tempVCs.entries()]
                        .find(
                            ([, vc]) =>
                                vc.guildId ===
                                member.guild.id &&
                                vc.ownerId ===
                                member.id
                        );

                if (!existing) {
                    const jtc =
                        member.guild.channels.cache.get(
                            data.jtc.channelId
                        );

                    if (jtc) {
                        await createPersonalVC(
                            member,
                            jtc
                        );
                    }
                }
            }

            // VC restrictions
            if (
                newState.channelId
            ) {
                const vcData =
                    getTempVC(
                        newState.channelId
                    );

                if (vcData) {
                    if (
                        vcData.banned.has(
                            member.id
                        ) ||
                        vcData.rejected.has(
                            member.id
                        )
                    ) {
                        await member.voice.disconnect(
                            "VC access denied"
                        ).catch(() => {});
                    }

                    if (
                        vcData.stfu.has(
                            member.id
                        )
                    ) {
                        await member.voice.setMute(
                            true,
                            "VC STFU"
                        ).catch(() => {});
                    }

                    await updateVCInterface(
                        newState.channel
                    );
                }
            }

            // Update old temp VC
            if (
                oldState.channelId
            ) {
                const oldChannel =
                    oldState.guild.channels.cache.get(
                        oldState.channelId
                    );

                if (oldChannel) {
                    const vcData =
                        getTempVC(
                            oldChannel.id
                        );

                    if (vcData) {
                        await updateVCInterface(
                            oldChannel
                        );

                        await deleteEmptyVC(
                            oldChannel
                        );
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

// ============================================================
// MEMBER JOIN / FOREVER BAN
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
                    reason:
                        "VC+ Forever Ban"
                }).catch(() => {});
            }

        } catch (error) {
            console.error(
                "guildMemberAdd error:",
                error
            );
        }
    }
);

// ============================================================
// SECURITY EVENTS
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

            if (
                channel.type ===
                ChannelType.GuildVoice
            ) {
                // Ignore normal VC+ generated channels
                if (
                    tempVCs.has(
                        channel.id
                    ) ||
                    channel.id ===
                        data.jtc.channelId
                ) {
                    return;
                }
            }

            await inspectAudit(
                channel.guild,
                AuditLogEvent.ChannelCreate,
                "Channel creation protection triggered.",
                5
            );

        } catch (error) {
            console.error(
                "channelCreate security error:",
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

            await inspectAudit(
                channel.guild,
                AuditLogEvent.ChannelDelete,
                "Channel deletion protection triggered.",
                3
            );

        } catch (error) {
            console.error(
                "channelDelete security error:",
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

            await inspectAudit(
                role.guild,
                AuditLogEvent.RoleCreate,
                "Role creation protection triggered.",
                5
            );

        } catch (error) {
            console.error(
                "roleCreate security error:",
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

            await inspectAudit(
                role.guild,
                AuditLogEvent.RoleDelete,
                "Role deletion protection triggered.",
                3
            );

        } catch (error) {
            console.error(
                "roleDelete security error:",
                error
            );
        }
    }
);

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

            await inspectAudit(
                channel.guild,
                AuditLogEvent.WebhookCreate,
                "Webhook creation protection triggered.",
                3
            );

        } catch (error) {
            console.error(
                "webhooksUpdate security error:",
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
            `✅ ${BOT_NAME} is online as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: `${PREFIX}commands`,
                    type:
                        ActivityType.Watching
                }
            ],
            status: "online"
        });

        // Load JTC/temp VC information that still exists
        for (
            const guild of client.guilds.cache.values()
        ) {
            const data =
                getGuildData(
                    guild.id
                );

            if (
                data.jtc.enabled &&
                data.jtc.channelId
            ) {
                const jtc =
                    guild.channels.cache.get(
                        data.jtc.channelId
                    );

                if (!jtc) {
                    data.jtc.enabled =
                        false;

                    data.jtc.channelId =
                        null;

                    data.jtc.categoryId =
                        null;

                    saveDB();
                }
            }
        }
    }
);

// ============================================================
// ERROR PROTECTION
// ============================================================

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

process.on(
    "uncaughtExceptionMonitor",
    error => {
        console.error(
            "[UNCAUGHT EXCEPTION MONITOR]",
            error
        );
    }
);

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
            "[CLIENT WARNING]",
            warning
        );
    }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
