```js
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

// ============================================================
// VC+
// One-file Discord bot
// ============================================================

const PREFIX = "-";
const BOT_NAME = "vc+";

// ---------------------------
// Client
// ---------------------------

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
// DATA
// ============================================================

const dataDir = path.join(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbFile = path.join(dataDir, "vcplus.json");

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
        db = JSON.parse(raw);

        if (!db || typeof db !== "object") {
            db = { guilds: {} };
        }

        if (!db.guilds) {
            db.guilds = {};
        }
    } catch (err) {
        console.error("[DB LOAD]", err);
        db = { guilds: {} };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            dbFile,
            JSON.stringify(db, null, 2)
        );
    } catch (err) {
        console.error("[DB SAVE]", err);
    }
}

loadDB();

// ============================================================
// RANK SYSTEM
// Bot-only ranks. No Discord roles are created.
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

    return db.guilds[guildId];
}

function getRank(guild, userId) {
    const data = guildData(guild.id);
    return data.ranks[userId] || "member";
}

function rankLevel(guild, userId) {
    return RANK_LEVEL[getRank(guild, userId)] || 1;
}

function isFounder(message) {
    return (
        message.guild?.ownerId === message.author.id ||
        getRank(message.guild, message.author.id) === "founder"
    );
}

function isGod(message) {
    return (
        isFounder(message) ||
        getRank(message.guild, message.author.id) === "god"
    );
}

function hasRank(message, level) {
    return rankLevel(
        message.guild,
        message.author.id
    ) >= level;
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description, type = "info") {
    const colors = {
        info: 0x5865f2,
        success: 0x57f287,
        error: 0xed4245,
        warning: 0xfee75c
    };

    return new EmbedBuilder()
        .setTitle(`${BOT_NAME} • ${title}`)
        .setDescription(description)
        .setColor(colors[type] ?? colors.info)
        .setTimestamp();
}

async function sendBox(message, title, description, type = "info") {
    return message.reply({
        embeds: [
            box(title, description, type)
        ]
    }).catch(() => null);
}

// ============================================================
// SAFE HELPERS
// ============================================================

function isBotOwner(message) {
    return message.guild?.ownerId === message.author.id;
}

function memberInGuild(message, id) {
    return message.guild.members.fetch(id).catch(() => null);
}

async function getTarget(message, value) {
    if (!value) return null;

    const mention = message.mentions.members.first();

    if (mention) return mention;

    const id = value.replace(/[<@!>]/g, "");

    if (!/^\d{15,25}$/.test(id)) {
        return null;
    }

    return memberInGuild(message, id);
}

function canModerate(message, target) {
    if (!target) return false;

    if (target.id === message.author.id) {
        return false;
    }

    if (target.id === message.guild.ownerId) {
        return false;
    }

    if (
        rankLevel(message.guild, target.id) >=
        rankLevel(message.guild, message.author.id)
    ) {
        return false;
    }

    return true;
}

// ============================================================
// VC MEMORY
// ============================================================

const temporaryVCs = new Map();

function getOwnedVC(member) {
    if (!member?.voice?.channelId) {
        return null;
    }

    const data =
        temporaryVCs.get(
            member.voice.channelId
        );

    if (!data) return null;

    return {
        channel: member.voice.channel,
        data
    };
}

// ============================================================
// VC PERMISSIONS
// ============================================================

function isVCOwner(message, vc) {
    if (!vc) return false;

    return (
        vc.data.ownerId === message.author.id ||
        isGod(message)
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

async function createVCInterface(channel, ownerId) {
    try {
        const existing = channel.guild.channels.cache.find(
            c =>
                c.type === ChannelType.GuildText &&
                c.name === `vc-${channel.id}`
        );

        if (existing) {
            return existing;
        }

        const text = await channel.guild.channels.create({
            name: `vc-${channel.id}`,
            type: ChannelType.GuildText,
            parent: channel.parentId ?? null,
            permissionOverwrites: [
                {
                    id: channel.guild.roles.everyone.id,
                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
                },
                {
                    id: ownerId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                }
            ],
            reason: "VC+ temporary VC interface"
        });

        await text.send({
            embeds: [
                box(
                    "Voice Control",
                    [
                        `Owner: <@${ownerId}>`,
                        "",
                        "**VC commands**",
                        "`-vc kick @user`",
                        "`-vc ban @user`",
                        "`-vc reject @user`",
                        "`-vc permit @user`",
                        "`-vc lock`",
                        "`-vc unlock`",
                        "`-vc limit 10`",
                        "`-vc rename My Room`",
                        "`-vc transfer @user`",
                        "`-vc stfu @user`",
                        "`-vc dragall`",
                        "`-interface`"
                    ].join("\n")
                )
            ]
        });

        return text;
    } catch (err) {
        console.error("[VC INTERFACE]", err);
        return null;
    }
}

// ============================================================
// VC SETUP
// ============================================================

async function setupVC(message) {
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

    const g = guildData(message.guild.id);

    try {
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

        let category =
            await message.guild.channels.create({
                name: "VC+",
                type: ChannelType.GuildCategory,
                reason: "VC+ setup"
            });

        const trigger =
            await message.guild.channels.create({
                name: "Join to Create",
                type: ChannelType.GuildVoice,
                parent: category.id,
                reason: "VC+ Join to Create"
            });

        g.jtc.categoryId = category.id;
        g.jtc.triggerId = trigger.id;

        saveDB();

        return sendBox(
            message,
            "Setup complete",
            [
                `Join **${trigger.name}** to automatically create your own voice channel.`,
                "",
                "Your new channel will look like:",
                `**${message.author.username} VC**`,
                "",
                "VC+ controls are available through `-vc`."
            ].join("\n"),
            "success"
        );

    } catch (err) {
        console.error("[VC SETUP]", err);

        return sendBox(
            message,
            "Setup failed",
            "I could not create the VC+ system. Make sure my bot role has **Manage Channels** and is high enough in the role hierarchy.",
            "error"
        );
    }
}

// ============================================================
// CREATE PERSONAL VC
// ============================================================

async function createPersonalVC(member, trigger) {
    const guild = member.guild;
    const g = guildData(guild.id);

    if (!trigger || trigger.id !== g.jtc.triggerId) {
        return null;
    }

    try {
        const existing = [...temporaryVCs.entries()]
            .find(([, value]) =>
                value.ownerId === member.id &&
                value.guildId === guild.id
            );

        if (existing) {
            const existingChannel =
                guild.channels.cache.get(existing[0]);

            if (existingChannel) {
                await member.voice.setChannel(
                    existingChannel
                ).catch(() => {});
                return existingChannel;
            }

            temporaryVCs.delete(existing[0]);
        }

        const channel =
            await guild.channels.create({
                name: `${member.user.username} VC`
                    .slice(0, 100),
                type: ChannelType.GuildVoice,
                parent: trigger.parentId ?? null,
                userLimit: 0,
                reason: "VC+ Join to Create",
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect
                        ]
                    },
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.Speak,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.MoveMembers
                        ]
                    }
                ]
            });

        temporaryVCs.set(
            channel.id,
            {
                guildId: guild.id,
                ownerId: member.id,
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

        await member.voice.setChannel(
            channel,
            "VC+ Join to Create"
        ).catch(() => {});

        return channel;

    } catch (err) {
        console.error("[CREATE VC]", err);
        return null;
    }
}

// ============================================================
// VC COMMAND
// ============================================================

async function handleVC(message, args) {
    const sub = args.shift()?.toLowerCase();

    if (!sub) {
        return sendBox(
            message,
            "VC commands",
            [
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
                "`-vc dragall`",
                "`-interface`"
            ].join("\n")
        );
    }

    if (sub === "setup") {
        return setupVC(message);
    }

    const owned = getOwnedVC(message.member);

    if (!owned) {
        return sendBox(
            message,
            "No VC",
            "You must be inside a VC+ temporary voice channel.",
            "error"
        );
    }

    const { channel, data } = owned;

    if (!isVCOwner(message, owned)) {
        return sendBox(
            message,
            "Access denied",
            "Only the owner of this VC, the server owner, God, or Founder can control this call.",
            "error"
        );
    }

    // ---------------------------
    // KICK
    // ---------------------------

    if (sub === "kick") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "VC kick",
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
                "That member is not in this call.",
                "error"
            );
        }

        if (!canModerate(message, target) &&
            !isGod(message)) {
            return sendBox(
                message,
                "Protected member",
                "You cannot control a member with equal or higher bot rank.",
                "error"
            );
        }

        await target.voice.disconnect(
            "VC+ owner kick"
        ).catch(() => {});

        return sendBox(
            message,
            "Member kicked",
            `${target} was removed from the call.`,
            "success"
        );
    }

    // ---------------------------
    // BAN
    // ---------------------------

    if (sub === "ban") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "VC ban",
                "Usage: `-vc ban @user`",
                "warning"
            );
        }

        if (
            !canModerate(message, target) &&
            !isGod(message)
        ) {
            return sendBox(
                message,
                "Protected member",
                "You cannot VC-ban a protected member.",
                "error"
            );
        }

        data.banned.add(target.id);

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.disconnect(
                "VC+ ban"
            ).catch(() => {});
        }

        return sendBox(
            message,
            "Member banned",
            `${target} can no longer join this temporary VC.`,
            "success"
        );
    }

    // ---------------------------
    // REJECT
    // ---------------------------

    if (sub === "reject") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "VC reject",
                "Usage: `-vc reject @user`",
                "warning"
            );
        }

        data.rejected.add(target.id);

        if (
            target.voice.channelId ===
            channel.id
        ) {
            await target.voice.disconnect(
                "VC+ rejected"
            ).catch(() => {});
        }

        return sendBox(
            message,
            "Rejected",
            `${target} is rejected from this VC.`,
            "success"
        );
    }

    // ---------------------------
    // PERMIT
    // ---------------------------

    if (sub === "permit") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "VC permit",
                "Usage: `-vc permit @user`",
                "warning"
            );
        }

        data.rejected.delete(target.id);
        data.banned.delete(target.id);
        data.permitted.add(target.id);

        return sendBox(
            message,
            "Permitted",
            `${target} is allowed to join this VC.`,
            "success"
        );
    }

    // ---------------------------
    // LOCK
    // ---------------------------

    if (sub === "lock") {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: false
            }
        ).catch(() => {});

        data.locked = true;

        return sendBox(
            message,
            "VC locked",
            "Your call is now locked.",
            "success"
        );
    }

    // ---------------------------
    // UNLOCK
    // ---------------------------

    if (sub === "unlock") {
        await channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                Connect: true
            }
        ).catch(() => {});

        data.locked = false;

        return sendBox(
            message,
            "VC unlocked",
            "Your call is now unlocked.",
            "success"
        );
    }

    // ---------------------------
    // LIMIT
    // ---------------------------

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
                "error"
            );
        }

        await channel.setUserLimit(
            limit
        ).catch(() => {});

        return sendBox(
            message,
            "Limit updated",
            `VC limit set to **${limit === 0 ? "unlimited" : limit}**.`,
            "success"
        );
    }

    // ---------------------------
    // RENAME
    // ---------------------------

    if (sub === "rename") {
        const name =
            args.join(" ").trim();

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

        await channel.setName(
            finalName
        ).catch(() => {});

        return sendBox(
            message,
            "VC renamed",
            `Your VC is now **${finalName}**.`,
            "success"
        );
    }

    // ---------------------------
    // TRANSFER
    // ---------------------------

    if (sub === "transfer") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "Transfer",
                "Usage: `-vc transfer @user`",
                "warning"
            );
        }

        data.ownerId = target.id;

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

    // ---------------------------
    // STFU
    // ---------------------------

    if (sub === "stfu") {
        const target =
            await getTarget(message, args[0]);

        if (!target) {
            return sendBox(
                message,
                "STFU",
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
                "That member is not in your VC.",
                "error"
            );
        }

        if (
            getRank(message.guild, target.id) === "founder" ||
            getRank(message.guild, target.id) === "god"
        ) {
            return sendBox(
                message,
                "Protected member",
                "You cannot use `-vc stfu` on Founder or God.",
                "error"
            );
        }

        data.stfu.add(target.id);

        await target.voice.setMute(
            true,
            "VC+ STFU"
        ).catch(() => {});

        return sendBox(
            message,
            "Member muted",
            `${target} is now locked muted in this VC.`,
            "success"
        );
    }

    // ---------------------------
    // DRAG ALL
    // ---------------------------

    if (sub === "dragall") {
        let moved = 0;

        for (const member of message.guild.members.cache.values()) {
            if (
                member.id === message.author.id ||
                !member.voice.channelId
            ) continue;

            await member.voice.setChannel(
                channel
            ).then(() => {
                moved++;
            }).catch(() => {});
        }

        return sendBox(
            message,
            "Drag all",
            `Attempted to move **${moved}** members into your VC.`,
            "success"
        );
    }

    return sendBox(
        message,
        "Unknown VC command",
        "Use `-vc` to see the available VC commands.",
        "error"
    );
}

// ============================================================
// INTERFACE COMMAND
// ============================================================

async function handleInterface(message) {
    const owned = getOwnedVC(message.member);

    if (!owned) {
        return sendBox(
            message,
            "No VC",
            "You must be inside your VC+ call.",
            "error"
        );
    }

    await createVCInterface(
        owned.channel,
        owned.data.ownerId
    );

    return sendBox(
        message,
        "Interface",
        "The VC+ control panel is available in your VC text channel.",
        "success"
    );
}

// ============================================================
// BASIC MODERATION
// ============================================================

async function banCommand(message, args) {
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
        await getTarget(message, args[0]);

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
            "You cannot ban the server owner or an equal/higher protected member.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
        "No reason provided";

    await target.ban({
        reason: `VC+ | ${reason}`
    }).catch(() => null);

    return sendBox(
        message,
        "Member banned",
        `${target.user.tag} was banned.\n\nReason: ${reason}`,
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
            "Permission denied",
            "`-foreverban` is restricted to **Founder** and **God**.",
            "error"
        );
    }

    const target =
        await getTarget(message, args[0]);

    if (!target) {
        return sendBox(
            message,
            "Forever ban",
            "Usage: `-foreverban @user`",
            "warning"
        );
    }

    if (
        target.id === message.guild.ownerId
    ) {
        return sendBox(
            message,
            "Protected",
            "The server owner cannot be forever banned.",
            "error"
        );
    }

    const g = guildData(message.guild.id);

    if (!g.foreverBanned.includes(target.id)) {
        g.foreverBanned.push(target.id);
    }

    saveDB();

    await target.ban({
        reason: "VC+ permanent bot ban"
    }).catch(() => {});

    return sendBox(
        message,
        "Forever banned",
        `${target.user.tag} has been added to the VC+ permanent ban list.`,
        "success"
    );
}

// ============================================================
// RANK
// ============================================================

async function rankCommand(message, args) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Permission denied",
            "Only Founder can manage VC+ ranks.",
            "error"
        );
    }

    const target =
        await getTarget(message, args[0]);

    const rank =
        String(args[1] || "")
            .toLowerCase()
            .replace(/[^a-z]/g, "");

    if (!target || !RANK_LEVEL[rank]) {
        return sendBox(
            message,
            "Rank",
            [
                "Usage: `-rank @user rank`",
                "",
                RANKS.map(
                    r => `\`${r}\``
                ).join(" • ")
            ].join("\n"),
            "warning"
        );
    }

    if (
        target.id === message.guild.ownerId &&
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
    ).ranks[target.id] = rank;

    saveDB();

    return sendBox(
        message,
        "Rank updated",
        `${target} is now **${rank}** in VC+.\n\nNo Discord role was created.`,
        "success"
    );
}

// ============================================================
// RANK LIST
// ============================================================

async function rankList(message) {
    return sendBox(
        message,
        "VC+ ranks",
        [
            "Founder — full VC+ access",
            "God — high-level VC+ access",
            "Owner — advanced access",
            "Co-Owner — advanced access",
            "Executive — staff access",
            "Director — staff access",
            "Admin — moderation access",
            "Moderator — moderation access",
            "Staff — basic staff access",
            "Member — standard access"
        ].join("\n")
    );
}

// ============================================================
// VOUCH
// ============================================================

async function vouch(message, args) {
    if (!isFounder(message)) {
        return sendBox(
            message,
            "Permission denied",
            "Only Founder can use the vouch system.",
            "error"
        );
    }

    const target =
        await getTarget(message, args[0]);

    if (!target) {
        return sendBox(
            message,
            "Vouch",
            "Usage: `-vouch add @user`",
            "warning"
        );
    }

    const g =
        guildData(message.guild.id);

    if (!g.vouches[target.id]) {
        g.vouches[target.id] = 0;
    }

    g.vouches[target.id]++;

    if (
        g.vouches[target.id] >=
        g.vouchLimit
    ) {
        g.ranks[target.id] = "god";
    }

    saveDB();

    return sendBox(
        message,
        "Vouch added",
        [
            `${target} now has **${g.vouches[target.id]}** vouch(es).`,
            `Required: **${g.vouchLimit}**`,
            "",
            g.vouches[target.id] >= g.vouchLimit
                ? "They reached the requirement and were promoted to **God**."
                : "They have not reached the requirement yet."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// MESSAGE COMMAND ROUTER
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
                parts.shift()?.toLowerCase();

            if (!command) return;

            // -------------------------
            // HELP
            // -------------------------

            if (command === "help") {
                return sendBox(
                    message,
                    "Help",
                    [
                        "**General**",
                        "`-help`",
                        "`-ping`",
                        "`-ranklist`",
                        "`-interface`",
                        "",
                        "**Moderation**",
                        "`-ban @user reason`",
                        "`-kick @user reason`",
                        "`-timeout @user minutes`",
                        "`-untimeout @user`",
                        "`-foreverban @user`",
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
                        "`-vc dragall`",
                        "",
                        "**Ranks**",
                        "`-rank @user rank`",
                        "`-ranklist`",
                        "`-vouch add @user`"
                    ].join("\n")
                );
            }

            // -------------------------
            // PING
            // -------------------------

            if (command === "ping") {
                return sendBox(
                    message,
                    "Pong",
                    `Latency: **${client.ws.ping}ms**`,
                    "success"
                );
            }

            // -------------------------
            // INTERFACE
            // -------------------------

            if (command === "interface") {
                return handleInterface(message);
            }

            // -------------------------
            // RANK LIST
            // -------------------------

            if (command === "ranklist") {
                return rankList(message);
            }

            // -------------------------
            // RANK
            // -------------------------

            if (command === "rank") {
                return rankCommand(
                    message,
                    parts
                );
            }

            // -------------------------
            // VOUCH
            // -------------------------

            if (command === "vouch") {
                return vouch(
                    message,
                    parts
                );
            }

            // -------------------------
            // VC
            // -------------------------

            if (command === "vc") {
                return handleVC(
                    message,
                    parts
                );
            }

            // -------------------------
            // BAN
            // -------------------------

            if (command === "ban") {
                return banCommand(
                    message,
                    parts
                );
            }

            // -------------------------
            // FOREVER BAN
            // -------------------------

            if (command === "foreverban") {
                return foreverBan(
                    message,
                    parts
                );
            }

            // -------------------------
            // KICK
            // -------------------------

            if (command === "kick") {
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
                        "Kick",
                        "That member cannot be kicked.",
                        "error"
                    );
                }

                await target.kick(
                    parts.slice(1).join(" ") ||
                    "VC+ kick"
                ).catch(() => {});

                return sendBox(
                    message,
                    "Member kicked",
                    `${target.user.tag} was kicked.`,
                    "success"
                );
            }

            // -------------------------
            // TIMEOUT
            // -------------------------

            if (command === "timeout") {
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

                await target.timeout(
                    duration,
                    "VC+ timeout"
                ).catch(() => {});

                return sendBox(
                    message,
                    "Timed out",
                    `${target.user.tag} was timed out for **${minutes} minutes**.`,
                    "success"
                );
            }

            // -------------------------
            // UNTIMEOUT
            // -------------------------

            if (command === "untimeout") {
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

                await target.timeout(
                    null,
                    "VC+ untimeout"
                ).catch(() => {});

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
                `I don't recognize \`${PREFIX}${command}\`.\nUse \`-help\` to see the commands.`,
                "error"
            );

        } catch (err) {
            console.error(
                "[COMMAND ERROR]",
                err
            );

            await sendBox(
                message,
                "Command error",
                "Something went wrong while processing that command. Check the bot permissions and try again.",
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
    async (oldState, newState) => {
        try {
            const guild =
                newState.guild ||
                oldState.guild;

            if (!guild) return;

            const g =
                guildData(guild.id);

            // -------------------------
            // JOIN TO CREATE
            // -------------------------

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
                        "[JTC] Failed to create VC"
                    );
                }

                return;
            }

            // -------------------------
            // VC PROTECTION
            // -------------------------

            if (newState.channelId) {
                const data =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (data) {
                    const userId =
                        newState.id;

                    if (
                        data.banned.has(
                            userId
                        ) ||
                        data.rejected.has(
                            userId
                        )
                    ) {
                        await newState.member
                            ?.voice
                            .disconnect(
                                "VC+ access denied"
                            )
                            .catch(() => {});

                        return;
                    }

                    // Auto-unmute Founder/God
                    const rank =
                        getRank(
                            guild,
                            userId
                        );

                    if (
                        rank === "founder" ||
                        rank === "god"
                    ) {
                        await newState.member
                            ?.voice
                            .setMute(
                                false,
                                "VC+ protected rank"
                            )
                            .catch(() => {});
                    }

                    // STFU protection
                    if (
                        data.stfu.has(
                            userId
                        )
                    ) {
                        await newState.member
                            ?.voice
                            .setMute(
                                true,
                                "VC+ STFU protection"
                            )
                            .catch(() => {});
                    }
                }
            }

            // -------------------------
            // CLEAN EMPTY VC
            // -------------------------

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

                if (
                    data &&
                    oldChannel.members.size === 0
                ) {
                    temporaryVCs.delete(
                        oldChannel.id
                    );

                    const interfaceChannel =
                        guild.channels.cache.find(
                            c =>
                                c.type === ChannelType.GuildText &&
                                c.name ===
                                `vc-${oldChannel.id}`
                        );

                    if (interfaceChannel) {
                        await interfaceChannel.delete(
                            "VC+ temporary VC cleanup"
                        ).catch(() => {});
                    }

                    await oldChannel.delete(
                        "VC+ temporary VC cleanup"
                    ).catch(() => {});
                }
            }

        } catch (err) {
            console.error(
                "[VOICE STATE ERROR]",
                err
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
                guildData(member.guild.id);

            if (
                g.foreverBanned.includes(
                    member.id
                )
            ) {
                await member.ban({
                    reason:
                        "VC+ permanent bot ban"
                }).catch(() => {});
            }
        } catch (err) {
            console.error(
                "[FOREVER BAN]",
                err
            );
        }
    }
);

// ============================================================
// GODMODE
// ============================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
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

            await newState.member.voice.setMute(
                false,
                "VC+ Godmode protection"
            ).catch(() => {});

        } catch (err) {
            console.error(
                "[GODMODE]",
                err
            );
        }
    }
);

// ============================================================
// SECURITY
// ============================================================

// Prevent bot commands from being used to target
// equal/higher VC+ ranks.

client.on(
    "guildMemberUpdate",
    async (oldMember, newMember) => {
        try {
            const oldRank =
                getRank(
                    newMember.guild,
                    newMember.id
                );

            if (
                oldRank === "founder" ||
                oldRank === "god"
            ) {
                // Keep protected members unmuted.
                if (
                    newMember.voice.serverMute
                ) {
                    await newMember.voice
                        .setMute(
                            false,
                            "VC+ protection"
                        )
                        .catch(() => {});
                }
            }
        } catch (err) {
            console.error(
                "[SECURITY]",
                err
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
        console.log(
            "================================"
        );
        console.log(
            "vc+ is online"
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
                    name: "VC+ | -help",
                    type: 0
                }
            ]
        });
    }
);

// ============================================================
// GLOBAL ERROR PROTECTION
// ============================================================

client.on(
    "error",
    err => {
        console.error(
            "[CLIENT ERROR]",
            err
        );
    }
);

client.on(
    "shardError",
    err => {
        console.error(
            "[SHARD ERROR]",
            err
        );
    }
);

process.on(
    "unhandledRejection",
    err => {
        console.error(
            "[UNHANDLED REJECTION]",
            err
        );
    }
);

process.on(
    "uncaughtException",
    err => {
        console.error(
            "[UNCAUGHT EXCEPTION]",
            err
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
        "Missing DISCORD_TOKEN in .env"
    );

    process.exit(1);
}

client.login(token)
    .catch(err => {
        console.error(
            "[LOGIN ERROR]",
            err
        );

        process.exit(1);
    });
```
