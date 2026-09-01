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

// ============================================================
// VC+
// Stable single-file Discord bot
// Prefix: -
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

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("[DB SAVE]", error);
    }
}

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            saveDB();
            return;
        }

        const raw = fs.readFileSync(DB_FILE, "utf8");

        if (!raw.trim()) {
            db = { guilds: {} };
            saveDB();
            return;
        }

        const parsed = JSON.parse(raw);

        if (!parsed || typeof parsed !== "object") {
            db = { guilds: {} };
        } else {
            db = parsed;
            db.guilds ??= {};
        }
    } catch (error) {
        console.error("[DB LOAD]", error);
        db = { guilds: {} };
    }
}

loadDB();

// ============================================================
// RANK SYSTEM
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

            godmode: {},

            jtc: {
                categoryId: null,
                triggerId: null
            },

            protection: {
                enabled: true,
                actionWindow: 10000,
                maxActions: 4
            }
        };
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

    g.protection ??= {};
    g.protection.enabled ??= true;
    g.protection.actionWindow ??= 10000;
    g.protection.maxActions ??= 4;

    return g;
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(guild, userId) {
    return guildData(guild.id).ranks[userId] || "member";
}

function rankLevel(guild, userId) {
    return RANK_LEVEL[getRank(guild, userId)] || 1;
}

function isFounder(messageOrGuild, userId = null) {
    const guild =
        messageOrGuild?.guild ||
        messageOrGuild;

    const id =
        userId ||
        messageOrGuild?.author?.id;

    if (!guild || !id) {
        return false;
    }

    return (
        guild.ownerId === id ||
        getRank(guild, id) === "founder"
    );
}

function isGod(guild, userId) {
    return (
        isFounder(guild, userId) ||
        getRank(guild, userId) === "god"
    );
}

function isProtected(guild, userId) {
    return isGod(guild, userId);
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, type = "info") {
    const colors = {
        info: 0x111111,
        success: 0xff4fa3,
        error: 0xed4245,
        warning: 0xff8acb
    };

    return new EmbedBuilder()
        .setAuthor({
            name: "VC+"
        })
        .setTitle(`♡ ${title}`)
        .setDescription(description)
        .setColor(colors[type] ?? colors.info)
        .setFooter({
            text: "VC+ • secure voice management"
        })
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
        console.error("[SEND BOX]", error);
        return null;
    }
}

// ============================================================
// TARGET FINDER
// ============================================================

async function getTarget(message, value) {
    try {
        if (!message.guild || !value) {
            return null;
        }

        const mentioned =
            message.mentions.members.first();

        if (mentioned) {
            return mentioned;
        }

        const id = String(value)
            .replace(/[<@!>]/g, "");

        if (!/^\d{15,25}$/.test(id)) {
            return null;
        }

        return await message.guild.members
            .fetch(id)
            .catch(() => null);

    } catch (error) {
        console.error("[TARGET]", error);
        return null;
    }
}

// ============================================================
// MODERATION HIERARCHY
// ============================================================

function canModerate(message, target) {
    try {
        if (!message.guild || !target) {
            return false;
        }

        if (target.id === message.author.id) {
            return false;
        }

        if (target.id === message.guild.ownerId) {
            return false;
        }

        if (
            isProtected(
                message.guild,
                target.id
            )
        ) {
            return isGod(
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
// TEMPORARY VC MEMORY
// ============================================================

const temporaryVCs = new Map();

/*
channelId -> {
    guildId,
    ownerId,
    banned: Set,
    rejected: Set,
    permitted: Set,
    stfu: Set,
    locked,
    interfaceMessageId
}
*/

// ============================================================
// GET PERSONAL VC
// ============================================================

function getOwnedVC(member) {
    try {
        if (!member?.voice?.channelId) {
            return null;
        }

        const channel =
            member.guild.channels.cache.get(
                member.voice.channelId
            );

        if (!channel) {
            return null;
        }

        const data =
            temporaryVCs.get(channel.id);

        if (!data) {
            return null;
        }

        return {
            channel,
            data
        };
    } catch (error) {
        console.error("[GET VC]", error);
        return null;
    }
}

// ============================================================
// VC CONTROL
// ============================================================

function canControlVC(message, data) {
    if (!data) {
        return false;
    }

    return (
        data.ownerId === message.author.id ||
        isGod(
            message.guild,
            message.author.id
        )
    );
}

// ============================================================
// VC INTERFACE
// IMPORTANT:
// Sends directly into the voice channel's built-in chat.
// No separate text channel is created.
// ============================================================

async function createVCInterface(
    voiceChannel,
    data
) {
    try {
        if (!voiceChannel) {
            return null;
        }

        const embed = box(
            "Voice Control",
            [
                `**Owner**`,
                `<@${data.ownerId}>`,
                "",
                "╭───────────────╮",
                "**VC COMMANDS**",
                "╰───────────────╯",
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
                "",
                "**PROTECTION**",
                "Founder + God cannot be VC-STFU'd.",
                "Godmode protects against server voice mutes.",
                "",
                "Use `-interface` to repost this panel."
            ].join("\n"),
            "info"
        );

        const sent =
            await voiceChannel.send({
                embeds: [embed]
            }).catch(error => {
                console.error(
                    "[VC INTERFACE SEND]",
                    error
                );

                return null;
            });

        if (sent) {
            data.interfaceMessageId =
                sent.id;
        }

        return sent;

    } catch (error) {
        console.error(
            "[VC INTERFACE]",
            error
        );

        return null;
    }
}

// ============================================================
// SETUP JOIN TO CREATE
// ============================================================

async function setupVC(message) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ManageChannels
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Manage Channels** to set up VC+.",
                "error"
            );
        }

        return setupGuildVC(message.guild);

    } catch (error) {
        console.error("[SETUP VC]", error);

        return sendBox(
            message,
            "Setup failed",
            "VC+ could not finish setup. Make sure the bot has **Manage Channels** and **Move Members**.",
            "error"
        );
    }
}

// ============================================================
// ACTUAL GUILD SETUP
// ============================================================

async function setupGuildVC(guild) {
    try {
        const g = guildData(guild.id);

        let category =
            guild.channels.cache.get(
                g.jtc.categoryId
            );

        if (
            !category ||
            category.type !== ChannelType.GuildCategory
        ) {
            category =
                await guild.channels.create({
                    name: "VC+",
                    type: ChannelType.GuildCategory,
                    reason: "VC+ Join to Create"
                });

            g.jtc.categoryId =
                category.id;
        }

        let trigger =
            guild.channels.cache.get(
                g.jtc.triggerId
            );

        if (
            !trigger ||
            trigger.type !== ChannelType.GuildVoice
        ) {
            trigger =
                await guild.channels.create({
                    name: "Join to Create",
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    reason: "VC+ Join to Create"
                });

            g.jtc.triggerId =
                trigger.id;
        }

        saveDB();

        return {
            category,
            trigger
        };

    } catch (error) {
        console.error(
            "[GUILD VC SETUP]",
            error
        );

        return null;
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
            guildData(guild.id);

        if (
            trigger.id !==
            g.jtc.triggerId
        ) {
            return null;
        }

        // --------------------------------------------
        // Existing VC
        // --------------------------------------------

        for (
            const [
                channelId,
                data
            ] of temporaryVCs
        ) {
            if (
                data.guildId === guild.id &&
                data.ownerId === member.id
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

        // --------------------------------------------
        // Safe name
        // --------------------------------------------

        let safeName =
            `${member.user.username} VC`
                .replace(/[^\w\s\-+]/g, "")
                .trim()
                .slice(0, 90);

        if (!safeName) {
            safeName = "Personal VC";
        }

        // --------------------------------------------
        // Create
        // --------------------------------------------

        const channel =
            await guild.channels.create({
                name: safeName,
                type: ChannelType.GuildVoice,
                parent: trigger.parentId || null,
                userLimit: 0,
                reason: "VC+ Personal VC",

                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect
                        ]
                    }
                ]
            });

        const data = {
            guildId: guild.id,
            ownerId: member.id,

            banned: new Set(),
            rejected: new Set(),
            permitted: new Set(),
            stfu: new Set(),

            locked: false,
            interfaceMessageId: null
        };

        temporaryVCs.set(
            channel.id,
            data
        );

        // --------------------------------------------
        // Move owner
        // --------------------------------------------

        await member.voice
            .setChannel(
                channel,
                "VC+ Personal VC"
            )
            .catch(error => {
                console.error(
                    "[MOVE OWNER]",
                    error
                );
            });

        // --------------------------------------------
        // Interface directly in VC chat
        // --------------------------------------------

        await createVCInterface(
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

function vcHelp(message) {
    return sendBox(
        message,
        "VC Commands",
        [
            "`-vc setup` — setup Join to Create",
            "`-vc kick @user` — remove someone",
            "`-vc ban @user` — VC-ban someone",
            "`-vc reject @user` — reject someone",
            "`-vc permit @user` — permit someone",
            "`-vc lock` — lock VC",
            "`-vc unlock` — unlock VC",
            "`-vc limit 10` — set user limit",
            "`-vc rename name` — rename VC",
            "`-vc transfer @user` — transfer VC",
            "`-vc stfu @user` — permanent VC mute",
            "`-vc unstfu @user` — remove STFU",
            "`-vc dragall` — Founder only",
            "",
            "`-interface` — repost interface"
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
                args.shift() || ""
            ).toLowerCase();

        if (!sub) {
            return vcHelp(message);
        }

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
                "You must be inside your VC+ personal call.",
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
            return sendBox(
                message,
                "Access denied",
                "Only the VC owner, Founder, or God can control this call.",
                "error"
            );
        }

        // ====================================================
        // KICK
        // ====================================================

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
                    "That member isn't inside this call.",
                    "error"
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
                    "You cannot VC-kick that member.",
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

        // ====================================================
        // BAN
        // ====================================================

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
                )
            ) {
                return sendBox(
                    message,
                    "Protected member",
                    "You cannot VC-ban that member.",
                    "error"
                );
            }

            data.banned.add(
                target.id
            );

            data.rejected.delete(
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
                "Member VC banned",
                `${target} can no longer join this call.`,
                "success"
            );
        }

        // ====================================================
        // REJECT
        // ====================================================

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

            if (
                !canModerate(
                    message,
                    target
                )
            ) {
                return sendBox(
                    message,
                    "Protected member",
                    "You cannot reject that member.",
                    "error"
                );
            }

            data.rejected.add(
                target.id
            );

            data.banned.delete(
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

            return sendBox(
                message,
                "Member rejected",
                `${target} is rejected from this VC.`,
                "success"
            );
        }

        // ====================================================
        // PERMIT
        // ====================================================

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

            data.banned.delete(
                target.id
            );

            data.rejected.delete(
                target.id
            );

            data.permitted.add(
                target.id
            );

            return sendBox(
                message,
                "Member permitted",
                `${target} can join this VC.`,
                "success"
            );
        }

        // ====================================================
        // LOCK
        // ====================================================

        if (sub === "lock") {
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

            return sendBox(
                message,
                "VC locked",
                "Your personal call is now locked.",
                "success"
            );
        }

        // ====================================================
        // UNLOCK
        // ====================================================

        if (sub === "unlock") {
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

            return sendBox(
                message,
                "VC unlocked",
                "Your personal call is now unlocked.",
                "success"
            );
        }

        // ====================================================
        // LIMIT
        // ====================================================

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
                    "warning"
                );
            }

            await channel
                .setUserLimit(
                    limit,
                    "VC+ limit"
                )
                .catch(error => {
                    console.error(
                        "[LIMIT]",
                        error
                    );
                });

            return sendBox(
                message,
                "Limit updated",
                `User limit: **${
                    limit === 0
                        ? "Unlimited"
                        : limit
                }**`,
                "success"
            );
        }

        // ====================================================
        // RENAME
        // ====================================================

        if (sub === "rename") {
            const name =
                args.join(" ")
                    .trim()
                    .slice(0, 100);

            if (!name) {
                return sendBox(
                    message,
                    "Rename",
                    "Usage: `-vc rename My VC`",
                    "warning"
                );
            }

            await channel
                .setName(
                    name,
                    "VC+ rename"
                )
                .catch(error => {
                    console.error(
                        "[RENAME]",
                        error
                    );
                });

            return sendBox(
                message,
                "VC renamed",
                `Your VC is now **${name}**.`,
                "success"
            );
        }

        // ====================================================
        // TRANSFER
        // ====================================================

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
                    "The new owner must be inside your VC.",
                    "warning"
                );
            }

            if (
                isProtected(
                    message.guild,
                    target.id
                )
            ) {
                return sendBox(
                    message,
                    "Protected",
                    "Protected ranks cannot be transferred VC ownership.",
                    "warning"
                );
            }

            data.ownerId =
                target.id;

            await createVCInterface(
                channel,
                data
            );

            return sendBox(
                message,
                "Ownership transferred",
                `${target} now owns this VC.`,
                "success"
            );
        }

        // ====================================================
        // STFU
        // ====================================================

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
                target.id ===
                message.author.id
            ) {
                return sendBox(
                    message,
                    "Invalid target",
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
                return sendBox(
                    message,
                    "Protected",
                    "Founder and God are protected from VC STFU.",
                    "error"
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

            return sendBox(
                message,
                "STFU enabled",
                [
                    `${target} is now muted.`,
                    "",
                    "The mute stays active until:",
                    "`-vc unstfu @user`"
                ].join("\n"),
                "success"
            );
        }

        // ====================================================
        // UNSTFU
        // ====================================================

        if (sub === "unstfu") {
            const target =
                await getTarget(
                    message,
                    args[0]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC Unstfu",
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

            return sendBox(
                message,
                "STFU removed",
                `${target} can speak again.`,
                "success"
            );
        }

        // ====================================================
        // DRAGALL
        // ====================================================

        if (sub === "dragall") {
            if (
                !isFounder(
                    message,
                    message.author.id
                )
            ) {
                return sendBox(
                    message,
                    "Access denied",
                    "`-vc dragall` is **Founder-only**.",
                    "error"
                );
            }

            let moved = 0;

            for (
                const member
                of message.guild.members.cache.values()
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
                        )
                        .catch(() => {});

                    moved++;
                } catch (error) {
                    console.error(
                        "[DRAGALL]",
                        error
                    );
                }
            }

            return sendBox(
                message,
                "Dragall complete",
                `Moved **${moved}** eligible members.`,
                "success"
            );
        }

        return sendBox(
            message,
            "Unknown VC command",
            `Unknown command: \`-vc ${sub}\`\nUse \`-vc\` for help.`,
            "error"
        );

    } catch (error) {
        console.error(
            "[VC COMMAND]",
            error
        );

        return sendBox(
            message,
            "Command error",
            "The command failed safely. VC+ stayed online.",
            "error"
        );
    }
}

// ============================================================
// INTERFACE COMMAND
// ============================================================

async function handleInterface(message) {
    try {
        const owned =
            getOwnedVC(
                message.member
            );

        if (!owned) {
            return sendBox(
                message,
                "No VC",
                "You must be inside your VC+ personal call.",
                "error"
            );
        }

        const sent =
            await createVCInterface(
                owned.channel,
                owned.data
            );

        if (!sent) {
            return sendBox(
                message,
                "Interface failed",
                "I couldn't post the interface into the VC chat.",
                "error"
            );
        }

        return sendBox(
            message,
            "Interface posted",
            "The VC+ interface was posted directly into your voice channel chat.",
            "success"
        );

    } catch (error) {
        console.error(
            "[INTERFACE]",
            error
        );

        return sendBox(
            message,
            "Interface error",
            "The interface failed safely.",
            "error"
        );
    }
}

// ============================================================
// RANK LIST
// ============================================================

async function rankList(message) {
    return sendBox(
        message,
        "Rank List",
        [
            "**10 • Founder** — Full protection",
            "**9 • God** — Protected access",
            "**8 • Owner** — Advanced access",
            "**7 • Co-Owner** — Advanced access",
            "**6 • Executive** — Staff access",
            "**5 • Director** — Staff access",
            "**4 • Admin** — Moderation",
            "**3 • Moderator** — Moderation",
            "**2 • Staff** — Staff",
            "**1 • Member** — Standard",
            "",
            "VC+ ranks are stored internally.",
            "No Discord roles are automatically created."
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
        !isFounder(
            message,
            message.author.id
        )
    ) {
        return sendBox(
            message,
            "Permission denied",
            "Only **Founder** can manage VC+ ranks.",
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
            .replace(/[^a-z]/g, "");

    if (
        !target ||
        !RANK_LEVEL[rank]
    ) {
        return sendBox(
            message,
            "Rank",
            [
                "`-rank @user rank`",
                "",
                RANKS
                    .map(r => `\`${r}\``)
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
            "The server owner remains Founder.",
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
        !isFounder(
            message,
            message.author.id
        )
    ) {
        return sendBox(
            message,
            "Permission denied",
            "Only **Founder** can manage Godmode.",
            "error"
        );
    }

    const action =
        String(
            args[0] || ""
        ).toLowerCase();

    const target =
        await getTarget(
            message,
            args[1]
        );

    if (
        !["on", "off"].includes(action)
    ) {
        return sendBox(
            message,
            "Godmode",
            [
                "`-godmode on @user`",
                "`-godmode off @user`"
            ].join("\n"),
            "warning"
        );
    }

    if (!target) {
        return sendBox(
            message,
            "Godmode",
            "Specify a user.",
            "warning"
        );
    }

    if (
        !isProtected(
            message.guild,
            target.id
        )
    ) {
        return sendBox(
            message,
            "Protected rank required",
            "Godmode can only be assigned to Founder/God.",
            "error"
        );
    }

    guildData(
        message.guild.id
    ).godmode[target.id] =
        action === "on";

    saveDB();

    return sendBox(
        message,
        "Godmode updated",
        `${target} Godmode is now **${action.toUpperCase()}**.`,
        "success"
    );
}

// ============================================================
// GENERAL HELP
// ============================================================

async function helpCommand(message) {
    return sendBox(
        message,
        "Commands",
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
            "**RANKS**",
            "`-rank @user rank`",
            "`-ranklist`",
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
                !message.content.startsWith(PREFIX)
            ) {
                return;
            }

            const parts =
                message.content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                String(
                    parts.shift() || ""
                ).toLowerCase();

            if (!command) {
                return;
            }

            if (command === "help") {
                return helpCommand(message);
            }

            if (command === "ping") {
                return sendBox(
                    message,
                    "Pong",
                    `Latency: **${client.ws.ping}ms**`,
                    "success"
                );
            }

            if (command === "interface") {
                return handleInterface(message);
            }

            if (command === "vc") {
                return handleVC(
                    message,
                    parts
                );
            }

            if (command === "ranklist") {
                return rankList(message);
            }

            if (command === "rank") {
                return rankCommand(
                    message,
                    parts
                );
            }

            if (command === "godmode") {
                return godmodeCommand(
                    message,
                    parts
                );
            }

            return sendBox(
                message,
                "Unknown command",
                [
                    `Unknown command: \`${PREFIX}${command}\``,
                    "",
                    "Use `-help` to see everything."
                ].join("\n"),
                "error"
            );

        } catch (error) {
            console.error(
                "[MESSAGE ROUTER]",
                error
            );

            try {
                await sendBox(
                    message,
                    "Command error",
                    "The command failed safely. VC+ is still online.",
                    "error"
                );
            } catch {}
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
                guildData(guild.id);

            // =================================================
            // JOIN TO CREATE
            // =================================================

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

            // =================================================
            // TEMP VC PROTECTION
            // =================================================

            if (newState.channelId) {
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

                    // -----------------------------
                    // BAN / REJECT
                    // -----------------------------

                    if (
                        data.banned.has(
                            member.id
                        ) ||
                        data.rejected.has(
                            member.id
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ access denied"
                            )
                            .catch(() => {});

                        return;
                    }

                    // -----------------------------
                    // PROTECTED RANK
                    // -----------------------------

                    if (
                        isProtected(
                            guild,
                            member.id
                        )
                    ) {
                        await member.voice
                            .setMute(
                                false,
                                "VC+ protected rank"
                            )
                            .catch(() => {});

                        return;
                    }

                    // -----------------------------
                    // STFU
                    // -----------------------------

                    if (
                        data.stfu.has(
                            member.id
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

            // =================================================
            // SERVER MUTE PROTECTION
            // =================================================

            if (
                newState.serverMute &&
                newState.member
            ) {
                const member =
                    newState.member;

                const protectedRank =
                    isProtected(
                        guild,
                        member.id
                    );

                const godmode =
                    g.godmode[member.id] === true;

                if (
                    protectedRank ||
                    godmode
                ) {
                    await member.voice
                        .setMute(
                            false,
                            "VC+ protection"
                        )
                        .catch(() => {});
                }
            }

            // =================================================
            // EMPTY VC CLEANUP
            // =================================================

            if (oldState.channelId) {
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
                    oldChannel.members.size === 0
                ) {
                    temporaryVCs.delete(
                        oldChannel.id
                    );

                    await oldChannel
                        .delete(
                            "VC+ empty VC cleanup"
                        )
                        .catch(error => {
                            console.error(
                                "[VC DELETE]",
                                error
                            );
                        });
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
// SERVER PROTECTION
// ============================================================

// Tracks potentially abusive actions.
const securityActions = new Map();

function registerSecurityAction(
    guildId,
    userId
) {
    const key =
        `${guildId}:${userId}`;

    const now = Date.now();

    const list =
        securityActions.get(key) || [];

    const recent =
        list.filter(
            time =>
                now - time <
                10000
        );

    recent.push(now);

    securityActions.set(
        key,
        recent
    );

    return recent.length;
}

function clearSecurityAction(
    guildId,
    userId
) {
    securityActions.delete(
        `${guildId}:${userId}`
    );
}

// ============================================================
// CHECK IF EXECUTOR IS ALLOWED
// ============================================================

function isTrustedExecutor(
    guild,
    userId
) {
    if (!userId) {
        return false;
    }

    if (userId === guild.ownerId) {
        return true;
    }

    return isFounder(
        guild,
        userId
    );
}

// ============================================================
// AUDIT LOG EXECUTOR
// ============================================================

async function getRecentExecutor(
    guild,
    type
) {
    try {
        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 5
            });

        const entry =
            logs.entries.first();

        if (!entry) {
            return null;
        }

        if (
            Date.now() -
            entry.createdTimestamp >
            8000
        ) {
            return null;
        }

        return entry.executor;
    } catch (error) {
        console.error(
            "[AUDIT LOG]",
            error
        );

        return null;
    }
}

// ============================================================
// CHANNEL CREATE PROTECTION
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
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    channel.guild,
                    executor.id
                )
            ) {
                clearSecurityAction(
                    channel.guild.id,
                    executor.id
                );

                return;
            }

            const count =
                registerSecurityAction(
                    channel.guild.id,
                    executor.id
                );

            if (count >= 4) {
                const member =
                    await channel.guild.members
                        .fetch(executor.id)
                        .catch(() => null);

                if (
                    member &&
                    member.kickable
                ) {
                    await member
                        .kick(
                            "VC+ anti-nuke protection"
                        )
                        .catch(() => {});
                }
            }

            if (
                channel.deletable
            ) {
                await channel
                    .delete(
                        "VC+ unauthorized channel creation"
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[CHANNEL CREATE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// CHANNEL DELETE PROTECTION
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
                    AuditLogEvent.ChannelDelete
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    channel.guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                registerSecurityAction(
                    channel.guild.id,
                    executor.id
                );

            const member =
                await channel.guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                count >= 2 &&
                member &&
                member.kickable
            ) {
                await member
                    .kick(
                        "VC+ anti-nuke channel deletion"
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[CHANNEL DELETE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// ROLE CREATE PROTECTION
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
                    AuditLogEvent.RoleCreate
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                registerSecurityAction(
                    guild.id,
                    executor.id
                );

            // Delete unauthorized role.
            if (
                role.editable
            ) {
                await role
                    .delete(
                        "VC+ unauthorized role creation"
                    )
                    .catch(() => {});
            }

            if (count >= 3) {
                const member =
                    await guild.members
                        .fetch(executor.id)
                        .catch(() => null);

                if (
                    member &&
                    member.kickable
                ) {
                    await member
                        .kick(
                            "VC+ anti-nuke role creation"
                        )
                        .catch(() => {});
                }
            }

        } catch (error) {
            console.error(
                "[ROLE CREATE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// ROLE DELETE PROTECTION
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
                    AuditLogEvent.RoleDelete
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                registerSecurityAction(
                    guild.id,
                    executor.id
                );

            const member =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                count >= 2 &&
                member &&
                member.kickable
            ) {
                await member
                    .kick(
                        "VC+ anti-nuke role deletion"
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[ROLE DELETE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// ROLE UPDATE PROTECTION
// Prevent non-Founder from creating dangerous admin roles.
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
                    AuditLogEvent.RoleUpdate
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            // Detect Administrator permission being added.
            const oldAdmin =
                oldRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            const newAdmin =
                newRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            if (
                !oldAdmin &&
                newAdmin
            ) {
                await newRole
                    .setPermissions(
                        oldRole.permissions,
                        "VC+ unauthorized Administrator permission"
                    )
                    .catch(() => {});

                const member =
                    await guild.members
                        .fetch(executor.id)
                        .catch(() => null);

                if (
                    member &&
                    member.kickable
                ) {
                    await member
                        .kick(
                            "VC+ unauthorized Administrator role change"
                        )
                        .catch(() => {});
                }
            }

        } catch (error) {
            console.error(
                "[ROLE UPDATE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// MEMBER ROLE UPDATE PROTECTION
// Prevent unauthorized Admin role assignments.
// ============================================================

client.on(
    "guildMemberUpdate",
    async (
        oldMember,
        newMember
    ) => {
        try {
            const guild =
                newMember.guild;

            if (
                oldMember.roles.cache.size >=
                newMember.roles.cache.size
            ) {
                return;
            }

            const addedRoles =
                newMember.roles.cache.filter(
                    role =>
                        !oldMember.roles.cache.has(
                            role.id
                        )
                );

            const dangerousRole =
                addedRoles.find(
                    role =>
                        role.permissions.has(
                            PermissionFlagsBits.Administrator
                        ) ||
                        role.permissions.has(
                            PermissionFlagsBits.ManageGuild
                        ) ||
                        role.permissions.has(
                            PermissionFlagsBits.ManageChannels
                        )
                );

            if (!dangerousRole) {
                return;
            }

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.MemberRoleUpdate
                );

            if (!executor) {
                return;
            }

            if (
                isTrustedExecutor(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            await newMember.roles
                .remove(
                    dangerousRole,
                    "VC+ unauthorized dangerous role assignment"
                )
                .catch(() => {});

            const member =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                member &&
                member.kickable
            ) {
                await member
                    .kick(
                        "VC+ unauthorized dangerous role assignment"
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[MEMBER ROLE PROTECTION]",
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
                    .catch(() => {});
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
// BOT JOINS SERVER
// ============================================================

client.on(
    "guildCreate",
    async guild => {
        try {
            console.log(
                `[GUILD JOIN] ${guild.name} (${guild.id})`
            );

            const setup =
                await setupGuildVC(
                    guild
                );

            // --------------------------------------------
            // Find owner
            // --------------------------------------------

            const owner =
                await guild.members
                    .fetch(guild.ownerId)
                    .catch(() => null);

            if (owner) {
                const message = [
                    "## ♡ VC+",
                    "",
                    `Thanks for adding **VC+** to **${guild.name}**.`,
                    "",
                    setup
                        ? `**Join to Create:** ${setup.trigger}`
                        : "**Join to Create:** setup could not be completed automatically.",
                    "",
                    "**COMMANDS**",
                    "`-help` — command list",
                    "`-vc` — VC commands",
                    "`-interface` — VC interface",
                    "`-ranklist` — ranks",
                    "",
                    "**PROTECTION**",
                    "Founder and God are protected from VC STFU.",
                    "Founder-only dragall is enabled.",
                    "VC+ also watches unauthorized channel/role changes when Discord permissions allow the bot to reverse them.",
                    "",
                    "**IMPORTANT**",
                    "Keep the VC+ bot role above the staff roles it needs to protect.",
                    "The actual server owner can always override bot permissions."
                ].join("\n");

                await owner
                    .send({
                        embeds: [
                            box(
                                "VC+ Installed",
                                message,
                                "success"
                            )
                        ]
                    })
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[GUILD CREATE]",
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
            "======================================"
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
            "======================================"
        );

        try {
            client.user.setPresence({
                status: "online",

                activities: [
                    {
                        name: "VC+ | -help",
                        type: ActivityType.Watching
                    }
                ]
            });
        } catch (error) {
            console.error(
                "[PRESENCE]",
                error
            );
        }

        // --------------------------------------------
        // Repair/setup JTC on startup
        // --------------------------------------------

        for (
            const guild
            of client.guilds.cache.values()
        ) {
            try {
                const g =
                    guildData(guild.id);

                const trigger =
                    guild.channels.cache.get(
                        g.jtc.triggerId
                    );

                if (!trigger) {
                    await setupGuildVC(
                        guild
                    );
                }
            } catch (error) {
                console.error(
                    `[STARTUP SETUP] ${guild.id}`,
                    error
                );
            }
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
        "ERROR: DISCORD_TOKEN is missing."
    );

    console.error(
        "Create a .env file:"
    );

    console.error(
        "DISCORD_TOKEN=YOUR_BOT_TOKEN"
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
