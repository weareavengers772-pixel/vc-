import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
    AuditLogEvent
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// VC+
// Discord.js v14
// Single-file bot
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

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "vcplus.json");

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, {
                recursive: true
            });
        }
    } catch (error) {
        console.error("[DATA DIR ERROR]", error);
    }
}

ensureDataDir();

let db = {
    guilds: {}
};

function saveDB() {
    try {
        ensureDataDir();

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
        console.error("[DB SAVE ERROR]", error);
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
            !parsed ||
            typeof parsed !== "object"
        ) {
            throw new Error("Invalid database");
        }

        db = parsed;

        if (!db.guilds) {
            db.guilds = {};
        }
    } catch (error) {
        console.error("[DB LOAD ERROR]", error);

        db = {
            guilds: {}
        };

        saveDB();
    }
}

loadDB();

// ============================================================
// RANKS
// BOT-ONLY — NO DISCORD ROLES
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

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            godmode: {},
            foreverBanned: [],
            vouches: {},
            vouchLimit: 1,

            jtc: {
                categoryId: null,
                triggerId: null
            }
        };
    }

    const data = db.guilds[guildId];

    data.ranks ??= {};
    data.godmode ??= {};
    data.foreverBanned ??= [];
    data.vouches ??= {};
    data.vouchLimit ??= 1;

    data.jtc ??= {
        categoryId: null,
        triggerId: null
    };

    return data;
}

function getRank(guild, userId) {
    if (!guild || !userId) {
        return "member";
    }

    const data = getGuildData(guild.id);

    return (
        data.ranks[userId] ||
        "member"
    );
}

function getRankLevel(guild, userId) {
    return (
        RANK_LEVEL[
            getRank(guild, userId)
        ] || 1
    );
}

function isFounder(memberOrMessage) {
    const guild =
        memberOrMessage.guild;

    const userId =
        memberOrMessage.author?.id ||
        memberOrMessage.id;

    if (!guild || !userId) {
        return false;
    }

    return (
        guild.ownerId === userId ||
        getRank(guild, userId) === "founder"
    );
}

function isGod(memberOrMessage) {
    const guild =
        memberOrMessage.guild;

    const userId =
        memberOrMessage.author?.id ||
        memberOrMessage.id;

    if (!guild || !userId) {
        return false;
    }

    const rank =
        getRank(
            guild,
            userId
        );

    return (
        rank === "founder" ||
        rank === "god"
    );
}

function hasBotRank(message, requiredLevel) {
    if (!message.guild) {
        return false;
    }

    return (
        getRankLevel(
            message.guild,
            message.author.id
        ) >= requiredLevel
    );
}

// ============================================================
// EMBEDS / BOXES
// ============================================================

function makeBox(
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
        .setDescription(description)
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
                makeBox(
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
// SAFE DISCORD HELPERS
// ============================================================

async function fetchMember(
    guild,
    id
) {
    try {
        if (!guild || !id) {
            return null;
        }

        return await guild.members.fetch(id);
    } catch {
        return null;
    }
}

async function getTarget(
    message,
    argument
) {
    try {
        if (!argument) {
            return null;
        }

        const mentioned =
            message.mentions.members.first();

        if (mentioned) {
            return mentioned;
        }

        const id =
            argument.replace(
                /[<@!>]/g,
                ""
            );

        if (
            !/^\d{15,25}$/.test(id)
        ) {
            return null;
        }

        return await fetchMember(
            message.guild,
            id
        );
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

    const actorLevel =
        getRankLevel(
            message.guild,
            message.author.id
        );

    const targetLevel =
        getRankLevel(
            message.guild,
            target.id
        );

    return targetLevel < actorLevel;
}

// ============================================================
// TEMP VC MEMORY
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
    locked: Boolean
}
*/

// ============================================================
// VC LOOKUP
// ============================================================

function getOwnedVC(member) {
    if (
        !member ||
        !member.voice?.channelId
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
        isGod(message)
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

async function createVCInterface(
    voiceChannel,
    ownerId
) {
    try {
        const guild =
            voiceChannel.guild;

        const data =
            temporaryVCs.get(
                voiceChannel.id
            );

        if (!data) {
            return null;
        }

        if (data.interfaceId) {
            const existing =
                guild.channels.cache.get(
                    data.interfaceId
                );

            if (existing) {
                return existing;
            }
        }

        const textChannel =
            await guild.channels.create({
                name:
                    `vc-${voiceChannel.id}`
                        .slice(0, 100),

                type:
                    ChannelType.GuildText,

                parent:
                    voiceChannel.parentId ??
                    null,

                permissionOverwrites: [
                    {
                        id:
                            guild.roles.everyone.id,

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

                reason:
                    "VC+ temporary interface"
            });

        data.interfaceId =
            textChannel.id;

        await textChannel.send({
            embeds: [
                makeBox(
                    "Voice Control",
                    [
                        `Owner: <@${data.ownerId}>`,
                        "",
                        "**VC Commands**",
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
                        "`-vc stfu up @user`",
                        "`-vc unstfu @user`",
                        "`-vc dragall` • Founder",
                        "",
                        "`-interface`",
                        "",
                        "**Protected:** Founder / God"
                    ].join("\n")
                )
            ]
        }).catch(() => {});

        return textChannel;
    } catch (error) {
        console.error(
            "[VC INTERFACE ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// JOIN TO CREATE SETUP
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
                "Permission Denied",
                [
                    "You need:",
                    "",
                    "`Manage Channels`"
                ].join("\n"),
                "error"
            );
        }

        const guildData =
            getGuildData(
                message.guild.id
            );

        if (
            guildData.jtc.triggerId &&
            message.guild.channels.cache.has(
                guildData.jtc.triggerId
            )
        ) {
            return sendBox(
                message,
                "Already Setup",
                [
                    "**Join to Create** is already configured.",
                    "",
                    `Trigger: <#${guildData.jtc.triggerId}>`
                ].join("\n"),
                "warning"
            );
        }

        const category =
            await message.guild.channels.create({
                name: "VC+",
                type: ChannelType.GuildCategory,
                reason: "VC+ Join to Create setup"
            });

        const trigger =
            await message.guild.channels.create({
                name: "Join to Create",
                type: ChannelType.GuildVoice,
                parent: category.id,
                reason: "VC+ Join to Create"
            });

        guildData.jtc.categoryId =
            category.id;

        guildData.jtc.triggerId =
            trigger.id;

        saveDB();

        return sendBox(
            message,
            "Setup Complete",
            [
                `Join <#${trigger.id}> to create your own call.`,
                "",
                "Your call will be named:",
                `**username VC**`,
                "",
                "A VC control interface will be created automatically."
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
            "Setup Failed",
            [
                "I couldn't finish the VC setup.",
                "",
                "Make sure the bot has:",
                "`Manage Channels`",
                "`Move Members`",
                "`Mute Members`"
            ].join("\n"),
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

        const guildData =
            getGuildData(
                guild.id
            );

        if (
            trigger.id !==
            guildData.jtc.triggerId
        ) {
            return null;
        }

        // Already has a VC
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
                .slice(0, 100);

        const channel =
            await guild.channels.create({
                name: safeName,

                type:
                    ChannelType.GuildVoice,

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

        const vcData = {
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
            vcData
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
            "[CREATE PERSONAL VC ERROR]",
            error
        );

        return null;
    }
}

// ============================================================
// VC HELP
// ============================================================

function vcHelpText() {
    return [
        "**VC Commands**",
        "",
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
        "`-vc stfu up @user`",
        "`-vc unstfu @user`",
        "`-vc dragall`",
        "`-vc interface`"
    ].join("\n");
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
            args.shift()?.toLowerCase();

        if (!sub) {
            return sendBox(
                message,
                "VC",
                vcHelpText()
            );
        }

        if (
            sub === "setup"
        ) {
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
                [
                    "You aren't inside a VC+ call.",
                    "",
                    "Use `-vc setup` to configure Join to Create."
                ].join("\n"),
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
                "No Permission",
                [
                    "You don't control this call.",
                    "",
                    `Owner: <@${data.ownerId}>`,
                    "",
                    "Only the VC owner, God, or Founder can control it."
                ].join("\n"),
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
                    "Not In VC",
                    `${target} isn't in this call.`,
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
                    "Protected Member",
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
                "VC Kick",
                `${target} was removed from the call.`,
                "success"
            );
        }

        // ====================================================
        // VC BAN
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
                ) &&
                !isGod(message)
            ) {
                return sendBox(
                    message,
                    "Protected Member",
                    "You cannot VC-ban an equal or higher rank.",
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
                "VC Ban",
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
                ) &&
                !isGod(message)
            ) {
                return sendBox(
                    message,
                    "Protected Member",
                    "You cannot reject an equal or higher rank.",
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
                "VC Reject",
                `${target} was rejected from this call.`,
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
                "VC Permit",
                `${target} is permitted to join this call.`,
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
                .catch(() => {});

            data.locked = true;

            return sendBox(
                message,
                "VC Locked",
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
                .catch(() => {});

            data.locked = false;

            return sendBox(
                message,
                "VC Unlocked",
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
                    "Invalid Limit",
                    "Use a whole number from `0` to `99`.",
                    "error"
                );
            }

            await channel
                .setUserLimit(
                    limit
                )
                .catch(() => {});

            return sendBox(
                message,
                "Limit Updated",
                `VC limit: **${
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

            await channel
                .setName(
                    finalName
                )
                .catch(() => {});

            return sendBox(
                message,
                "VC Renamed",
                `Your call is now **${finalName}**.`,
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
                    "Not In VC",
                    "The new owner must be inside your VC.",
                    "error"
                );
            }

            if (
                target.id ===
                message.author.id
            ) {
                return sendBox(
                    message,
                    "Transfer",
                    "You already own this VC.",
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
                "Ownership Transferred",
                `${target} now owns this call.`,
                "success"
            );
        }

        // ====================================================
        // STFU NORMAL
        // ====================================================

        if (
            sub === "stfu" &&
            args[0]?.toLowerCase() !== "up"
        ) {
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
                    "Not In VC",
                    "That member isn't in your call.",
                    "error"
                );
            }

            if (
                isGod(target)
            ) {
                return sendBox(
                    message,
                    "Protected Member",
                    "Founder and God cannot be muted with VC+ moderation.",
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
                    "Protected Member",
                    "You cannot mute an equal or higher bot rank.",
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
                "Member Muted",
                `${target} has been muted in this call.`,
                "success"
            );
        }

        // ====================================================
        // STFU UP
        // ====================================================

        if (
            sub === "stfu" &&
            args[0]?.toLowerCase() === "up"
        ) {
            const target =
                await getTarget(
                    message,
                    args[1]
                );

            if (!target) {
                return sendBox(
                    message,
                    "VC STFU UP",
                    "Usage: `-vc stfu up @user`",
                    "warning"
                );
            }

            if (
                target.voice.channelId !==
                channel.id
            ) {
                return sendBox(
                    message,
                    "Not In VC",
                    "That member isn't in your call.",
                    "error"
                );
            }

            if (
                isGod(target)
            ) {
                return sendBox(
                    message,
                    "Protected Member",
                    "Founder and God cannot be permanently muted by VC moderation.",
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
                    "Protected Member",
                    "You cannot mute an equal or higher bot rank.",
                    "error"
                );
            }

            data.stfu.add(
                target.id
            );

            await target.voice
                .setMute(
                    true,
                    "VC+ STFU UP"
                )
                .catch(() => {});

            return sendBox(
                message,
                "STFU UP",
                [
                    `${target} is now **locked muted**.`,
                    "",
                    "They stay muted until:",
                    "`-vc unstfu @user`"
                ].join("\n"),
                "success"
            );
        }

        // ====================================================
        // UNSTFU
        // ====================================================

        if (
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
                "STFU Removed",
                `${target} is no longer locked muted.`,
                "success"
            );
        }

        // ====================================================
        // DRAG ALL
        // FOUNDER ONLY
        // ====================================================

        if (
            sub === "dragall"
        ) {
            if (
                !isFounder(message)
            ) {
                return sendBox(
                    message,
                    "No Permission",
                    [
                        "`-vc dragall` is Founder-only.",
                        "",
                        "Required Rank: **Founder**"
                    ].join("\n"),
                    "error"
                );
            }

            let moved = 0;
            let failed = 0;

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
                        member.id ===
                        message.guild.ownerId
                    ) {
                        continue;
                    }

                    await member.voice
                        .setChannel(
                            channel,
                            "VC+ Founder dragall"
                        );

                    moved++;
                } catch {
                    failed++;
                }
            }

            return sendBox(
                message,
                "Drag All",
                [
                    `Moved: **${moved}**`,
                    `Failed: **${failed}**`
                ].join("\n"),
                "success"
            );
        }

        // ====================================================
        // INTERFACE
        // ====================================================

        if (
            sub === "interface"
        ) {
            const interfaceChannel =
                await createVCInterface(
                    channel,
                    data.ownerId
                );

            if (!interfaceChannel) {
                return sendBox(
                    message,
                    "Interface Error",
                    "I couldn't create the VC interface.",
                    "error"
                );
            }

            return sendBox(
                message,
                "Interface",
                `VC controls: <#${interfaceChannel.id}>`,
                "success"
            );
        }

        return sendBox(
            message,
            "Unknown VC Command",
            [
                `I don't recognize \`-vc ${sub}\`.`,
                "",
                "Use `-vc` to see all VC commands."
            ].join("\n"),
            "error"
        );
    } catch (error) {
        console.error(
            "[VC COMMAND ERROR]",
            error
        );

        return sendBox(
            message,
            "Command Error",
            "Something went wrong processing that VC command.",
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
                "You must be inside a VC+ call.",
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
                "Interface Error",
                "I couldn't create the interface.",
                "error"
            );
        }

        return sendBox(
            message,
            "Interface",
            `VC control panel: <#${text.id}>`,
            "success"
        );
    } catch (error) {
        console.error(
            "[INTERFACE ERROR]",
            error
        );

        return sendBox(
            message,
            "Interface Error",
            "Something went wrong creating the interface.",
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
            "`10` Founder",
            "`9` God",
            "`8` Owner",
            "`7` Co-Owner",
            "`6` Executive",
            "`5` Director",
            "`4` Admin",
            "`3` Moderator",
            "`2` Staff",
            "`1` Member",
            "",
            "These ranks exist inside VC+ only.",
            "No Discord roles are created."
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
        !isFounder(message)
    ) {
        return sendBox(
            message,
            "No Permission",
            [
                "Only **Founder** can manage VC+ ranks.",
                "",
                "These ranks are bot-only."
            ].join("\n"),
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
                RANKS.map(
                    rank =>
                        `\`${rank}\``
                ).join(" • ")
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
            "The Discord server owner cannot be assigned a lower VC+ rank.",
            "error"
        );
    }

    const data =
        getGuildData(
            message.guild.id
        );

    data.ranks[target.id] =
        rank;

    saveDB();

    return sendBox(
        message,
        "Rank Updated",
        [
            `${target} is now **${rank}**.`,
            "",
            "Discord roles were not created."
        ].join("\n"),
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
    if (
        !isFounder(message)
    ) {
        return sendBox(
            message,
            "No Permission",
            "Only Founder can use the vouch system.",
            "error"
        );
    }

    const action =
        args.shift()?.toLowerCase();

    if (
        action !== "add"
    ) {
        return sendBox(
            message,
            "Vouch",
            [
                "`-vouch add @user`",
                "",
                "`-vouch limit 3`"
            ].join("\n"),
            "warning"
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
            "Vouch",
            "Usage: `-vouch add @user`",
            "warning"
        );
    }

    const data =
        getGuildData(
            message.guild.id
        );

    data.vouches[target.id] ??= 0;

    data.vouches[target.id]++;

    const count =
        data.vouches[target.id];

    const required =
        Number(
            data.vouchLimit
        ) || 1;

    let promoted = false;

    if (
        count >= required
    ) {
        /*
         * The vouch promotion is to the
         * second-highest VC+ rank:
         *
         * Founder = 10
         * God     = 9
         *
         * Founder is the only rank allowed
         * to use this command.
         */

        if (
            getRank(
                message.guild,
                target.id
            ) !== "founder"
        ) {
            data.ranks[target.id] =
                "god";

            promoted = true;
        }
    }

    saveDB();

    return sendBox(
        message,
        "Vouch Added",
        [
            `${target} now has **${count}** vouch(es).`,
            `Required: **${required}**`,
            "",
            promoted
                ? "**Promotion:** God"
                : "Requirement has not been reached yet."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// VOUCH LIMIT
// ============================================================

async function setVouchLimit(
    message,
    args
) {
    if (
        !isFounder(message)
    ) {
        return sendBox(
            message,
            "No Permission",
            "Only Founder can change the vouch requirement.",
            "error"
        );
    }

    const limit =
        Number(args[0]);

    if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
    ) {
        return sendBox(
            message,
            "Invalid Limit",
            "Use a whole number from `1` to `100`.",
            "warning"
        );
    }

    const data =
        getGuildData(
            message.guild.id
        );

    data.vouchLimit =
        limit;

    saveDB();

    return sendBox(
        message,
        "Vouch Limit",
        `Vouch requirement set to **${limit}**.`,
        "success"
    );
}

// ============================================================
// GODMODE
// ONLY FOUNDER CAN GIVE/REMOVE
// ============================================================

async function godmodeCommand(
    message,
    args
) {
    if (
        !isFounder(message)
    ) {
        return sendBox(
            message,
            "No Permission",
            "Only Founder can manage Godmode.",
            "error"
        );
    }

    const action =
        args.shift()?.toLowerCase();

    const target =
        await getTarget(
            message,
            args[0]
        );

    if (
        !target
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

    const data =
        getGuildData(
            message.guild.id
        );

    if (
        action === "on"
    ) {
        data.godmode[target.id] =
            true;

        saveDB();

        return sendBox(
            message,
            "Godmode Enabled",
            [
                `${target} now has **Godmode**.`,
                "",
                "VC protection is active.",
                "Manual voice mute attempts will be countered when the bot can do so."
            ].join("\n"),
            "success"
        );
    }

    if (
        action === "off"
    ) {
        delete data.godmode[target.id];

        saveDB();

        return sendBox(
            message,
            "Godmode Disabled",
            `${target} no longer has Godmode.`,
            "success"
        );
    }

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

function hasGodmode(
    guild,
    userId
) {
    const data =
        getGuildData(
            guild.id
        );

    return Boolean(
        data.godmode[userId]
    );
}

function isProtectedVoiceUser(
    member
) {
    if (!member) {
        return false;
    }

    return (
        getRank(
            member.guild,
            member.id
        ) === "founder" ||
        getRank(
            member.guild,
            member.id
        ) === "god" ||
        hasGodmode(
            member.guild,
            member.id
        )
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
        !isGod(message)
    ) {
        return sendBox(
            message,
            "No Permission",
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
            "The Discord server owner cannot be forever banned.",
            "error"
        );
    }

    if (
        isFounder(target) &&
        !isFounder(message)
    ) {
        return sendBox(
            message,
            "Protected",
            "You cannot forever-ban a Founder.",
            "error"
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

    await target.ban({
        reason:
            "VC+ permanent user ban"
    }).catch(() => {});

    return sendBox(
        message,
        "Forever Banned",
        [
            `${target.user.tag} has been added to the permanent ban list.`,
            "",
            "If they rejoin, VC+ will automatically ban them again.",
            "",
            "Note: Discord bots cannot see a user's IP address."
        ].join("\n"),
        "success"
    );
}

// ============================================================
// NORMAL BAN
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
            "No Permission",
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
            "Protected Member",
            "You cannot ban the server owner or an equal/higher VC+ rank.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
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
            "Ban Failed",
            "Discord rejected the ban. Check my role position and permissions.",
            "error"
        );
    }

    return sendBox(
        message,
        "Member Banned",
        [
            `${target.user.tag} was banned.`,
            "",
            `Reason: ${reason}`
        ].join("\n"),
        "success"
    );
}

// ============================================================
// KICK
// ============================================================

async function kickCommand(
    message,
    args
) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.KickMembers
        )
    ) {
        return sendBox(
            message,
            "No Permission",
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
        !target
    ) {
        return sendBox(
            message,
            "Kick",
            "Usage: `-kick @user reason`",
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
            "Protected Member",
            "That member cannot be kicked.",
            "error"
        );
    }

    const reason =
        args.slice(1).join(" ") ||
        "VC+ kick";

    const success =
        await target.kick(
            reason
        )
            .then(() => true)
            .catch(() => false);

    if (!success) {
        return sendBox(
            message,
            "Kick Failed",
            "Discord rejected the kick. Check my role position and permissions.",
            "error"
        );
    }

    return sendBox(
        message,
        "Member Kicked",
        `${target.user.tag} was kicked.`,
        "success"
    );
}

// ============================================================
// TIMEOUT
// ============================================================

async function timeoutCommand(
    message,
    args
) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        return sendBox(
            message,
            "No Permission",
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
        minutes <= 0
    ) {
        return sendBox(
            message,
            "Timeout",
            "Usage: `-timeout @user minutes`",
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
            "Protected Member",
            "You cannot timeout an equal or higher VC+ rank.",
            "error"
        );
    }

    const safeMinutes =
        Math.min(
            Math.floor(minutes),
            40320
        );

    const duration =
        safeMinutes *
        60 *
        1000;

    const success =
        await target.timeout(
            duration,
            "VC+ timeout"
        )
            .then(() => true)
            .catch(() => false);

    if (!success) {
        return sendBox(
            message,
            "Timeout Failed",
            "Discord rejected the timeout.",
            "error"
        );
    }

    return sendBox(
        message,
        "Timed Out",
        `${target.user.tag} was timed out for **${safeMinutes} minutes**.`,
        "success"
    );
}

// ============================================================
// UNTIMEOUT
// ============================================================

async function untimeoutCommand(
    message,
    args
) {
    if (
        !message.member.permissions.has(
            PermissionFlagsBits.ModerateMembers
        )
    ) {
        return sendBox(
            message,
            "No Permission",
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
            "Protected Member",
            "You cannot modify an equal/higher protected rank.",
            "error"
        );
    }

    const success =
        await target.timeout(
            null,
            "VC+ untimeout"
        )
            .then(() => true)
            .catch(() => false);

    if (!success) {
        return sendBox(
            message,
            "Failed",
            "Discord rejected the action.",
            "error"
        );
    }

    return sendBox(
        message,
        "Timeout Removed",
        `${target.user.tag} is no longer timed out.`,
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
            "`-vc stfu up @user`",
            "`-vc unstfu @user`",
            "`-vc dragall`",
            "`-vc interface`",
            "",
            "**Ranks**",
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

            const content =
                message.content
                    .slice(PREFIX.length)
                    .trim();

            if (!content) {
                return;
            }

            const parts =
                content.split(/\s+/);

            const command =
                parts.shift()
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
                case "ranks":
                    return rankList(
                        message
                    );

                case "rank":
                    return rankCommand(
                        message,
                        parts
                    );

                case "vouch":
                    if (
                        parts[0]
                            ?.toLowerCase() ===
                        "limit"
                    ) {
                        parts.shift();

                        return setVouchLimit(
                            message,
                            parts
                        );
                    }

                    return vouchCommand(
                        message,
                        parts
                    );

                case "godmode":
                    return godmodeCommand(
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
                    return foreverBan(
                        message,
                        parts
                    );

                default:
                    return sendBox(
                        message,
                        "Unknown Command",
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
                "Command Error",
                "Something went wrong. The error was caught so the bot can keep running.",
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

            const guildData =
                getGuildData(
                    guild.id
                );

            // =================================================
            // JOIN TO CREATE
            // =================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    guildData.jtc.triggerId
            ) {
                const created =
                    await createPersonalVC(
                        newState.member,
                        newState.channel
                    );

                if (!created) {
                    console.error(
                        "[JTC] Failed to create personal VC"
                    );
                }

                return;
            }

            // =================================================
            // TEMP VC PROTECTION
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

                    // -------------------------------
                    // VC BAN / REJECT
                    // -------------------------------

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

                    // -------------------------------
                    // LOCK
                    // -------------------------------

                    if (
                        data.locked &&
                        member.id !==
                            data.ownerId &&
                        !isGod(member)
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ locked"
                            )
                            .catch(() => {});

                        return;
                    }

                    // -------------------------------
                    // FOUNDER / GOD / GODMODE
                    // AUTO UNMUTE
                    // -------------------------------

                    if (
                        isProtectedVoiceUser(
                            member
                        )
                    ) {
                        await member.voice
                            .setMute(
                                false,
                                "VC+ protection"
                            )
                            .catch(() => {});
                    }

                    // -------------------------------
                    // STFU UP
                    // -------------------------------

                    if (
                        data.stfu.has(
                            member.id
                        ) &&
                        !isProtectedVoiceUser(
                            member
                        )
                    ) {
                        await member.voice
                            .setMute(
                                true,
                                "VC+ STFU UP protection"
                            )
                            .catch(() => {});
                    }
                }
            }

            // =================================================
            // EMPTY VC CLEANUP
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
                    !data ||
                    oldChannel.members.size !== 0
                ) {
                    return;
                }

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
        } catch (error) {
            console.error(
                "[VOICE STATE ERROR]",
                error
            );
        }
    }
);

// ============================================================
// GLOBAL VOICE PROTECTION
//
// This catches serverMute changes to protected users.
// ============================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            const member =
                newState.member;

            if (!member) {
                return;
            }

            if (
                !newState.serverMute
            ) {
                return;
            }

            if (
                !isProtectedVoiceUser(
                    member
                )
            ) {
                return;
            }

            await member.voice
                .setMute(
                    false,
                    "VC+ protected user"
                )
                .catch(() => {});
        } catch (error) {
            console.error(
                "[GLOBAL VOICE PROTECTION]",
                error
            );
        }
    }
);

// ============================================================
// FOREVER BAN JOIN PROTECTION
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
                !data.foreverBanned.includes(
                    member.id
                )
            ) {
                return;
            }

            await member.ban({
                reason:
                    "VC+ permanent ban list"
            }).catch(() => {});
        } catch (error) {
            console.error(
                "[FOREVER BAN JOIN ERROR]",
                error
            );
        }
    }
);

// ============================================================
// MEMBER UPDATE PROTECTION
// ============================================================

client.on(
    "guildMemberUpdate",
    async (
        oldMember,
        newMember
    ) => {
        try {
            if (
                !isProtectedVoiceUser(
                    newMember
                )
            ) {
                return;
            }

            if (
                newMember.voice?.serverMute
            ) {
                await newMember.voice
                    .setMute(
                        false,
                        "VC+ protected member"
                    )
                    .catch(() => {});
            }
        } catch (error) {
            console.error(
                "[MEMBER UPDATE PROTECTION]",
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
            "[CLIENT WARNING]",
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
// PROCESS PROTECTION
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

    process.exit(1);
}

client.login(token)
    .then(() => {
        console.log(
            "Discord login successful."
        );
    })
    .catch(error => {
        console.error(
            "[LOGIN ERROR]",
            error
        );

        process.exit(1);
    });
