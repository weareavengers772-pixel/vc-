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

try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
    console.error("[DATA DIR]", error);
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

        fs.renameSync(tempFile, DB_FILE);
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

        if (
            !parsed ||
            typeof parsed !== "object" ||
            typeof parsed.guilds !== "object"
        ) {
            db = { guilds: {} };
            saveDB();
            return;
        }

        db = parsed;
        db.guilds ??= {};
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

function isFounder(guild, userId) {
    if (!guild || !userId) return false;

    return (
        guild.ownerId === userId ||
        getRank(guild, userId) === "founder"
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

function isTrustedExecutor(guild, userId) {
    if (!guild || !userId) return false;

    return (
        guild.ownerId === userId ||
        getRank(guild, userId) === "founder"
    );
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
            name: BOT_NAME
        })
        .setTitle(title)
        .setDescription(description)
        .setColor(colors[type] ?? colors.info)
        .setFooter({
            text: "VC+ • secure server management"
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
        if (!message?.channel) return null;

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
        if (!message?.guild || !value) {
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
        if (!message?.guild || !target) {
            return false;
        }

        if (target.id === message.author.id) {
            return false;
        }

        if (target.id === message.guild.ownerId) {
            return false;
        }

        if (isProtected(message.guild, target.id)) {
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
// VC MEMORY
// ============================================================

const temporaryVCs = new Map();

// channelId -> {
//     guildId,
//     ownerId,
//     banned,
//     rejected,
//     permitted,
//     stfu,
//     locked,
//     interfaceMessageId
// }

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
    if (!data) return false;

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
                "**Owner**",
                `<@${data.ownerId}>`,
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
                "",
                "**Use**",
                "`-interface` to repost this panel."
            ].join("\n"),
            "info"
        );

        const sent =
            await voiceChannel
                .send({
                    embeds: [embed]
                })
                .catch(error => {
                    console.error(
                        "[VC INTERFACE SEND]",
                        error
                    );

                    return null;
                });

        if (sent) {
            data.interfaceMessageId = sent.id;
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

async function setupGuildVC(guild) {
    try {
        if (!guild) return null;

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

async function setupVC(message) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ManageChannels
            ) &&
            !isFounder(
                message.guild,
                message.author.id
            )
        ) {
            return sendBox(
                message,
                "Permission denied",
                "You need **Manage Channels** or Founder access.",
                "error"
            );
        }

        const result =
            await setupGuildVC(
                message.guild
            );

        if (!result) {
            return sendBox(
                message,
                "Setup failed",
                "VC+ could not create the Join to Create channel.",
                "error"
            );
        }

        return sendBox(
            message,
            "Join to Create ready",
            `Join ${result.trigger} to create your personal voice channel.`,
            "success"
        );

    } catch (error) {
        console.error("[SETUP VC]", error);

        return sendBox(
            message,
            "Setup failed",
            "VC+ failed safely while setting up Join to Create.",
            "error"
        );
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member, trigger) {
    try {
        if (!member || !trigger) {
            return null;
        }

        const guild = member.guild;
        const g = guildData(guild.id);

        if (trigger.id !== g.jtc.triggerId) {
            return null;
        }

        // Existing VC
        for (const [channelId, data] of temporaryVCs) {
            if (
                data.guildId === guild.id &&
                data.ownerId === member.id
            ) {
                const existing =
                    guild.channels.cache.get(channelId);

                if (existing) {
                    await member.voice
                        .setChannel(
                            existing,
                            "VC+ existing personal VC"
                        )
                        .catch(() => {});

                    return existing;
                }

                temporaryVCs.delete(channelId);
            }
        }

        let safeName =
            `${member.user.username} VC`
                .replace(/[^\w\s\-+]/g, "")
                .trim()
                .slice(0, 90);

        if (!safeName) {
            safeName = "Personal VC";
        }

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

async function vcHelp(message) {
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
            "`-vc stfu @user` — mute someone",
            "`-vc unstfu @user` — remove mute",
            "`-vc dragall` — Founder only",
            "",
            "`-interface` — repost interface"
        ].join("\n")
    );
}

// ============================================================
// VC COMMANDS
// ============================================================

async function handleVC(message, args) {
    try {
        const sub =
            String(args.shift() || "")
                .toLowerCase();

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

        // KICK
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

        // BAN
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

            data.banned.add(target.id);
            data.rejected.delete(target.id);

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

        // REJECT
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

            data.rejected.add(target.id);
            data.banned.delete(target.id);

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

        // PERMIT
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

            data.banned.delete(target.id);
            data.rejected.delete(target.id);
            data.permitted.add(target.id);

            return sendBox(
                message,
                "Member permitted",
                `${target} can join this VC.`,
                "success"
            );
        }

        // LOCK
        if (sub === "lock") {
            await channel.permissionOverwrites
                .edit(
                    message.guild.roles.everyone,
                    {
                        Connect: false
                    }
                )
                .catch(error => {
                    console.error("[LOCK]", error);
                });

            data.locked = true;

            return sendBox(
                message,
                "VC locked",
                "Your personal call is now locked.",
                "success"
            );
        }

        // UNLOCK
        if (sub === "unlock") {
            await channel.permissionOverwrites
                .edit(
                    message.guild.roles.everyone,
                    {
                        Connect: true
                    }
                )
                .catch(error => {
                    console.error("[UNLOCK]", error);
                });

            data.locked = false;

            return sendBox(
                message,
                "VC unlocked",
                "Your personal call is now unlocked.",
                "success"
            );
        }

        // LIMIT
        if (sub === "limit") {
            const limit = Number(args[0]);

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
                    console.error("[LIMIT]", error);
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

        // RENAME
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
                    console.error("[RENAME]", error);
                });

            return sendBox(
                message,
                "VC renamed",
                `Your VC is now **${name}**.`,
                "success"
            );
        }

        // TRANSFER
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
                    "Protected ranks cannot receive VC ownership.",
                    "warning"
                );
            }

            data.ownerId = target.id;

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

        // STFU
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

            data.stfu.add(target.id);

            await target.voice
                .setMute(
                    true,
                    "VC+ STFU"
                )
                .catch(error => {
                    console.error("[STFU]", error);
                });

            return sendBox(
                message,
                "STFU enabled",
                `${target} is now muted.`,
                "success"
            );
        }

        // UNSTFU
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

            data.stfu.delete(target.id);

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

        // DRAGALL
        if (sub === "dragall") {
            if (
                !isFounder(
                    message.guild,
                    message.author.id
                )
            ) {
                return sendBox(
                    message,
                    "Access denied",
                    "`-vc dragall` is Founder-only.",
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
                    ) continue;

                    if (
                        !member.voice.channelId
                    ) continue;

                    if (
                        isProtected(
                            message.guild,
                            member.id
                        )
                    ) continue;

                    await member.voice
                        .setChannel(
                            channel,
                            "VC+ Founder dragall"
                        )
                        .catch(() => {});

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
        console.error("[VC COMMAND]", error);

        return sendBox(
            message,
            "Command error",
            "The command failed safely. VC+ stayed online.",
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
            "The VC+ interface was posted in your voice channel chat.",
            "success"
        );

    } catch (error) {
        console.error("[INTERFACE]", error);

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
            "**1 • Member** — Standard"
        ].join("\n")
    );
}

// ============================================================
// RANK COMMAND
// ============================================================

async function rankCommand(message, args) {
    if (
        !isFounder(
            message.guild,
            message.author.id
        )
    ) {
        return sendBox(
            message,
            "Permission denied",
            "Only Founder can manage VC+ ranks.",
            "error"
        );
    }

    const target =
        await getTarget(
            message,
            args[0]
        );

    const rank =
        String(args[1] || "")
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
        target.id === message.guild.ownerId
    ) {
        return sendBox(
            message,
            "Protected",
            "The server owner is always treated as Founder.",
            "error"
        );
    }

    guildData(
        message.guild.id
    ).ranks[target.id] = rank;

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

async function godmodeCommand(message, args) {
    if (
        !isFounder(
            message.guild,
            message.author.id
        )
    ) {
        return sendBox(
            message,
            "Permission denied",
            "Only Founder can manage Godmode.",
            "error"
        );
    }

    const action =
        String(args[0] || "")
            .toLowerCase();

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
            "Godmode can only be assigned to Founder or God.",
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
// SERVER MODERATION
// ============================================================

async function banCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.BanMembers
        ) &&
        !isFounder(
            message.guild,
            message.author.id
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

    if (!canModerate(message, target)) {
        return sendBox(
            message,
            "Protected member",
            "You cannot ban that member.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ").slice(0, 400) ||
        "No reason provided";

    try {
        await target.ban({
            reason: `VC+ | ${reason}`
        });

        return sendBox(
            message,
            "Member banned",
            `${target.user.tag} was banned.`,
            "success"
        );
    } catch (error) {
        console.error("[BAN]", error);

        return sendBox(
            message,
            "Ban failed",
            "Discord prevented the bot from banning this member.",
            "error"
        );
    }
}

async function kickCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.KickMembers
        ) &&
        !isFounder(
            message.guild,
            message.author.id
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

    if (!target) {
        return sendBox(
            message,
            "Kick",
            "Usage: `-kick @user reason`",
            "warning"
        );
    }

    if (!canModerate(message, target)) {
        return sendBox(
            message,
            "Protected member",
            "You cannot kick that member.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ").slice(0, 400) ||
        "No reason provided";

    try {
        await target.kick(
            `VC+ | ${reason}`
        );

        return sendBox(
            message,
            "Member kicked",
            `${target.user.tag} was kicked.`,
            "success"
        );
    } catch (error) {
        console.error("[KICK]", error);

        return sendBox(
            message,
            "Kick failed",
            "Discord prevented the bot from kicking this member.",
            "error"
        );
    }
}

async function timeoutCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ModerateMembers
        ) &&
        !isFounder(
            message.guild,
            message.author.id
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
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 40320
    ) {
        return sendBox(
            message,
            "Timeout",
            "Usage: `-timeout @user minutes`\nMaximum: 40320 minutes.",
            "warning"
        );
    }

    if (!canModerate(message, target)) {
        return sendBox(
            message,
            "Protected member",
            "You cannot timeout that member.",
            "error"
        );
    }

    try {
        await target.timeout(
            minutes * 60 * 1000,
            "VC+ timeout"
        );

        return sendBox(
            message,
            "Timeout applied",
            `${target} was timed out for **${minutes} minutes**.`,
            "success"
        );
    } catch (error) {
        console.error("[TIMEOUT]", error);

        return sendBox(
            message,
            "Timeout failed",
            "Discord prevented the bot from applying the timeout.",
            "error"
        );
    }
}

async function untimeoutCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ModerateMembers
        ) &&
        !isFounder(
            message.guild,
            message.author.id
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

    if (!canModerate(message, target)) {
        return sendBox(
            message,
            "Protected member",
            "You cannot remove that member's timeout.",
            "error"
        );
    }

    try {
        await target.timeout(
            null,
            "VC+ timeout removed"
        );

        return sendBox(
            message,
            "Timeout removed",
            `${target} is no longer timed out.`,
            "success"
        );
    } catch (error) {
        console.error("[UNTIMEOUT]", error);

        return sendBox(
            message,
            "Failed",
            "Discord prevented the bot from removing the timeout.",
            "error"
        );
    }
}

// ============================================================
// FOREVER BAN
// ============================================================

async function foreverBanCommand(message, args) {
    if (
        !isFounder(
            message.guild,
            message.author.id
        )
    ) {
        return sendBox(
            message,
            "Permission denied",
            "Only Founder can use Forever Ban.",
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
            reason: "VC+ permanent ban list"
        });
    } catch (error) {
        console.error("[FOREVER BAN]", error);
    }

    return sendBox(
        message,
        "Forever ban added",
        `${target.user.tag} was added to the permanent ban list.`,
        "success"
    );
}

// ============================================================
// HELP
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

            if (!command) return;

            switch (command) {
                case "help":
                    return helpCommand(message);

                case "ping":
                    return sendBox(
                        message,
                        "Pong",
                        `Latency: **${client.ws.ping}ms**`,
                        "success"
                    );

                case "interface":
                    return handleInterface(message);

                case "vc":
                    return handleVC(
                        message,
                        parts
                    );

                case "ranklist":
                    return rankList(message);

                case "rank":
                    return rankCommand(
                        message,
                        parts
                    );

                case "godmode":
                    return godmodeCommand(
                        message,
                        parts
                    );

                case "ban":
                    return banCommand(
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

                case "foreverban":
                    return foreverBanCommand(
                        message,
                        parts
                    );

                // Deliberately no unban command.
                case "unban":
                    return sendBox(
                        message,
                        "Unknown command",
                        "That command is not available.",
                        "error"
                    );

                default:
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
            }

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
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) return;

            const g =
                guildData(guild.id);

            // Join to Create
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

            // VC protection
            if (newState.channelId) {
                const data =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (data) {
                    const member =
                        newState.member;

                    if (!member) return;

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

            // Server mute protection
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

            // Empty VC cleanup
            if (oldState.channelId) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (!oldChannel) return;

                const data =
                    temporaryVCs.get(
                        oldChannel.id
                    );

                if (!data) return;

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
// SECURITY TRACKING
// ============================================================

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
                now - time < 10000
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
// AUDIT LOG
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

        if (!entry) return null;

        if (
            Date.now() -
            entry.createdTimestamp >
            8000
        ) {
            return null;
        }

        return entry.executor || null;

    } catch (error) {
        console.error(
            "[AUDIT LOG]",
            error
        );

        return null;
    }
}

// ============================================================
// PROTECTION: CHANNEL CREATE
// ============================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) return;

            const g =
                guildData(
                    channel.guild.id
                );

            if (!g.protection.enabled) return;

            const executor =
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) return;

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

            if (
                channel.deletable
            ) {
                await channel
                    .delete(
                        "VC+ unauthorized channel creation"
                    )
                    .catch(() => {});
            }

            if (count >= g.protection.maxActions) {
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

        } catch (error) {
            console.error(
                "[CHANNEL CREATE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// PROTECTION: CHANNEL DELETE
// ============================================================

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) return;

            const g =
                guildData(
                    channel.guild.id
                );

            if (!g.protection.enabled) return;

            const executor =
                await getRecentExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

            if (!executor) return;

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

            if (
                count >= g.protection.maxActions
            ) {
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
                            "VC+ anti-nuke channel deletion"
                        )
                        .catch(() => {});
                }
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
// PROTECTION: ROLE CREATE
// ============================================================

client.on(
    "roleCreate",
    async role => {
        try {
            const guild =
                role.guild;

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) return;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleCreate
                );

            if (!executor) return;

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

            if (role.editable) {
                await role
                    .delete(
                        "VC+ unauthorized role creation"
                    )
                    .catch(() => {});
            }

            if (
                count >= g.protection.maxActions
            ) {
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
// PROTECTION: ROLE DELETE
// ============================================================

client.on(
    "roleDelete",
    async role => {
        try {
            const guild =
                role.guild;

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) return;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleDelete
                );

            if (!executor) return;

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

            if (
                count >= g.protection.maxActions
            ) {
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
                            "VC+ anti-nuke role deletion"
                        )
                        .catch(() => {});
                }
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
// PROTECTION: ROLE UPDATE
// ============================================================

client.on(
    "roleUpdate",
    async (oldRole, newRole) => {
        try {
            const guild =
                newRole.guild;

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) return;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.RoleUpdate
                );

            if (!executor) return;

            if (
                isTrustedExecutor(
                    guild,
                    executor.id
                )
            ) {
                return;
            }

            const oldAdmin =
                oldRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            const newAdmin =
                newRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            const dangerousAdded =
                !oldAdmin && newAdmin;

            if (dangerousAdded) {
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
// PROTECTION: DANGEROUS ROLE ASSIGNMENT
// ============================================================

client.on(
    "guildMemberUpdate",
    async (oldMember, newMember) => {
        try {
            const guild =
                newMember.guild;

            const addedRoles =
                newMember.roles.cache.filter(
                    role =>
                        !oldMember.roles.cache.has(
                            role.id
                        )
                );

            if (!addedRoles.size) return;

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

            if (!dangerousRole) return;

            const executor =
                await getRecentExecutor(
                    guild,
                    AuditLogEvent.MemberRoleUpdate
                );

            if (!executor) return;

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

            const executorMember =
                await guild.members
                    .fetch(executor.id)
                    .catch(() => null);

            if (
                executorMember &&
                executorMember.kickable
            ) {
                await executorMember
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
// FOREVER BAN CHECK
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
                            "[FOREVER BAN JOIN]",
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

            const owner =
                await guild.members
                    .fetch(guild.ownerId)
                    .catch(() => null);

            if (!owner) return;

            const text = [
                `VC+ has been installed in **${guild.name}**.`,
                "",
                setup
                    ? `**Join to Create:** ${setup.trigger}`
                    : "**Join to Create:** setup failed. Use `-vc setup`.",
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
                "Unauthorized channel and role changes are monitored.",
                "",
                "**IMPORTANT**",
                "Give VC+ the permissions it needs and place its bot role above the roles it must manage.",
                "Discord's permission hierarchy still applies."
            ].join("\n");

            await owner
                .send({
                    embeds: [
                        box(
                            "VC+ Installed",
                            text,
                            "success"
                        )
                    ]
                })
                .catch(() => {});

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

        // Repair Join to Create
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
// PROCESS ERROR HANDLERS
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
        "Create a .env file containing:"
    );

    console.error(
        "DISCORD_TOKEN=YOUR_BOT_TOKEN"
    );

    // Configuration error, not a Discord runtime crash.
    process.exitCode = 1;
} else {
    client.login(token)
        .catch(error => {
            console.error(
                "[LOGIN ERROR]",
                error
            );

            process.exitCode = 1;
        });
}
