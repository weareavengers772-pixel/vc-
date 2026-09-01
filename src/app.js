import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    ActivityType
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// VC+
// Robust single-file Discord bot
// ============================================================

const PREFIX = "-";
const BOT_NAME = "vc+";

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
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = {
    guilds: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(dbFile)) {
            saveDB();
            return;
        }

        const raw = fs.readFileSync(dbFile, "utf8");

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

            if (!db.guilds || typeof db.guilds !== "object") {
                db.guilds = {};
            }
        }
    } catch (error) {
        console.error("[DATABASE LOAD]", error);
        db = { guilds: {} };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            dbFile,
            JSON.stringify(db, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("[DATABASE SAVE]", error);
    }
}

loadDB();

// ============================================================
// RANKS
// Bot-only ranks.
// NO DISCORD ROLES ARE CREATED.
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
            }
        };
    }

    const data = db.guilds[guildId];

    data.ranks ??= {};
    data.foreverBanned ??= [];
    data.vouches ??= {};
    data.vouchLimit ??= 1;
    data.godmode ??= {};

    data.jtc ??= {};
    data.jtc.categoryId ??= null;
    data.jtc.triggerId ??= null;

    return data;
}

// ============================================================
// RANK HELPERS
// ============================================================

function getRank(guild, userId) {
    const data = guildData(guild.id);

    return data.ranks[userId] || "member";
}

function rankLevel(guild, userId) {
    return RANK_LEVEL[getRank(guild, userId)] || 1;
}

function isFounder(message) {
    if (!message.guild) return false;

    return (
        message.guild.ownerId === message.author.id ||
        getRank(message.guild, message.author.id) === "founder"
    );
}

function isGod(message) {
    if (!message.guild) return false;

    return (
        isFounder(message) ||
        getRank(message.guild, message.author.id) === "god"
    );
}

function isProtected(guild, userId) {
    const rank = getRank(guild, userId);

    return (
        rank === "founder" ||
        rank === "god"
    );
}

// ============================================================
// EMBED / BLEED-STYLE BOX
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
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setColor(
            colors[type] ?? colors.info
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
        console.error("[SEND BOX]", error);
        return null;
    }
}

// ============================================================
// SAFE MEMBER FETCH
// ============================================================

async function getTarget(message, value) {
    try {
        if (!value) return null;

        const mentioned =
            message.mentions.members.first();

        if (mentioned) {
            return mentioned;
        }

        const id =
            String(value)
                .replace(/[<@!>]/g, "");

        if (!/^\d{15,25}$/.test(id)) {
            return null;
        }

        return await message.guild.members
            .fetch(id)
            .catch(() => null);

    } catch (error) {
        console.error("[GET TARGET]", error);
        return null;
    }
}

// ============================================================
// MODERATION SAFETY
// ============================================================

function canModerate(message, target) {
    try {
        if (!target) return false;

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

        // Founder/God cannot be targeted by lower ranks.
        if (
            isProtected(
                message.guild,
                target.id
            )
        ) {
            return isGod(message);
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
temporaryVCs:

channelId -> {
    guildId,
    ownerId,
    interfaceId,
    banned: Set,
    rejected: Set,
    permitted: Set,
    stfu: Set,
    locked
}
*/

// ============================================================
// FIND USER'S VC
// ============================================================

function getOwnedVC(member) {
    try {
        if (!member?.voice?.channelId) {
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

    } catch (error) {
        console.error("[GET OWNED VC]", error);
        return null;
    }
}

// ============================================================
// VC CONTROL ACCESS
// ============================================================

function canControlVC(message, data) {
    if (!data) return false;

    return (
        data.ownerId === message.author.id ||
        isGod(message)
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

async function createVCInterface(
    voiceChannel,
    data
) {
    try {
        const guild =
            voiceChannel.guild;

        let textChannel = null;

        if (data.interfaceId) {
            textChannel =
                guild.channels.cache.get(
                    data.interfaceId
                );
        }

        if (!textChannel) {
            textChannel =
                guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildText &&
                        channel.name ===
                            "vc-chat" &&
                        channel.parentId ===
                            voiceChannel.parentId
                );
        }

        if (!textChannel) {
            textChannel =
                await guild.channels.create({
                    name: "vc-chat",
                    type: ChannelType.GuildText,
                    parent:
                        voiceChannel.parentId ??
                        null,

                    permissionOverwrites: [
                        {
                            id:
                                guild.roles.everyone.id,

                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.ReadMessageHistory
                            ],

                            deny: [
                                PermissionFlagsBits.SendMessages
                            ]
                        },
                        {
                            id: data.ownerId,

                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory
                            ]
                        }
                    ],

                    reason:
                        "VC+ temporary VC interface"
                });
        }

        data.interfaceId =
            textChannel.id;

        await textChannel
            .send({
                embeds: [
                    box(
                        "Voice Control",
                        [
                            `**Owner:** <@${data.ownerId}>`,
                            "",
                            "**VC COMMANDS**",
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
                            "**Protection**",
                            "Founder and God are protected from VC STFU.",
                            "STFU remains active until `-vc unstfu` is used."
                        ].join("\n")
                    )
                ]
            })
            .catch(() => {});

        saveDB();

        return textChannel;

    } catch (error) {
        console.error(
            "[CREATE VC INTERFACE]",
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
                "You need **Manage Channels** to set up Join to Create.",
                "error"
            );
        }

        const g =
            guildData(message.guild.id);

        if (
            g.jtc.triggerId &&
            message.guild.channels.cache.has(
                g.jtc.triggerId
            )
        ) {
            const existing =
                message.guild.channels.cache.get(
                    g.jtc.triggerId
                );

            return sendBox(
                message,
                "Already setup",
                `Join to Create is already active in <#${existing.id}>.`,
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

        if (
            !category
        ) {
            category =
                await message.guild.channels.create({
                    name: "VC+",
                    type: ChannelType.GuildCategory,
                    reason: "VC+ setup"
                });
        }

        const trigger =
            await message.guild.channels.create({
                name: "Join to Create",
                type: ChannelType.GuildVoice,
                parent: category.id,
                reason: "VC+ Join to Create"
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
                `Join <#${trigger.id}> to create your personal VC.`,
                "",
                "Your VC will be named:",
                `**yourname VC**`,
                "",
                "A `vc-chat` interface will automatically be created beside your VC.",
                "",
                "Use `-vc` to view VC commands."
            ].join("\n"),
            "success"
        );

    } catch (error) {
        console.error(
            "[VC SETUP]",
            error
        );

        return sendBox(
            message,
            "Setup failed",
            "I couldn't create the Join to Create system. Check that the bot has **Manage Channels** and **Move Members**.",
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
            guildData(guild.id);

        if (
            trigger.id !==
            g.jtc.triggerId
        ) {
            return null;
        }

        // Prevent duplicate VCs.
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

        const safeName =
            `${member.user.username} VC`
                .replace(/[^\w\s\-+]/g, "")
                .slice(0, 100)
                .trim() ||
            "Personal VC";

        const channel =
            await guild.channels.create({
                name: safeName,
                type: ChannelType.GuildVoice,
                parent:
                    trigger.parentId ??
                    null,

                userLimit: 0,

                reason:
                    "VC+ Join to Create",

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
            guildId: guild.id,
            ownerId: member.id,
            interfaceId: null,

            banned: new Set(),
            rejected: new Set(),
            permitted: new Set(),
            stfu: new Set(),

            locked: false
        };

        temporaryVCs.set(
            channel.id,
            data
        );

        await createVCInterface(
            channel,
            data
        );

        await member.voice
            .setChannel(
                channel,
                "VC+ Join to Create"
            )
            .catch(error => {
                console.error(
                    "[MOVE TO VC]",
                    error
                );
            });

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
// VC COMMAND HELP
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
            "`-vc permit @user` — allow someone",
            "`-vc lock` — lock your VC",
            "`-vc unlock` — unlock your VC",
            "`-vc limit 10` — set VC limit",
            "`-vc rename name` — rename your VC",
            "`-vc transfer @user` — transfer ownership",
            "`-vc stfu @user` — keep someone muted",
            "`-vc unstfu @user` — remove STFU",
            "`-vc dragall` — Founder-only mass drag",
            "`-interface` — reopen VC interface"
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
            return sendBox(
                message,
                "Access denied",
                "Only the owner of this call, Founder, or God can control this VC.",
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
                return sendBox(
                    message,
                    "Protected member",
                    "You cannot VC-kick an equal or higher protected member.",
                    "error"
                );
            }

            await target.voice
                .disconnect(
                    "VC+ owner kick"
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

            return sendBox(
                message,
                "Member VC banned",
                `${target} can no longer join this temporary VC.`,
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

            return sendBox(
                message,
                "Member rejected",
                `${target} is now rejected from this VC.`,
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
                `${target} is allowed to join this VC.`,
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
                        "[VC LOCK]",
                        error
                    );
                });

            data.locked = true;

            return sendBox(
                message,
                "VC locked",
                "Your call is now locked.",
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
                        "[VC UNLOCK]",
                        error
                    );
                });

            data.locked = false;

            return sendBox(
                message,
                "VC unlocked",
                "Your call is now unlocked.",
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
                        "[VC LIMIT]",
                        error
                    );
                });

            return sendBox(
                message,
                "Limit updated",
                `VC limit set to **${
                    limit === 0
                        ? "unlimited"
                        : limit
                }**.`,
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
                    name
                )
                .catch(error => {
                    console.error(
                        "[VC RENAME]",
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
                    "Protected member",
                    "That member already has a protected bot rank.",
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
                `${target} is now the owner of this VC.`,
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
                    "Protected member",
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
                        "[VC STFU]",
                        error
                    );
                });

            return sendBox(
                message,
                "STFU enabled",
                [
                    `${target} has been muted.`,
                    "",
                    "They will remain muted until:",
                    "`-vc unstfu @user`"
                ].join("\n"),
                "success"
            );
        }

        // ====================================================
        // UNSTFU
        // ====================================================

        if (
            sub === "unstfu" ||
            sub === "unstfu"
        ) {
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
                `${target} is no longer locked muted.`,
                "success"
            );
        }

        // ====================================================
        // DRAGALL
        // ====================================================

        if (sub === "dragall") {
            if (!isFounder(message)) {
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
                        );

                    moved++;

                } catch (error) {
                    console.error(
                        "[DRAGALL MEMBER]",
                        error
                    );
                }
            }

            return sendBox(
                message,
                "Dragall complete",
                `Moved **${moved}** eligible members into your VC.`,
                "success"
            );
        }

        return sendBox(
            message,
            "Unknown VC command",
            `I don't recognize \`-vc ${sub}\`.\nUse \`-vc\` to see the available commands.`,
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
            "The VC command failed safely. Check the bot's permissions and try again.",
            "error"
        );
    }
}

// ============================================================
// INTERFACE
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
                "You must be inside your temporary VC+ call.",
                "error"
            );
        }

        const text =
            await createVCInterface(
                owned.channel,
                owned.data
            );

        if (!text) {
            return sendBox(
                message,
                "Interface failed",
                "I couldn't create the VC interface. Check **Manage Channels** permission.",
                "error"
            );
        }

        return sendBox(
            message,
            "Interface ready",
            `Your VC controls are available in <#${text.id}>.`,
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
            "Something went wrong while creating the interface.",
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
            "**10 • Founder** — Full VC+ access",
            "**9 • God** — Protected/high access",
            "**8 • Owner** — Advanced access",
            "**7 • Co-Owner** — Advanced access",
            "**6 • Executive** — Staff access",
            "**5 • Director** — Staff access",
            "**4 • Admin** — Moderation access",
            "**3 • Moderator** — Moderation access",
            "**2 • Staff** — Staff access",
            "**1 • Member** — Standard access",
            "",
            "These ranks are **bot-only**.",
            "VC+ does not create Discord roles."
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
    if (!isFounder(message)) {
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
                "Usage:",
                "`-rank @user rank`",
                "",
                RANKS
                    .map(
                        r => `\`${r}\``
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
            "The server owner cannot be assigned a lower bot rank.",
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
        [
            `${target} is now **${rank}**.`,
            "",
            "No Discord role was created.",
            "This rank only exists inside VC+."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// VOUCH
// ============================================================

async function vouch(
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
            args.shift() || ""
        ).toLowerCase();

    const g =
        guildData(
            message.guild.id
        );

    // --------------------------------------------------------
    // VOUCH LIMIT
    // --------------------------------------------------------

    if (
        action === "limit"
    ) {
        const limit =
            Number(args[0]);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            return sendBox(
                message,
                "Invalid vouch limit",
                "Use a number from `1` to `100`.",
                "warning"
            );
        }

        g.vouchLimit =
            limit;

        saveDB();

        return sendBox(
            message,
            "Vouch limit updated",
            `Promotion requirement is now **${limit} vouch(es)**.`,
            "success"
        );
    }

    // --------------------------------------------------------
    // VOUCH ADD
    // --------------------------------------------------------

    if (
        action === "add"
    ) {
        const target =
            await getTarget(
                message,
                args[0]
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
                "Invalid target",
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

        let promotion =
            false;

        if (
            count >=
            g.vouchLimit
        ) {
            g.ranks[target.id] =
                "god";

            promotion = true;
        }

        saveDB();

        return sendBox(
            message,
            "Vouch added",
            [
                `${target} now has **${count}** vouch(es).`,
                `Required: **${g.vouchLimit}**`,
                "",
                promotion
                    ? "Requirement reached — user promoted to **God**."
                    : "The requirement has not been reached yet."
            ].join("\n"),
            "success"
        );
    }

    return sendBox(
        message,
        "Vouch",
        [
            "`-vouch add @user`",
            "`-vouch limit 3`",
            "",
            `Current requirement: **${g.vouchLimit}**`
        ].join("\n"),
        "warning"
    );
}

// ============================================================
// GODMODE
// ============================================================

async function godmodeCommand(
    message,
    args
) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Permission denied",
            "Only **Founder** can manage Godmode.",
            "error"
        );
    }

    const action =
        String(
            args.shift() || ""
        ).toLowerCase();

    const target =
        await getTarget(
            message,
            args[0]
        );

    if (
        action !== "on" &&
        action !== "off"
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
            "You must specify a member.",
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
            "Godmode can only be assigned to a **Founder or God** rank.",
            "error"
        );
    }

    const g =
        guildData(
            message.guild.id
        );

    g.godmode[target.id] =
        action === "on";

    saveDB();

    return sendBox(
        message,
        "Godmode updated",
        [
            `${target} Godmode is now **${
                action === "on"
                    ? "ON"
                    : "OFF"
            }**.`,
            "",
            "Godmode protects against VC STFU and server voice mutes."
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
            "You cannot ban the server owner, Founder, God, or an equal/higher rank.",
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

        return sendBox(
            message,
            "Ban failed",
            "Discord rejected the ban. Check the bot's role hierarchy and Ban Members permission.",
            "error"
        );
    }

    return sendBox(
        message,
        "Member banned",
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

    try {
        await target.ban({
            reason:
                "VC+ permanent ban"
        });
    } catch (error) {
        console.error(
            "[FOREVER BAN]",
            error
        );

        return sendBox(
            message,
            "Ban failed",
            "The permanent-ban list was updated, but Discord rejected the immediate ban.",
            "warning"
        );
    }

    return sendBox(
        message,
        "Forever banned",
        `${target.user.tag} was added to the VC+ permanent ban list.`,
        "success"
    );
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
            "**MODERATION**",
            "`-ban @user reason`",
            "`-kick @user reason`",
            "`-timeout @user minutes`",
            "`-untimeout @user`",
            "`-foreverban @user`",
            "",
            "**RANKS**",
            "`-rank @user rank`",
            "`-ranklist`",
            "`-vouch add @user`",
            "`-vouch limit 3`",
            "`-godmode on @user`",
            "`-godmode off @user`"
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
                    parts.shift() || ""
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
                return sendBox(
                    message,
                    "Pong",
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
                command === "vouch"
            ) {
                return vouch(
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

            // =================================================
            // KICK
            // =================================================

            if (
                command === "kick"
            ) {
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
                        parts[0]
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
                        "Kick failed",
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
                    .catch(error => {
                        console.error(
                            "[KICK]",
                            error
                        );
                    });

                return sendBox(
                    message,
                    "Member kicked",
                    `${target.user.tag} was kicked.`,
                    "success"
                );
            }

            // =================================================
            // TIMEOUT
            // =================================================

            if (
                command === "timeout"
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
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
                        parts[0]
                    );

                const minutes =
                    Number(parts[1]);

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
                    return sendBox(
                        message,
                        "Timeout",
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
                    .catch(error => {
                        console.error(
                            "[TIMEOUT]",
                            error
                        );
                    });

                return sendBox(
                    message,
                    "Timed out",
                    `${target.user.tag} was timed out for **${minutes} minute(s)**.`,
                    "success"
                );
            }

            // =================================================
            // UNTIMEOUT
            // =================================================

            if (
                command === "untimeout"
            ) {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
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
                        parts[0]
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
                        "You cannot remove the timeout from that protected member.",
                        "error"
                    );
                }

                await target
                    .timeout(
                        null,
                        "VC+ untimeout"
                    )
                    .catch(error => {
                        console.error(
                            "[UNTIMEOUT]",
                            error
                        );
                    });

                return sendBox(
                    message,
                    "Timeout removed",
                    `${target.user.tag} is no longer timed out.`,
                    "success"
                );
            }

            return sendBox(
                message,
                "Unknown command",
                [
                    `I don't recognize \`${PREFIX}${command}\`.`,
                    "",
                    "Use `-help` to see the available commands."
                ].join("\n"),
                "error"
            );

        } catch (error) {
            console.error(
                "[COMMAND ROUTER]",
                error
            );

            await sendBox(
                message,
                "Command error",
                "Something went wrong while processing that command. The bot stayed online.",
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

            // =================================================
            // JOIN TO CREATE
            // =================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    g.jtc.triggerId
            ) {
                const channel =
                    await createPersonalVC(
                        newState.member,
                        newState.channel
                    );

                if (!channel) {
                    console.error(
                        "[JTC] Could not create personal VC."
                    );
                }

                return;
            }

            // =================================================
            // TEMP VC JOIN PROTECTION
            // =================================================

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

                    // -----------------------------------------
                    // VC BAN / REJECT
                    // -----------------------------------------

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

                    // -----------------------------------------
                    // FOUNDER / GOD PROTECTION
                    // -----------------------------------------

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

                    // -----------------------------------------
                    // STFU
                    // -----------------------------------------

                    if (
                        data.stfu.has(
                            userId
                        )
                    ) {
                        // Founder/God always win.
                        if (
                            !isProtected(
                                guild,
                                userId
                            )
                        ) {
                            await member.voice
                                .setMute(
                                    true,
                                    "VC+ STFU protection"
                                )
                                .catch(() => {});
                        }
                    }
                }
            }

            // =================================================
            // GODMODE SERVER VOICE MUTE PROTECTION
            // =================================================

            if (
                newState.serverMute &&
                newState.member
            ) {
                const userId =
                    newState.member.id;

                const rank =
                    getRank(
                        guild,
                        userId
                    );

                const godmode =
                    g.godmode[userId] ===
                    true;

                if (
                    rank === "founder" ||
                    rank === "god" ||
                    godmode
                ) {
                    await newState.member.voice
                        .setMute(
                            false,
                            "VC+ Godmode protection"
                        )
                        .catch(() => {});
                }
            }

            // =================================================
            // CLEAN EMPTY TEMP VC
            // =================================================

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
                    !data
                ) {
                    return;
                }

                if (
                    oldChannel.members.size ===
                    0
                ) {
                    temporaryVCs.delete(
                        oldChannel.id
                    );

                    if (
                        data.interfaceId
                    ) {
                        const interfaceChannel =
                            guild.channels.cache.get(
                                data.interfaceId
                            );

                        if (
                            interfaceChannel
                        ) {
                            await interfaceChannel
                                .delete(
                                    "VC+ empty VC cleanup"
                                )
                                .catch(() => {});
                        }
                    }

                    await oldChannel
                        .delete(
                            "VC+ empty VC cleanup"
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
// FOREVER BAN PROTECTION
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
                            "[AUTO FOREVER BAN]",
                            error
                        );
                    });
            }

        } catch (error) {
            console.error(
                "[GUILD MEMBER ADD]",
                error
            );
        }
    }
);

// ============================================================
// REPEATED GODMODE PROTECTION
// ============================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            if (
                !newState.member
            ) {
                return;
            }

            if (
                !newState.serverMute
            ) {
                return;
            }

            const guild =
                newState.guild;

            const g =
                guildData(
                    guild.id
                );

            const userId =
                newState.member.id;

            const protectedRank =
                isProtected(
                    guild,
                    userId
                );

            const enabled =
                g.godmode[userId] ===
                true;

            if (
                protectedRank ||
                enabled
            ) {
                await newState.member.voice
                    .setMute(
                        false,
                        "VC+ personal protection"
                    )
                    .catch(() => {});
            }

        } catch (error) {
            console.error(
                "[GODMODE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// STARTUP
// ============================================================

client.once(
    "ready",
    () => {
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
        "Put DISCORD_TOKEN=your_bot_token in .env"
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
