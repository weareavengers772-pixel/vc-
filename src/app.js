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
// Bleed-inspired moderation / VC bot
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
            db.guilds ??= {};
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

// ============================================================
// GUILD DATA
// ============================================================

function guildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            foreverBanned: [],
            vouches: {},
            vouchLimit: 1,

            godmode: {},

            protection: {
                enabled: true
            },

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

    data.protection ??= {};
    data.protection.enabled ??= true;

    data.jtc ??= {};
    data.jtc.categoryId ??= null;
    data.jtc.triggerId ??= null;

    return data;
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
        guild.ownerId === userId ||
        rank === "founder" ||
        rank === "god"
    );
}

// ============================================================
// BLEED-STYLE EMBEDS
// ============================================================

const COLORS = {
    main: 0xff4fa3,
    success: 0xff4fa3,
    error: 0x111111,
    warning: 0x242424
};

function box(title, description, type = "main") {
    return new EmbedBuilder()
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setColor(COLORS[type] ?? COLORS.main)
        .setFooter({
            text: "vc+ • protection system"
        })
        .setTimestamp();
}

async function sendBox(
    message,
    title,
    description,
    type = "main"
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
// SAFE TARGET
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
        if (!target || !message.guild) {
            return false;
        }

        if (target.id === message.author.id) {
            return false;
        }

        if (target.id === message.guild.ownerId) {
            return false;
        }

        if (isProtected(message.guild, target.id)) {
            return false;
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
// TEMPORARY VC STORAGE
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
    locked
}
*/

// ============================================================
// FIND PERSONAL VC
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
        console.error("[GET VC]", error);
        return null;
    }
}

// ============================================================
// VC ACCESS
// ============================================================

function canControlVC(message, data) {
    if (!data) return false;

    return (
        data.ownerId === message.author.id ||
        isGod(message)
    );
}

// ============================================================
// BASIC JOIN TO CREATE
// NO TEXT CHANNEL
// ============================================================

async function setupVC(message) {
    try {
        if (
            !message.member.permissions.has(
                PermissionFlagsBits.ManageChannels
            ) &&
            !isFounder(message)
        ) {
            return sendBox(
                message,
                "Access denied",
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
                "Already enabled",
                `Join to Create is already active in <#${existing.id}>.`,
                "warning"
            );
        }

        const category =
            await message.guild.channels.create({
                name: "VC+",
                type: ChannelType.GuildCategory,
                reason: "VC+ Join to Create"
            });

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
            "Join to Create",
            [
                `Trigger: <#${trigger.id}>`,
                "",
                "Join the channel and VC+ will create",
                "a temporary personal voice channel for you.",
                "",
                "Empty temporary calls are automatically deleted."
            ].join("\n"),
            "success"
        );

    } catch (error) {
        console.error("[VC SETUP]", error);

        return sendBox(
            message,
            "Setup failed",
            "VC+ couldn't create the Join to Create system. Check **Manage Channels**.",
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

        // Existing VC check
        for (const [
            channelId,
            data
        ] of temporaryVCs) {

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

                temporaryVCs.delete(channelId);
            }
        }

        const username =
            member.user.username
                .replace(/[^\w\s\-+]/g, "")
                .slice(0, 80)
                .trim() ||
            "User";

        const channel =
            await guild.channels.create({
                name: `${username} VC`,
                type: ChannelType.GuildVoice,
                parent: trigger.parentId ?? null,
                userLimit: 0,
                reason: "VC+ personal VC"
            });

        const data = {
            guildId: guild.id,
            ownerId: member.id,

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

        await member.voice
            .setChannel(
                channel,
                "VC+ Join to Create"
            )
            .catch(error => {
                console.error(
                    "[VC MOVE]",
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
// VC HELP
// ============================================================

function vcHelp(message) {
    return sendBox(
        message,
        "Voice",
        [
            "`-vc setup` — create Join to Create",
            "`-vc kick @user` — remove member",
            "`-vc ban @user` — block member",
            "`-vc reject @user` — reject member",
            "`-vc permit @user` — allow member",
            "`-vc lock` — lock VC",
            "`-vc unlock` — unlock VC",
            "`-vc limit 10` — set limit",
            "`-vc rename name` — rename VC",
            "`-vc transfer @user` — transfer owner",
            "`-vc stfu @user` — server mute lock",
            "`-vc unstfu @user` — remove STFU",
            "`-vc dragall` — Founder only"
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
                "Only the VC owner, Founder, or God can control this call.",
                "error"
            );
        }

        // ------------------------------------------------------
        // KICK
        // ------------------------------------------------------

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
                    "Protected",
                    "You cannot kick that member.",
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

        // ------------------------------------------------------
        // BAN
        // ------------------------------------------------------

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
                    "Protected",
                    "You cannot VC-ban that member.",
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
                `${target} can no longer join this call.`,
                "success"
            );
        }

        // ------------------------------------------------------
        // REJECT
        // ------------------------------------------------------

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
                    "Protected",
                    "You cannot reject that member.",
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

        // ------------------------------------------------------
        // PERMIT
        // ------------------------------------------------------

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
                `${target} can now join this VC.`,
                "success"
            );
        }

        // ------------------------------------------------------
        // LOCK
        // ------------------------------------------------------

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
                "Your voice channel is now locked.",
                "success"
            );
        }

        // ------------------------------------------------------
        // UNLOCK
        // ------------------------------------------------------

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
                "Your voice channel is now unlocked.",
                "success"
            );
        }

        // ------------------------------------------------------
        // LIMIT
        // ------------------------------------------------------

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
                .catch(error => {
                    console.error(
                        "[VC LIMIT]",
                        error
                    );
                });

            return sendBox(
                message,
                "Limit updated",
                `Limit: **${
                    limit === 0
                        ? "unlimited"
                        : limit
                }**`,
                "success"
            );
        }

        // ------------------------------------------------------
        // RENAME
        // ------------------------------------------------------

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
                .setName(name)
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

        // ------------------------------------------------------
        // TRANSFER
        // ------------------------------------------------------

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
                    "That member already has protected access.",
                    "warning"
                );
            }

            data.ownerId =
                target.id;

            return sendBox(
                message,
                "Ownership transferred",
                `${target} now owns this VC.`,
                "success"
            );
        }

        // ------------------------------------------------------
        // STFU
        // ------------------------------------------------------

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
                    "Founder and God cannot be VC-STFU'd.",
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
                    "That member isn't in this call.",
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
                    "The mute remains until:",
                    "`-vc unstfu @user`"
                ].join("\n"),
                "success"
            );
        }

        // ------------------------------------------------------
        // UNSTFU
        // ------------------------------------------------------

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

            if (
                target.voice.channelId ===
                channel.id
            ) {
                await target.voice
                    .setMute(
                        false,
                        "VC+ STFU removed"
                    )
                    .catch(() => {});
            }

            return sendBox(
                message,
                "STFU removed",
                `${target} can speak again.`,
                "success"
            );
        }

        // ------------------------------------------------------
        // DRAGALL
        // ------------------------------------------------------

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

            return sendBox(
                message,
                "Dragall complete",
                `Moved **${moved}** eligible members.`,
                "success"
            );
        }

        return sendBox(
            message,
            "Unknown command",
            `Unknown VC command: \`-vc ${sub}\``,
            "error"
        );

    } catch (error) {
        console.error(
            "[VC COMMAND]",
            error
        );

        return sendBox(
            message,
            "Command failed",
            "The command failed safely. VC+ stayed online.",
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
        "Ranks",
        [
            "**10** • Founder",
            "**9** • God",
            "**8** • Owner",
            "**7** • Co-Owner",
            "**6** • Executive",
            "**5** • Director",
            "**4** • Admin",
            "**3** • Moderator",
            "**2** • Staff",
            "**1** • Member",
            "",
            "VC+ ranks are bot-managed."
        ].join("\n")
    );
}

// ============================================================
// RANK COMMAND
// ============================================================

async function rankCommand(message, args) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Access denied",
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
                "`-rank @user founder`",
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
            "The server owner cannot receive a lower rank.",
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
// VOUCH
// ============================================================

async function vouch(message, args) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Access denied",
            "Only **Founder** can manage vouches.",
            "error"
        );
    }

    const action =
        String(args.shift() || "")
            .toLowerCase();

    const g =
        guildData(message.guild.id);

    if (action === "limit") {
        const limit =
            Number(args[0]);

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            return sendBox(
                message,
                "Invalid limit",
                "Choose a number from `1` to `100`.",
                "warning"
            );
        }

        g.vouchLimit = limit;
        saveDB();

        return sendBox(
            message,
            "Vouch limit",
            `Required vouches: **${limit}**`,
            "success"
        );
    }

    if (action === "add") {
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
                "Invalid",
                "You cannot vouch for yourself.",
                "error"
            );
        }

        g.vouches[target.id] ??= 0;
        g.vouches[target.id]++;

        const count =
            g.vouches[target.id];

        let promoted = false;

        if (
            count >=
            g.vouchLimit
        ) {
            g.ranks[target.id] = "god";
            promoted = true;
        }

        saveDB();

        return sendBox(
            message,
            "Vouch added",
            [
                `${target} • **${count}** vouch(es)`,
                `Required • **${g.vouchLimit}**`,
                "",
                promoted
                    ? "Requirement reached — promoted to **God**."
                    : "Requirement not reached."
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
            `Current limit: **${g.vouchLimit}**`
        ].join("\n"),
        "warning"
    );
}

// ============================================================
// GODMODE
// ============================================================

async function godmodeCommand(message, args) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Access denied",
            "Only **Founder** can manage Godmode.",
            "error"
        );
    }

    const action =
        String(args.shift() || "")
            .toLowerCase();

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
        return sendBox(
            message,
            "Protected rank required",
            "Godmode can only be assigned to Founder/God.",
            "error"
        );
    }

    const g =
        guildData(message.guild.id);

    g.godmode[target.id] =
        action === "on";

    saveDB();

    return sendBox(
        message,
        "Godmode",
        [
            `${target} • **${
                action === "on"
                    ? "ON"
                    : "OFF"
            }**`,
            "",
            "Voice protection is active."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// BAN
// ============================================================

async function banCommand(message, args) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        return sendBox(
            message,
            "Access denied",
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
            "Protected",
            "That member cannot be banned.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ").trim() ||
        "No reason provided";

    try {
        await target.ban({
            reason: `VC+ | ${reason}`
        });
    } catch (error) {
        console.error(
            "[BAN]",
            error
        );

        return sendBox(
            message,
            "Ban failed",
            "Discord rejected the ban. Check role hierarchy and permissions.",
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

async function foreverBan(message, args) {
    if (!isGod(message)) {
        return sendBox(
            message,
            "Access denied",
            "`-foreverban` is Founder/God only.",
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
        isProtected(
            message.guild,
            target.id
        )
    ) {
        return sendBox(
            message,
            "Protected",
            "Protected members cannot be forever banned.",
            "error"
        );
    }

    const g =
        guildData(message.guild.id);

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

    await target.ban({
        reason: "VC+ permanent ban"
    }).catch(error => {
        console.error(
            "[FOREVER BAN]",
            error
        );
    });

    return sendBox(
        message,
        "Forever banned",
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
        "Help",
        [
            "**GENERAL**",
            "`-help`",
            "`-ping`",
            "`-ranklist`",
            "",
            "**VOICE**",
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
            "**MODERATION**",
            "`-ban @user reason`",
            "`-kick @user reason`",
            "`-timeout @user minutes`",
            "`-untimeout @user`",
            "`-foreverban @user`",
            "",
            "**STAFF**",
            "`-rank @user rank`",
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
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                String(
                    parts.shift() || ""
                ).toLowerCase();

            if (!command) return;

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

            if (command === "vouch") {
                return vouch(
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

            if (command === "ban") {
                return banCommand(
                    message,
                    parts
                );
            }

            if (command === "foreverban") {
                return foreverBan(
                    message,
                    parts
                );
            }

            // ------------------------------------------------
            // KICK
            // ------------------------------------------------

            if (command === "kick") {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.KickMembers
                    )
                ) {
                    return sendBox(
                        message,
                        "Access denied",
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
                    .catch(() => {});

                return sendBox(
                    message,
                    "Member kicked",
                    `${target.user.tag} was kicked.`,
                    "success"
                );
            }

            // ------------------------------------------------
            // TIMEOUT
            // ------------------------------------------------

            if (command === "timeout") {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return sendBox(
                        message,
                        "Access denied",
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

                return sendBox(
                    message,
                    "Timed out",
                    `${target.user.tag} • **${minutes} minute(s)**`,
                    "success"
                );
            }

            // ------------------------------------------------
            // UNTIMEOUT
            // ------------------------------------------------

            if (command === "untimeout") {
                if (
                    !message.member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    )
                ) {
                    return sendBox(
                        message,
                        "Access denied",
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
                        "Protected",
                        "You cannot untimeout that member.",
                        "error"
                    );
                }

                await target
                    .timeout(
                        null,
                        "VC+ untimeout"
                    )
                    .catch(() => {});

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
                    `Unknown command: \`${PREFIX}${command}\``,
                    "",
                    "Use `-help` to view commands."
                ].join("\n"),
                "error"
            );

        } catch (error) {
            console.error(
                "[MESSAGE ROUTER]",
                error
            );

            await sendBox(
                message,
                "Command error",
                "The command failed safely. VC+ remained online.",
                "error"
            ).catch(() => {});
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
            // PERSONAL VC PROTECTION
            // ------------------------------------------------

            if (newState.channelId) {
                const data =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (data) {
                    const member =
                        newState.member;

                    if (!member) return;

                    const userId =
                        member.id;

                    // VC ban / reject
                    if (
                        data.banned.has(userId) ||
                        data.rejected.has(userId)
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ access denied"
                            )
                            .catch(() => {});

                        return;
                    }

                    // Founder / God protection
                    if (
                        isProtected(
                            guild,
                            userId
                        )
                    ) {
                        await member.voice
                            .setMute(
                                false,
                                "VC+ protected"
                            )
                            .catch(() => {});
                    }

                    // STFU
                    if (
                        data.stfu.has(userId) &&
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
            // GODMODE SERVER-MUTE PROTECTION
            // ------------------------------------------------

            if (
                newState.serverMute &&
                newState.member
            ) {
                const userId =
                    newState.member.id;

                const enabled =
                    g.godmode[userId] === true;

                if (
                    isProtected(
                        guild,
                        userId
                    ) ||
                    enabled
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
            // DELETE EMPTY PERSONAL VC
            // ------------------------------------------------

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
                                "[VC CLEANUP]",
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
// SERVER PROTECTION
// ============================================================
//
// Important:
// Discord audit logs tell us WHO performed an action,
// but the bot cannot magically prevent actions performed
// by users whose permissions outrank the bot.
//
// Therefore the bot:
// 1. Watches destructive actions.
// 2. Checks the actor.
// 3. Allows server owner / Founder.
// 4. Blocks/reverts actions when Discord allows it.
// ============================================================

async function getRecentAuditEntry(
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

        return logs.entries.find(
            entry =>
                (!targetId ||
                    entry.target?.id === targetId) &&
                Date.now() -
                    entry.createdTimestamp <
                    10000
        );

    } catch (error) {
        console.error(
            "[AUDIT LOG]",
            error
        );

        return null;
    }
}

function actorIsAllowed(
    guild,
    userId
) {
    return (
        userId === guild.ownerId ||
        getRank(guild, userId) === "founder"
    );
}

// ============================================================
// CHANNEL CREATE PROTECTION
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

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    channel.guild,
                    AuditLogEvent.ChannelCreate,
                    channel.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    channel.guild,
                    entry.executorId
                )
            ) {
                return;
            }

            // Don't delete VC+ channels created by the bot.
            if (
                entry.executorId ===
                client.user.id
            ) {
                return;
            }

            await channel
                .delete(
                    "VC+ server protection"
                )
                .catch(() => {});

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
            if (!channel.guild) return;

            const g =
                guildData(
                    channel.guild.id
                );

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    channel.guild,
                    AuditLogEvent.ChannelDelete,
                    channel.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    channel.guild,
                    entry.executorId
                )
            ) {
                return;
            }

            // Discord does not provide a universal
            // one-call channel restore API.
            // Log the unauthorized action safely.
            console.warn(
                `[PROTECTION] Unauthorized channel deletion by ${entry.executorId}`
            );

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

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    guild,
                    AuditLogEvent.RoleCreate,
                    role.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    guild,
                    entry.executorId
                )
            ) {
                return;
            }

            // Remove unauthorized role.
            await role
                .delete(
                    "VC+ unauthorized role protection"
                )
                .catch(() => {});

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

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    guild,
                    AuditLogEvent.RoleDelete,
                    role.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    guild,
                    entry.executorId
                )
            ) {
                return;
            }

            console.warn(
                `[PROTECTION] Unauthorized role deletion by ${entry.executorId}`
            );

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
// ============================================================

client.on(
    "roleUpdate",
    async (oldRole, newRole) => {
        try {
            const guild =
                newRole.guild;

            const g =
                guildData(guild.id);

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    guild,
                    AuditLogEvent.RoleUpdate,
                    newRole.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    guild,
                    entry.executorId
                )
            ) {
                return;
            }

            // Prevent unauthorized dangerous permissions.
            const dangerous =
                newRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            const oldDangerous =
                oldRole.permissions.has(
                    PermissionFlagsBits.Administrator
                );

            if (
                dangerous &&
                !oldDangerous
            ) {
                await newRole
                    .setPermissions(
                        oldRole.permissions,
                        "VC+ unauthorized admin permission protection"
                    )
                    .catch(() => {});
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
// GUILD UPDATE PROTECTION
// ============================================================

client.on(
    "guildUpdate",
    async (oldGuild, newGuild) => {
        try {
            const g =
                guildData(
                    newGuild.id
                );

            if (!g.protection.enabled) {
                return;
            }

            const entry =
                await getRecentAuditEntry(
                    newGuild,
                    AuditLogEvent.GuildUpdate,
                    newGuild.id
                );

            if (!entry) return;

            if (
                actorIsAllowed(
                    newGuild,
                    entry.executorId
                )
            ) {
                return;
            }

            console.warn(
                `[PROTECTION] Unauthorized server update by ${entry.executorId}`
            );

        } catch (error) {
            console.error(
                "[GUILD UPDATE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// SERVER PROTECTION STATUS
// ============================================================

async function protectionCommand(
    message,
    args
) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Access denied",
            "Only **Founder** can control server protection.",
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

    if (
        action !== "on" &&
        action !== "off"
    ) {
        return sendBox(
            message,
            "Protection",
            [
                "`-protection on`",
                "`-protection off`",
                "",
                `Status: **${
                    g.protection.enabled
                        ? "ON"
                        : "OFF"
                }**`
            ].join("\n"),
            "warning"
        );
    }

    g.protection.enabled =
        action === "on";

    saveDB();

    return sendBox(
        message,
        "Protection updated",
        `Server protection is now **${
            action === "on"
                ? "ON"
                : "OFF"
        }**.`,
        "success"
    );
}

// ============================================================
// PROTECTION COMMAND ROUTE
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
                    "-protection"
                )
            ) {
                return;
            }

            const parts =
                message.content
                    .trim()
                    .split(/\s+/);

            parts.shift();

            await protectionCommand(
                message,
                parts
            );

        } catch (error) {
            console.error(
                "[PROTECTION COMMAND]",
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
// READY
// ============================================================

client.once(
    "ready",
    () => {
        console.log(
            "======================================"
        );

        console.log(
            "VC+ ONLINE"
        );

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        console.log(
            "Protection system: READY"
        );

        console.log(
            "Join to Create: READY"
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
                            "-help | VC+",
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

client.login(token)
    .catch(error => {
        console.error(
            "[LOGIN ERROR]",
            error
        );

        process.exit(1);
    });
