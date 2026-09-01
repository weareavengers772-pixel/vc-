import {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// VC+ CONFIG
// ============================================================

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("[VC+] Missing DISCORD_TOKEN.");
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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Message
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

function defaultGuildData() {
    return {
        ranks: {},

        godmode: [],

        foreverBanned: [],

        vouches: {},

        vouchRevoked: {},

        vouchLimit: 5,

        roles: {
            vouch: null
        },

        jtc: {
            channelId: null,
            categoryId: null
        },

        tempVCs: {},

        filters: {
            enabled: false,
            words: [],
            strikes: {},
            maxStrikes: 3,
            timeoutMinutes: 10
        }
    };
}

let db = {};

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            db = {};
            saveDB();
            return;
        }

        const raw =
            fs.readFileSync(
                DB_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            db = {};
            saveDB();
            return;
        }

        db = JSON.parse(raw);

        if (
            !db ||
            typeof db !== "object"
        ) {
            db = {};
        }

    } catch (error) {
        console.error(
            "[VC+] Database load error:",
            error
        );

        db = {};
    }
}

function saveDB() {
    try {
        const temp =
            `${DB_FILE}.tmp`;

        fs.writeFileSync(
            temp,
            JSON.stringify(
                db,
                null,
                4
            ),
            "utf8"
        );

        fs.renameSync(
            temp,
            DB_FILE
        );

    } catch (error) {
        console.error(
            "[VC+] Database save error:",
            error
        );
    }
}

function getGuildData(guildId) {
    if (!db[guildId]) {
        db[guildId] =
            defaultGuildData();

        saveDB();
    }

    const defaults =
        defaultGuildData();

    db[guildId] = {
        ...defaults,
        ...db[guildId],

        ranks: {
            ...defaults.ranks,
            ...(db[guildId].ranks || {})
        },

        godmode: [
            ...(db[guildId].godmode || [])
        ],

        foreverBanned: [
            ...(db[guildId].foreverBanned || [])
        ],

        vouches: {
            ...(db[guildId].vouches || {})
        },

        vouchRevoked: {
            ...(db[guildId].vouchRevoked || {})
        },

        roles: {
            ...defaults.roles,
            ...(db[guildId].roles || {})
        },

        jtc: {
            ...defaults.jtc,
            ...(db[guildId].jtc || {})
        },

        tempVCs: {
            ...(db[guildId].tempVCs || {})
        },

        filters: {
            ...defaults.filters,
            ...(db[guildId].filters || {})
        }
    };

    return db[guildId];
}

loadDB();

// ============================================================
// RANK SYSTEM
// ============================================================

const RANKS = {
    founder: 10,
    god: 9,
    owner: 8,
    coowner: 7,
    executive: 6,
    director: 5,
    admin: 4,
    moderator: 3,
    staff: 2,
    member: 1
};

function normalizeRank(rank) {
    return String(rank || "")
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

function getRankName(member) {
    if (!member?.guild) {
        return "member";
    }

    if (
        member.guild.ownerId ===
        member.id
    ) {
        return "founder";
    }

    const data =
        getGuildData(
            member.guild.id
        );

    const rank =
        normalizeRank(
            data.ranks[member.id]
        );

    if (
        Object.prototype.hasOwnProperty
            .call(RANKS, rank)
    ) {
        return rank;
    }

    return "member";
}

function getRankLevel(member) {
    return (
        RANKS[
            getRankName(member)
        ] || 1
    );
}

function isServerOwner(member) {
    return (
        !!member?.guild &&
        member.guild.ownerId ===
            member.id
    );
}

function isFounder(member) {
    return (
        isServerOwner(member) ||
        getRankLevel(member) >=
            RANKS.founder
    );
}

function isGod(member) {
    if (!member?.guild) {
        return false;
    }

    const data =
        getGuildData(
            member.guild.id
        );

    return (
        isFounder(member) ||
        getRankLevel(member) >=
            RANKS.god ||
        data.godmode.includes(
            member.id
        )
    );
}

function canManageTarget(
    actor,
    target
) {
    if (!actor || !target) {
        return false;
    }

    if (
        actor.id ===
        target.id
    ) {
        return false;
    }

    if (
        isServerOwner(actor)
    ) {
        return true;
    }

    if (
        isFounder(actor)
    ) {
        return !isFounder(target);
    }

    return (
        getRankLevel(actor) >
        getRankLevel(target)
    );
}

// ============================================================
// MESSAGE STYLE
// ============================================================

function plain(title, text) {
    return (
        `${BOT_NAME}\n\n` +
        `> **${title}**\n` +
        `> ${text}`
    );
}

// ============================================================
// ROLE HELPERS
// ============================================================

function botMember(guild) {
    return guild.members.me;
}

function canBotManageRole(
    guild,
    role
) {
    const me =
        botMember(guild);

    if (!me || !role) {
        return false;
    }

    if (
        !me.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        return false;
    }

    if (role.managed) {
        return false;
    }

    if (
        role.id ===
        guild.id
    ) {
        return false;
    }

    return (
        role.position <
        me.roles.highest.position
    );
}

// ============================================================
// VOUCH SYSTEM
// ============================================================

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

function isVouchRevoked(
    guildId,
    userId
) {
    const data =
        getGuildData(guildId);

    return (
        data.vouchRevoked[userId] ===
        true
    );
}

async function syncVouchRole(
    member
) {
    if (!member?.guild) {
        return {
            ok: false,
            reason:
                "Member unavailable."
        };
    }

    const guild =
        member.guild;

    const data =
        getGuildData(
            guild.id
        );

    if (!data.roles.vouch) {
        return {
            ok: false,
            reason:
                "No vouch role configured."
        };
    }

    const role =
        await guild.roles
            .fetch(
                data.roles.vouch
            )
            .catch(() => null);

    if (!role) {
        return {
            ok: false,
            reason:
                "The configured vouch role no longer exists."
        };
    }

    if (
        !canBotManageRole(
            guild,
            role
        )
    ) {
        return {
            ok: false,
            reason:
                "I cannot manage the vouch role. Give me Manage Roles and move my bot role above it."
        };
    }

    const count =
        getVouchCount(
            guild.id,
            member.id
        );

    const qualified =
        count >= data.vouchLimit &&
        !isVouchRevoked(
            guild.id,
            member.id
        );

    try {
        if (qualified) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role,
                    "VC+ vouch requirement reached"
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
                    "VC+ vouch requirement not met or revoked"
                );
            }
        }

        return {
            ok: true,
            qualified
        };

    } catch (error) {
        console.error(
            "[VC+] Vouch role error:",
            error
        );

        return {
            ok: false,
            reason:
                error.message
        };
    }
}

async function syncAllVouchRoles(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    if (!data.roles.vouch) {
        return;
    }

    const members =
        await guild.members
            .fetch()
            .catch(() => null);

    if (!members) {
        return;
    }

    for (
        const member
        of members.values()
    ) {
        if (member.user.bot) {
            continue;
        }

        await syncVouchRole(
            member
        ).catch(() => {});
    }
}

// ============================================================
// TEMP VC DATA
// ============================================================

function getTempVC(
    guildId,
    channelId
) {
    const data =
        getGuildData(guildId);

    return (
        data.tempVCs[channelId] ||
        null
    );
}

function isTempVC(
    guildId,
    channelId
) {
    return !!getTempVC(
        guildId,
        channelId
    );
}

// ============================================================
// VC INTERFACE
// ============================================================

function buildVCInterface() {
    return [
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        "vc_lock"
                    )
                    .setLabel(
                        "Lock"
                    )
                    .setEmoji("🔒")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_unlock"
                    )
                    .setLabel(
                        "Unlock"
                    )
                    .setEmoji("🔓")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_claim"
                    )
                    .setLabel(
                        "Claim"
                    )
                    .setEmoji("👑")
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_rename"
                    )
                    .setLabel(
                        "Rename"
                    )
                    .setEmoji("✏️")
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_limit"
                    )
                    .setLabel(
                        "Limit"
                    )
                    .setEmoji("👥")
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),

        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        "vc_permit"
                    )
                    .setLabel(
                        "Permit"
                    )
                    .setEmoji("✅")
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_reject"
                    )
                    .setLabel(
                        "Reject"
                    )
                    .setEmoji("🚫")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_kick"
                    )
                    .setLabel(
                        "Kick"
                    )
                    .setEmoji("👢")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_stfu"
                    )
                    .setLabel(
                        "STFU"
                    )
                    .setEmoji("🔇")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_unstfu"
                    )
                    .setLabel(
                        "Unstfu"
                    )
                    .setEmoji("🔊")
                    .setStyle(
                        ButtonStyle.Success
                    )
            ),

        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        "vc_transfer"
                    )
                    .setLabel(
                        "Transfer"
                    )
                    .setEmoji("👑")
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_ban"
                    )
                    .setLabel(
                        "VC Ban"
                    )
                    .setEmoji("⛔")
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_unban"
                    )
                    .setLabel(
                        "VC Unban"
                    )
                    .setEmoji("♻️")
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_settings"
                    )
                    .setLabel(
                        "Settings"
                    )
                    .setEmoji("⚙️")
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            )
    ];
}

async function sendVCInterface(
    channel,
    ownerId
) {
    try {
        const message =
            await channel.send({
                content:
                    `${BOT_NAME}\n\n` +
                    `> **Voice Channel Interface**\n` +
                    `> Owner: <@${ownerId}>\n` +
                    `> Manage your temporary voice channel below.`,

                components:
                    buildVCInterface()
            });

        return message;

    } catch (error) {
        console.error(
            "[VC+] Interface could not be sent:",
            error
        );

        return null;
    }
}

// ============================================================
// CREATE TEMP VC
// ============================================================

async function createTempVC(
    member
) {
    const guild =
        member.guild;

    const data =
        getGuildData(
            guild.id
        );

    let parent = null;

    if (
        data.jtc.categoryId
    ) {
        parent =
            guild.channels.cache.get(
                data.jtc.categoryId
            );
    }

    if (
        !parent &&
        data.jtc.channelId
    ) {
        const jtc =
            guild.channels.cache.get(
                data.jtc.channelId
            );

        parent =
            jtc?.parent;
    }

    const channel =
        await guild.channels.create({
            name:
                `${member.displayName}'s VC`,

            type:
                ChannelType.GuildVoice,

            parent:
                parent?.type ===
                ChannelType.GuildCategory
                    ? parent.id
                    : null,

            permissionOverwrites: [
                {
                    id:
                        guild.roles
                            .everyone.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak
                    ]
                },

                {
                    id:
                        member.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.MoveMembers,
                        PermissionFlagsBits.MuteMembers,
                        PermissionFlagsBits.DeafenMembers
                    ]
                }
            ]
        });

    data.tempVCs[channel.id] = {
        ownerId:
            member.id,

        locked:
            false,

        banned: [],

        permitted: [],

        stfu: [],

        interfaceMessageId:
            null
    };

    saveDB();

    // ========================================================
    // THIS IS THE IMPORTANT PART:
    // THE INTERFACE GOES INSIDE THE NEW VOICE CHANNEL
    // ========================================================

    const interfaceMessage =
        await sendVCInterface(
            channel,
            member.id
        );

    if (interfaceMessage) {
        data.tempVCs[
            channel.id
        ].interfaceMessageId =
            interfaceMessage.id;

        saveDB();
    }

    return channel;
}

// ============================================================
// DELETE TEMP VC
// ============================================================

async function deleteTempVC(
    channel
) {
    if (!channel?.guild) {
        return;
    }

    const data =
        getGuildData(
            channel.guild.id
        );

    if (
        !data.tempVCs[
            channel.id
        ]
    ) {
        return;
    }

    delete data.tempVCs[
        channel.id
    ];

    saveDB();

    try {
        if (channel.deletable) {
            await channel.delete(
                "VC+ temporary channel cleanup"
            );
        }

    } catch (error) {
        console.error(
            "[VC+] Delete VC error:",
            error
        );
    }
}

// ============================================================
// CLEANUP EMPTY VCS
// ============================================================

async function cleanupEmptyTempVCs(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    for (
        const channelId
        of Object.keys(
            data.tempVCs
        )
    ) {
        const channel =
            guild.channels.cache.get(
                channelId
            );

        if (!channel) {
            delete data.tempVCs[
                channelId
            ];

            continue;
        }

        if (
            channel.type ===
                ChannelType.GuildVoice &&
            channel.members.size === 0
        ) {
            await deleteTempVC(
                channel
            );
        }
    }

    saveDB();
}

// ============================================================
// VC MANAGER CHECK
// ============================================================

function isVCManager(
    member,
    channel
) {
    const data =
        getTempVC(
            channel.guild.id,
            channel.id
        );

    if (!data) {
        return false;
    }

    return (
        data.ownerId ===
            member.id ||
        isFounder(member) ||
        isGod(member)
    );
}

// ============================================================
// USER ID MODAL
// ============================================================

function createUserModal(
    id,
    title
) {
    const modal =
        new ModalBuilder()
            .setCustomId(id)
            .setTitle(title);

    const input =
        new TextInputBuilder()
            .setCustomId(
                "user_id"
            )
            .setLabel(
                "Discord User ID"
            )
            .setPlaceholder(
                "Enter the user's ID"
            )
            .setStyle(
                TextInputStyle.Short
            )
            .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(input)
    );

    return modal;
}

// ============================================================
// VC BUTTON HANDLER
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {

            if (
                !interaction.isButton()
            ) {
                return;
            }

            if (
                !interaction.customId
                    .startsWith("vc_")
            ) {
                return;
            }

            const channel =
                interaction.channel;

            if (
                !channel ||
                channel.type !==
                    ChannelType.GuildVoice
            ) {
                return interaction.reply({
                    content:
                        plain(
                            "Error",
                            "This interface must be used inside a temporary VC."
                        ),
                    ephemeral: true
                });
            }

            const data =
                getTempVC(
                    channel.guild.id,
                    channel.id
                );

            if (!data) {
                return interaction.reply({
                    content:
                        plain(
                            "Error",
                            "This is not a VC+ temporary voice channel."
                        ),
                    ephemeral: true
                });
            }

            if (
                !isVCManager(
                    interaction.member,
                    channel
                )
            ) {
                return interaction.reply({
                    content:
                        plain(
                            "Access Denied",
                            "Only the VC owner, Founder, or God can use this interface."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // LOCK
            // =================================================

            if (
                interaction.customId ===
                "vc_lock"
            ) {
                data.locked = true;

                await channel
                    .permissionOverwrites
                    .edit(
                        channel.guild
                            .roles.everyone,
                        {
                            Connect: false
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "VC Locked",
                            "Your VC is now locked."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // UNLOCK
            // =================================================

            if (
                interaction.customId ===
                "vc_unlock"
            ) {
                data.locked = false;

                await channel
                    .permissionOverwrites
                    .edit(
                        channel.guild
                            .roles.everyone,
                        {
                            Connect: null
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "VC Unlocked",
                            "Your VC is now unlocked."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // CLAIM
            // =================================================

            if (
                interaction.customId ===
                "vc_claim"
            ) {
                const owner =
                    await channel.guild
                        .members
                        .fetch(
                            data.ownerId
                        )
                        .catch(() => null);

                if (
                    owner &&
                    owner.voice.channelId ===
                        channel.id &&
                    owner.id !==
                        interaction.user.id &&
                    !isFounder(
                        interaction.member
                    ) &&
                    !isGod(
                        interaction.member
                    )
                ) {
                    return interaction.reply({
                        content:
                            plain(
                                "Claim Failed",
                                "The current owner is still in the VC."
                            ),
                        ephemeral: true
                    });
                }

                data.ownerId =
                    interaction.user.id;

                await channel
                    .permissionOverwrites
                    .edit(
                        interaction.user.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true,
                            SendMessages: true,
                            MoveMembers: true,
                            MuteMembers: true,
                            DeafenMembers: true
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "VC Claimed",
                            "You are now the owner of this VC."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // RENAME
            // =================================================

            if (
                interaction.customId ===
                "vc_rename"
            ) {
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
                            "name"
                        )
                        .setLabel(
                            "New VC Name"
                        )
                        .setPlaceholder(
                            "Enter a new name"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setMinLength(1)
                        .setMaxLength(100)
                        .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            input
                        )
                );

                return interaction.showModal(
                    modal
                );
            }

            // =================================================
            // LIMIT
            // =================================================

            if (
                interaction.customId ===
                "vc_limit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "vc_limit_modal"
                        )
                        .setTitle(
                            "Voice User Limit"
                        );

                const input =
                    new TextInputBuilder()
                        .setCustomId(
                            "limit"
                        )
                        .setLabel(
                            "User Limit"
                        )
                        .setPlaceholder(
                            "0 = unlimited"
                        )
                        .setStyle(
                            TextInputStyle.Short
                        )
                        .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder()
                        .addComponents(
                            input
                        )
                );

                return interaction.showModal(
                    modal
                );
            }

            // =================================================
            // PERMIT
            // =================================================

            if (
                interaction.customId ===
                "vc_permit"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_permit_modal",
                        "Permit User"
                    )
                );
            }

            // =================================================
            // REJECT
            // =================================================

            if (
                interaction.customId ===
                "vc_reject"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_reject_modal",
                        "Reject User"
                    )
                );
            }

            // =================================================
            // KICK
            // =================================================

            if (
                interaction.customId ===
                "vc_kick"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_kick_modal",
                        "Kick User"
                    )
                );
            }

            // =================================================
            // STFU
            // =================================================

            if (
                interaction.customId ===
                "vc_stfu"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_stfu_modal",
                        "STFU User"
                    )
                );
            }

            // =================================================
            // UNSTFU
            // =================================================

            if (
                interaction.customId ===
                "vc_unstfu"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_unstfu_modal",
                        "Unstfu User"
                    )
                );
            }

            // =================================================
            // TRANSFER
            // =================================================

            if (
                interaction.customId ===
                "vc_transfer"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_transfer_modal",
                        "Transfer VC"
                    )
                );
            }

            // =================================================
            // VC BAN
            // =================================================

            if (
                interaction.customId ===
                "vc_ban"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_ban_modal",
                        "VC Ban User"
                    )
                );
            }

            // =================================================
            // VC UNBAN
            // =================================================

            if (
                interaction.customId ===
                "vc_unban"
            ) {
                return interaction.showModal(
                    createUserModal(
                        "vc_unban_modal",
                        "VC Unban User"
                    )
                );
            }

            // =================================================
            // SETTINGS
            // =================================================

            if (
                interaction.customId ===
                "vc_settings"
            ) {
                return interaction.reply({
                    content:
                        plain(
                            "VC Settings",
                            `Owner: <@${data.ownerId}>\n` +
                            `Locked: **${data.locked ? "Yes" : "No"}**\n` +
                            `Users: **${channel.members.size}**\n` +
                            `Limit: **${channel.userLimit || "Unlimited"}**\n` +
                            `VC Bans: **${data.banned.length}**\n` +
                            `STFU List: **${data.stfu.length}**`
                        ),
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error(
                "[VC+] Button error:",
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        plain(
                            "Error",
                            "Something went wrong while processing that button."
                        ),
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
);

// ============================================================
// MODAL HANDLER
// ============================================================

client.on(
    "interactionCreate",
    async interaction => {
        try {

            if (
                !interaction.isModalSubmit()
            ) {
                return;
            }

            if (
                !interaction.customId
                    .startsWith("vc_")
            ) {
                return;
            }

            const channel =
                interaction.channel;

            if (
                !channel ||
                channel.type !==
                    ChannelType.GuildVoice
            ) {
                return;
            }

            const data =
                getTempVC(
                    channel.guild.id,
                    channel.id
                );

            if (!data) {
                return interaction.reply({
                    content:
                        plain(
                            "Error",
                            "This is not a VC+ temporary VC."
                        ),
                    ephemeral: true
                });
            }

            if (
                !isVCManager(
                    interaction.member,
                    channel
                )
            ) {
                return interaction.reply({
                    content:
                        plain(
                            "Access Denied",
                            "You cannot manage this VC."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // RENAME
            // =================================================

            if (
                interaction.customId ===
                "vc_rename_modal"
            ) {
                const name =
                    interaction.fields
                        .getTextInputValue(
                            "name"
                        )
                        .trim();

                if (!name) {
                    return interaction.reply({
                        content:
                            plain(
                                "Invalid Name",
                                "Enter a valid channel name."
                            ),
                        ephemeral: true
                    });
                }

                await channel.setName(
                    name.slice(0, 100),
                    "VC+ owner rename"
                );

                return interaction.reply({
                    content:
                        plain(
                            "VC Renamed",
                            `Your VC is now **${name.slice(0, 100)}**.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // LIMIT
            // =================================================

            if (
                interaction.customId ===
                "vc_limit_modal"
            ) {
                const amount =
                    Number(
                        interaction.fields
                            .getTextInputValue(
                                "limit"
                            )
                    );

                if (
                    !Number.isInteger(
                        amount
                    ) ||
                    amount < 0 ||
                    amount > 99
                ) {
                    return interaction.reply({
                        content:
                            plain(
                                "Invalid Limit",
                                "Use a whole number from **0 to 99**. 0 means unlimited."
                            ),
                        ephemeral: true
                    });
                }

                await channel.setUserLimit(
                    amount,
                    "VC+ user limit"
                );

                return interaction.reply({
                    content:
                        plain(
                            "Limit Updated",
                            `The VC limit is now **${amount === 0 ? "Unlimited" : amount}**.`
                        ),
                    ephemeral: true
                });
            }

            const rawId =
                interaction.fields
                    .getTextInputValue(
                        "user_id"
                    )
                    .trim();

            const userId =
                rawId.replace(
                    /[<@!>]/g,
                    ""
                );

            const member =
                await channel.guild
                    .members
                    .fetch(userId)
                    .catch(() => null);

            if (!member) {
                return interaction.reply({
                    content:
                        plain(
                            "User Not Found",
                            "I could not find that member."
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // PERMIT
            // =================================================

            if (
                interaction.customId ===
                "vc_permit_modal"
            ) {
                data.permitted =
                    [
                        ...new Set([
                            ...data.permitted,
                            member.id
                        ])
                    ];

                data.banned =
                    data.banned.filter(
                        id =>
                            id !==
                            member.id
                    );

                await channel
                    .permissionOverwrites
                    .edit(
                        member.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true,
                            SendMessages: true
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "User Permitted",
                            `${member} can now join your VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // REJECT
            // =================================================

            if (
                interaction.customId ===
                "vc_reject_modal"
            ) {
                data.banned =
                    [
                        ...new Set([
                            ...data.banned,
                            member.id
                        ])
                    ];

                data.permitted =
                    data.permitted.filter(
                        id =>
                            id !==
                            member.id
                    );

                await channel
                    .permissionOverwrites
                    .edit(
                        member.id,
                        {
                            Connect: false
                        }
                    );

                if (
                    member.voice.channelId ===
                    channel.id
                ) {
                    await member.voice
                        .disconnect(
                            "VC+ rejected"
                        )
                        .catch(() => {});
                }

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "User Rejected",
                            `${member} can no longer join this VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // KICK
            // =================================================

            if (
                interaction.customId ===
                "vc_kick_modal"
            ) {
                if (
                    member.voice.channelId !==
                    channel.id
                ) {
                    return interaction.reply({
                        content:
                            plain(
                                "Not In VC",
                                `${member} is not currently in your VC.`
                            ),
                        ephemeral: true
                    });
                }

                await member.voice
                    .disconnect(
                        "VC+ kick"
                    )
                    .catch(() => {});

                return interaction.reply({
                    content:
                        plain(
                            "User Kicked",
                            `${member} was removed from the VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // STFU
            // =================================================

            if (
                interaction.customId ===
                "vc_stfu_modal"
            ) {
                data.stfu =
                    [
                        ...new Set([
                            ...data.stfu,
                            member.id
                        ])
                    ];

                if (
                    member.voice.channelId ===
                    channel.id
                ) {
                    await member.voice
                        .setMute(
                            true,
                            "VC+ STFU"
                        )
                        .catch(() => {});
                }

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "STFU",
                            `${member} is now server-muted in this VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // UNSTFU
            // =================================================

            if (
                interaction.customId ===
                "vc_unstfu_modal"
            ) {
                data.stfu =
                    data.stfu.filter(
                        id =>
                            id !==
                            member.id
                    );

                if (
                    member.voice.channelId ===
                    channel.id
                ) {
                    await member.voice
                        .setMute(
                            false,
                            "VC+ Unstfu"
                        )
                        .catch(() => {});
                }

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "Unstfu",
                            `${member} can speak again.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // TRANSFER
            // =================================================

            if (
                interaction.customId ===
                "vc_transfer_modal"
            ) {
                if (
                    member.voice.channelId !==
                    channel.id
                ) {
                    return interaction.reply({
                        content:
                            plain(
                                "Transfer Failed",
                                "The selected user must be inside your VC."
                            ),
                        ephemeral: true
                    });
                }

                data.ownerId =
                    member.id;

                await channel
                    .permissionOverwrites
                    .edit(
                        member.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true,
                            SendMessages: true,
                            MoveMembers: true,
                            MuteMembers: true,
                            DeafenMembers: true
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "Ownership Transferred",
                            `${member} is now the owner of this VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // VC BAN
            // =================================================

            if (
                interaction.customId ===
                "vc_ban_modal"
            ) {
                data.banned =
                    [
                        ...new Set([
                            ...data.banned,
                            member.id
                        ])
                    ];

                data.permitted =
                    data.permitted.filter(
                        id =>
                            id !==
                            member.id
                    );

                await channel
                    .permissionOverwrites
                    .edit(
                        member.id,
                        {
                            ViewChannel: false,
                            Connect: false
                        }
                    );

                if (
                    member.voice.channelId ===
                    channel.id
                ) {
                    await member.voice
                        .disconnect(
                            "VC+ VC ban"
                        )
                        .catch(() => {});
                }

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "VC Ban",
                            `${member} has been banned from this VC.`
                        ),
                    ephemeral: true
                });
            }

            // =================================================
            // VC UNBAN
            // =================================================

            if (
                interaction.customId ===
                "vc_unban_modal"
            ) {
                data.banned =
                    data.banned.filter(
                        id =>
                            id !==
                            member.id
                    );

                await channel
                    .permissionOverwrites
                    .edit(
                        member.id,
                        {
                            ViewChannel: null,
                            Connect: null
                        }
                    );

                saveDB();

                return interaction.reply({
                    content:
                        plain(
                            "VC Unban",
                            `${member} can join this VC again.`
                        ),
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error(
                "[VC+] Modal error:",
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        plain(
                            "Error",
                            "Something went wrong."
                        ),
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

            const data =
                getGuildData(
                    guild.id
                );

            // =================================================
            // JOIN VC-USER
            // =================================================

            if (
                data.jtc.channelId &&
                newState.channelId ===
                    data.jtc.channelId &&
                oldState.channelId !==
                    data.jtc.channelId
            ) {
                const member =
                    newState.member;

                if (!member) {
                    return;
                }

                const tempVC =
                    await createTempVC(
                        member
                    );

                await member.voice
                    .setChannel(
                        tempVC
                    )
                    .catch(
                        async error => {
                            console.error(
                                "[VC+] Move failed:",
                                error
                            );

                            await deleteTempVC(
                                tempVC
                            );
                        }
                    );

                return;
            }

            // =================================================
            // TEMP VC PROTECTION
            // =================================================

            if (
                newState.channelId
            ) {
                const temp =
                    getTempVC(
                        guild.id,
                        newState.channelId
                    );

                if (temp) {
                    const member =
                        newState.member;

                    if (!member) {
                        return;
                    }

                    // -----------------------------------------
                    // VC BAN
                    // -----------------------------------------

                    if (
                        temp.banned.includes(
                            member.id
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ VC ban"
                            )
                            .catch(
                                () => {}
                            );

                        return;
                    }

                    // -----------------------------------------
                    // STFU
                    // -----------------------------------------

                    if (
                        temp.stfu.includes(
                            member.id
                        ) &&
                        !newState.serverMute
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

            // =================================================
            // STFU PERSISTENCE
            // =================================================

            if (
                newState.channelId
            ) {
                const temp =
                    getTempVC(
                        guild.id,
                        newState.channelId
                    );

                if (
                    temp &&
                    temp.stfu.includes(
                        newState.id
                    ) &&
                    !newState.serverMute
                ) {
                    await newState.member
                        ?.voice
                        .setMute(
                            true,
                            "VC+ STFU"
                        )
                        .catch(
                            () => {}
                        );
                }
            }

            // =================================================
            // DELETE EMPTY TEMP VCS
            // =================================================

            await cleanupEmptyTempVCs(
                guild
            );

        } catch (error) {
            console.error(
                "[VC+] Voice state error:",
                error
            );
        }
    }
);

// ============================================================
// MESSAGE COMMANDS
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

            const args =
                parts;

            const guild =
                message.guild;

            const data =
                getGuildData(
                    guild.id
                );

            // =================================================
            // HELP
            // =================================================

            if (
                command ===
                "help"
            ) {
                return message.reply(
                    plain(
                        "Commands",
                        "`-help`\n" +
                        "`-jtc channel #voice`\n" +
                        "`-jtc category #category`\n" +
                        "`-rank @user <rank>`\n" +
                        "`-godmode @user`\n" +
                        "`-vouch give @user`\n" +
                        "`-vouch take @user`\n" +
                        "`-vouch clear`\n" +
                        "`-vouch limit <number>`\n" +
                        "`-vouch role set @role`\n" +
                        "`-vouchrole claim`\n" +
                        "`-kick @user`\n" +
                        "`-ban @user`\n" +
                        "`-timeout @user <minutes>`\n" +
                        "`-untimeout @user`\n" +
                        "`-purge <amount>`"
                    )
                );
            }

            // =================================================
            // JTC
            // =================================================

            if (
                command ===
                "jtc"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "Only Founder or Server Owner can configure Join To Create."
                        )
                    );
                }

                const sub =
                    String(
                        args[0] || ""
                    ).toLowerCase();

                if (
                    sub ===
                    "channel"
                ) {
                    const channel =
                        message.mentions
                            .channels
                            .first();

                    if (
                        !channel ||
                        channel.type !==
                            ChannelType.GuildVoice
                    ) {
                        return message.reply(
                            plain(
                                "Invalid Channel",
                                "Mention the voice channel users should join."
                            )
                        );
                    }

                    data.jtc.channelId =
                        channel.id;

                    saveDB();

                    return message.reply(
                        plain(
                            "JTC Channel Set",
                            `${channel} is now the Join To Create channel.`
                        )
                    );
                }

                if (
                    sub ===
                    "category"
                ) {
                    const category =
                        message.mentions
                            .channels
                            .first();

                    if (
                        !category ||
                        category.type !==
                            ChannelType.GuildCategory
                    ) {
                        return message.reply(
                            plain(
                                "Invalid Category",
                                "Mention a category."
                            )
                        );
                    }

                    data.jtc.categoryId =
                        category.id;

                    saveDB();

                    return message.reply(
                        plain(
                            "VC Category Set",
                            `Temporary VCs will be created inside ${category}.`
                        )
                    );
                }

                return message.reply(
                    plain(
                        "JTC",
                        "`-jtc channel #vc-user`\n`-jtc category #category`"
                    )
                );
            }

            // =================================================
            // RANK
            // =================================================

            if (
                command ===
                "rank"
            ) {
                if (
                    !isFounder(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "Only Founder or Server Owner can manage ranks."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                const rank =
                    normalizeRank(
                        args[1]
                    );

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    !RANKS[rank]
                ) {
                    return message.reply(
                        plain(
                            "Invalid Rank",
                            "Ranks: Founder, God, Owner, CoOwner, Executive, Director, Admin, Moderator, Staff, Member."
                        )
                    );
                }

                if (
                    rank ===
                        "founder" &&
                    !isServerOwner(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "Only the actual Server Owner can assign Founder."
                        )
                    );
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDB();

                return message.reply(
                    plain(
                        "Rank Updated",
                        `${target} is now **${rank}**.`
                    )
                );
            }

            // =================================================
            // GODMODE
            // =================================================

            if (
                command ===
                "godmode"
            ) {
                if (
                    !isServerOwner(
                        message.member
                    ) &&
                    !isFounder(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "Only Founder or Server Owner can manage Godmode."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    data.godmode.includes(
                        target.id
                    )
                ) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );

                    saveDB();

                    return message.reply(
                        plain(
                            "Godmode Removed",
                            `${target} no longer has Godmode.`
                        )
                    );
                }

                data.godmode.push(
                    target.id
                );

                saveDB();

                return message.reply(
                    plain(
                        "Godmode Enabled",
                        `${target} now has Godmode.`
                    )
                );
            }

            // =================================================
            // VOUCH
            // =================================================

            if (
                command ===
                "vouch"
            ) {
                const sub =
                    String(
                        args[0] || ""
                    ).toLowerCase();

                // ---------------------------------------------
                // CLEAR
                // SERVER OWNER ONLY
                // ---------------------------------------------

                if (
                    sub ===
                    "clear"
                ) {
                    if (
                        !isServerOwner(
                            message.member
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "Only the **Server Owner** can clear all vouches."
                            )
                        );
                    }

                    data.vouches = {};
                    data.vouchRevoked = {};

                    saveDB();

                    await syncAllVouchRoles(
                        guild
                    );

                    return message.reply(
                        plain(
                            "Vouches Cleared",
                            "All vouches in this server have been cleared."
                        )
                    );
                }

                // ---------------------------------------------
                // LIMIT
                // FOUNDER / SERVER OWNER
                // ---------------------------------------------

                if (
                    sub ===
                    "limit"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "Only Founder or Server Owner can change the vouch limit."
                            )
                        );
                    }

                    const amount =
                        Number(
                            args[1]
                        );

                    if (
                        !Number.isInteger(
                            amount
                        ) ||
                        amount < 1 ||
                        amount > 1000
                    ) {
                        return message.reply(
                            plain(
                                "Invalid Limit",
                                "Use a whole number between **1 and 1000**."
                            )
                        );
                    }

                    data.vouchLimit =
                        amount;

                    saveDB();

                    await syncAllVouchRoles(
                        guild
                    );

                    return message.reply(
                        plain(
                            "Vouch Limit Updated",
                            `The vouch requirement is now **${amount}**.`
                        )
                    );
                }

                // ---------------------------------------------
                // ROLE SET
                // ---------------------------------------------

                if (
                    sub ===
                    "role"
                ) {
                    if (
                        !isFounder(
                            message.member
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "Only Founder or Server Owner can set the vouch role."
                            )
                        );
                    }

                    if (
                        String(
                            args[1] || ""
                        ).toLowerCase() !==
                        "set"
                    ) {
                        return message.reply(
                            plain(
                                "Vouch Role",
                                "Use `-vouch role set @role`."
                            )
                        );
                    }

                    const role =
                        message.mentions
                            .roles
                            .first();

                    if (!role) {
                        return message.reply(
                            plain(
                                "Missing Role",
                                "Mention a role."
                            )
                        );
                    }

                    if (
                        !canBotManageRole(
                            guild,
                            role
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Role Hierarchy",
                                "I cannot assign that role. Give me Manage Roles and move my bot role above it."
                            )
                        );
                    }

                    data.roles.vouch =
                        role.id;

                    saveDB();

                    await syncAllVouchRoles(
                        guild
                    );

                    return message.reply(
                        plain(
                            "Vouch Role Set",
                            `${role} is now the vouch role.`
                        )
                    );
                }

                // ---------------------------------------------
                // GIVE
                // ---------------------------------------------

                if (
                    sub ===
                    "give"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "You do not have permission to give vouches."
                            )
                        );
                    }

                    const target =
                        message.mentions
                            .members
                            .first();

                    if (!target) {
                        return message.reply(
                            plain(
                                "Missing User",
                                "Mention a user."
                            )
                        );
                    }

                    if (
                        !canManageTarget(
                            message.member,
                            target
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "You cannot manage that user."
                            )
                        );
                    }

                    data.vouchRevoked[
                        target.id
                    ] = false;

                    data.vouches[
                        target.id
                    ] =
                        getVouchCount(
                            guild.id,
                            target.id
                        ) + 1;

                    saveDB();

                    const result =
                        await syncVouchRole(
                            target
                        );

                    const count =
                        getVouchCount(
                            guild.id,
                            target.id
                        );

                    return message.reply(
                        plain(
                            "Vouch Added",
                            `${target} now has **${count}** vouches.` +
                            (
                                count >=
                                data.vouchLimit
                                    ? result.ok
                                        ? " They qualify for the vouch role."
                                        : ` I could not assign the role: ${result.reason}`
                                    : ` They need **${data.vouchLimit - count}** more.`
                            )
                        )
                    );
                }

                // ---------------------------------------------
                // TAKE
                // ---------------------------------------------

                if (
                    sub ===
                    "take"
                ) {
                    if (
                        !isGod(
                            message.member
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "You do not have permission to take vouches."
                            )
                        );
                    }

                    const target =
                        message.mentions
                            .members
                            .first();

                    if (!target) {
                        return message.reply(
                            plain(
                                "Missing User",
                                "Mention a user."
                            )
                        );
                    }

                    if (
                        !canManageTarget(
                            message.member,
                            target
                        )
                    ) {
                        return message.reply(
                            plain(
                                "Access Denied",
                                "You cannot manage that user."
                            )
                        );
                    }

                    const count =
                        getVouchCount(
                            guild.id,
                            target.id
                        );

                    data.vouches[
                        target.id
                    ] =
                        Math.max(
                            0,
                            count - 1
                        );

                    data.vouchRevoked[
                        target.id
                    ] = true;

                    saveDB();

                    await syncVouchRole(
                        target
                    );

                    return message.reply(
                        plain(
                            "Vouch Removed",
                            `${target} now has **${data.vouches[target.id]}** vouches and their qualification has been revoked.`
                        )
                    );
                }

                return message.reply(
                    plain(
                        "Vouch Commands",
                        "`-vouch give @user`\n`-vouch take @user`\n`-vouch clear`\n`-vouch limit <number>`\n`-vouch role set @role`"
                    )
                );
            }

            // =================================================
            // VOUCH ROLE CLAIM
            // =================================================

            if (
                command ===
                "vouchrole"
            ) {
                if (
                    String(
                        args[0] || ""
                    ).toLowerCase() !==
                    "claim"
                ) {
                    return;
                }

                if (
                    data.vouchRevoked[
                        message.author.id
                    ]
                ) {
                    return message.reply(
                        plain(
                            "Vouch Revoked",
                            "Your vouch qualification has been revoked."
                        )
                    );
                }

                const count =
                    getVouchCount(
                        guild.id,
                        message.author.id
                    );

                if (
                    count <
                    data.vouchLimit
                ) {
                    return message.reply(
                        plain(
                            "Not Qualified",
                            `You have **${count}** vouches. You need **${data.vouchLimit}**.`
                        )
                    );
                }

                const result =
                    await syncVouchRole(
                        message.member
                    );

                if (!result.ok) {
                    return message.reply(
                        plain(
                            "Role Error",
                            result.reason
                        )
                    );
                }

                return message.reply(
                    plain(
                        "Vouch Role",
                        "Your vouch role has been assigned."
                    )
                );
            }

            // =================================================
            // KICK
            // =================================================

            if (
                command ===
                "kick"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You do not have permission to kick members."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You cannot manage that user."
                        )
                    );
                }

                await target.kick(
                    "VC+ moderation"
                );

                return message.reply(
                    plain(
                        "User Kicked",
                        `${target} has been kicked.`
                    )
                );
            }

            // =================================================
            // BAN
            // =================================================

            if (
                command ===
                "ban"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You do not have permission to ban members."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You cannot manage that user."
                        )
                    );
                }

                await target.ban({
                    reason:
                        "VC+ moderation"
                });

                return message.reply(
                    plain(
                        "User Banned",
                        `${target} has been banned.`
                    )
                );
            }

            // =================================================
            // TIMEOUT
            // =================================================

            if (
                command ===
                "timeout"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You do not have permission to timeout members."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You cannot manage that user."
                        )
                    );
                }

                const minutes =
                    Math.min(
                        40320,
                        Math.max(
                            1,
                            Number(
                                args[1]
                            ) || 10
                        )
                    );

                await target.timeout(
                    minutes *
                        60 *
                        1000,
                    "VC+ moderation"
                );

                return message.reply(
                    plain(
                        "User Timed Out",
                        `${target} has been timed out for **${minutes} minutes**.`
                    )
                );
            }

            // =================================================
            // UNTIMEOUT
            // =================================================

            if (
                command ===
                "untimeout"
            ) {
                if (
                    !isGod(
                        message.member
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You do not have permission to remove timeouts."
                        )
                    );
                }

                const target =
                    message.mentions
                        .members
                        .first();

                if (!target) {
                    return message.reply(
                        plain(
                            "Missing User",
                            "Mention a user."
                        )
                    );
                }

                if (
                    !canManageTarget(
                        message.member,
                        target
                    )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You cannot manage that user."
                        )
                    );
                }

                await target.timeout(
                    null,
                    "VC+ timeout removed"
                );

                return message.reply(
                    plain(
                        "Timeout Removed",
                        `${target} is no longer timed out.`
                    )
                );
            }

            // =================================================
            // PURGE
            // =================================================

            if (
                command ===
                "purge"
            ) {
                if (
                    !isGod(
                        message.member
                    ) &&
                    !message.member
                        .permissions
                        .has(
                            PermissionFlagsBits
                                .ManageMessages
                        )
                ) {
                    return message.reply(
                        plain(
                            "Access Denied",
                            "You need Manage Messages."
                        )
                    );
                }

                const amount =
                    Math.min(
                        100,
                        Math.max(
                            1,
                            Number(
                                args[0]
                            ) || 10
                        )
                    );

                const deleted =
                    await message.channel
                        .bulkDelete(
                            amount + 1,
                            true
                        )
                        .catch(
                            () => null
                        );

                if (!deleted) {
                    return;
                }

                return message.channel.send(
                    plain(
                        "Messages Purged",
                        `Deleted **${Math.max(
                            0,
                            deleted.size - 1
                        )}** messages.`
                    )
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Command error:",
                error
            );

            await message.reply(
                plain(
                    "Error",
                    "VC+ encountered an error while processing that command."
                )
            ).catch(() => {});
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
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                data.foreverBanned
                    .includes(
                        member.id
                    )
            ) {
                await member.ban({
                    reason:
                        "VC+ permanent ban"
                }).catch(() => {});
            }

        } catch (error) {
            console.error(
                "[VC+] Member join error:",
                error
            );
        }
    }
);

// ============================================================
// CLIENT READY
// ============================================================

client.once(
    "ready",
    async () => {
        console.log(
            "======================================"
        );

        console.log(
            `[VC+] Logged in as ${client.user.tag}`
        );

        console.log(
            `[VC+] Servers: ${client.guilds.cache.size}`
        );

        console.log(
            "======================================"
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        "VC+ | -help",
                    type:
                        ActivityType.Watching
                }
            ],

            status:
                "online"
        });

        for (
            const guild
            of client.guilds.cache.values()
        ) {
            getGuildData(
                guild.id
            );

            await cleanupEmptyTempVCs(
                guild
            ).catch(() => {});
        }
    }
);

// ============================================================
// ERROR PROTECTION
// ============================================================

client.on(
    "error",
    error => {
        console.error(
            "[VC+] Client error:",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[VC+] Discord warning:",
            warning
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[VC+] Unhandled rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[VC+] Uncaught exception:",
            error
        );
    }
);

process.on(
    "SIGINT",
    () => {
        console.log(
            "[VC+] Saving database..."
        );

        saveDB();

        client.destroy();

        process.exit(0);
    }
);

process.on(
    "SIGTERM",
    () => {
        console.log(
            "[VC+] Saving database..."
        );

        saveDB();

        client.destroy();

        process.exit(0);
    }
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
