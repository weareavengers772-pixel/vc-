import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder
} from "discord.js";

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import "dotenv/config";

// ============================================================
// VC+
// Stable one-file Discord bot
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

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
        GatewayIntentBits.GuildModeration
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
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

let db = {
    guilds: {}
};

function saveDB() {
    try {
        const tempFile = `${DB_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(db, null, 2),
            "utf8"
        );

        fs.renameSync(
            tempFile,
            DB_FILE
        );
    } catch (error) {
        console.error("[DATABASE SAVE ERROR]", error);
    }
}

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            saveDB();
            return;
        }

        const raw = fs.readFileSync(
            DB_FILE,
            "utf8"
        );

        const parsed = JSON.parse(raw);

        if (
            parsed &&
            typeof parsed === "object" &&
            parsed.guilds &&
            typeof parsed.guilds === "object"
        ) {
            db = parsed;
        } else {
            db = {
                guilds: {}
            };
        }

    } catch (error) {
        console.error("[DATABASE LOAD ERROR]", error);

        db = {
            guilds: {}
        };
    }
}

loadDB();

// ============================================================
// RANKS
// Bot-only ranks.
// NO Discord roles are created.
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

function guildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            foreverBanned: [],
            vouches: {},
            vouchLimit: 1,

            jtc: {
                categoryId: null,
                triggerId: null
            }
        };
    }

    const g = db.guilds[guildId];

    if (!g.ranks) g.ranks = {};
    if (!Array.isArray(g.foreverBanned)) {
        g.foreverBanned = [];
    }
    if (!g.vouches) g.vouches = {};
    if (!Number.isInteger(g.vouchLimit)) {
        g.vouchLimit = 1;
    }

    if (!g.jtc) {
        g.jtc = {
            categoryId: null,
            triggerId: null
        };
    }

    return g;
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(guild, userId) {
    return (
        guildData(guild.id).ranks[userId] ||
        "member"
    );
}

function rankLevel(guild, userId) {
    return (
        RANK_LEVEL[
            getRank(guild, userId)
        ] || 1
    );
}

function isFounder(message) {
    if (!message.guild) return false;

    return (
        message.guild.ownerId ===
            message.author.id ||
        getRank(
            message.guild,
            message.author.id
        ) === "founder"
    );
}

function isGod(message) {
    return (
        isFounder(message) ||
        getRank(
            message.guild,
            message.author.id
        ) === "god"
    );
}

function hasBotRank(message, level) {
    if (!message.guild) return false;

    return (
        rankLevel(
            message.guild,
            message.author.id
        ) >= level
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
    const colors = {
        info: 0x5865f2,
        success: 0x57f287,
        error: 0xed4245,
        warning: 0xfee75c
    };

    return new EmbedBuilder()
        .setTitle(
            `${BOT_NAME} • ${title}`
        )
        .setDescription(
            description
        )
        .setColor(
            colors[type] ??
            colors.info
        )
        .setTimestamp();
}

async function sendBox(
    message,
    title,
    description,
    type = "info"
) {
    try {
        return await message.reply({
            embeds: [
                box(
                    title,
                    description,
                    type
                )
            ]
        });
    } catch (error) {
        console.error(
            "[SEND BOX ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// MEMBER HELPERS
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

        const id = value
            .replace(/[<@!>]/g, "");

        if (
            !/^\d{15,25}$/.test(id)
        ) {
            return null;
        }

        return await message.guild.members
            .fetch(id)
            .catch(() => null);

    } catch {
        return null;
    }
}

function canModerate(
    message,
    target
) {
    if (!target) {
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

    const executorLevel =
        rankLevel(
            message.guild,
            message.author.id
        );

    const targetLevel =
        rankLevel(
            message.guild,
            target.id
        );

    return targetLevel < executorLevel;
}

// ============================================================
// TEMPORARY VC STORAGE
// ============================================================

const temporaryVCs = new Map();

function getOwnedVC(member) {
    if (
        !member ||
        !member.voice.channelId
    ) {
        return null;
    }

    const data =
        temporaryVCs.get(
            member.voice.channelId
        );

    if (!data) {
        return null;
    }

    const channel =
        member.guild.channels.cache.get(
            member.voice.channelId
        );

    if (!channel) {
        return null;
    }

    return {
        channel,
        data
    };
}

function isVCOwner(
    message,
    vc
) {
    if (!vc) return false;

    return (
        vc.data.ownerId ===
            message.author.id ||
        isGod(message)
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

async function createVCInterface(
    channel,
    ownerId
) {
    try {
        const guild =
            channel.guild;

        const existing =
            guild.channels.cache.find(
                c =>
                    c.type ===
                        ChannelType.GuildText &&
                    c.name ===
                        `vc-${channel.id}`
            );

        if (existing) {
            return existing;
        }

        const text =
            await guild.channels.create({
                name: `vc-${channel.id}`,
                type: ChannelType.GuildText,
                parent:
                    channel.parentId ?? null,

                permissionOverwrites: [
                    {
                        id:
                            guild.roles
                                .everyone.id,

                        deny: [
                            PermissionFlagsBits
                                .ViewChannel
                        ]
                    },

                    {
                        id: ownerId,

                        allow: [
                            PermissionFlagsBits
                                .ViewChannel,

                            PermissionFlagsBits
                                .SendMessages,

                            PermissionFlagsBits
                                .ReadMessageHistory
                        ]
                    }
                ],

                reason:
                    "VC+ temporary interface"
            });

        await text.send({
            embeds: [
                box(
                    "Voice Control",
                    [
                        `Owner: <@${ownerId}>`,
                        "",
                        "**VC COMMANDS**",
                        "",
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
                        "`-interface`",
                        "",
                        "**TIP**",
                        "Use `-vc` for the complete VC command list."
                    ].join("\n")
                )
            ]
        });

        return text;

    } catch (error) {
        console.error(
            "[VC INTERFACE ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// VC SETUP
// ============================================================

async function setupVC(message) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits
                    .ManageChannels
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
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
            return sendBox(
                message,
                "Already setup",
                "VC+ Join to Create is already configured.",
                "warning"
            );
        }

        const category =
            await message.guild.channels.create({
                name: "VC+",
                type:
                    ChannelType.GuildCategory,
                reason:
                    "VC+ setup"
            });

        const trigger =
            await message.guild.channels.create({
                name:
                    "Join to Create",
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

        saveDB();

        return sendBox(
            message,
            "Setup complete",
            [
                `Join **${trigger.name}** to create your personal VC.`,
                "",
                "Example:",
                `**${message.author.username} VC**`,
                "",
                "The bot will automatically move you into it.",
                "",
                "Your VC gets its own control chat."
            ].join("\n"),
            "success"
        );

    } catch (error) {
        console.error(
            "[VC SETUP ERROR]",
            error
        );

        return sendBox(
            message,
            "Setup failed",
            "I couldn't create the VC system. Check that the bot has **Manage Channels**, **Move Members**, **Mute Members**, and **Connect** permissions.",
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
        if (!member || !trigger) {
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

        // Check whether user already owns a VC.
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
                            "VC+ existing personal VC"
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
                .replace(/[^\w\s\-+]/g, "")
                .slice(0, 100) ||
            "Personal VC";

        const channel =
            await guild.channels.create({
                name: safeName,
                type:
                    ChannelType.GuildVoice,

                parent:
                    trigger.parentId ?? null,

                userLimit: 0,

                reason:
                    "VC+ Join to Create",

                permissionOverwrites: [
                    {
                        id:
                            guild.roles
                                .everyone.id,

                        allow: [
                            PermissionFlagsBits
                                .ViewChannel,

                            PermissionFlagsBits
                                .Connect
                        ]
                    },

                    {
                        id: member.id,

                        allow: [
                            PermissionFlagsBits
                                .ViewChannel,

                            PermissionFlagsBits
                                .Connect,

                            PermissionFlagsBits
                                .Speak,

                            PermissionFlagsBits
                                .MuteMembers,

                            PermissionFlagsBits
                                .MoveMembers
                        ]
                    }
                ]
            });

        temporaryVCs.set(
            channel.id,
            {
                guildId:
                    guild.id,

                ownerId:
                    member.id,

                banned: new Set(),
                rejected: new Set(),
                permitted: new Set(),
                stfu: new Set(),

                locked: false
            }
        );

        await createVCInterface(
            channel,
            member.id
        );

        await member.voice
            .setChannel(
                channel,
                "VC+ Join to Create"
            )
            .catch(() => {});

        return channel;

    } catch (error) {
        console.error(
            "[CREATE VC ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// VC COMMANDS
// ============================================================

async function handleVC(
    message,
    args
) {
    try {
        const sub =
            args.shift()
                ?.toLowerCase();

        // --------------------------------
        // VC HELP
        // --------------------------------

        if (!sub) {
            return sendBox(
                message,
                "VC Commands",
                [
                    "`-vc setup`",
                    "",
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
                    "`-vc dragall`"
                ].join("\n")
            );
        }

        // --------------------------------
        // SETUP
        // --------------------------------

        if (sub === "setup") {
            return setupVC(message);
        }

        const owned =
            getOwnedVC(
                message.member
            );

        if (!owned) {
            return sendBox(
                message,
                "No VC",
                "You must be inside a VC+ personal call.",
                "error"
            );
        }

        const {
            channel,
            data
        } = owned;

        if (
            !isVCOwner(
                message,
                owned
            )
        ) {
            return sendBox(
                message,
                "Access denied",
                "You don't control this call. Only the VC owner, God, or Founder can control it.",
                "error"
            );
        }

        // --------------------------------
        // KICK
        // --------------------------------

        if (sub === "kick") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC Kick",
                    "Usage: `-vc kick @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return sendBox(
                    message,
                    "Not in VC",
                    "That member isn't in your call.",
                    "error"
                );
            }

            if (
                !canModerate(
                    message,
                    target
                ) &&
                !isGod(message)
            ) {
                return sendBox(
                    message,
                    "Protected member",
                    "You cannot control a member with an equal or higher VC+ rank.",
                    "error"
                );
            }

            await target.voice
                .disconnect(
                    "VC+ kick"
                )
                .catch(() => {});

            return sendBox(
                message,
                "Member kicked",
                `${target} was removed from the call.`,
                "success"
            );
        }

        // --------------------------------
        // BAN
        // --------------------------------

        if (sub === "ban") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC Ban",
                    "Usage: `-vc ban @user`",
                    "warning"
                );
            }

            if (
                !canModerate(
                    message,
                    target
                ) &&
                !isGod(message)
            ) {
                return sendBox(
                    message,
                    "Protected member",
                    "You cannot VC-ban an equal or higher ranked member.",
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
                        "VC+ ban"
                    )
                    .catch(() => {});
            }

            return sendBox(
                message,
                "Member banned",
                `${target} can no longer join this VC.`,
                "success"
            );
        }

        // --------------------------------
        // REJECT
        // --------------------------------

        if (sub === "reject") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC Reject",
                    "Usage: `-vc reject @user`",
                    "warning"
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
                        "VC+ reject"
                    )
                    .catch(() => {});
            }

            return sendBox(
                message,
                "Member rejected",
                `${target} is rejected from this VC.`,
                "success"
            );
        }

        // --------------------------------
        // PERMIT
        // --------------------------------

        if (sub === "permit") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC Permit",
                    "Usage: `-vc permit @user`",
                    "warning"
                );
            }

            data.rejected.delete(
                target.id
            );

            data.banned.delete(
                target.id
            );

            data.permitted.add(
                target.id
            );

            return sendBox(
                message,
                "Member permitted",
                `${target} can now join your VC.`,
                "success"
            );
        }

        // --------------------------------
        // LOCK
        // --------------------------------

        if (sub === "lock") {
            await channel
                .permissionOverwrites
                .edit(
                    message.guild.roles
                        .everyone,
                    {
                        Connect: false
                    }
                )
                .catch(() => {});

            data.locked = true;

            return sendBox(
                message,
                "VC locked",
                "Your call is now locked.",
                "success"
            );
        }

        // --------------------------------
        // UNLOCK
        // --------------------------------

        if (sub === "unlock") {
            await channel
                .permissionOverwrites
                .edit(
                    message.guild.roles
                        .everyone,
                    {
                        Connect: true
                    }
                )
                .catch(() => {});

            data.locked = false;

            return sendBox(
                message,
                "VC unlocked",
                "Your call is now unlocked.",
                "success"
            );
        }

        // --------------------------------
        // LIMIT
        // --------------------------------

        if (sub === "limit") {
            const limit =
                Number(args[0]);

            if (
                !Number.isInteger(limit) ||
                limit < 0 ||
                limit > 99
            ) {
                return sendBox(
                    message,
                    "Invalid limit",
                    "Use a number from `0` to `99`.",
                    "error"
                );
            }

            await channel
                .setUserLimit(limit)
                .catch(() => {});

            return sendBox(
                message,
                "Limit updated",
                `VC limit: **${
                    limit === 0
                        ? "Unlimited"
                        : limit
                }**`,
                "success"
            );
        }

        // --------------------------------
        // RENAME
        // --------------------------------

        if (sub === "rename") {
            const name =
                args.join(" ")
                    .trim();

            if (!name) {
                return sendBox(
                    message,
                    "Rename",
                    "Usage: `-vc rename My VC`",
                    "warning"
                );
            }

            const finalName =
                name.slice(0, 100);

            await channel
                .setName(finalName)
                .catch(() => {});

            return sendBox(
                message,
                "VC renamed",
                `Your call is now **${finalName}**.`,
                "success"
            );
        }

        // --------------------------------
        // TRANSFER
        // --------------------------------

        if (sub === "transfer") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "Transfer",
                    "Usage: `-vc transfer @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return sendBox(
                    message,
                    "Not in VC",
                    "The new owner must be inside the VC.",
                    "warning"
                );
            }

            data.ownerId =
                target.id;

            await createVCInterface(
                channel,
                target.id
            );

            return sendBox(
                message,
                "Ownership transferred",
                `${target} is now the owner of this VC.`,
                "success"
            );
        }

        // --------------------------------
        // STFU
        // --------------------------------

        if (sub === "stfu") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC STFU",
                    "Usage: `-vc stfu @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return sendBox(
                    message,
                    "Not in VC",
                    "That member isn't in your call.",
                    "error"
                );
            }

            const targetRank =
                getRank(
                    message.guild,
                    target.id
                );

            if (
                targetRank === "founder" ||
                targetRank === "god"
            ) {
                return sendBox(
                    message,
                    "Protected member",
                    "Founder and God cannot be VC-STFU'd.",
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
                .catch(() => {});

            return sendBox(
                message,
                "Member muted",
                `${target} is now muted in this VC.`,
                "success"
            );
        }

        // --------------------------------
        // UNSTFU
        // --------------------------------

        if (sub === "unstfu") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC UnSTFU",
                    "Usage: `-vc unstfu @user`",
                    "warning"
                );
            }

            data.stfu.delete(
                target.id
            );

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .setMute(
                        false,
                        "VC+ unstfu"
                    )
                    .catch(() => {});
            }

            return sendBox(
                message,
                "Member unmuted",
                `${target} is no longer locked muted.`,
                "success"
            );
        }

        // --------------------------------
        // DRAG ALL
        // --------------------------------

        if (sub === "dragall") {
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

                    const memberRank =
                        rankLevel(
                            message.guild,
                            member.id
                        );

                    const executorRank =
                        rankLevel(
                            message.guild,
                            message.author.id
                        );

                    if (
                        memberRank >=
                        executorRank
                    ) {
                        continue;
                    }

                    await member.voice
                        .setChannel(
                            channel,
                            "VC+ dragall"
                        );

                    moved++;

                } catch {
                    // One failed move
                    // does not stop dragall.
                }
            }

            return sendBox(
                message,
                "Drag all",
                `Moved **${moved}** eligible members into your VC.`,
                "success"
            );
        }

        return sendBox(
            message,
            "Unknown VC command",
            `I don't recognize \`-vc ${sub}\`.\nUse \`-vc\` to see the commands.`,
            "error"
        );

    } catch (error) {
        console.error(
            "[VC COMMAND ERROR]",
            error
        );

        return sendBox(
            message,
            "VC error",
            "Something went wrong with that VC command. The bot recovered safely.",
            "error"
        );
    }
}

// ============================================================
// INTERFACE
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
            return sendBox(
                message,
                "No VC",
                "You must be inside your VC+ call.",
                "error"
            );
        }

        const text =
            await createVCInterface(
                owned.channel,
                owned.data.ownerId
            );

        if (!text) {
            return sendBox(
                message,
                "Interface error",
                "I couldn't create the VC control chat.",
                "error"
            );
        }

        return sendBox(
            message,
            "Interface ready",
            `Your VC control panel is in <#${text.id}>.`,
            "success"
        );

    } catch (error) {
        console.error(
            "[INTERFACE ERROR]",
            error
        );

        return sendBox(
            message,
            "Interface error",
            "Something went wrong while creating the interface.",
            "error"
        );
    }
}

// ============================================================
// HELP
// ============================================================

async function helpCommand(
    message
) {
    return sendBox(
        message,
        "Help",
        [
            "**GENERAL**",
            "`-help`",
            "`-ping`",
            "`-ranklist`",
            "`-interface`",
            "",
            "**MODERATION**",
            "`-kick @user reason`",
            "`-ban @user reason`",
            "`-timeout @user minutes`",
            "`-untimeout @user`",
            "`-foreverban @user`",
            "",
            "**VC+**",
            "`-vc`",
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
            "**BOT RANKS**",
            "`-ranklist`",
            "`-rank @user rank`",
            "",
            "**VOUCH**",
            "`-vouch add @user`",
            "`-vouch setlimit 3`"
        ].join("\n")
    );
}

// ============================================================
// RANK LIST
// ============================================================

async function rankList(
    message
) {
    const lines =
        RANKS.map(
            (rank, index) =>
                `**${10 - index}.** ${rank}`
        );

    return sendBox(
        message,
        "Rank List",
        [
            ...lines,
            "",
            "These are **VC+ bot ranks**.",
            "The bot does not create Discord roles for them."
        ].join("\n")
    );
}

// ============================================================
// SET RANK
// ============================================================

async function rankCommand(
    message,
    args
) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Permission denied",
            "Only **Founder** can manage VC+ bot ranks.",
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
            args[1] || ""
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
        return sendBox(
            message,
            "Rank",
            [
                "Usage:",
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
        return sendBox(
            message,
            "Protected",
            "The server owner must remain Founder.",
            "error"
        );
    }

    guildData(
        message.guild.id
    ).ranks[target.id] =
        rank;

    saveDB();

    return sendBox(
        message,
        "Rank updated",
        `${target} is now **${rank}** in VC+.\n\nNo Discord role was created.`,
        "success"
    );
}

// ============================================================
// VOUCH
// ============================================================

async function vouchCommand(
    message,
    args
) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Permission denied",
            "Only **Founder** can use the vouch system.",
            "error"
        );
    }

    const action =
        String(
            args[0] || ""
        ).toLowerCase();

    const g =
        guildData(
            message.guild.id
        );

    // --------------------------------
    // SET LIMIT
    // --------------------------------

    if (
        action === "setlimit"
    ) {
        const limit =
            Number(args[1]);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            return sendBox(
                message,
                "Invalid limit",
                "Use a whole number from `1` to `100`.",
                "warning"
            );
        }

        g.vouchLimit =
            limit;

        saveDB();

        return sendBox(
            message,
            "Vouch limit",
            `The required vouches are now **${limit}**.`,
            "success"
        );
    }

    // --------------------------------
    // ADD
    // --------------------------------

    if (
        action === "add"
    ) {
        const target =
            await getTarget(
                message,
                args[1]
            );

        if (!target) {
            return sendBox(
                message,
                "Vouch",
                "Usage: `-vouch add @user`",
                "warning"
            );
        }

        if (
            target.id ===
            message.author.id
        ) {
            return sendBox(
                message,
                "Vouch",
                "You cannot vouch for yourself.",
                "error"
            );
        }

        if (
            !g.vouches[target.id]
        ) {
            g.vouches[target.id] =
                0;
        }

        g.vouches[target.id]++;

        const count =
            g.vouches[target.id];

        let promoted = false;

        if (
            count >=
                g.vouchLimit &&
            rankLevel(
                message.guild,
                target.id
            ) < 9
        ) {
            // Second-highest bot rank.
            g.ranks[target.id] =
                "god";

            promoted = true;
        }

        saveDB();

        return sendBox(
            message,
            "Vouch added",
            [
                `${target} now has **${count}** vouch(es).`,
                `Required: **${g.vouchLimit}**`,
                "",
                promoted
                    ? "They reached the requirement and were promoted to **God**."
                    : "They have not reached the requirement yet."
            ].join("\n"),
            "success"
        );
    }

    return sendBox(
        message,
        "Vouch",
        [
            "`-vouch add @user`",
            "`-vouch setlimit 3`",
            "",
            `Current requirement: **${g.vouchLimit}**`
        ].join("\n"),
        "warning"
    );
}

// ============================================================
// BAN
// ============================================================

async function banCommand(
    message,
    args
) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.BanMembers
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Ban Members**.",
                "error"
            );
        }

        const target =
            await getTarget(
                message,
                args[0]
            );

        if (!target) {
            return sendBox(
                message,
                "Ban",
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
            return sendBox(
                message,
                "Protected member",
                "You cannot ban the server owner or an equal/higher VC+ rank.",
                "error"
            );
        }

        const reason =
            args
                .slice(1)
                .join(" ") ||
            "No reason provided";

        const success =
            await target.ban({
                reason:
                    `VC+ | ${reason}`
            })
            .then(() => true)
            .catch(() => false);

        if (!success) {
            return sendBox(
                message,
                "Ban failed",
                "Discord rejected the ban. Check my role hierarchy and Ban Members permission.",
                "error"
            );
        }

        return sendBox(
            message,
            "Member banned",
            `${target.user.tag} was banned.\n\nReason: ${reason}`,
            "success"
        );

    } catch (error) {
        console.error(
            "[BAN ERROR]",
            error
        );

        return sendBox(
            message,
            "Ban error",
            "The ban command failed safely.",
            "error"
        );
    }
}

// ============================================================
// FOREVER BAN
// ============================================================

async function foreverBan(
    message,
    args
) {
    try {
        if (!isGod(message)) {
            return sendBox(
                message,
                "Permission denied",
                "`-foreverban` is restricted to **Founder** and **God**.",
                "error"
            );
        }

        const target =
            await getTarget(
                message,
                args[0]
            );

        if (!target) {
            return sendBox(
                message,
                "Forever Ban",
                "Usage: `-foreverban @user`",
                "warning"
            );
        }

        if (
            target.id ===
            message.guild.ownerId
        ) {
            return sendBox(
                message,
                "Protected",
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

        saveDB();

        const success =
            await target.ban({
                reason:
                    "VC+ persistent ban"
            })
            .then(() => true)
            .catch(() => false);

        if (!success) {
            return sendBox(
                message,
                "Persistent ban saved",
                `${target.user.tag} was added to the persistent ban list, but Discord did not allow the current ban.`,
                "warning"
            );
        }

        return sendBox(
            message,
            "Forever banned",
            [
                `${target.user.tag} has been added to the persistent VC+ ban list.`,
                "",
                "If they leave and rejoin this server, VC+ will automatically ban them again.",
                "",
                "**Note:** Discord does not provide bots with member IP addresses, so this is a persistent user-ID ban rather than an IP ban."
            ].join("\n"),
            "success"
        );

    } catch (error) {
        console.error(
            "[FOREVER BAN ERROR]",
            error
        );

        return sendBox(
            message,
            "Forever ban error",
            "The command failed safely.",
            "error"
        );
    }
}

// ============================================================
// KICK
// ============================================================

async function kickCommand(
    message,
    args
) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.KickMembers
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Kick Members**.",
                "error"
            );
        }

        const target =
            await getTarget(
                message,
                args[0]
            );

        if (
            !target ||
            !canModerate(
                message,
                target
            )
        ) {
            return sendBox(
                message,
                "Protected member",
                "That member cannot be kicked.",
                "error"
            );
        }

        const reason =
            args
                .slice(1)
                .join(" ") ||
            "VC+ kick";

        await target.kick(
            reason
        );

        return sendBox(
            message,
            "Member kicked",
            `${target.user.tag} was kicked.`,
            "success"
        );

    } catch (error) {
        console.error(
            "[KICK ERROR]",
            error
        );

        return sendBox(
            message,
            "Kick error",
            "The kick failed safely.",
            "error"
        );
    }
}

// ============================================================
// TIMEOUT
// ============================================================

async function timeoutCommand(
    message,
    args
) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits
                    .ModerateMembers
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Moderate Members**.",
                "error"
            );
        }

        const target =
            await getTarget(
                message,
                args[0]
            );

        const minutes =
            Number(args[1]);

        if (
            !target ||
            !Number.isFinite(minutes) ||
            minutes <= 0 ||
            !canModerate(
                message,
                target
            )
        ) {
            return sendBox(
                message,
                "Timeout",
                "Usage: `-timeout @user minutes`",
                "warning"
            );
        }

        const safeMinutes =
            Math.min(
                minutes,
                40320
            );

        await target.timeout(
            safeMinutes *
                60 *
                1000,
            "VC+ timeout"
        );

        return sendBox(
            message,
            "Timed out",
            `${target.user.tag} was timed out for **${safeMinutes} minutes**.`,
            "success"
        );

    } catch (error) {
        console.error(
            "[TIMEOUT ERROR]",
            error
        );

        return sendBox(
            message,
            "Timeout error",
            "The timeout failed safely.",
            "error"
        );
    }
}

// ============================================================
// UNTIMEOUT
// ============================================================

async function untimeoutCommand(
    message,
    args
) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits
                    .ModerateMembers
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Moderate Members**.",
                "error"
            );
        }

        const target =
            await getTarget(
                message,
                args[0]
            );

        if (!target) {
            return sendBox(
                message,
                "Untimeout",
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
            return sendBox(
                message,
                "Protected member",
                "You cannot modify this member.",
                "error"
            );
        }

        await target.timeout(
            null,
            "VC+ untimeout"
        );

        return sendBox(
            message,
            "Timeout removed",
            `${target.user.tag} is no longer timed out.`,
            "success"
        );

    } catch (error) {
        console.error(
            "[UNTIMEOUT ERROR]",
            error
        );

        return sendBox(
            message,
            "Untimeout error",
            "The command failed safely.",
            "error"
        );
    }
}

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
                parts
                    .shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            switch (command) {
                case "help":
                    return helpCommand(
                        message
                    );

                case "ping":
                    return sendBox(
                        message,
                        "Pong",
                        `Latency: **${client.ws.ping}ms**`,
                        "success"
                    );

                case "interface":
                    return handleInterface(
                        message
                    );

                case "ranklist":
                    return rankList(
                        message
                    );

                case "rank":
                    return rankCommand(
                        message,
                        parts
                    );

                case "vouch":
                    return vouchCommand(
                        message,
                        parts
                    );

                case "vc":
                    return handleVC(
                        message,
                        parts
                    );

                case "ban":
                    return banCommand(
                        message,
                        parts
                    );

                case "foreverban":
                    return foreverBan(
                        message,
                        parts
                    );

                case "kick":
                    return kickCommand(
                        message,
                        parts
                    );

                case "timeout":
                    return timeoutCommand(
                        message,
                        parts
                    );

                case "untimeout":
                    return untimeoutCommand(
                        message,
                        parts
                    );

                default:
                    return sendBox(
                        message,
                        "Unknown command",
                        [
                            `I don't recognize \`${PREFIX}${command}\`.`,
                            "",
                            "Use `-help` to see the commands."
                        ].join("\n"),
                        "error"
                    );
            }

        } catch (error) {
            console.error(
                "[COMMAND ROUTER ERROR]",
                error
            );

            await sendBox(
                message,
                "Command error",
                "Something went wrong while processing that command. The bot recovered safely.",
                "error"
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

            // --------------------------------
            // JOIN TO CREATE
            // --------------------------------

            if (
                newState.channelId &&
                newState.channelId ===
                    g.jtc.triggerId
            ) {
                const created =
                    await createPersonalVC(
                        newState.member,
                        newState.channel
                    );

                if (!created) {
                    console.error(
                        "[JTC] Could not create VC"
                    );
                }

                return;
            }

            // --------------------------------
            // VC PROTECTION
            // --------------------------------

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

                    // VC BAN
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
                            .catch(
                                () => {}
                            );

                        return;
                    }

                    // GOD / FOUNDER PROTECTION
                    const rank =
                        getRank(
                            guild,
                            userId
                        );

                    if (
                        rank ===
                            "founder" ||
                        rank ===
                            "god"
                    ) {
                        await member.voice
                            .setMute(
                                false,
                                "VC+ protected rank"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    // STFU
                    if (
                        data.stfu.has(
                            userId
                        ) &&
                        rank !==
                            "founder" &&
                        rank !==
                            "god"
                    ) {
                        await member.voice
                            .setMute(
                                true,
                                "VC+ STFU"
                            )
                            .catch(
                                () => {}
                            );
                    }
                }
            }

            // --------------------------------
            // CLEAN EMPTY VC
            // --------------------------------

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

                if (
                    data &&
                    oldChannel.members.size ===
                        0
                ) {
                    temporaryVCs.delete(
                        oldChannel.id
                    );

                    const interfaceChannel =
                        guild.channels.cache.find(
                            c =>
                                c.type ===
                                    ChannelType.GuildText &&
                                c.name ===
                                    `vc-${oldChannel.id}`
                        );

                    if (
                        interfaceChannel
                    ) {
                        await interfaceChannel
                            .delete(
                                "VC+ empty VC cleanup"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    await oldChannel
                        .delete(
                            "VC+ empty VC cleanup"
                        )
                        .catch(
                            () => {}
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

// ============================================================
// GODMODE
// Automatically remove server mute from Founder/God.
// ============================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            if (
                !newState.member ||
                !newState.serverMute
            ) {
                return;
            }

            const rank =
                getRank(
                    newState.guild,
                    newState.id
                );

            if (
                rank !== "founder" &&
                rank !== "god"
            ) {
                return;
            }

            await newState.member.voice
                .setMute(
                    false,
                    "VC+ Godmode protection"
                )
                .catch(
                    () => {}
                );

        } catch (error) {
            console.error(
                "[GODMODE ERROR]",
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
                !g.foreverBanned.includes(
                    member.id
                )
            ) {
                return;
            }

            await member.ban({
                reason:
                    "VC+ persistent ban"
            }).catch(
                () => {}
            );

        } catch (error) {
            console.error(
                "[PERSISTENT BAN ERROR]",
                error
            );
        }
    }
);

// ============================================================
// SECURITY: MASS BAN DETECTION
// ============================================================

const banTracker = new Map();

client.on(
    "guildBanAdd",
    async ban => {
        try {
            const guild =
                ban.guild;

            const now =
                Date.now();

            const existing =
                banTracker.get(
                    guild.id
                ) || [];

            const recent =
                existing.filter(
                    timestamp =>
                        now -
                            timestamp <
                        10000
                );

            recent.push(now);

            banTracker.set(
                guild.id,
                recent
            );

            // If many bans happen
            // extremely quickly, log it.
            if (
                recent.length >= 5
            ) {
                console.warn(
                    `[SECURITY] Possible mass-ban event in ${guild.name}`
                );

                // Notify server owner if possible.
                const owner =
                    await guild.fetchOwner()
                        .catch(
                            () => null
                        );

                if (owner) {
                    await owner.send({
                        embeds: [
                            box(
                                "Security Alert",
                                [
                                    `Possible mass-ban activity detected in **${guild.name}**.`,
                                    "",
                                    `**${recent.length}** bans were detected within approximately 10 seconds.`,
                                    "",
                                    "Check your server Audit Log and administrator accounts."
                                ].join("\n"),
                                "warning"
                            )
                        ]
                    }).catch(
                        () => {}
                    );
                }

                // Reset after alert.
                banTracker.set(
                    guild.id,
                    []
                );
            }

        } catch (error) {
            console.error(
                "[BAN SECURITY ERROR]",
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
    () => {
        try {
            console.log(
                "================================"
            );

            console.log(
                "VC+ IS ONLINE"
            );

            console.log(
                `Logged in as ${client.user.tag}`
            );

            console.log(
                `Servers: ${client.guilds.cache.size}`
            );

            console.log(
                "================================"
            );

            client.user.setPresence({
                status: "online",

                activities: [
                    {
                        name:
                            "VC+ | -help",
                        type: 0
                    }
                ]
            });

        } catch (error) {
            console.error(
                "[READY ERROR]",
                error
            );
        }
    }
);

// ============================================================
// CLIENT ERROR PROTECTION
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
            "[DISCORD WARNING]",
            warning
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

// ============================================================
// PROCESS ERROR PROTECTION
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

// ============================================================
// LOGIN
// ============================================================

const token =
    process.env.DISCORD_TOKEN;

if (!token) {
    console.error(
        "ERROR: DISCORD_TOKEN is missing from .env"
    );

    process.exit(1);
}

client.login(token)
    .catch(error => {
        console.error(
            "[LOGIN ERROR]",
            error
        );

        process.exit(1);
    });
