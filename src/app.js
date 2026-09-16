import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    AuditLogEvent
} from "discord.js";

/* =========================================================
   VC+
   Single-file Discord bot
   Prefix: -
========================================================= */

const PREFIX = "-";
const BOT_NAME = "VC+";
const VERSION = "1.0.0";

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error("[VC+ CONFIG ERROR] DISCORD_TOKEN is missing.");
    process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

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
        Partials.GuildMember
    ]
});

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "vcplus.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify({ guilds: {} }, null, 2)
    );
}

let db;

function loadDatabase() {
    try {
        db = JSON.parse(
            fs.readFileSync(DB_FILE, "utf8")
        );

        if (!db.guilds) {
            db.guilds = {};
        }

        console.log("[VC+] Database loaded.");
    } catch (error) {
        console.error("[VC+ DATABASE ERROR]", error);

        db = {
            guilds: {}
        };
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error("[VC+ DATABASE ERROR]", error);
    }
}

function defaultGuild() {
    return {
        prefix: PREFIX,

        modules: {},

        permissions: {},

        warnings: {},

        vouches: {},

        snipe: {
            messages: [],
            cleared: []
        },

        antinuke: {
            enabled: false,
            actionWindow: 10000,
            maxActions: 3,
            punishment: "remove_roles",
            whitelist: [],
            lockdown: false
        },

        antiraid: {
            enabled: false,
            threshold: 10,
            window: 10000,
            accountAge: 86400000,
            lockdown: false
        },

        filter: {
            enabled: false,
            words: []
        },

        autoresponders: {},

        boosterRoles: {
            enabled: false,
            roles: []
        },

        boosterMessages: {
            enabled: false,
            message: "Thank you {user} for boosting {server}!"
        },

        counters: {},

        levels: {
            enabled: false,
            users: {}
        },

        lockIgnore: [],

        reactionRoles: {},

        starboard: {
            enabled: false,
            channelId: null,
            threshold: 3
        },

        clownboard: {
            enabled: false,
            channelId: null,
            threshold: 3
        },

        vanity: {},

        welcome: {
            enabled: false,
            channelId: null,
            message: "Welcome {user} to {server}!"
        },

        goodbye: {
            enabled: false,
            channelId: null,
            message: "Goodbye {username}!"
        },

        webhooks: {},

        logging: {
            enabled: false,
            channelId: null,
            events: []
        },

        voiceMaster: {
            enabled: false,
            categoryId: null,
            triggerId: null,
            channels: {}
        }
    };
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = defaultGuild();
        saveDatabase();
    }

    return db.guilds[guildId];
}

loadDatabase();

/* =========================================================
   UTILITIES
========================================================= */

function mention(user) {
    return `<@${user.id}>`;
}

function warning(user, text) {
    return `:warning~1: ${mention(user)} — ${text}`;
}

function success(user, text) {
    return `:white_check_mark: ${mention(user)} — ${text}`;
}

function errorText(text) {
    return `:warning~1: ${text}`;
}

function isAdmin(member) {
    return member.permissions.has(
        PermissionsBitField.Flags.Administrator
    );
}

function hasBotPermission(guild, permission) {
    const me = guild.members.me;

    if (!me) return false;

    return me.permissions.has(permission);
}

function canManageTarget(message, target) {
    const member = message.member;
    const me = message.guild.members.me;

    if (!target) return false;

    if (target.id === message.author.id) {
        return false;
    }

    if (target.id === client.user.id) {
        return false;
    }

    if (
        member.roles.highest.position <=
        target.roles.highest.position &&
        message.guild.ownerId !== message.author.id
    ) {
        return false;
    }

    if (
        me &&
        me.roles.highest.position <=
        target.roles.highest.position
    ) {
        return false;
    }

    return true;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {
        return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return `${hours}h`;
    }

    return `${Math.floor(hours / 24)}d`;
}

function parseDuration(input) {
    if (!input) return null;

    const match = input.match(
        /^(\d+)(s|m|h|d|w)$/i
    );

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000
    };

    return amount * multipliers[unit];
}

function replaceVariables(text, member, guild) {
    return text
        .replaceAll("{user}", `<@${member.id}>`)
        .replaceAll("{username}", member.user.username)
        .replaceAll("{server}", guild.name);
}

function getMentionedMember(message) {
    return (
        message.mentions.members.first() ||
        null
    );
}

function commandArgs(content) {
    return content.trim().split(/\s+/);
}

function commandName(content) {
    return commandArgs(content)[0]
        .slice(PREFIX.length)
        .toLowerCase();
}

function commandArguments(content) {
    const args = commandArgs(content);
    args.shift();
    return args;
}

function isLockIgnored(guildId, channelId) {
    const data = getGuildData(guildId);

    return data.lockIgnore.includes(channelId);
}

/* =========================================================
   COOLDOWNS
========================================================= */

const cooldowns = new Map();

function checkCooldown(userId, command, seconds = 2) {
    const key = `${userId}:${command}`;

    const now = Date.now();
    const previous = cooldowns.get(key);

    if (
        previous &&
        now - previous < seconds * 1000
    ) {
        return false;
    }

    cooldowns.set(key, now);

    return true;
}

/* =========================================================
   LOGGING
========================================================= */

async function logEvent(
    guild,
    event,
    description,
    color = 0x5865f2
) {
    try {
        const data = getGuildData(guild.id);

        if (!data.logging.enabled) return;
        if (!data.logging.channelId) return;

        if (
            data.logging.events.length &&
            !data.logging.events.includes(event)
        ) {
            return;
        }

        const channel = guild.channels.cache.get(
            data.logging.channelId
        );

        if (!channel?.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(`VC+ • ${event}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error(
            "[VC+ LOGGING ERROR]",
            error
        );
    }
}

/* =========================================================
   COMMAND HELPERS
========================================================= */

async function requireAdmin(message) {
    if (!isAdmin(message.member)) {
        await message.reply(
            warning(
                message.author,
                "Administrator permission is required."
            )
        );

        return false;
    }

    return true;
}

async function requireVCOwner(message) {
    const data = getGuildData(message.guild.id);
    const channel = message.member.voice.channel;

    if (!channel) {
        await message.reply(
            warning(
                message.author,
                "You must be in a voice channel."
            )
        );

        return false;
    }

    const info =
        data.voiceMaster.channels[channel.id];

    if (!info) {
        await message.reply(
            warning(
                message.author,
                "You don't have permission to control this VC."
            )
        );

        return false;
    }

    if (
        info.ownerId !== message.author.id
    ) {
        await message.reply(
            warning(
                message.author,
                "You don't have permission to control this VC."
            )
        );

        return false;
    }

    return true;
}

/* =========================================================
   HELP PANEL
========================================================= */

const helpPages = [
    {
        title: "VC+ • Moderation",
        description: [
            "`-ban @user [reason]`",
            "`-unban @user`",
            "`-kick @user [reason]`",
            "`-timeout @user [duration] [reason]`",
            "`-untimeout @user`",
            "`-warn @user [reason]`",
            "`-warnings @user`",
            "`-purge <amount>`",
            "`-clear <amount>`",
            "`-cs`",
            "`-s`",
            "`-lock`",
            "`-unlock`"
        ].join("\n")
    },
    {
        title: "VC+ • Music",
        description: [
            "`-play <song>`",
            "`-pause`",
            "`-resume`",
            "`-skip`",
            "`-stop`",
            "`-queue`",
            "`-nowplaying`",
            "`-volume <1-100>`",
            "`-shuffle`"
        ].join("\n")
    },
    {
        title: "VC+ • Vouches",
        description: [
            "`-vouch @user`",
            "`-vouch list`",
            "`-vouch list @user`",
            "`-vouch clear @user`",
            "`-vouch clear everyone`",
            "`-vouch limit <amount>`",
            "`-vouch role set @role`",
            "`-vouch role reset`",
            "`-vouch role limit <amount>`"
        ].join("\n")
    },
    {
        title: "VC+ • Voice",
        description: [
            "`-vc setup`",
            "`-vc lock`",
            "`-vc unlock`",
            "`-vc hide`",
            "`-vc unhide`",
            "`-vc ghost`",
            "`-vc limit <number>`",
            "`-vc name <name>`",
            "`-vc kick @user`",
            "`-vc ban @user`",
            "`-vc unban @user`",
            "`-vc permit @user`",
            "`-vc reject @user`",
            "`-vc transfer @user`",
            "`-vc claim`"
        ].join("\n")
    },
    {
        title: "VC+ • Security",
        description: [
            "`-antinuke setup`",
            "`-antinuke status`",
            "`-antinuke enable`",
            "`-antinuke disable`",
            "`-antinuke whitelist @user`",
            "`-antinuke unwhitelist @user`",
            "`-antinuke whitelist`",
            "`-antinuke config`",
            "`-antinuke limits`",
            "`-antinuke punishment`",
            "`-antinuke logs`",
            "`-antinuke lockdown`",
            "`-antinuke unlock`",
            "`-antinuke reset`",
            "`-antiraid setup`",
            "`-antiraid status`",
            "`-antiraid enable`",
            "`-antiraid disable`"
        ].join("\n")
    },
    {
        title: "VC+ • Server Setup",
        description: [
            "`-setup`",
            "`-settings`",
            "`-permissions`",
            "`-module`",
            "`-filter setup`",
            "`-autoresponder add`",
            "`-boosterrole setup`",
            "`-boostermessage setup`",
            "`-counter setup`",
            "`-embed create`",
            "`-levels setup`",
            "`-lockignore add`",
            "`-reactionrole setup`",
            "`-starboard setup`",
            "`-clownboard setup`",
            "`-vanity setup`",
            "`-welcome setup`",
            "`-goodbye setup`",
            "`-logs setup`"
        ].join("\n")
    }
];

function helpEmbed(page) {
    const data = helpPages[page];

    return new EmbedBuilder()
        .setTitle(data.title)
        .setDescription(data.description)
        .setFooter({
            text: `${BOT_NAME} • ${page + 1}/${helpPages.length}`
        })
        .setColor(0x5865f2);
}

function helpButtons(page) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("help_previous")
            .setLabel("‹ Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

        new ButtonBuilder()
            .setCustomId("help_page")
            .setLabel(
                `${page + 1} / ${helpPages.length}`
            )
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId("help_next")
            .setLabel("Next ›")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(
                page === helpPages.length - 1
            )
    );
}

/* =========================================================
   VC PANEL
========================================================= */

function vcPanel() {
    const embed = new EmbedBuilder()
        .setTitle("VC+ • Voice Control")
        .setDescription(
            [
                "`-vc lock` — Lock your VC",
                "`-vc unlock` — Unlock your VC",
                "`-vc hide` — Hide your VC",
                "`-vc unhide` — Show your VC",
                "`-vc ghost` — Ghost your VC",
                "`-vc limit <number>` — Set limit",
                "`-vc name <name>` — Rename VC",
                "`-vc kick @user` — Kick user",
                "`-vc ban @user` — Ban user",
                "`-vc unban @user` — Unban user",
                "`-vc permit @user` — Permit user",
                "`-vc reject @user` — Reject user",
                "`-vc transfer @user` — Transfer ownership",
                "`-vc claim` — Claim VC"
            ].join("\n")
        )
        .setColor(0x5865f2);

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("vc_lock")
                .setLabel("▫ Lock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unlock")
                .setLabel("▫ Unlock")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_hide")
                .setLabel("▫ Hide")
                .setStyle(ButtonStyle.Secondary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("vc_permit")
                .setLabel("▫ Permit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_reject")
                .setLabel("▫ Reject")
                .setStyle(ButtonStyle.Secondary)
        );

    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("vc_kick")
                .setLabel("▫ Kick")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_ban")
                .setLabel("▫ Ban")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_unban")
                .setLabel("▫ Unban")
                .setStyle(ButtonStyle.Secondary)
        );

    const row4 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("vc_limit")
                .setLabel("▫ Limit")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_claim")
                .setLabel("▫ Claim")
                .setStyle(ButtonStyle.Secondary),

            new ButtonBuilder()
                .setCustomId("vc_ghost")
                .setLabel("▫ Ghost")
                .setStyle(ButtonStyle.Secondary)
        );

    return {
        embeds: [embed],
        components: [
            row1,
            row2,
            row3,
            row4
        ]
    };
}

/* =========================================================
   VC PANEL SENDER
========================================================= */

async function sendVCPanel(channel) {
    if (!channel?.isTextBased()) return;

    try {
        const messages =
            await channel.messages.fetch({
                limit: 50
            });

        const existing = messages.find(
            message =>
                message.author.id === client.user.id &&
                message.embeds?.[0]?.title ===
                    "VC+ • Voice Control"
        );

        if (existing) return;

        await channel.send(vcPanel());
    } catch (error) {
        console.error(
            "[VC+ VC PANEL ERROR]",
            error
        );
    }
}

/* =========================================================
   CREATE TEMP VC
========================================================= */

async function createTempVC(member) {
    const data = getGuildData(
        member.guild.id
    );

    if (!data.voiceMaster.enabled) return;

    const guild = member.guild;

    const category =
        guild.channels.cache.get(
            data.voiceMaster.categoryId
        );

    if (!category) return;

    try {
        const channel =
            await guild.channels.create({
                name: `${member.user.username}'s VC`,
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [
                            PermissionsBitField.Flags.Connect,
                            PermissionsBitField.Flags.Speak,
                            PermissionsBitField.Flags.ManageChannels
                        ]
                    }
                ]
            });

        data.voiceMaster.channels[
            channel.id
        ] = {
            ownerId: member.id,
            channelId: channel.id,
            createdAt: Date.now(),
            banned: [],
            permitted: []
        };

        saveDatabase();

        await member.voice.setChannel(
            channel
        );

        if (
            channel
                .permissionsFor(guild.members.me)
                ?.has(
                    PermissionsBitField.Flags.SendMessages
                )
        ) {
            await sendVCPanel(channel);
        }

        await logEvent(
            guild,
            "VC_CREATE",
            `${member} created ${channel}.`
        );
    } catch (error) {
        console.error(
            "[VC+ VC CREATE ERROR]",
            error
        );
    }
}

/* =========================================================
   MESSAGE DELETE / SNIPE
========================================================= */

client.on(
    "messageDelete",
    async message => {
        if (!message.guild) return;
        if (message.author?.bot) return;

        const data = getGuildData(
            message.guild.id
        );

        data.snipe.messages.unshift({
            id: message.id,
            authorId:
                message.author?.id || null,
            authorTag:
                message.author?.tag || "Unknown User",
            content:
                message.content || "[No text content]",
            channelId: message.channel.id,
            timestamp: Date.now()
        });

        data.snipe.messages =
            data.snipe.messages.slice(0, 20);

        saveDatabase();
    }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
    "guildMemberAdd",
    async member => {
        const data = getGuildData(
            member.guild.id
        );

        if (
            data.welcome.enabled &&
            data.welcome.channelId
        ) {
            const channel =
                member.guild.channels.cache.get(
                    data.welcome.channelId
                );

            if (channel?.isTextBased()) {
                await channel.send(
                    replaceVariables(
                        data.welcome.message,
                        member,
                        member.guild
                    )
                );
            }
        }

        if (data.antiraid.enabled) {
            const now = Date.now();

            if (!member.guild._vcplusJoins) {
                member.guild._vcplusJoins = [];
            }

            member.guild._vcplusJoins.push(
                now
            );

            member.guild._vcplusJoins =
                member.guild._vcplusJoins.filter(
                    time =>
                        now -
                            time <=
                        data.antiraid.window
                );

            if (
                member.guild._vcplusJoins
                    .length >=
                data.antiraid.threshold
            ) {
                data.antiraid.lockdown = true;

                await logEvent(
                    member.guild,
                    "ANTIRAID",
                    `Raid threshold reached. ${member.guild._vcplusJoins.length} joins detected.`,
                    0xff0000
                );

                saveDatabase();
            }
        }
    }
);

/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on(
    "guildMemberRemove",
    async member => {
        const data = getGuildData(
            member.guild.id
        );

        if (
            data.goodbye.enabled &&
            data.goodbye.channelId
        ) {
            const channel =
                member.guild.channels.cache.get(
                    data.goodbye.channelId
                );

            if (channel?.isTextBased()) {
                await channel.send(
                    replaceVariables(
                        data.goodbye.message,
                        member,
                        member.guild
                    )
                );
            }
        }
    }
);

/* =========================================================
   VOICE STATE
========================================================= */

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        const guild =
            newState.guild ||
            oldState.guild;

        const data = getGuildData(
            guild.id
        );

        if (!data.voiceMaster.enabled)
            return;

        if (
            newState.channelId ===
            data.voiceMaster.triggerId
        ) {
            await createTempVC(
                newState.member
            );
        }

        if (oldState.channelId) {
            const info =
                data.voiceMaster.channels[
                    oldState.channelId
                ];

            if (info) {
                const channel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    channel &&
                    channel.members.size === 0
                ) {
                    try {
                        await channel.delete(
                            "VC+ temporary voice cleanup"
                        );
                    } catch {}

                    delete data.voiceMaster
                        .channels[
                            oldState.channelId
                        ];

                    saveDatabase();
                }
            }
        }
    }
);

/* =========================================================
   ANTINUKE
========================================================= */

const antiNukeActions = new Map();

function isWhitelisted(guildId, userId) {
    const data = getGuildData(guildId);

    return (
        userId === guildId ||
        data.antinuke.whitelist.includes(
            userId
        )
    );
}

async function punishAntinuke(
    guild,
    executor
) {
    const data = getGuildData(
        guild.id
    );

    if (!executor) return;

    if (
        isWhitelisted(
            guild.id,
            executor.id
        )
    ) {
        return;
    }

    const member =
        await guild.members
            .fetch(executor.id)
            .catch(() => null);

    if (!member) return;

    if (
        data.antinuke.punishment ===
        "remove_roles"
    ) {
        const removable =
            member.roles.cache.filter(
                role =>
                    role.editable &&
                    role.id !== guild.id
            );

        try {
            await member.roles.remove(
                removable,
                "VC+ Antinuke"
            );
        } catch {}
    }

    await logEvent(
        guild,
        "ANTINUKE",
        `Unauthorized dangerous action detected from ${member}.`,
        0xff0000
    );
}

async function recordAntinukeAction(
    guild,
    executorId
) {
    const data = getGuildData(
        guild.id
    );

    if (!data.antinuke.enabled)
        return;

    if (
        isWhitelisted(
            guild.id,
            executorId
        )
    ) {
        return;
    }

    const key =
        `${guild.id}:${executorId}`;

    const now = Date.now();

    const actions =
        antiNukeActions.get(key) || [];

    actions.push(now);

    const filtered =
        actions.filter(
            time =>
                now -
                    time <=
                data.antinuke.actionWindow
        );

    antiNukeActions.set(
        key,
        filtered
    );

    if (
        filtered.length >=
        data.antinuke.maxActions
    ) {
        const member =
            await guild.members
                .fetch(executorId)
                .catch(() => null);

        if (member) {
            await punishAntinuke(
                guild,
                member
            );
        }

        antiNukeActions.delete(key);
    }
}

client.on(
    "guildBanAdd",
    async ban => {
        const guild = ban.guild;

        if (
            !getGuildData(guild.id)
                .antinuke.enabled
        ) {
            return;
        }

        try {
            const logs =
                await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberBanAdd,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (
                entry &&
                Date.now() -
                    entry.createdTimestamp <
                    10000
            ) {
                await recordAntinukeAction(
                    guild,
                    entry.executor.id
                );
            }
        } catch (error) {
            console.error(
                "[VC+ SECURITY ERROR]",
                error
            );
        }
    }
);

client.on(
    "guildMemberRemove",
    async member => {
        const data = getGuildData(
            member.guild.id
        );

        if (!data.antinuke.enabled)
            return;

        try {
            const logs =
                await member.guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberKick,
                    limit: 1
                });

            const entry =
                logs.entries.first();

            if (
                entry &&
                Date.now() -
                    entry.createdTimestamp <
                    10000 &&
                entry.target?.id === member.id
            ) {
                await recordAntinukeAction(
                    member.guild,
                    entry.executor.id
                );
            }
        } catch {}
    }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
    "messageCreate",
    async message => {
        if (!message.guild) return;
        if (message.author.bot) return;

        const data = getGuildData(
            message.guild.id
        );

        /* FILTER */

        if (data.filter.enabled) {
            const normalized =
                message.content
                    .toLowerCase();

            const matched =
                data.filter.words.find(
                    word =>
                        normalized.includes(
                            word.toLowerCase()
                        )
                );

            if (matched) {
                try {
                    if (
                        message.deletable
                    ) {
                        await message.delete();
                    }

                    await message.channel
                        .send(
                            warning(
                                message.author,
                                "That message contained a filtered word."
                            )
                        )
                        .then(msg =>
                            setTimeout(
                                () =>
                                    msg.delete()
                                        .catch(
                                            () => {}
                                        ),
                                5000
                            )
                        );
                } catch {}

                return;
            }
        }

        /* AUTORESPONDERS */

        const autoKey =
            message.content
                .toLowerCase();

        const autoResponse =
            data.autoresponders[
                autoKey
            ];

        if (autoResponse) {
            await message.channel.send(
                autoResponse
            );
        }

        /* PREFIX */

        if (
            !message.content.startsWith(
                data.prefix || PREFIX
            )
        ) {
            return;
        }

        if (
            !checkCooldown(
                message.author.id,
                message.content
                    .split(/\s+/)[0]
                    .toLowerCase(),
                1
            )
        ) {
            return;
        }

        await handleCommand(message);
    }
);

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(message) {
    const content =
        message.content.trim();

    const args =
        commandArguments(content);

    const command =
        commandName(content);

    try {
        switch (command) {
            case "help":
                return handleHelp(
                    message
                );

            case "setup":
                return handleSetup(
                    message
                );

            case "settings":
                return handleSettings(
                    message
                );

            case "permissions":
                return handlePermissions(
                    message
                );

            case "about":
                return handleAbout(
                    message
                );

            case "invite":
                return handleInvite(
                    message
                );

            case "support":
                return handleSupport(
                    message
                );

            case "ban":
                return handleBan(
                    message,
                    args
                );

            case "unban":
                return handleUnban(
                    message,
                    args
                );

            case "kick":
                return handleKick(
                    message,
                    args
                );

            case "timeout":
                return handleTimeout(
                    message,
                    args
                );

            case "untimeout":
                return handleUntimeout(
                    message,
                    args
                );

            case "warn":
                return handleWarn(
                    message,
                    args
                );

            case "warnings":
                return handleWarnings(
                    message,
                    args
                );

            case "purge":
            case "clear":
                return handlePurge(
                    message,
                    args
                );

            case "cs":
                return handleCS(
                    message,
                    args
                );

            case "s":
                return handleSnipe(
                    message
                );

            case "lock":
                return handleLock(
                    message
                );

            case "unlock":
                return handleUnlock(
                    message
                );

            case "vouch":
                return handleVouch(
                    message,
                    args
                );

            case "vc":
                return handleVC(
                    message,
                    args
                );

            case "antinuke":
                return handleAntinuke(
                    message,
                    args
                );

            case "antiraid":
                return handleAntiraid(
                    message,
                    args
                );

            case "module":
                return handleModule(
                    message,
                    args
                );

            case "filter":
                return handleFilter(
                    message,
                    args
                );

            case "autoresponder":
                return handleAutoresponder(
                    message,
                    args
                );

            case "boosterrole":
                return handleBoosterRole(
                    message,
                    args
                );

            case "boostermessage":
                return handleBoosterMessage(
                    message,
                    args
                );

            case "levels":
                return handleLevels(
                    message,
                    args
                );

            case "lockignore":
                return handleLockIgnore(
                    message,
                    args
                );

            case "welcome":
                return handleWelcome(
                    message,
                    args
                );

            case "goodbye":
                return handleGoodbye(
                    message,
                    args
                );

            case "logs":
                return handleLogs(
                    message,
                    args
                );

            default:
                return;
        }
    } catch (error) {
        console.error(
            "[VC+ COMMAND ERROR]",
            error
        );

        await message.reply(
            errorText(
                "Something went wrong while running that command."
            )
        );
    }
}

/* =========================================================
   HELP
========================================================= */

async function handleHelp(message) {
    let page = 0;

    const response =
        await message.reply({
            embeds: [
                helpEmbed(page)
            ],
            components: [
                helpButtons(page)
            ]
        });

    const collector =
        response.createMessageComponentCollector({
            time: 120000
        });

    collector.on(
        "collect",
        async interaction => {
            if (
                interaction.user.id !==
                message.author.id
            ) {
                return interaction.reply({
                    content: warning(
                        interaction.user,
                        "You can't control this panel."
                    ),
                    ephemeral: true
                });
            }

            if (
                interaction.customId ===
                "help_previous"
            ) {
                page--;
            }

            if (
                interaction.customId ===
                "help_next"
            ) {
                page++;
            }

            page = Math.max(
                0,
                Math.min(
                    helpPages.length - 1,
                    page
                )
            );

            await interaction.update({
                embeds: [
                    helpEmbed(page)
                ],
                components: [
                    helpButtons(page)
                ]
            });
        }
    );

    collector.on(
        "end",
        async () => {
            try {
                await response.edit({
                    components: []
                });
            } catch {}
        }
    );
}

/* =========================================================
   SETUP
========================================================= */

async function handleSetup(message) {
    if (
        !(await requireAdmin(message))
    ) {
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle("VC+ • Setup")
        .setDescription(
            [
                "VC+ is installed in this server.",
                "",
                "Available setup modules:",
                "`VoiceMaster`",
                "`Antinuke`",
                "`Antiraid`",
                "`Logging`",
                "`Welcome`",
                "`Goodbye`",
                "`Filter`",
                "`Levels`",
                "",
                "Use the individual setup commands to configure each module."
            ].join("\n")
        )
        .setColor(0x5865f2);

    await message.reply({
        embeds: [embed]
    });
}

/* =========================================================
   SETTINGS
========================================================= */

async function handleSettings(message) {
    if (
        !(await requireAdmin(message))
    ) {
        return;
    }

    const data = getGuildData(
        message.guild.id
    );

    const embed = new EmbedBuilder()
        .setTitle("VC+ • Settings")
        .addFields(
            {
                name: "Prefix",
                value: `\`${data.prefix}\``,
                inline: true
            },
            {
                name: "VoiceMaster",
                value: data.voiceMaster.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            },
            {
                name: "Antinuke",
                value: data.antinuke.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            },
            {
                name: "Antiraid",
                value: data.antiraid.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            },
            {
                name: "Filter",
                value: data.filter.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            },
            {
                name: "Logging",
                value: data.logging.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            },
            {
                name: "Levels",
                value: data.levels.enabled
                    ? "Enabled"
                    : "Disabled",
                inline: true
            }
        )
        .setColor(0x5865f2);

    await message.reply({
        embeds: [embed]
    });
}

/* =========================================================
   PERMISSIONS
========================================================= */

async function handlePermissions(message) {
    if (
        !(await requireAdmin(message))
    ) {
        return;
    }

    const permissions = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageRoles,
        PermissionsBitField.Flags.KickMembers,
        PermissionsBitField.Flags.BanMembers,
        PermissionsBitField.Flags.ModerateMembers,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.MoveMembers
    ];

    const me =
        message.guild.members.me;

    const lines =
        permissions.map(permission => {
            const name =
                permission.toString();

            return me.permissions.has(
                permission
            )
                ? `:white_check_mark: \`${name}\``
                : `:warning~1: \`${name}\``;
        });

    await message.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    "VC+ • Permissions"
                )
                .setDescription(
                    lines.join("\n")
                )
                .setColor(0x5865f2)
        ]
    });
}

/* =========================================================
   ABOUT
========================================================= */

async function handleAbout(message) {
    await message.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle("VC+")
                .setDescription(
                    "A moderation, security, voice, and server management bot."
                )
                .addFields({
                    name: "Version",
                    value: VERSION,
                    inline: true
                })
                .setColor(0x5865f2)
        ]
    });
}

async function handleInvite(message) {
    const invite =
        process.env.BOT_INVITE;

    await message.reply(
        invite ||
            "VC+ invite link has not been configured."
    );
}

async function handleSupport(message) {
    const support =
        process.env.SUPPORT_SERVER;

    await message.reply(
        support ||
            "VC+ support server has not been configured."
    );
}

/* =========================================================
   MODERATION
========================================================= */

async function handleBan(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    if (
        !canManageTarget(
            message,
            target
        )
    ) {
        return message.reply(
            warning(
                message.author,
                "I can't manage this user due to role hierarchy."
            )
        );
    }

    const reason =
        args
            .filter(
                arg =>
                    !arg.startsWith("<@")
            )
            .join(" ") ||
        "No reason provided";

    try {
        await target.ban({
            reason
        });

        await logEvent(
            message.guild,
            "BAN",
            `${target} was banned by ${message.author}.\nReason: ${reason}`
        );

        await message.reply(
            success(
                message.author,
                "User banned."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

async function handleUnban(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const id = args[0];

    if (!id) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    try {
        await message.guild.members.unban(
            id
        );

        await message.reply(
            success(
                message.author,
                "User unbanned."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "That user couldn't be found."
            )
        );
    }
}

async function handleKick(
    message
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    if (
        !canManageTarget(
            message,
            target
        )
    ) {
        return message.reply(
            warning(
                message.author,
                "I can't manage this user due to role hierarchy."
            )
        );
    }

    try {
        await target.kick(
            "VC+ moderation"
        );

        await message.reply(
            success(
                message.author,
                "User kicked."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

async function handleTimeout(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    const duration =
        parseDuration(args[1]);

    if (!duration) {
        return message.reply(
            warning(
                message.author,
                "Please enter a valid duration."
            )
        );
    }

    if (
        !canManageTarget(
            message,
            target
        )
    ) {
        return message.reply(
            warning(
                message.author,
                "I can't manage this user due to role hierarchy."
            )
        );
    }

    const reason =
        args.slice(2).join(" ") ||
        "No reason provided";

    try {
        await target.timeout(
            duration,
            reason
        );

        await message.reply(
            success(
                message.author,
                `User timed out for ${formatDuration(duration)}.`
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

async function handleUntimeout(
    message
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    try {
        await target.timeout(
            null,
            "VC+ untimeout"
        );

        await message.reply(
            success(
                message.author,
                "Timeout removed."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

/* =========================================================
   WARNINGS
========================================================= */

async function handleWarn(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    const reason =
        args.slice(1).join(" ");

    if (!reason) {
        return message.reply(
            warning(
                message.author,
                "Please provide a reason."
            )
        );
    }

    const data = getGuildData(
        message.guild.id
    );

    if (!data.warnings[target.id]) {
        data.warnings[target.id] = [];
    }

    data.warnings[target.id].push({
        moderatorId:
            message.author.id,
        reason,
        timestamp: Date.now()
    });

    saveDatabase();

    await message.reply(
        success(
            message.author,
            "Warning added."
        )
    );

    await logEvent(
        message.guild,
        "WARN",
        `${target} was warned by ${message.author}.\nReason: ${reason}`
    );
}

async function handleWarnings(
    message
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const target =
        getMentionedMember(message);

    if (!target) {
        return message.reply(
            warning(
                message.author,
                "Please provide a user."
            )
        );
    }

    const data = getGuildData(
        message.guild.id
    );

    const warnings =
        data.warnings[target.id] || [];

    if (!warnings.length) {
        return message.reply(
            `${mention(target)} has no warnings.`
        );
    }

    const description =
        warnings
            .map(
                (warning, index) =>
                    `**${index + 1}.** ${warning.reason}\n<@${warning.moderatorId}> • <t:${Math.floor(warning.timestamp / 1000)}:R>`
            )
            .join("\n\n");

    await message.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    `Warnings • ${target.user.username}`
                )
                .setDescription(
                    description
                )
                .setColor(0xffcc00)
        ]
    });
}

/* =========================================================
   PURGE / CLEAR
========================================================= */

async function handlePurge(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const amount =
        Number(args[0]);

    if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100
    ) {
        return message.reply(
            warning(
                message.author,
                "Please enter a valid number."
            )
        );
    }

    if (
        !message.channel
            .isTextBased()
    ) {
        return;
    }

    try {
        const deleted =
            await message.channel.bulkDelete(
                amount,
                true
            );

        await message.channel.send(
            success(
                message.author,
                `${deleted.size} messages cleared.`
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

/* =========================================================
   CS
========================================================= */

async function handleCS(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const amount =
        Number(args[0] || 100);

    if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100
    ) {
        return message.reply(
            warning(
                message.author,
                "Please enter a valid number."
            )
        );
    }

    const data = getGuildData(
        message.guild.id
    );

    const messages =
        data.snipe.messages || [];

    data.snipe.cleared.push(
        ...messages.map(
            message =>
                message.id
        )
    );

    data.snipe.messages = [];

    saveDatabase();

    try {
        await message.channel.bulkDelete(
            amount,
            true
        );
    } catch {}

    await message.channel.send(
        success(
            message.author,
            "Messages cleared and removed from snipe history."
        )
    );
}

/* =========================================================
   SNIPE
========================================================= */

async function handleSnipe(message) {
    const data = getGuildData(
        message.guild.id
    );

    const item =
        data.snipe.messages.find(
            message =>
                message.channelId ===
                message.channel.id &&
                !data.snipe.cleared.includes(
                    message.id
                )
        );

    if (!item) {
        return message.reply(
            "There is nothing to snipe."
        );
    }

    const embed = new EmbedBuilder()
        .setTitle("VC+ • Snipe")
        .setDescription(
            item.content
        )
        .addFields({
            name: "Author",
            value: item.authorTag,
            inline: true
        })
        .setTimestamp(item.timestamp)
        .setColor(0x5865f2);

    await message.reply({
        embeds: [embed]
    });
}

/* =========================================================
   LOCK / UNLOCK
========================================================= */

async function handleLock(message) {
    if (
        !(await requireAdmin(message))
    )
        return;

    if (
        isLockIgnored(
            message.guild.id,
            message.channel.id
        )
    ) {
        return message.reply(
            warning(
                message.author,
                "This channel is ignored by lock settings."
            )
        );
    }

    try {
        await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                SendMessages: false
            }
        );

        await message.reply(
            success(
                message.author,
                "Channel locked."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

async function handleUnlock(message) {
    if (
        !(await requireAdmin(message))
    )
        return;

    try {
        await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                SendMessages: null
            }
        );

        await message.reply(
            success(
                message.author,
                "Channel unlocked."
            )
        );
    } catch {
        await message.reply(
            warning(
                message.author,
                "I don't have the required permissions to do that."
            )
        );
    }
}

/* =========================================================
   VOUCHES
========================================================= */

async function handleVouch(
    message,
    args
) {
    const data = getGuildData(
        message.guild.id
    );

    const sub =
        args[0]?.toLowerCase();

    if (!sub && message.mentions.users.size) {
        const target =
            message.mentions.users.first();

        if (
            target.id ===
            message.author.id
        ) {
            return message.reply(
                warning(
                    message.author,
                    "You can't use this action on yourself."
                )
            );
        }

        if (
            target.bot
        ) {
            return message.reply(
                warning(
                    message.author,
                    "You can't use this action on me."
                )
            );
        }

        const roleId =
            data.vouches.roleId;

        if (roleId) {
            const member =
                message.member;

            if (
                !member.roles.cache.has(
                    roleId
                )
            ) {
                return message.reply(
                    warning(
                        message.author,
                        "You don't have a permitted role to use this command."
                    )
                );
            }
        }

        if (!data.vouches[target.id]) {
            data.vouches[target.id] = [];
        }

        data.vouches[target.id].push({
            giverId:
                message.author.id,
            timestamp: Date.now()
        });

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Vouch added."
            )
        );
    }

    if (sub === "list") {
        const target =
            message.mentions.users.first();

        if (target) {
            const list =
                data.vouches[target.id] ||
                [];

            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(
                            `Vouches • ${target.username}`
                        )
                        .setDescription(
                            list.length
                                ? list
                                      .map(
                                          (v, i) =>
                                              `**${i + 1}.** <@${v.giverId}> • <t:${Math.floor(v.timestamp / 1000)}:R>`
                                      )
                                      .join(
                                          "\n"
                                      )
                                : "No vouches."
                        )
                        .setColor(
                            0x5865f2
                        )
                ]
            });
        }

        const entries =
            Object.entries(
                data.vouches
            );

        const text =
            entries.length
                ? entries
                      .map(
                          ([id, list]) =>
                              `<@${id}> — ${list.length}`
                      )
                      .join("\n")
                : "No vouches.";

        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "VC+ • Vouches"
                    )
                    .setDescription(text)
                    .setColor(0x5865f2)
            ]
        });
    }

    if (sub === "clear") {
        if (
            !(await requireAdmin(
                message
            ))
        )
            return;

        if (
            args[1] ===
            "everyone"
        ) {
            data.vouches = {};
            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "All vouches cleared."
                )
            );
        }

        const target =
            message.mentions.users.first();

        if (!target) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a user."
                )
            );
        }

        delete data.vouches[
            target.id
        ];

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Vouches cleared."
            )
        );
    }

    if (sub === "role") {
        if (
            !(await requireAdmin(
                message
            ))
        )
            return;

        if (
            args[1] === "set"
        ) {
            const role =
                message.mentions.roles.first();

            if (!role) {
                return message.reply(
                    warning(
                        message.author,
                        "Please provide a role."
                    )
                );
            }

            data.vouches.roleId =
                role.id;

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "Vouch role set."
                )
            );
        }

        if (
            args[1] === "reset"
        ) {
            delete data.vouches.roleId;

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "Vouch role reset."
                )
            );
        }
    }

    if (sub === "limit") {
        if (
            !(await requireAdmin(
                message
            ))
        )
            return;

        const amount =
            Number(args[1]);

        if (
            !Number.isInteger(amount) ||
            amount < 0
        ) {
            return message.reply(
                warning(
                    message.author,
                    "Please enter a valid number."
                )
            );
        }

        data.vouches.limit =
            amount;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Vouch limit updated."
            )
        );
    }
}

/* =========================================================
   VC COMMANDS
========================================================= */

async function handleVC(
    message,
    args
) {
    const sub =
        args[0]?.toLowerCase();

    if (sub === "setup") {
        if (
            !(await requireAdmin(
                message
            ))
        )
            return;

        const guild =
            message.guild;

        let category =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildCategory &&
                    channel.name ===
                        "VC+"
            );

        if (!category) {
            category =
                await guild.channels.create(
                    {
                        name: "VC+",
                        type: ChannelType.GuildCategory
                    }
                );
        }

        let trigger =
            guild.channels.cache.find(
                channel =>
                    channel.type ===
                        ChannelType.GuildVoice &&
                    channel.name ===
                        "Join to Create"
            );

        if (!trigger) {
            trigger =
                await guild.channels.create(
                    {
                        name: "Join to Create",
                        type: ChannelType.GuildVoice,
                        parent: category.id
                    }
                );
        }

        const data = getGuildData(
            guild.id
        );

        data.voiceMaster.enabled =
            true;

        data.voiceMaster.categoryId =
            category.id;

        data.voiceMaster.triggerId =
            trigger.id;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "VoiceMaster setup complete."
            )
        );
    }

    const ownerRequired = [
        "lock",
        "unlock",
        "hide",
        "unhide",
        "ghost",
        "limit",
        "name",
        "kick",
        "ban",
        "unban",
        "permit",
        "reject",
        "transfer"
    ];

    if (
        ownerRequired.includes(sub)
    ) {
        if (
            !(await requireVCOwner(
                message
            ))
        )
            return;
    }

    const channel =
        message.member.voice.channel;

    if (
        sub === "lock"
    ) {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: false
            }
        );

        return message.reply(
            success(
                message.author,
                "VC locked."
            )
        );
    }

    if (
        sub === "unlock"
    ) {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: null
            }
        );

        return message.reply(
            success(
                message.author,
                "VC unlocked."
            )
        );
    }

    if (
        sub === "hide" ||
        sub === "ghost"
    ) {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                ViewChannel: false
            }
        );

        return message.reply(
            success(
                message.author,
                sub === "ghost"
                    ? "VC ghosted."
                    : "VC hidden."
            )
        );
    }

    if (
        sub === "unhide"
    ) {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                ViewChannel: null
            }
        );

        return message.reply(
            success(
                message.author,
                "VC visible."
            )
        );
    }

    if (
        sub === "limit"
    ) {
        const limit =
            Number(args[1]);

        if (
            !Number.isInteger(limit) ||
            limit < 0 ||
            limit > 99
        ) {
            return message.reply(
                warning(
                    message.author,
                    "Please enter a valid number."
                )
            );
        }

        await channel.setUserLimit(
            limit
        );

        return message.reply(
            success(
                message.author,
                "VC limit updated."
            )
        );
    }

    if (
        sub === "name"
    ) {
        const name =
            args.slice(1).join(" ");

        if (!name) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a name."
                )
            );
        }

        await channel.setName(
            name.slice(0, 100)
        );

        return message.reply(
            success(
                message.author,
                "VC renamed."
            )
        );
    }

    if (
        [
            "kick",
            "ban",
            "unban",
            "permit",
            "reject",
            "transfer"
        ].includes(sub)
    ) {
        const target =
            getMentionedMember(
                message
            );

        if (!target) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a user."
                )
            );
        }

        const data =
            getGuildData(
                message.guild.id
            );

        const info =
            data.voiceMaster
                .channels[channel.id];

        if (!info) {
            return message.reply(
                warning(
                    message.author,
                    "This isn't a VC+ temporary VC."
                )
            );
        }

        if (
            sub === "kick"
        ) {
            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect(
                        "VC+ owner kick"
                    );
            }

            return message.reply(
                success(
                    message.author,
                    "User kicked."
                )
            );
        }

        if (
            sub === "ban"
        ) {
            if (!info.banned)
                info.banned = [];

            if (
                !info.banned.includes(
                    target.id
                )
            ) {
                info.banned.push(
                    target.id
                );
            }

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: false
                }
            );

            if (
                target.voice
                    .channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect()
                    .catch(() => {});
            }

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "User banned from VC."
                )
            );
        }

        if (
            sub === "unban"
        ) {
            info.banned =
                (info.banned || [])
                    .filter(
                        id =>
                            id !==
                            target.id
                    );

            await channel.permissionOverwrites.delete(
                target.id
            ).catch(() => {});

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "User unbanned from VC."
                )
            );
        }

        if (
            sub === "permit"
        ) {
            if (!info.permitted)
                info.permitted = [];

            if (
                !info.permitted.includes(
                    target.id
                )
            ) {
                info.permitted.push(
                    target.id
                );
            }

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: true,
                    ViewChannel: true
                }
            );

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "User permitted."
                )
            );
        }

        if (
            sub === "reject"
        ) {
            info.permitted =
                (info.permitted || [])
                    .filter(
                        id =>
                            id !==
                            target.id
                    );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    Connect: false
                }
            );

            if (
                target.voice
                    .channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect()
                    .catch(() => {});
            }

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "User rejected."
                )
            );
        }

        if (
            sub === "transfer"
        ) {
            if (
                target.id ===
                message.author.id
            ) {
                return message.reply(
                    warning(
                        message.author,
                        "You can't use this action on yourself."
                    )
                );
            }

            info.ownerId =
                target.id;

            saveDatabase();

            return message.reply(
                success(
                    message.author,
                    "VC ownership transferred."
                )
            );
        }
    }

    if (
        sub === "claim"
    ) {
        const data =
            getGuildData(
                message.guild.id
            );

        const info =
            data.voiceMaster
                .channels[channel?.id];

        if (!info) {
            return message.reply(
                warning(
                    message.author,
                    "This isn't a VC+ temporary VC."
                )
            );
        }

        if (
            info.ownerId &&
            channel.members.has(
                info.ownerId
            )
        ) {
            return message.reply(
                warning(
                    message.author,
                    "The current owner is still in the VC."
                )
            );
        }

        info.ownerId =
            message.author.id;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "You claimed this VC."
            )
        );
    }
}

/* =========================================================
   ANTINUKE COMMANDS
========================================================= */

async function handleAntinuke(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (sub === "setup") {
        data.antinuke.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke enabled."
            )
        );
    }

    if (sub === "status") {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "VC+ • Antinuke"
                    )
                    .setDescription(
                        [
                            `Enabled: **${data.antinuke.enabled ? "Yes" : "No"}**`,
                            `Action Window: **${data.antinuke.actionWindow}ms**`,
                            `Max Actions: **${data.antinuke.maxActions}**`,
                            `Punishment: **${data.antinuke.punishment}**`,
                            `Whitelisted: **${data.antinuke.whitelist.length}**`
                        ].join("\n")
                    )
                    .setColor(
                        data.antinuke.enabled
                            ? 0x00ff88
                            : 0xff0000
                    )
            ]
        });
    }

    if (
        sub === "enable"
    ) {
        data.antinuke.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.antinuke.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke disabled."
            )
        );
    }

    if (
        sub === "whitelist"
    ) {
        const target =
            getMentionedMember(
                message
            );

        if (!target) {
            return message.reply(
                `Whitelisted users: ${
                    data.antinuke.whitelist
                        .map(
                            id =>
                                `<@${id}>`
                        )
                        .join(
                            ", "
                        ) ||
                    "None"
                }`
            );
        }

        if (
            !data.antinuke.whitelist.includes(
                target.id
            )
        ) {
            data.antinuke.whitelist.push(
                target.id
            );
        }

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "User whitelisted."
            )
        );
    }

    if (
        sub === "unwhitelist"
    ) {
        const target =
            getMentionedMember(
                message
            );

        if (!target) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a user."
                )
            );
        }

        data.antinuke.whitelist =
            data.antinuke.whitelist.filter(
                id =>
                    id !==
                    target.id
            );

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "User removed from whitelist."
            )
        );
    }

    if (
        sub === "config"
    ) {
        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        "VC+ • Antinuke Config"
                    )
                    .setDescription(
                        [
                            `Window: \`${data.antinuke.actionWindow}ms\``,
                            `Max Actions: \`${data.antinuke.maxActions}\``,
                            `Punishment: \`${data.antinuke.punishment}\``
                        ].join("\n")
                    )
                    .setColor(0x5865f2)
            ]
        });
    }

    if (
        sub === "limits"
    ) {
        return message.reply(
            `Window: ${data.antinuke.actionWindow}ms\nMax actions: ${data.antinuke.maxActions}`
        );
    }

    if (
        sub === "punishment"
    ) {
        const punishment =
            args[1];

        if (!punishment) {
            return message.reply(
                `Current punishment: ${data.antinuke.punishment}`
            );
        }

        const allowed = [
            "remove_roles",
            "kick",
            "ban"
        ];

        if (
            !allowed.includes(
                punishment
            )
        ) {
            return message.reply(
                warning(
                    message.author,
                    "Invalid punishment."
                )
            );
        }

        data.antinuke.punishment =
            punishment;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke punishment updated."
            )
        );
    }

    if (
        sub === "lockdown"
    ) {
        data.antinuke.lockdown =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke lockdown enabled."
            )
        );
    }

    if (
        sub === "unlock"
    ) {
        data.antinuke.lockdown =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke lockdown disabled."
            )
        );
    }

    if (
        sub === "reset"
    ) {
        data.antinuke =
            defaultGuild().antinuke;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antinuke settings reset."
            )
        );
    }
}

/* =========================================================
   ANTIRAID
========================================================= */

async function handleAntiraid(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.antiraid.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antiraid enabled."
            )
        );
    }

    if (
        sub === "status"
    ) {
        return message.reply(
            `Antiraid: ${
                data.antiraid.enabled
                    ? "enabled"
                    : "disabled"
            }\nThreshold: ${data.antiraid.threshold}`
        );
    }

    if (
        sub === "enable"
    ) {
        data.antiraid.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antiraid enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.antiraid.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Antiraid disabled."
            )
        );
    }
}

/* =========================================================
   MODULES
========================================================= */

async function handleModule(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (!sub) {
        const modules =
            Object.entries(
                data.modules
            );

        return message.reply(
            modules.length
                ? modules
                      .map(
                          ([name, enabled]) =>
                              `${name}: ${
                                  enabled
                                      ? "enabled"
                                      : "disabled"
                              }`
                      )
                      .join("\n")
                : "No modules configured."
        );
    }

    const moduleName =
        args[1]?.toLowerCase();

    if (!moduleName) {
        return message.reply(
            warning(
                message.author,
                "Please provide a module."
            )
        );
    }

    if (
        sub === "enable"
    ) {
        data.modules[
            moduleName
        ] = true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                `Module \`${moduleName}\` enabled.`
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.modules[
            moduleName
        ] = false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                `Module \`${moduleName}\` disabled.`
            )
        );
    }
}

/* =========================================================
   FILTER
========================================================= */

async function handleFilter(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.filter.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Filter enabled."
            )
        );
    }

    if (
        sub === "add"
    ) {
        const word =
            args
                .slice(1)
                .join(" ")
                .toLowerCase();

        if (!word) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a word."
                )
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

        return message.reply(
            success(
                message.author,
                "Filter word added."
            )
        );
    }

    if (
        sub === "remove"
    ) {
        const word =
            args
                .slice(1)
                .join(" ")
                .toLowerCase();

        data.filter.words =
            data.filter.words.filter(
                item =>
                    item !== word
            );

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Filter word removed."
            )
        );
    }

    if (
        sub === "list"
    ) {
        return message.reply(
            data.filter.words.length
                ? data.filter.words
                      .map(
                          word =>
                              `\`${word}\``
                      )
                      .join(", ")
                : "No filter words."
        );
    }
}

/* =========================================================
   AUTORESPONDERS
========================================================= */

async function handleAutoresponder(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "add"
    ) {
        const trigger =
            args[1]?.toLowerCase();

        const response =
            args
                .slice(2)
                .join(" ");

        if (!trigger || !response) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a trigger and response."
                )
            );
        }

        data.autoresponders[
            trigger
        ] = response;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Autoresponder added."
            )
        );
    }

    if (
        sub === "remove"
    ) {
        const trigger =
            args[1]?.toLowerCase();

        delete data.autoresponders[
            trigger
        ];

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Autoresponder removed."
            )
        );
    }

    if (
        sub === "list"
    ) {
        const entries =
            Object.entries(
                data.autoresponders
            );

        return message.reply(
            entries.length
                ? entries
                      .map(
                          ([trigger, response]) =>
                              `\`${trigger}\` → ${response}`
                      )
                      .join("\n")
                : "No autoresponders."
        );
    }
}

/* =========================================================
   BOOSTER ROLES
========================================================= */

async function handleBoosterRole(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.boosterRoles.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster roles enabled."
            )
        );
    }

    if (
        sub === "add"
    ) {
        const role =
            message.mentions.roles.first();

        if (!role) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a role."
                )
            );
        }

        if (
            !data.boosterRoles.roles.includes(
                role.id
            )
        ) {
            data.boosterRoles.roles.push(
                role.id
            );
        }

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster role added."
            )
        );
    }

    if (
        sub === "remove"
    ) {
        const role =
            message.mentions.roles.first();

        if (!role) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a role."
                )
            );
        }

        data.boosterRoles.roles =
            data.boosterRoles.roles.filter(
                id =>
                    id !== role.id
            );

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster role removed."
            )
        );
    }
}

/* =========================================================
   BOOSTER MESSAGES
========================================================= */

async function handleBoosterMessage(
    message,
  args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.boosterMessages.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster messages enabled."
            )
        );
    }

    if (
        sub === "enable"
    ) {
        data.boosterMessages.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster messages enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.boosterMessages.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Booster messages disabled."
            )
        );
    }
}

/* =========================================================
   LEVELS
========================================================= */

async function handleLevels(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup" ||
        sub === "enable"
    ) {
        data.levels.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Levels enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.levels.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Levels disabled."
            )
        );
    }

    if (
        sub === "settings"
    ) {
        return message.reply(
            `Levels: ${
                data.levels.enabled
                    ? "enabled"
                    : "disabled"
            }`
        );
    }
}

/* =========================================================
   LOCK IGNORE
========================================================= */

async function handleLockIgnore(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    const channel =
        message.mentions.channels.first();

    if (
        sub === "add"
    ) {
        if (!channel) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a channel."
                )
            );
        }

        if (
            !data.lockIgnore.includes(
                channel.id
            )
        ) {
            data.lockIgnore.push(
                channel.id
            );
        }

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Channel added to lock ignore."
            )
        );
    }

    if (
        sub === "remove"
    ) {
        if (!channel) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a channel."
                )
            );
        }

        data.lockIgnore =
            data.lockIgnore.filter(
                id =>
                    id !==
                    channel.id
            );

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Channel removed from lock ignore."
            )
        );
    }

    if (
        sub === "list"
    ) {
        return message.reply(
            data.lockIgnore.length
                ? data.lockIgnore
                      .map(
                          id =>
                              `<#${id}>`
                      )
                      .join("\n")
                : "No ignored channels."
        );
    }
}

/* =========================================================
   WELCOME
========================================================= */

async function handleWelcome(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.welcome.channelId =
            message.channel.id;

        data.welcome.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Welcome system configured."
            )
        );
    }

    if (
        sub === "enable"
    ) {
        data.welcome.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Welcome enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.welcome.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Welcome disabled."
            )
        );
    }

    if (
        sub === "message"
    ) {
        const text =
            args
                .slice(1)
                .join(" ");

        if (!text) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a message."
                )
            );
        }

        data.welcome.message =
            text;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Welcome message updated."
            )
        );
    }
}

/* =========================================================
   GOODBYE
========================================================= */

async function handleGoodbye(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.goodbye.channelId =
            message.channel.id;

        data.goodbye.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Goodbye system configured."
            )
        );
    }

    if (
        sub === "enable"
    ) {
        data.goodbye.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Goodbye enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.goodbye.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Goodbye disabled."
            )
        );
    }

    if (
        sub === "message"
    ) {
        const text =
            args
                .slice(1)
                .join(" ");

        if (!text) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a message."
                )
            );
        }

        data.goodbye.message =
            text;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Goodbye message updated."
            )
        );
    }
}

/* =========================================================
   LOGS
========================================================= */

async function handleLogs(
    message,
    args
) {
    if (
        !(await requireAdmin(message))
    )
        return;

    const data =
        getGuildData(
            message.guild.id
        );

    const sub =
        args[0]?.toLowerCase();

    if (
        sub === "setup"
    ) {
        data.logging.channelId =
            message.channel.id;

        data.logging.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Logging configured."
            )
        );
    }

    if (
        sub === "enable"
    ) {
        data.logging.enabled =
            true;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Logging enabled."
            )
        );
    }

    if (
        sub === "disable"
    ) {
        data.logging.enabled =
            false;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Logging disabled."
            )
        );
    }

    if (
        sub === "channel"
    ) {
        const channel =
            message.mentions.channels.first();

        if (!channel) {
            return message.reply(
                warning(
                    message.author,
                    "Please provide a channel."
                )
            );
        }

        data.logging.channelId =
            channel.id;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Logging channel updated."
            )
        );
    }

    if (
        sub === "events"
    ) {
        const events =
            args
                .slice(1)
                .join(" ")
                .split(",")
                .map(
                    x =>
                        x.trim()
                            .toUpperCase()
                )
                .filter(Boolean);

        data.logging.events =
            events;

        saveDatabase();

        return message.reply(
            success(
                message.author,
                "Logging events updated."
            )
        );
    }
}

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {
        if (
            !interaction.isButton()
        ) {
            return;
        }

        try {
            /* HELP */

            if (
                interaction.customId.startsWith(
                    "help_"
                )
            ) {
                return;
            }

            /* VC BUTTONS */

            const vcButtons = [
                "vc_lock",
                "vc_unlock",
                "vc_hide",
                "vc_permit",
                "vc_reject",
                "vc_kick",
                "vc_ban",
                "vc_unban",
                "vc_limit",
                "vc_claim",
                "vc_ghost"
            ];

            if (
                vcButtons.includes(
                    interaction.customId
                )
            ) {
                const channel =
                    interaction.member
                        ?.voice?.channel;

                if (!channel) {
                    return interaction.reply({
                        content:
                            warning(
                                interaction.user,
                                "You must be in a voice channel."
                            ),
                        ephemeral: true
                    });
                }

                const data =
                    getGuildData(
                        interaction.guild.id
                    );

                const info =
                    data.voiceMaster
                        .channels[
                            channel.id
                        ];

                if (!info) {
                    return interaction.reply({
                        content:
                            warning(
                                interaction.user,
                                "This isn't a VC+ temporary VC."
                            ),
                        ephemeral: true
                    });
                }

                if (
                    info.ownerId !==
                    interaction.user.id
                ) {
                    return interaction.reply({
                        content:
                            warning(
                                interaction.user,
                                "You don't have permission to control this VC."
                            ),
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    "vc_lock"
                ) {
                    await channel.permissionOverwrites.edit(
                        interaction.guild
                            .roles
                            .everyone,
                        {
                            Connect: false
                        }
                    );

                    return interaction.reply({
                        content:
                            success(
                                interaction.user,
                                "VC locked."
                            ),
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    "vc_unlock"
                ) {
                    await channel.permissionOverwrites.edit(
                        interaction.guild
                            .roles
                            .everyone,
                        {
                            Connect: null
                        }
                    );

                    return interaction.reply({
                        content:
                            success(
                                interaction.user,
                                "VC unlocked."
                            ),
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    "vc_hide" ||
                    interaction.customId ===
                    "vc_ghost"
                ) {
                    await channel.permissionOverwrites.edit(
                        interaction.guild
                            .roles
                            .everyone,
                        {
                            ViewChannel: false
                        }
                    );

                    return interaction.reply({
                        content:
                            success(
                                interaction.user,
                                interaction.customId ===
                                    "vc_ghost"
                                    ? "VC ghosted."
                                    : "VC hidden."
                            ),
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    "vc_claim"
                ) {
                    if (
                        channel.members.has(
                            info.ownerId
                        )
                    ) {
                        return interaction.reply({
                            content:
                                warning(
                                    interaction.user,
                                    "The current owner is still in the VC."
                                ),
                            ephemeral: true
                        });
                    }

                    info.ownerId =
                        interaction.user.id;

                    saveDatabase();

                    return interaction.reply({
                        content:
                            success(
                                interaction.user,
                                "You claimed this VC."
                            ),
                        ephemeral: true
                    });
                }

                return interaction.reply({
                    content:
                        "Use the command version for this control.",
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error(
                "[VC+ INTERACTION ERROR]",
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        errorText(
                            "Something went wrong."
                        ),
                    ephemeral: true
                });
            }
        }
    }
);

/* =========================================================
   READY
========================================================= */

client.once(
    "ready",
    async () => {
        console.log(
            `[VC+] Logged in as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name: "-help",
                    type: 2
                }
            ],
            status: "online"
        });

        console.log(
            "[VC+] VC+ is online."
        );

        console.log(
            `[VC+] Serving ${client.guilds.cache.size} server(s).`
        );
    }
);

/* =========================================================
   PROCESS ERROR HANDLING
========================================================= */

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+ UNHANDLED REJECTION]",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[VC+ UNCAUGHT EXCEPTION]",
            error
        );
    }
);

/* =========================================================
   START BOT
========================================================= */

async function startBot() {
    console.log(
        "[VC+] Starting..."
    );

    loadDatabase();

    console.log(
        "[VC+] Commands loaded."
    );

    console.log(
        "[VC+] Events loaded."
    );

    try {
        await client.login(token);
    } catch (error) {
        console.error(
            "[VC+ LOGIN ERROR]",
            error
        );

        process.exit(1);
    }
}

startBot();
