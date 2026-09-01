import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    AuditLogEvent
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// VC+
// SAFE / ANTI-NUKE / PERSONAL VC SYSTEM
// ============================================================

const PREFIX = "-";
const BOT_NAME = "vc+";

// Pink / black theme
const COLORS = {
    pink: 0xff4fa3,
    darkPink: 0xd93688,
    black: 0x111111,
    success: 0x57f287,
    error: 0xed4245,
    warning: 0xfee75c,
    info: 0x5865f2
};

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

const dataDir = path.join(process.cwd(), "data");
const dbFile = path.join(dataDir, "vcplus.json");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, {
        recursive: true
    });
}

let db = {
    guilds: {}
};

let saveTimer = null;

function normalizeDatabase() {
    if (!db || typeof db !== "object") {
        db = {};
    }

    if (!db.guilds || typeof db.guilds !== "object") {
        db.guilds = {};
    }
}

function loadDB() {
    try {
        if (!fs.existsSync(dbFile)) {
            normalizeDatabase();
            saveDB();
            return;
        }

        const raw = fs.readFileSync(
            dbFile,
            "utf8"
        );

        if (!raw.trim()) {
            db = {
                guilds: {}
            };

            saveDB();
            return;
        }

        const parsed = JSON.parse(raw);

        if (
            !parsed ||
            typeof parsed !== "object"
        ) {
            db = {
                guilds: {}
            };
        } else {
            db = parsed;
        }

        normalizeDatabase();

    } catch (error) {
        console.error(
            "[DATABASE LOAD]",
            error
        );

        db = {
            guilds: {}
        };
    }
}

function saveDB() {
    try {
        normalizeDatabase();

        const tempFile =
            `${dbFile}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(
                db,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            tempFile,
            dbFile
        );

    } catch (error) {
        console.error(
            "[DATABASE SAVE]",
            error
        );
    }
}

function queueSave() {
    if (saveTimer) {
        return;
    }

    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveDB();
    }, 500);
}

loadDB();

// ============================================================
// RANKS
// ============================================================

const RANKS = [
    "founder",
    "god",
    "owner",
    "coowner",
    "executive",
    "director",
    "admin",
    "moderator",
    "staff",
    "member"
];

const RANK_LEVEL = {
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

// ============================================================
// GUILD DATA
// ============================================================

function guildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {};
    }

    const g = db.guilds[guildId];

    g.ranks ??= {};
    g.foreverBanned ??= [];
    g.vouches ??= {};
    g.vouchLimit ??= 1;
    g.godmode ??= {};

    g.jtc ??= {};
    g.jtc.categoryId ??= null;
    g.jtc.triggerId ??= null;

    g.security ??= {};
    g.security.enabled ??= true;

    return g;
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(guild, userId) {
    const g = guildData(
        guild.id
    );

    return (
        g.ranks[userId] ||
        "member"
    );
}

function rankLevel(
    guild,
    userId
) {
    return (
        RANK_LEVEL[
            getRank(
                guild,
                userId
            )
        ] || 1
    );
}

function isFounderFromId(
    guild,
    userId
) {
    return (
        guild.ownerId === userId ||
        getRank(
            guild,
            userId
        ) === "founder"
    );
}

function isGodFromId(
    guild,
    userId
) {
    return (
        isFounderFromId(
            guild,
            userId
        ) ||
        getRank(
            guild,
            userId
        ) === "god"
    );
}

function isProtected(
    guild,
    userId
) {
    const rank =
        getRank(
            guild,
            userId
        );

    return (
        rank === "founder" ||
        rank === "god" ||
        guild.ownerId === userId
    );
}

// ============================================================
// EMBEDS
// ============================================================

function box(
    title,
    description,
    type = "info"
) {
    const color =
        COLORS[type] ??
        COLORS.pink;

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(
            `♡ ${BOT_NAME} • ${title}`
        )
        .setDescription(
            description
        )
        .setFooter({
            text:
                "VC+ • ghetto comm control"
        })
        .setTimestamp();
}

async function safeReply(
    message,
    title,
    description,
    type = "info"
) {
    try {
        if (!message) {
            return null;
        }

        return await message.reply({
            embeds: [
                box(
                    title,
                    description,
                    type
                )
            ],
            allowedMentions: {
                parse: []
            }
        });

    } catch (error) {
        console.error(
            "[REPLY ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// TARGET
// ============================================================

async function getTarget(
    message,
    value
) {
    try {
        if (!value) {
            return null;
        }

        const mentioned =
            message.mentions.members.first();

        if (mentioned) {
            return mentioned;
        }

        const id =
            String(value)
                .replace(
                    /[<@!>]/g,
                    ""
                );

        if (
            !/^\d{15,25}$/.test(id)
        ) {
            return null;
        }

        return await message.guild.members
            .fetch(id)
            .catch(() => null);

    } catch (error) {
        console.error(
            "[GET TARGET]",
            error
        );

        return null;
    }
}

// ============================================================
// MODERATION SAFETY
// ============================================================

function canModerate(
    message,
    target
) {
    try {
        if (
            !message.guild ||
            !target
        ) {
            return false;
        }

        if (
            target.id ===
            message.author.id
        ) {
            return false;
        }

        if (
            target.id ===
            message.guild.ownerId
        ) {
            return false;
        }

        if (
            isProtected(
                message.guild,
                target.id
            )
        ) {
            return isGodFromId(
                message.guild,
                message.author.id
            );
        }

        return (
            rankLevel(
                message.guild,
                message.author.id
            ) >
            rankLevel(
                message.guild,
                target.id
            )
        );

    } catch {
        return false;
    }
}

// ============================================================
// TEMP VC MEMORY
// ============================================================

const temporaryVCs =
    new Map();

/*
channelId -> {
    guildId,
    ownerId,
    banned: Set,
    rejected: Set,
    permitted: Set,
    stfu: Set,
    locked
}
*/

// ============================================================
// FIND VC
// ============================================================

function getOwnedVC(
    member
) {
    try {
        if (
            !member?.voice?.channelId
        ) {
            return null;
        }

        const channelId =
            member.voice.channelId;

        const data =
            temporaryVCs.get(
                channelId
            );

        if (!data) {
            return null;
        }

        const channel =
            member.guild.channels.cache.get(
                channelId
            );

        if (!channel) {
            return null;
        }

        return {
            channel,
            data
        };

    } catch (error) {
        console.error(
            "[GET OWNED VC]",
            error
        );

        return null;
    }
}

function canControlVC(
    message,
    data
) {
    if (!data) {
        return false;
    }

    return (
        data.ownerId ===
            message.author.id ||
        isGodFromId(
            message.guild,
            message.author.id
        )
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

function interfaceButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
                    "vcplus_lock"
                )
                .setLabel("LOCK")
                .setEmoji("🔒")
                .setStyle(
                    ButtonStyle.Danger
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vcplus_unlock"
                )
                .setLabel("UNLOCK")
                .setEmoji("🔓")
                .setStyle(
                    ButtonStyle.Success
                ),

            new ButtonBuilder()
                .setCustomId(
                    "vcplus_refresh"
                )
                .setLabel("REFRESH")
                .setEmoji("↻")
                .setStyle(
                    ButtonStyle.Secondary
                )
        );
}

function interfaceSelect(
    channel
) {
    const members =
        [...channel.members.values()]
            .filter(
                member =>
                    member.id !==
                    channel.guild.ownerId
            )
            .filter(
                member =>
                    !isProtected(
                        channel.guild,
                        member.id
                    )
            )
            .slice(0, 25);

    if (!members.length) {
        return null;
    }

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId(
                "vcplus_stfu_select"
            )
            .setPlaceholder(
                "Select someone to STFU"
            )
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                members.map(
                    member => ({
                        label:
                            member.user.username
                                .slice(0, 100),
                        value:
                            member.id,
                        description:
                            "Lock this member muted"
                    })
                )
            );

    return new ActionRowBuilder()
        .addComponents(
            menu
        );
}

async function sendVCInterface(
    voiceChannel,
    data
) {
    try {
        if (
            !voiceChannel ||
            !data
        ) {
            return null;
        }

        if (
            typeof voiceChannel.send !==
            "function"
        ) {
            return null;
        }

        const lines = [
            "### ♡ VC+ CONTROL PANEL",
            "",
            `**OWNER** <@${data.ownerId}>`,
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            "**VC CONTROLS**",
            "`-vc kick @user`",
            "`-vc ban @user`",
            "`-vc reject @user`",
            "`-vc permit @user`",
            "`-vc lock`",
            "`-vc unlock`",
            "`-vc limit 10`",
            "`-vc rename name`",
            "`-vc transfer @user`",
            "",
            "**VOICE CONTROL**",
            "`-vc stfu @user`",
            "`-vc unstfu @user`",
            "`-vc dragall`",
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            "**PROTECTION**",
            "♡ Founder + God cannot be VC-STFU'd.",
            "♡ Godmode protects against server voice mute.",
            "♡ Founder is always protected.",
            "",
            "Use the buttons below for quick controls."
        ];

        const components = [
            interfaceButtons()
        ];

        const select =
            interfaceSelect(
                voiceChannel
            );

        if (select) {
            components.push(
                select
            );
        }

        return await voiceChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(
                        COLORS.pink
                    )
                    .setTitle(
                        "♡ VC+ // PERSONAL CALL"
                    )
                    .setDescription(
                        lines.join("\n")
                    )
                    .setThumbnail(
                        client.user?.displayAvatarURL?.({
                            size: 128
                        }) ?? null
                    )
                    .setFooter({
                        text:
                            "VC+ • private call control"
                    })
                    .setTimestamp()
            ],
            components
        });

    } catch (error) {
        console.error(
            "[VC INTERFACE]",
            error
        );

        return null;
    }
}

// ============================================================
// SETUP
// ============================================================

async function setupVC(
    message
) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ManageChannels
            )
        ) {
            return safeReply(
                message,
                "PERMISSION DENIED",
                "You need **Manage Channels** to set up VC+.",
                "error"
            );
        }

        const g =
            guildData(
                message.guild.id
            );

        if (
            g.jtc.triggerId &&
            message.guild.channels.cache.has(
                g.jtc.triggerId
            )
        ) {
            return safeReply(
                message,
                "ALREADY ACTIVE",
                `Join <#${g.jtc.triggerId}> to create your personal VC.`,
                "warning"
            );
        }

        let category = null;

        if (
            g.jtc.categoryId
        ) {
            category =
                message.guild.channels.cache.get(
                    g.jtc.categoryId
                );
        }

        if (!category) {
            category =
                await message.guild.channels.create({
                    name: "♡ VC+",
                    type:
                        ChannelType.GuildCategory,
                    reason:
                        "VC+ setup"
                });
        }

        const trigger =
            await message.guild.channels.create({
                name:
                    "♡・join-to-create",
                type:
                    ChannelType.GuildVoice,
                parent:
                    category.id,
                reason:
                    "VC+ Join to Create"
            });

        g.jtc.categoryId =
            category.id;

        g.jtc.triggerId =
            trigger.id;

        queueSave();

        return safeReply(
            message,
            "VC+ ONLINE",
            [
                `Join <#${trigger.id}> to create your personal call.`,
                "",
                "**NO EXTRA CHAT CHANNELS.**",
                "Your control interface appears directly inside your VC's built-in chat.",
                "",
                "Use `-vc` for commands."
            ].join("\n"),
            "success"
        );

    } catch (error) {
        console.error(
            "[VC SETUP]",
            error
        );

        return safeReply(
            message,
            "SETUP FAILED",
            "VC+ could not finish setup. Check the bot's **Manage Channels** permission.",
            "error"
        );
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(
    member,
    trigger
) {
    try {
        if (
            !member ||
            !trigger
        ) {
            return null;
        }

        const guild =
            member.guild;

        const g =
            guildData(
                guild.id
            );

        if (
            trigger.id !==
            g.jtc.triggerId
        ) {
            return null;
        }

        // Existing VC
        for (
            const [
                channelId,
                data
            ] of temporaryVCs
        ) {
            if (
                data.guildId ===
                    guild.id &&
                data.ownerId ===
                    member.id
            ) {
                const existing =
                    guild.channels.cache.get(
                        channelId
                    );

                if (existing) {
                    await member.voice
                        .setChannel(
                            existing,
                            "VC+ existing VC"
                        )
                        .catch(() => {});

                    return existing;
                }

                temporaryVCs.delete(
                    channelId
                );
            }
        }

        const safeName =
            `${member.user.username} VC`
                .replace(
                    /[^\w\s\-+♡]/g,
                    ""
                )
                .slice(0, 95)
                .trim() ||
            "Personal VC";

        const channel =
            await guild.channels.create({
                name:
                    `♡ ${safeName}`,
                type:
                    ChannelType.GuildVoice,
                parent:
                    trigger.parentId ??
                    null,
                userLimit: 0,
                reason:
                    "VC+ personal VC",
                permissionOverwrites: [
                    {
                        id:
                            guild.roles.everyone.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect
                        ]
                    }
                ]
            });

        const data = {
            guildId:
                guild.id,
            ownerId:
                member.id,
            banned:
                new Set(),
            rejected:
                new Set(),
            permitted:
                new Set(),
            stfu:
                new Set(),
            locked:
                false
        };

        temporaryVCs.set(
            channel.id,
            data
        );

        // Move first.
        await member.voice
            .setChannel(
                channel,
                "VC+ personal VC"
            )
            .catch(error => {
                console.error(
                    "[MOVE TO PERSONAL VC]",
                    error
                );
            });

        // Then put the interface INSIDE
        // the voice channel's chat.
        await sendVCInterface(
            channel,
            data
        );

        return channel;

    } catch (error) {
        console.error(
            "[CREATE PERSONAL VC]",
            error
        );

        return null;
    }
}

// ============================================================
// VC HELP
// ============================================================

async function vcHelp(
    message
) {
    return safeReply(
        message,
        "VC+ COMMANDS",
        [
            "**SETUP**",
            "`-vc setup`",
            "",
            "**CONTROL**",
            "`-vc kick @user`",
            "`-vc ban @user`",
            "`-vc reject @user`",
            "`-vc permit @user`",
            "`-vc lock`",
            "`-vc unlock`",
            "`-vc limit 10`",
            "`-vc rename name`",
            "`-vc transfer @user`",
            "",
            "**VOICE**",
            "`-vc stfu @user`",
            "`-vc unstfu @user`",
            "`-vc dragall`",
            "",
            "**INTERFACE**",
            "`-interface`",
            "",
            "**FOUNDER ONLY**",
            "`-vc dragall`"
        ].join("\n")
    );
}

// ============================================================
// VC COMMAND HANDLER
// ============================================================

async function handleVC(
    message,
    args
) {
    try {
        const sub =
            String(
                args.shift() ||
                ""
            ).toLowerCase();

        if (!sub) {
            return vcHelp(
                message
            );
        }

        if (
            sub === "setup"
        ) {
            return setupVC(
                message
            );
        }

        const owned =
            getOwnedVC(
                message.member
            );

        if (!owned) {
            return safeReply(
                message,
                "NO VC",
                "You must be inside a temporary VC+ call.",
                "error"
            );
        }

        const {
            channel,
            data
        } = owned;

        if (
            !canControlVC(
                message,
                data
            )
        ) {
            return safeReply(
                message,
                "ACCESS DENIED",
                "Only the VC owner, Founder, or God can control this call.",
                "error"
            );
        }

        // ----------------------------------------------------
        // KICK
        // ----------------------------------------------------

        if (
            sub === "kick"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC KICK",
                    "Usage: `-vc kick @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return safeReply(
                    message,
                    "NOT IN VC",
                    "That member isn't in this call.",
                    "error"
                );
            }

            if (
                !canModerate(
                    message,
                    target
                )
            ) {
                return safeReply(
                    message,
                    "PROTECTED",
                    "You cannot kick an equal or higher protected member.",
                    "error"
                );
            }

            await target.voice
                .disconnect(
                    "VC+ owner kick"
                )
                .catch(() => {});

            return safeReply(
                message,
                "KICKED",
                `${target} was removed from the call.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // BAN
        // ----------------------------------------------------

        if (
            sub === "ban"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC BAN",
                    "Usage: `-vc ban @user`",
                    "warning"
                );
            }

            if (
                !canModerate(
                    message,
                    target
                )
            ) {
                return safeReply(
                    message,
                    "PROTECTED",
                    "You cannot VC-ban Founder, God, or an equal/higher rank.",
                    "error"
                );
            }

            data.banned.add(
                target.id
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect(
                        "VC+ VC ban"
                    )
                    .catch(() => {});
            }

            return safeReply(
                message,
                "VC BANNED",
                `${target} can no longer join this call.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // REJECT
        // ----------------------------------------------------

        if (
            sub === "reject"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC REJECT",
                    "Usage: `-vc reject @user`",
                    "warning"
                );
            }

            if (
                !canModerate(
                    message,
                    target
                )
            ) {
                return safeReply(
                    message,
                    "PROTECTED",
                    "You cannot reject a protected member.",
                    "error"
                );
            }

            data.rejected.add(
                target.id
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .disconnect(
                        "VC+ rejected"
                    )
                    .catch(() => {});
            }

            return safeReply(
                message,
                "REJECTED",
                `${target} is now rejected from this call.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // PERMIT
        // ----------------------------------------------------

        if (
            sub === "permit"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC PERMIT",
                    "Usage: `-vc permit @user`",
                    "warning"
                );
            }

            data.banned.delete(
                target.id
            );

            data.rejected.delete(
                target.id
            );

            data.permitted.add(
                target.id
            );

            return safeReply(
                message,
                "PERMITTED",
                `${target} is allowed to join this VC.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // LOCK
        // ----------------------------------------------------

        if (
            sub === "lock"
        ) {
            await channel.permissionOverwrites
                .edit(
                    message.guild.roles.everyone,
                    {
                        Connect: false
                    }
                )
                .catch(error => {
                    console.error(
                        "[LOCK]",
                        error
                    );
                });

            data.locked = true;

            return safeReply(
                message,
                "VC LOCKED",
                "Nobody new can join this call.",
                "success"
            );
        }

        // ----------------------------------------------------
        // UNLOCK
        // ----------------------------------------------------

        if (
            sub === "unlock"
        ) {
            await channel.permissionOverwrites
                .edit(
                    message.guild.roles.everyone,
                    {
                        Connect: true
                    }
                )
                .catch(error => {
                    console.error(
                        "[UNLOCK]",
                        error
                    );
                });

            data.locked = false;

            return safeReply(
                message,
                "VC UNLOCKED",
                "Your call is open again.",
                "success"
            );
        }

        // ----------------------------------------------------
        // LIMIT
        // ----------------------------------------------------

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
                return safeReply(
                    message,
                    "INVALID LIMIT",
                    "Choose a number from `0` to `99`.",
                    "error"
                );
            }

            await channel
                .setUserLimit(
                    limit
                )
                .catch(error => {
                    console.error(
                        "[LIMIT]",
                        error
                    );
                });

            return safeReply(
                message,
                "LIMIT UPDATED",
                `VC limit: **${
                    limit === 0
                        ? "Unlimited"
                        : limit
                }**`,
                "success"
            );
        }

        // ----------------------------------------------------
        // RENAME
        // ----------------------------------------------------

        if (
            sub === "rename"
        ) {
            const name =
                args
                    .join(" ")
                    .trim()
                    .slice(0, 100);

            if (!name) {
                return safeReply(
                    message,
                    "RENAME",
                    "Usage: `-vc rename My VC`",
                    "warning"
                );
            }

            await channel
                .setName(
                    name
                )
                .catch(error => {
                    console.error(
                        "[RENAME]",
                        error
                    );
                });

            return safeReply(
                message,
                "VC RENAMED",
                `Your VC is now **${name}**.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // TRANSFER
        // ----------------------------------------------------

        if (
            sub === "transfer"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "TRANSFER",
                    "Usage: `-vc transfer @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return safeReply(
                    message,
                    "NOT IN VC",
                    "The new owner must be inside the call.",
                    "warning"
                );
            }

            if (
                isProtected(
                    message.guild,
                    target.id
                )
            ) {
                return safeReply(
                    message,
                    "PROTECTED",
                    "That member already has a protected rank.",
                    "warning"
                );
            }

            data.ownerId =
                target.id;

            await sendVCInterface(
                channel,
                data
            );

            return safeReply(
                message,
                "OWNERSHIP TRANSFERRED",
                `${target} is now the owner of this call.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // STFU
        // ----------------------------------------------------

        if (
            sub === "stfu"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC STFU",
                    "Usage: `-vc stfu @user`",
                    "warning"
                );
            }

            if (
                target.id ===
                message.author.id
            ) {
                return safeReply(
                    message,
                    "INVALID TARGET",
                    "You cannot STFU yourself.",
                    "error"
                );
            }

            if (
                isProtected(
                    message.guild,
                    target.id
                )
            ) {
                return safeReply(
                    message,
                    "PROTECTED",
                    "Founder and God are protected from VC STFU.",
                    "error"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return safeReply(
                    message,
                    "NOT IN VC",
                    "That member isn't in your call.",
                    "error"
                );
            }

            data.stfu.add(
                target.id
            );

            await target.voice
                .setMute(
                    true,
                    "VC+ STFU"
                )
                .catch(error => {
                    console.error(
                        "[STFU]",
                        error
                    );
                });

            return safeReply(
                message,
                "STFU ENABLED",
                [
                    `${target} is now muted.`,
                    "",
                    "They stay muted until:",
                    "`-vc unstfu @user`"
                ].join("\n"),
                "success"
            );
        }

        // ----------------------------------------------------
        // UNSTFU
        // ----------------------------------------------------

        if (
            sub === "unstfu"
        ) {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return safeReply(
                    message,
                    "VC UNSTFU",
                    "Usage: `-vc unstfu @user`",
                    "warning"
                );
            }

            data.stfu.delete(
                target.id
            );

            await target.voice
                .setMute(
                    false,
                    "VC+ STFU removed"
                )
                .catch(() => {});

            return safeReply(
                message,
                "STFU REMOVED",
                `${target} is no longer locked muted.`,
                "success"
            );
        }

        // ----------------------------------------------------
        // DRAGALL
        // ----------------------------------------------------

        if (
            sub === "dragall"
        ) {
            if (
                !isFounderFromId(
                    message.guild,
                    message.author.id
                )
            ) {
                return safeReply(
                    message,
                    "FOUNDER ONLY",
                    "`-vc dragall` is **Founder-only**.",
                    "error"
                );
            }

            let moved = 0;

            for (
                const member of
                message.guild.members.cache.values()
            ) {
                try {
                    if (
                        member.id ===
                        message.author.id
                    ) {
                        continue;
                    }

                    if (
                        !member.voice.channelId
                    ) {
                        continue;
                    }

                    if (
                        isProtected(
                            message.guild,
                            member.id
                        )
                    ) {
                        continue;
                    }

                    await member.voice
                        .setChannel(
                            channel,
                            "VC+ Founder dragall"
                        );

                    moved++;

                } catch (error) {
                    console.error(
                        "[DRAGALL]",
                        error
                    );
                }
            }

            return safeReply(
                message,
                "DRAGALL COMPLETE",
                `Moved **${moved}** eligible members.`,
                "success"
            );
        }

        return safeReply(
            message,
            "UNKNOWN VC COMMAND",
            `Unknown command: \`-vc ${sub}\`\nUse \`-vc\` for help.`,
            "error"
        );

    } catch (error) {
        console.error(
            "[VC COMMAND]",
            error
        );

        return safeReply(
            message,
            "COMMAND FAILED",
            "VC+ caught the error and stayed online.",
            "error"
        );
    }
}

// ============================================================
// INTERFACE COMMAND
// ============================================================

async function handleInterface(
    message
) {
    try {
        const owned =
            getOwnedVC(
                message.member
            );

        if (!owned) {
            return safeReply(
                message,
                "NO VC",
                "You must be inside your temporary VC.",
                "error"
            );
        }

        const sent =
            await sendVCInterface(
                owned.channel,
                owned.data
            );

        if (!sent) {
            return safeReply(
                message,
                "INTERFACE FAILED",
                "I couldn't send the interface into the voice channel chat.",
                "error"
            );
        }

        return safeReply(
            message,
            "INTERFACE READY",
            "The VC+ control panel was sent into your voice channel's built-in chat.",
            "success"
        );

    } catch (error) {
        console.error(
            "[INTERFACE]",
            error
        );

        return safeReply(
            message,
            "INTERFACE ERROR",
            "The bot stayed online, but the interface could not be sent.",
            "error"
        );
    }
}

// ============================================================
// RANK LIST
// ============================================================

async function rankList(
    message
) {
    return safeReply(
        message,
        "RANK SYSTEM",
        [
            "**10 • Founder**",
            "**9 • God**",
            "**8 • Owner**",
            "**7 • Co-Owner**",
            "**6 • Executive**",
            "**5 • Director**",
            "**4 • Admin**",
            "**3 • Moderator**",
            "**2 • Staff**",
            "**1 • Member**",
            "",
            "Founder/God receive special protection.",
            "",
            "These are VC+ bot ranks."
        ].join("\n")
    );
}

// ============================================================
// RANK COMMAND
// ============================================================

async function rankCommand(
    message,
    args
) {
    if (
        !isFounderFromId(
            message.guild,
            message.author.id
        )
    ) {
        return safeReply(
            message,
            "FOUNDER ONLY",
            "Only **Founder** can manage ranks.",
            "error"
        );
    }

    const target =
        await getTarget(
            message,
            args[0]
        );

    const rank =
        String(
            args[1] ||
            ""
        )
            .toLowerCase()
            .replace(
                /[^a-z]/g,
                ""
            );

    if (
        !target ||
        !RANK_LEVEL[rank]
    ) {
        return safeReply(
            message,
            "RANK",
            [
                "`-rank @user rank`",
                "",
                RANKS
                    .map(
                        r =>
                            `\`${r}\``
                    )
                    .join(" • ")
            ].join("\n"),
            "warning"
        );
    }

    if (
        target.id ===
            message.guild.ownerId &&
        rank !== "founder"
    ) {
        return safeReply(
            message,
            "PROTECTED",
            "The server owner cannot receive a lower rank.",
            "error"
        );
    }

    guildData(
        message.guild.id
    ).ranks[
        target.id
    ] = rank;

    queueSave();

    return safeReply(
        message,
        "RANK UPDATED",
        `${target} is now **${rank}**.`,
        "success"
    );
}

// ============================================================
// GODMODE
// ============================================================

async function godmodeCommand(
    message,
    args
) {
    if (
        !isFounderFromId(
            message.guild,
            message.author.id
        )
    ) {
        return safeReply(
            message,
            "FOUNDER ONLY",
            "Only **Founder** can manage Godmode.",
            "error"
        );
    }

    const action =
        String(
            args.shift() ||
            ""
        ).toLowerCase();

    const target =
        await getTarget(
            message,
            args[0]
        );

    if (
        !["on", "off"].includes(
            action
        )
    ) {
        return safeReply(
            message,
            "GODMODE",
            [
                "`-godmode on @user`",
                "`-godmode off @user`"
            ].join("\n"),
            "warning"
        );
    }

    if (!target) {
        return safeReply(
            message,
            "GODMODE",
            "Specify a member.",
            "warning"
        );
    }

    if (
        !isProtected(
            message.guild,
            target.id
        )
    ) {
        return safeReply(
            message,
            "PROTECTED RANK REQUIRED",
            "Godmode can only be assigned to Founder or God.",
            "error"
        );
    }

    const g =
        guildData(
            message.guild.id
        );

    g.godmode[
        target.id
    ] =
        action === "on";

    queueSave();

    return safeReply(
        message,
        "GODMODE UPDATED",
        [
            `${target} Godmode: **${
                action === "on"
                    ? "ON"
                    : "OFF"
            }**`,
            "",
            "Voice mute protection is active."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// BAN
// ============================================================

async function banCommand(
    message,
    args
) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        return safeReply(
            message,
            "PERMISSION DENIED",
            "You need **Ban Members**.",
            "error"
        );
    }

    const target =
        await getTarget(
            message,
            args[0]
        );

    if (
        !target
    ) {
        return safeReply(
            message,
            "BAN",
            "Usage: `-ban @user reason`",
            "warning"
        );
    }

    if (
        !canModerate(
            message,
            target
        )
    ) {
        return safeReply(
            message,
            "PROTECTED",
            "You cannot ban that member.",
            "error"
        );
    }

    const reason =
        args
            .slice(1)
            .join(" ")
            .trim() ||
        "No reason provided";

    try {
        await target.ban({
            reason:
                `VC+ | ${reason}`
        });

    } catch (error) {
        console.error(
            "[BAN]",
            error
        );

        return safeReply(
            message,
            "BAN FAILED",
            "Discord rejected the ban. Check role hierarchy.",
            "error"
        );
    }

    return safeReply(
        message,
        "BANNED",
        [
            `${target.user.tag} was banned.`,
            "",
            `Reason: ${reason}`
        ].join("\n"),
        "success"
    );
}

// ============================================================
// FOREVER BAN
// ============================================================

async function foreverBan(
    message,
    args
) {
    if (
        !isGodFromId(
            message.guild,
            message.author.id
        )
    ) {
        return safeReply(
            message,
            "PROTECTED COMMAND",
            "`-foreverban` requires Founder or God.",
            "error"
        );
    }

    const target =
        await getTarget(
            message,
            args[0]
        );

    if (!target) {
        return safeReply(
            message,
            "FOREVER BAN",
            "Usage: `-foreverban @user`",
            "warning"
        );
    }

    if (
        target.id ===
        message.guild.ownerId
    ) {
        return safeReply(
            message,
            "PROTECTED",
            "The server owner cannot be forever banned.",
            "error"
        );
    }

    const g =
        guildData(
            message.guild.id
        );

    if (
        !g.foreverBanned.includes(
            target.id
        )
    ) {
        g.foreverBanned.push(
            target.id
        );
    }

    queueSave();

    await target.ban({
        reason:
            "VC+ permanent ban"
    }).catch(error => {
        console.error(
            "[FOREVER BAN]",
            error
        );
    });

    return safeReply(
        message,
        "FOREVER BANNED",
        `${target.user.tag} is now on the permanent ban list.`,
        "success"
    );
}

// ============================================================
// HELP
// ============================================================

async function helpCommand(
    message
) {
    return safeReply(
        message,
        "HELP",
        [
            "**GENERAL**",
            "`-help`",
            "`-ping`",
            "`-ranklist`",
            "`-interface`",
            "",
            "**VC+**",
            "`-vc setup`",
            "`-vc kick @user`",
            "`-vc ban @user`",
            "`-vc reject @user`",
            "`-vc permit @user`",
            "`-vc lock`",
            "`-vc unlock`",
            "`-vc limit 10`",
            "`-vc rename name`",
            "`-vc transfer @user`",
            "`-vc stfu @user`",
            "`-vc unstfu @user`",
            "`-vc dragall`",
            "",
            "**SECURITY**",
            "`-godmode on @user`",
            "`-godmode off @user`",
            "",
            "**MODERATION**",
            "`-ban @user reason`",
            "`-kick @user reason`",
            "`-timeout @user minutes`",
            "`-untimeout @user`",
            "`-foreverban @user`"
        ].join("\n")
    );
}

// ============================================================
// BUTTON / INTERFACE HANDLER
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isButton() &&
                !interaction.isStringSelectMenu()
            ) {
                return;
            }

            const guild =
                interaction.guild;

            if (!guild) {
                return;
            }

            const member =
                await guild.members
                    .fetch(
                        interaction.user.id
                    )
                    .catch(() => null);

            if (!member) {
                return;
            }

            const owned =
                getOwnedVC(
                    member
                );

            if (!owned) {
                return interaction.reply({
                    embeds: [
                        box(
                            "NO VC",
                            "You must be inside your VC+ call.",
                            "error"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

            if (
                !canControlVC(
                    {
                        guild,
                        author: interaction.user
                    },
                    owned.data
                )
            ) {
                return interaction.reply({
                    embeds: [
                        box(
                            "ACCESS DENIED",
                            "Only the VC owner, Founder, or God can use this interface.",
                            "error"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

            const {
                channel,
                data
            } = owned;

            // LOCK
            if (
                interaction.customId ===
                "vcplus_lock"
            ) {
                await channel.permissionOverwrites
                    .edit(
                        guild.roles.everyone,
                        {
                            Connect: false
                        }
                    )
                    .catch(() => {});

                data.locked = true;

                return interaction.reply({
                    embeds: [
                        box(
                            "VC LOCKED",
                            "The call is now locked.",
                            "success"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

            // UNLOCK
            if (
                interaction.customId ===
                "vcplus_unlock"
            ) {
                await channel.permissionOverwrites
                    .edit(
                        guild.roles.everyone,
                        {
                            Connect: true
                        }
                    )
                    .catch(() => {});

                data.locked = false;

                return interaction.reply({
                    embeds: [
                        box(
                            "VC UNLOCKED",
                            "The call is open again.",
                            "success"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

            // REFRESH
            if (
                interaction.customId ===
                "vcplus_refresh"
            ) {
                await sendVCInterface(
                    channel,
                    data
                );

                return interaction.reply({
                    embeds: [
                        box(
                            "REFRESHED",
                            "A fresh VC+ interface was posted in this call.",
                            "success"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

            // STFU SELECT
            if (
                interaction.customId ===
                "vcplus_stfu_select"
            ) {
                const targetId =
                    interaction.values?.[0];

                if (!targetId) {
                    return interaction.reply({
                        content:
                            "No member selected.",
                        ephemeral: true
                    }).catch(() => {});
                }

                const target =
                    guild.members.cache.get(
                        targetId
                    );

                if (!target) {
                    return interaction.reply({
                        content:
                            "Member not found.",
                        ephemeral: true
                    }).catch(() => {});
                }

                if (
                    isProtected(
                        guild,
                        target.id
                    )
                ) {
                    return interaction.reply({
                        embeds: [
                            box(
                                "PROTECTED",
                                "Founder and God cannot be VC-STFU'd.",
                                "error"
                            )
                        ],
                        ephemeral: true
                    }).catch(() => {});
                }

                if (
                    target.voice.channelId !==
                    channel.id
                ) {
                    return interaction.reply({
                        content:
                            "That member left the VC.",
                        ephemeral: true
                    }).catch(() => {});
                }

                data.stfu.add(
                    target.id
                );

                await target.voice
                    .setMute(
                        true,
                        "VC+ interface STFU"
                    )
                    .catch(() => {});

                return interaction.reply({
                    embeds: [
                        box(
                            "STFU ENABLED",
                            `${target} is now locked muted until unstfu.`,
                            "success"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }

        } catch (error) {
            console.error(
                "[INTERACTION]",
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    embeds: [
                        box(
                            "ERROR",
                            "The interface failed safely.",
                            "error"
                        )
                    ],
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ============================================================
// MESSAGE ROUTER
// ============================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                !message.guild ||
                message.author.bot
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

            const parts =
                message.content
                    .slice(
                        PREFIX.length
                    )
                    .trim()
                    .split(/\s+/);

            const command =
                String(
                    parts.shift() ||
                    ""
                ).toLowerCase();

            if (!command) {
                return;
            }

            if (
                command === "help"
            ) {
                return helpCommand(
                    message
                );
            }

            if (
                command === "ping"
            ) {
                return safeReply(
                    message,
                    "PONG",
                    `Latency: **${client.ws.ping}ms**`,
                    "success"
                );
            }

            if (
                command === "interface"
            ) {
                return handleInterface(
                    message
                );
            }

            if (
                command === "vc"
            ) {
                return handleVC(
                    message,
                    parts
                );
            }

            if (
                command === "ranklist"
            ) {
                return rankList(
                    message
                );
            }

            if (
                command === "rank"
            ) {
                return rankCommand(
                    message,
                    parts
                );
            }

            if (
                command === "godmode"
            ) {
                return godmodeCommand(
                    message,
                    parts
                );
            }

            if (
                command === "ban"
            ) {
                return banCommand(
                    message,
                    parts
                );
            }

            if (
                command === "foreverban"
            ) {
                return foreverBan(
                    message,
                    parts
                );
            }

            // ------------------------------------------------
            // KICK
            // ------------------------------------------------

            if (
                command === "kick"
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.KickMembers
                    )
                ) {
                    return safeReply(
                        message,
                        "PERMISSION DENIED",
                        "You need **Kick Members**.",
                        "error"
                    );
                }

                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                if (
                    !target ||
                    !canModerate(
                        message,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        "KICK FAILED",
                        "That member cannot be kicked.",
                        "error"
                    );
                }

                await target
                    .kick(
                        parts
                            .slice(1)
                            .join(" ") ||
                        "VC+ kick"
                    )
                    .catch(() => {});

                return safeReply(
                    message,
                    "KICKED",
                    `${target.user.tag} was kicked.`,
                    "success"
                );
            }

            // ------------------------------------------------
            // TIMEOUT
            // ------------------------------------------------

            if (
                command === "timeout"
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return safeReply(
                        message,
                        "PERMISSION DENIED",
                        "You need **Moderate Members**.",
                        "error"
                    );
                }

                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                const minutes =
                    Number(
                        parts[1]
                    );

                if (
                    !target ||
                    !Number.isFinite(
                        minutes
                    ) ||
                    minutes <= 0 ||
                    !canModerate(
                        message,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        "TIMEOUT",
                        "Usage: `-timeout @user minutes`",
                        "warning"
                    );
                }

                const duration =
                    Math.min(
                        minutes,
                        40320
                    ) *
                    60 *
                    1000;

                await target
                    .timeout(
                        duration,
                        "VC+ timeout"
                    )
                    .catch(() => {});

                return safeReply(
                    message,
                    "TIMED OUT",
                    `${target.user.tag} was timed out for **${minutes} minute(s)**.`,
                    "success"
                );
            }

            // ------------------------------------------------
            // UNTIMEOUT
            // ------------------------------------------------

            if (
                command === "untimeout"
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return safeReply(
                        message,
                        "PERMISSION DENIED",
                        "You need **Moderate Members**.",
                        "error"
                    );
                }

                const target =
                    await getTarget(
                        message,
                        parts[0]
                    );

                if (!target) {
                    return safeReply(
                        message,
                        "UNTIMEOUT",
                        "Usage: `-untimeout @user`",
                        "warning"
                    );
                }

                if (
                    !canModerate(
                        message,
                        target
                    )
                ) {
                    return safeReply(
                        message,
                        "PROTECTED",
                        "You cannot remove the timeout from that member.",
                        "error"
                    );
                }

                await target
                    .timeout(
                        null,
                        "VC+ untimeout"
                    )
                    .catch(() => {});

                return safeReply(
                    message,
                    "UNTIMEOUT",
                    `${target.user.tag} is no longer timed out.`,
                    "success"
                );
            }

            return safeReply(
                message,
                "UNKNOWN COMMAND",
                [
                    `I don't recognize \`${PREFIX}${command}\`.`,
                    "",
                    "Use `-help`."
                ].join("\n"),
                "error"
            );

        } catch (error) {
            console.error(
                "[MESSAGE ROUTER]",
                error
            );

            await safeReply(
                message,
                "COMMAND ERROR",
                "The command failed safely. VC+ stayed online.",
                "error"
            );
        }
    }
);

// ============================================================
// ANTI-NUKE HELPERS
// ============================================================

function isTrustedUser(
    guild,
    userId
) {
    return (
        guild.ownerId ===
            userId ||
        getRank(
            guild,
            userId
        ) === "founder"
    );
}

function dangerousRolePermissions(
    permissions
) {
    const dangerous = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.MentionEveryone
    ];

    return dangerous.some(
        permission =>
            permissions.has(
                permission
            )
    );
}

async function removeDangerousPermissions(
    role
) {
    try {
        if (
            !role ||
            role.managed
        ) {
            return false;
        }

        if (
            role.id ===
            role.guild.id
        ) {
            return false;
        }

        const clean =
            role.permissions
                .remove(
                    [
                        PermissionFlagsBits.Administrator,
                        PermissionFlagsBits.ManageGuild,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageRoles,
                        PermissionFlagsBits.ManageWebhooks,
                        PermissionFlagsBits.BanMembers,
                        PermissionFlagsBits.KickMembers,
                        PermissionFlagsBits.ModerateMembers
                    ]
                );

        await role.setPermissions(
            clean,
            "VC+ anti-nuke protection"
        );

        return true;

    } catch (error) {
        console.error(
            "[REMOVE DANGEROUS PERMISSIONS]",
            error
        );

        return false;
    }
}

// ============================================================
// AUDIT LOG EXECUTOR
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
                    item.target?.id ===
                        targetId &&
                    Date.now() -
                        item.createdTimestamp <
                        15000
            );

        return entry?.executor ??
            null;

    } catch (error) {
        console.error(
            "[AUDIT LOG]",
            error
        );

        return null;
    }
}

// ============================================================
// ANTI-NUKE
// ============================================================

async function handleUnauthorizedAction(
    guild,
    executor,
    action
) {
    try {
        if (!executor) {
            return;
        }

        if (
            isTrustedUser(
                guild,
                executor.id
            )
        ) {
            return;
        }

        console.warn(
            `[ANTI-NUKE] ${executor.tag} -> ${action}`
        );

        const member =
            await guild.members
                .fetch(
                    executor.id
                )
                .catch(() => null);

        if (!member) {
            return;
        }

        // Remove dangerous permissions
        // from roles the user controls.
        for (
            const role of
            member.roles.cache.values()
        ) {
            if (
                role.managed
            ) {
                continue;
            }

            if (
                dangerousRolePermissions(
                    role.permissions
                )
            ) {
                await removeDangerousPermissions(
                    role
                );
            }
        }

        // Do not attempt to punish the server owner.
        if (
            executor.id ===
            guild.ownerId
        ) {
            return;
        }

        // Kick unauthorized account
        // if the bot has sufficient hierarchy.
        if (
            member.kickable
        ) {
            await member
                .kick(
                    `VC+ anti-nuke: ${action}`
                )
                .catch(error => {
                    console.error(
                        "[ANTI-NUKE KICK]",
                        error
                    );
                });
        }

    } catch (error) {
        console.error(
            "[ANTI-NUKE ACTION]",
            error
        );
    }
}

// ============================================================
// ROLE CREATE
// ============================================================

client.on(
    "roleCreate",
    async role => {
        try {
            const guild =
                role.guild;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleCreate,
                    role.id
                );

            if (
                !executor ||
                isTrustedUser(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            if (
                dangerousRolePermissions(
                    role.permissions
                )
            ) {
                await role
                    .delete(
                        "VC+ anti-nuke unauthorized dangerous role"
                    )
                    .catch(() => {});
            }

            await handleUnauthorizedAction(
                guild,
                executor,
                "unauthorized role creation"
            );

        } catch (error) {
            console.error(
                "[ROLE CREATE]",
                error
            );
        }
    }
);

// ============================================================
// ROLE DELETE
// ============================================================

client.on(
    "roleDelete",
    async role => {
        try {
            const guild =
                role.guild;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleDelete,
                    role.id
                );

            await handleUnauthorizedAction(
                guild,
                executor,
                "role deletion"
            );

        } catch (error) {
            console.error(
                "[ROLE DELETE]",
                error
            );
        }
    }
);

// ============================================================
// CHANNEL CREATE
// ============================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const executor =
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate,
                    channel.id
                );

            if (
                !executor ||
                isTrustedUser(
                    channel.guild,
                    executor.id
                )
            ) {
                return;
            }

            // Remove unauthorized channels.
            await channel
                .delete(
                    "VC+ anti-nuke unauthorized channel"
                )
                .catch(() => {});

            await handleUnauthorizedAction(
                channel.guild,
                executor,
                "unauthorized channel creation"
            );

        } catch (error) {
            console.error(
                "[CHANNEL CREATE]",
                error
            );
        }
    }
);

// ============================================================
// CHANNEL DELETE
// ============================================================

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const executor =
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete,
                    channel.id
                );

            await handleUnauthorizedAction(
                channel.guild,
                executor,
                "channel deletion"
            );

        } catch (error) {
            console.error(
                "[CHANNEL DELETE]",
                error
            );
        }
    }
);

// ============================================================
// ROLE UPDATE
// ============================================================

client.on(
    "roleUpdate",
    async (
        oldRole,
        newRole
    ) => {
        try {
            const guild =
                newRole.guild;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleUpdate,
                    newRole.id
                );

            if (
                !executor ||
                isTrustedUser(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            if (
                dangerousRolePermissions(
                    newRole.permissions
                )
            ) {
                await newRole.setPermissions(
                    oldRole.permissions,
                    "VC+ anti-nuke restore"
                ).catch(() => {});
            }

            await handleUnauthorizedAction(
                guild,
                executor,
                "unauthorized role permission change"
            );

        } catch (error) {
            console.error(
                "[ROLE UPDATE]",
                error
            );
        }
    }
);

// ============================================================
// GUILD UPDATE
// ============================================================

client.on(
    "guildUpdate",
    async (
        oldGuild,
        newGuild
    ) => {
        try {
            const executor =
                await getRecentExecutor(
                    newGuild,
                    AuditLogEvent.GuildUpdate,
                    newGuild.id
                );

            if (
                !executor ||
                isTrustedUser(
                    newGuild,
                    executor.id
                )
            ) {
                return;
            }

            // Restore important server metadata.
            const changes = {};

            if (
                oldGuild.name !==
                newGuild.name
            ) {
                changes.name =
                    oldGuild.name;
            }

            if (
                oldGuild.verificationLevel !==
                newGuild.verificationLevel
            ) {
                changes.verificationLevel =
                    oldGuild.verificationLevel;
            }

            if (
                Object.keys(changes)
                    .length
            ) {
                await newGuild
                    .edit(
                        changes,
                        "VC+ anti-nuke restore"
                    )
                    .catch(() => {});
            }

            await handleUnauthorizedAction(
                newGuild,
                executor,
                "unauthorized server modification"
            );

        } catch (error) {
            console.error(
                "[GUILD UPDATE]",
                error
            );
        }
    }
);

// ============================================================
// VOICE STATE
// ============================================================

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

            const g =
                guildData(
                    guild.id
                );

            // ------------------------------------------------
            // JOIN TO CREATE
            // ------------------------------------------------

            if (
                newState.channelId &&
                newState.channelId ===
                    g.jtc.triggerId
            ) {
                await createPersonalVC(
                    newState.member,
                    newState.channel
                );

                return;
            }

            // ------------------------------------------------
            // PERSONAL VC
            // ------------------------------------------------

            if (
                newState.channelId
            ) {
                const data =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (data) {
                    const member =
                        newState.member;

                    if (!member) {
                        return;
                    }

                    const userId =
                        member.id;

                    // VC BAN / REJECT
                    if (
                        data.banned.has(
                            userId
                        ) ||
                        data.rejected.has(
                            userId
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ access denied"
                            )
                            .catch(() => {});

                        return;
                    }

                    // PROTECTED MEMBERS
                    if (
                        isProtected(
                            guild,
                            userId
                        )
                    ) {
                        await member.voice
                            .setMute(
                                false,
                                "VC+ protected rank"
                            )
                            .catch(() => {});
                    }

                    // STFU
                    if (
                        data.stfu.has(
                            userId
                        ) &&
                        !isProtected(
                            guild,
                            userId
                        )
                    ) {
                        await member.voice
                            .setMute(
                                true,
                                "VC+ STFU"
                            )
                            .catch(() => {});
                    }
                }
            }

            // ------------------------------------------------
            // SERVER MUTE PROTECTION
            // ------------------------------------------------

            if (
                newState.serverMute &&
                newState.member
            ) {
                const userId =
                    newState.member.id;

                const protectedRank =
                    isProtected(
                        guild,
                        userId
                    );

                const godmode =
                    g.godmode[
                        userId
                    ] === true;

                if (
                    protectedRank ||
                    godmode
                ) {
                    await newState.member.voice
                        .setMute(
                            false,
                            "VC+ protection"
                        )
                        .catch(() => {});
                }
            }

            // ------------------------------------------------
            // CLEAN EMPTY PERSONAL VC
            // ------------------------------------------------

            if (
                oldState.channelId
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (!oldChannel) {
                    return;
                }

                const data =
                    temporaryVCs.get(
                        oldChannel.id
                    );

                if (!data) {
                    return;
                }

                if (
                    oldChannel.members.size ===
                    0
                ) {
                    temporaryVCs.delete(
                        oldChannel.id
                    );

                    await oldChannel
                        .delete(
                            "VC+ empty personal VC"
                        )
                        .catch(() => {});
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
// FOREVER BAN
// ============================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const g =
                guildData(
                    member.guild.id
                );

            if (
                g.foreverBanned.includes(
                    member.id
                )
            ) {
                await member
                    .ban({
                        reason:
                            "VC+ permanent ban list"
                    })
                    .catch(error => {
                        console.error(
                            "[AUTO BAN]",
                            error
                        );
                    });
            }

        } catch (error) {
            console.error(
                "[MEMBER ADD]",
                error
            );
        }
    }
);

// ============================================================
// STARTUP SECURITY SCAN
// ============================================================

async function securityScan(
    guild
) {
    try {
        await guild.roles.fetch();

        for (
            const role of
            guild.roles.cache.values()
        ) {
            if (
                role.managed ||
                role.id ===
                    guild.id
            ) {
                continue;
            }

            // Do not touch Founder-controlled roles.
            // Only strip dangerous permissions from
            // suspicious roles if the bot can manage them.
            if (
                role.permissions.has(
                    PermissionFlagsBits.Administrator
                ) &&
                role.position <
                    guild.members.me.roles.highest.position
            ) {
                // We intentionally do NOT blindly
                // remove Administrator from every
                // existing role on startup.
                //
                // Existing server roles may be legitimate.
                continue;
            }
        }

    } catch (error) {
        console.error(
            "[SECURITY SCAN]",
            error
        );
    }
}

// ============================================================
// READY
// ============================================================

client.once(
    "ready",
    async () => {
        console.log(
            "======================================"
        );

        console.log(
            "♡ VC+ IS ONLINE"
        );

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        console.log(
            "Anti-nuke: ACTIVE"
        );

        console.log(
            "VC protection: ACTIVE"
        );

        console.log(
            "Godmode protection: ACTIVE"
        );

        console.log(
            "======================================"
        );

        try {
            client.user.setPresence({
                status:
                    "online",

                activities: [
                    {
                        name:
                            "VC+ | -help",
                        type:
                            ActivityType.Watching
                    }
                ]
            });
        } catch (error) {
            console.error(
                "[PRESENCE]",
                error
            );
        }

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            await securityScan(
                guild
            );
        }
    }
);

// ============================================================
// GLOBAL ERROR PROTECTION
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
    "shardError",
    error => {
        console.error(
            "[SHARD ERROR]",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[DISCORD WARNING]",
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
    }
);

// ============================================================
// LOGIN
// ============================================================

const token =
    process.env.DISCORD_TOKEN;

if (!token) {
    console.error(
        "ERROR: DISCORD_TOKEN is missing."
    );

    console.error(
        "Create a .env file with:"
    );

    console.error(
        "DISCORD_TOKEN=your_bot_token"
    );

    process.exit(1);
}

client.login(
    token
).catch(error => {
    console.error(
        "[LOGIN ERROR]",
        error
    );

    process.exit(1);
});
