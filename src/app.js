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

/*
========================================================
VC+
Complete Discord.js v14 server / VC management bot
========================================================

PREFIX:
-

RANKS:
Founder
God
Owner
Co Owner
Executive
Director
Admin
Moderator
Staff
Member

IMPORTANT:
- Founder = stored Founder rank OR Server Owner
- God = stored God rank OR Godmode OR Founder
- Only Server Owner can assign Founder
- Founder can manage everything
- No emojis are used
========================================================
*/

const PREFIX = "-";
const BOT_NAME = "VC+";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("[VC+] DISCORD_TOKEN is missing.");
    process.exit(1);
}

/*
========================================================
CLIENT
========================================================
*/

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

/*
========================================================
DATABASE
========================================================
*/

const DATA_DIR = path.join(
    process.cwd(),
    "data"
);

const DATA_FILE = path.join(
    DATA_DIR,
    "vcplus.json"
);

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

const DEFAULT_GUILD_DATA = {
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

let db = {};

/*
========================================================
DATABASE FUNCTIONS
========================================================
*/

function cloneDefault() {
    return JSON.parse(
        JSON.stringify(
            DEFAULT_GUILD_DATA
        )
    );
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                db,
                null,
                4
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "[VC+] Database save error:",
            error
        );
    }
}

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            db = {};
            saveDatabase();
            return;
        }

        const raw =
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            );

        if (!raw.trim()) {
            db = {};
            saveDatabase();
            return;
        }

        db = JSON.parse(raw);

        if (
            !db ||
            typeof db !== "object"
        ) {
            db = {};
        }

        for (
            const guildId of Object.keys(db)
        ) {
            ensureGuildData(guildId);
        }

        saveDatabase();

        console.log(
            "[VC+] Database loaded."
        );
    } catch (error) {
        console.error(
            "[VC+] Database load error:",
            error
        );

        db = {};
    }
}

function ensureGuildData(guildId) {
    if (!db[guildId]) {
        db[guildId] =
            cloneDefault();

        return db[guildId];
    }

    const data =
        db[guildId];

    data.ranks ??= {};

    data.godmode ??= [];

    data.foreverBanned ??= [];

    data.vouches ??= {};

    data.vouchRevoked ??= {};

    data.vouchLimit ??= 5;

    data.roles ??= {};

    data.roles.vouch ??= null;

    data.jtc ??= {};

    data.jtc.channelId ??= null;

    data.jtc.categoryId ??= null;

    data.tempVCs ??= {};

    data.filters ??= {};

    data.filters.enabled ??= false;

    data.filters.words ??= [];

    data.filters.strikes ??= {};

    data.filters.maxStrikes ??= 3;

    data.filters.timeoutMinutes ??= 10;

    return data;
}

function guildData(guild) {
    return ensureGuildData(
        guild.id
    );
}

loadDatabase();

/*
========================================================
BLEED STYLE RESPONSE
========================================================
*/

function plain(title, text) {
    return `${BOT_NAME}\n\n> **${title}**\n> ${text}`;
}

function replyError(
    message,
    text
) {
    return message.reply(
        plain(
            "ERROR",
            text
        )
    ).catch(() => {});
}

async function safeInteractionReply(
    interaction,
    title,
    text,
    ephemeral = true
) {
    const content =
        plain(
            title,
            text
        );

    try {
        if (
            interaction.replied ||
            interaction.deferred
        ) {
            return await interaction.followUp({
                content,
                ephemeral
            });
        }

        return await interaction.reply({
            content,
            ephemeral
        });
    } catch {
        return null;
    }
}

/*
========================================================
RANK SYSTEM
========================================================
*/

const RANK_LEVELS = {
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
    if (!rank) {
        return null;
    }

    const value =
        String(rank)
            .toLowerCase()
            .replace(
                /[\s_-]/g,
                ""
            );

    if (
        Object.prototype.hasOwnProperty.call(
            RANK_LEVELS,
            value
        )
    ) {
        return value;
    }

    return null;
}

function getRankName(
    member,
    guild
) {
    if (
        !member ||
        !guild
    ) {
        return "member";
    }

    if (
        member.id ===
        guild.ownerId
    ) {
        return "founder";
    }

    const data =
        guildData(guild);

    return (
        normalizeRank(
            data.ranks[
                member.id
            ]
        ) ||
        "member"
    );
}

function getRankLevel(
    member,
    guild
) {
    return (
        RANK_LEVELS[
            getRankName(
                member,
                guild
            )
        ] || 1
    );
}

function isServerOwner(
    member,
    guild
) {
    return Boolean(
        member &&
        guild &&
        member.id ===
            guild.ownerId
    );
}

function isFounder(member) {
    if (!member?.guild) {
        return false;
    }

    return (
        isServerOwner(
            member,
            member.guild
        ) ||
        getRankName(
            member,
            member.guild
        ) === "founder"
    );
}

function isGod(member) {
    if (!member?.guild) {
        return false;
    }

    if (
        isFounder(member)
    ) {
        return true;
    }

    const data =
        guildData(
            member.guild
        );

    return (
        getRankLevel(
            member,
            member.guild
        ) >= RANK_LEVELS.god ||
        data.godmode.includes(
            member.id
        )
    );
}

function canManageTarget(
    actor,
    target
) {
    if (
        !actor ||
        !target
    ) {
        return false;
    }

    if (
        actor.id ===
        target.id
    ) {
        return false;
    }

    if (
        isServerOwner(
            actor,
            actor.guild
        )
    ) {
        return true;
    }

    return (
        getRankLevel(
            actor,
            actor.guild
        ) >
        getRankLevel(
            target,
            target.guild
        )
    );
}

/*
========================================================
GENERAL HELPERS
========================================================
*/

function getMentionedMember(
    message
) {
    return (
        message.mentions.members.first() ||
        null
    );
}

function getMentionedRole(
    message
) {
    return (
        message.mentions.roles.first() ||
        null
    );
}

function cleanReason(parts) {
    return (
        parts.join(" ").trim() ||
        "No reason provided"
    );
}

function parsePositiveInteger(
    value,
    fallback = null
) {
    const number =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isFinite(
            number
        )
    ) {
        return fallback;
    }

    return number;
}

function hasBotPermission(
    guild,
    permission
) {
    const me =
        guild.members.me;

    if (!me) {
        return false;
    }

    return me.permissions.has(
        permission
    );
}

/*
========================================================
VOUCH SYSTEM
========================================================
*/

function getVouchCount(
    guild,
    userId
) {
    const data =
        guildData(guild);

    return Number(
        data.vouches[userId] || 0
    );
}

function isVouchRevoked(
    guild,
    userId
) {
    const data =
        guildData(guild);

    return Boolean(
        data.vouchRevoked[userId]
    );
}

function canBotManageRole(
    guild,
    role
) {
    const me =
        guild.members.me;

    if (
        !me ||
        !role
    ) {
        return false;
    }

    if (
        !me.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        return false;
    }

    return (
        role.position <
        me.roles.highest.position
    );
}

async function syncVouchRole(
    guild,
    member
) {
    const data =
        guildData(guild);

    if (
        !data.roles.vouch
    ) {
        return;
    }

    const role =
        guild.roles.cache.get(
            data.roles.vouch
        );

    if (!role) {
        data.roles.vouch = null;
        saveDatabase();
        return;
    }

    if (
        !canBotManageRole(
            guild,
            role
        )
    ) {
        return;
    }

    const count =
        getVouchCount(
            guild,
            member.id
        );

    const limit =
        Math.max(
            1,
            Number(
                data.vouchLimit ||
                5
            )
        );

    const revoked =
        isVouchRevoked(
            guild,
            member.id
        );

    try {
        if (
            count >= limit &&
            !revoked
        ) {
            if (
                !member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.add(
                    role
                );
            }
        } else {
            if (
                member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles.remove(
                    role
                );
            }
        }
    } catch (error) {
        console.error(
            "[VC+] Vouch role sync error:",
            error
        );
    }
}

async function syncAllVouchRoles(
    guild
) {
    const data =
        guildData(guild);

    if (
        !data.roles.vouch
    ) {
        return;
    }

    const role =
        guild.roles.cache.get(
            data.roles.vouch
        );

    if (
        !role ||
        !canBotManageRole(
            guild,
            role
        )
    ) {
        return;
    }

    for (
        const member of
        guild.members.cache.values()
    ) {
        await syncVouchRole(
            guild,
            member
        );
    }
}

/*
========================================================
TEMP VC SYSTEM
========================================================
*/

function getTempVC(
    guild,
    channelId
) {
    const data =
        guildData(guild);

    return (
        data.tempVCs[
            channelId
        ] || null
    );
}

function isTempVC(
    guild,
    channelId
) {
    return Boolean(
        getTempVC(
            guild,
            channelId
        )
    );
}

function canUseNormalVCControl(
    member,
    channel
) {
    const record =
        getTempVC(
            member.guild,
            channel.id
        );

    if (!record) {
        return false;
    }

    return (
        record.ownerId ===
            member.id ||
        isFounder(member)
    );
}

/*
========================================================
VC BUTTON INTERFACE
========================================================
*/

function buildVCInterface() {
    const rows = [];

    rows.push(
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_lock"
                    )
                    .setLabel(
                        "Lock"
                    )
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
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            )
    );

    rows.push(
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        "vc_permit"
                    )
                    .setLabel(
                        "Permit"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_reject"
                    )
                    .setLabel(
                        "Reject"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_kick"
                    )
                    .setLabel(
                        "Kick"
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_transfer"
                    )
                    .setLabel(
                        "Transfer"
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        "vc_settings"
                    )
                    .setLabel(
                        "Settings"
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            )
    );

    return rows;
}

/*
========================================================
BLEED STYLE MODAL HELPERS
========================================================
*/

function shortInput(
    id,
    label,
    placeholder,
    maxLength = 100
) {
    return new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(
            TextInputStyle.Short
        )
        .setPlaceholder(
            placeholder
        )
        .setRequired(true)
        .setMaxLength(
            maxLength
        );
}

function paragraphInput(
    id,
    label,
    placeholder,
    maxLength = 1000
) {
    return new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(
            TextInputStyle.Paragraph
        )
        .setPlaceholder(
            placeholder
        )
        .setRequired(true)
        .setMaxLength(
            maxLength
        );
}

function userModal(
    customId,
    title,
    label = "USER ID"
) {
    return new ModalBuilder()
        .setCustomId(
            customId
        )
        .setTitle(
            `VC+ | ${title}`
        )
        .addComponents(
            new ActionRowBuilder()
                .addComponents(
                    shortInput(
                        "user_id",
                        label,
                        "Enter the Discord user ID"
                    )
                )
        );
}

function getModalUserId(
    interaction
) {
    return interaction.fields
        .getTextInputValue(
            "user_id"
        )
        .trim()
        .replace(
            /[<@!>]/g,
            ""
        );
}

/*
========================================================
SEND VC INTERFACE
========================================================
*/

async function sendVCInterface(
    channel
) {
    const record =
        getTempVC(
            channel.guild,
            channel.id
        );

    if (!record) {
        return null;
    }

    const owner =
        channel.guild.members.cache.get(
            record.ownerId
        );

    const message =
        await channel.send({
            content: plain(
                "VC+ INTERFACE",
                [
                    `OWNER: ${owner || record.ownerId}`,
                    "",
                    "Use the controls below.",
                    "",
                    "Lock",
                    "Unlock",
                    "Claim",
                    "Rename",
                    "Limit",
                    "Permit",
                    "Reject",
                    "Kick",
                    "Transfer",
                    "Settings",
                    "",
                    "Founder-only controls remain restricted to Founder and Server Owner."
                ].join("\n")
            ),
            components:
                buildVCInterface()
        });

    record.interfaceMessageId =
        message.id;

    saveDatabase();

    return message;
}

async function refreshVCInterface(
    channel
) {
    const record =
        getTempVC(
            channel.guild,
            channel.id
        );

    if (
        !record ||
        !record.interfaceMessageId
    ) {
        return;
    }

    try {
        const message =
            await channel.messages.fetch(
                record.interfaceMessageId
            );

        const owner =
            channel.guild.members.cache.get(
                record.ownerId
            );

        await message.edit({
            content: plain(
                "VC+ INTERFACE",
                [
                    `OWNER: ${owner || record.ownerId}`,
                    "",
                    "Use the controls below.",
                    "",
                    "Lock",
                    "Unlock",
                    "Claim",
                    "Rename",
                    "Limit",
                    "Permit",
                    "Reject",
                    "Kick",
                    "Transfer",
                    "Settings",
                    "",
                    "Founder-only VC commands remain restricted."
                ].join("\n")
            ),
            components:
                buildVCInterface()
        });
    } catch {
        try {
            await sendVCInterface(
                channel
            );
        } catch {}
    }
}

/*
========================================================
CREATE TEMP VC
========================================================
*/

async function createTempVC(
    member
) {
    const guild =
        member.guild;

    const data =
        guildData(guild);

    if (
        !data.jtc.categoryId
    ) {
        return null;
    }

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (
        !category ||
        category.type !==
            ChannelType.GuildCategory
    ) {
        return null;
    }

    const channelName =
        `${member.displayName}'s VC`
            .slice(0, 100);

    const channel =
        await guild.channels.create({
            name: channelName,

            type:
                ChannelType.GuildVoice,

            parent:
                category.id,

            userLimit: 0,

            permissionOverwrites: [
                {
                    id:
                        guild.roles.everyone.id,

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

    data.tempVCs[
        channel.id
    ] = {
        ownerId: member.id,

        locked: false,

        banned: [],

        permitted: [],

        stfu: [],

        interfaceMessageId: null
    };

    saveDatabase();

    try {
        await sendVCInterface(
            channel
        );
    } catch (error) {
        console.error(
            "[VC+] Interface error:",
            error
        );
    }

    return channel;
}

/*
========================================================
DELETE TEMP VC
========================================================
*/

async function deleteTempVC(
    channel
) {
    const data =
        guildData(
            channel.guild
        );

    delete data.tempVCs[
        channel.id
    ];

    saveDatabase();

    try {
        if (
            channel.deletable
        ) {
            await channel.delete(
                "VC+ temporary VC cleanup"
            );
        }
    } catch (error) {
        console.error(
            "[VC+] VC deletion error:",
            error
        );
    }
}

/*
========================================================
CLEAN EMPTY VCS
========================================================
*/

async function cleanupEmptyTempVCs(
    guild
) {
    const data =
        guildData(guild);

    for (
        const channelId of
        Object.keys(
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
            channel.type !==
            ChannelType.GuildVoice
        ) {
            delete data.tempVCs[
                channelId
            ];

            continue;
        }

        if (
            channel.members.size ===
            0
        ) {
            await deleteTempVC(
                channel
            );
        }
    }

    saveDatabase();
}

/*
========================================================
VC FILTER
========================================================
*/

function messageContainsFilteredWord(
    content,
    words
) {
    const lower =
        content.toLowerCase();

    return words.some(
        word => {
            const clean =
                String(word)
                    .trim()
                    .toLowerCase();

            if (!clean) {
                return false;
            }

            return lower.includes(
                clean
            );
        }
    );
}

async function processVCFilter(
    message
) {
    if (!message.guild) {
        return false;
    }

    const data =
        guildData(
            message.guild
        );

    if (
        !data.filters.enabled
    ) {
        return false;
    }

    if (
        !isTempVC(
            message.guild,
            message.channel.id
        )
    ) {
        return false;
    }

    if (
        !data.filters.words.length
    ) {
        return false;
    }

    if (!message.member) {
        return false;
    }

    if (
        isFounder(
            message.member
        )
    ) {
        return false;
    }

    if (
        message.author.bot ||
        message.webhookId
    ) {
        return false;
    }

    if (
        !messageContainsFilteredWord(
            message.content,
            data.filters.words
        )
    ) {
        return false;
    }

    try {
        await message.delete();
    } catch {}

    const userId =
        message.author.id;

    data.filters.strikes[
        userId
    ] =
        Number(
            data.filters.strikes[
                userId
            ] || 0
        ) + 1;

    const strikes =
        data.filters.strikes[
            userId
        ];

    const maxStrikes =
        Math.max(
            1,
            Number(
                data.filters.maxStrikes ||
                3
            )
        );

    saveDatabase();

    if (
        strikes >= maxStrikes
    ) {
        const timeoutMinutes =
            Math.max(
                1,
                Number(
                    data.filters
                        .timeoutMinutes ||
                    10
                )
            );

        try {
            if (
                message.member.moderatable &&
                hasBotPermission(
                    message.guild,
                    PermissionFlagsBits.ModerateMembers
                )
            ) {
                await message.member.timeout(
                    timeoutMinutes *
                        60 *
                        1000,
                    "VC+ automatic VC text filter"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Filter timeout error:",
                error
            );
        }

        data.filters.strikes[
            userId
        ] = 0;

        saveDatabase();

        try {
            await message.channel.send(
                plain(
                    "VC FILTER",
                    `${message.author} reached the maximum filter strikes and was timed out for ${timeoutMinutes} minutes.`
                )
            );
        } catch {}
    } else {
        try {
            await message.channel.send(
                plain(
                    "VC FILTER",
                    `${message.author} received a filter strike. Strikes: ${strikes}/${maxStrikes}.`
                )
            );
        } catch {}
    }

    return true;
}

/*
========================================================
BUTTON INTERACTIONS
========================================================
*/

client.on(
    "interactionCreate",
    async interaction => {
        try {
            if (
                !interaction.isButton()
            ) {
                return;
            }

            const id =
                interaction.customId;

            if (
                !id.startsWith("vc_")
            ) {
                return;
            }

            if (
                !interaction.guild
            ) {
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "This control can only be used inside a server."
                );
            }

            const channel =
                interaction.channel;

            if (
                !channel ||
                channel.type !==
                    ChannelType.GuildVoice
            ) {
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "This interface must be used inside the temporary VC."
                );
            }

            const record =
                getTempVC(
                    interaction.guild,
                    channel.id
                );

            if (!record) {
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "This temporary VC is no longer managed by VC+."
                );
            }

            const member =
                interaction.member;

            const founderOnly =
                [
                    "vc_stfu",
                    "vc_unstfu",
                    "vc_ban",
                    "vc_unban"
                ];

            if (
                founderOnly.includes(
                    id
                )
            ) {
                if (
                    !isFounder(member)
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ACCESS DENIED",
                        "Founder rank or the Server Owner is required."
                    );
                }
            } else {
                if (
                    !canUseNormalVCControl(
                        member,
                        channel
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ACCESS DENIED",
                        "You do not own this temporary VC."
                    );
                }
            }

            /*
            ----------------------------------------
            LOCK
            ----------------------------------------
            */

            if (
                id ===
                "vc_lock"
            ) {
                record.locked =
                    true;

                await channel.permissionOverwrites.edit(
                    interaction.guild
                        .roles
                        .everyone,
                    {
                        Connect:
                            false
                    }
                );

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "VC LOCKED",
                    "This VC is now locked."
                );
            }

            /*
            ----------------------------------------
            UNLOCK
            ----------------------------------------
            */

            if (
                id ===
                "vc_unlock"
            ) {
                record.locked =
                    false;

                await channel.permissionOverwrites.edit(
                    interaction.guild
                        .roles
                        .everyone,
                    {
                        Connect:
                            null
                    }
                );

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "VC UNLOCKED",
                    "This VC is now unlocked."
                );
            }

            /*
            ----------------------------------------
            CLAIM
            ----------------------------------------
            */

            if (
                id ===
                "vc_claim"
            ) {
                const oldOwner =
                    interaction.guild
                        .members
                        .cache.get(
                            record.ownerId
                        );

                if (
                    oldOwner &&
                    channel.members.has(
                        oldOwner.id
                    ) &&
                    oldOwner.id !==
                        member.id &&
                    !isFounder(
                        member
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        "CLAIM FAILED",
                        "The current owner is still inside this VC."
                    );
                }

                record.ownerId =
                    member.id;

                await channel.permissionOverwrites.edit(
                    member.id,
                    {
                        ViewChannel:
                            true,

                        Connect:
                            true,

                        Speak:
                            true,

                        SendMessages:
                            true,

                        MoveMembers:
                            true,

                        MuteMembers:
                            true,

                        DeafenMembers:
                            true
                    }
                );

                saveDatabase();

                await refreshVCInterface(
                    channel
                );

                return safeInteractionReply(
                    interaction,
                    "VC CLAIMED",
                    "You are now the owner of this VC."
                );
            }

            /*
            ----------------------------------------
            RENAME
            ----------------------------------------
            */

            if (
                id ===
                "vc_rename"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "vc_modal_rename"
                        )
                        .setTitle(
                            "VC+ | RENAME"
                        )
                        .addComponents(
                            new ActionRowBuilder()
                                .addComponents(
                                    shortInput(
                                        "name",
                                        "NEW NAME",
                                        "Enter the new voice channel name",
                                        100
                                    )
                                )
                        );

                return interaction.showModal(
                    modal
                );
            }

            /*
            ----------------------------------------
            LIMIT
            ----------------------------------------
            */

            if (
                id ===
                "vc_limit"
            ) {
                const modal =
                    new ModalBuilder()
                        .setCustomId(
                            "vc_modal_limit"
                        )
                        .setTitle(
                            "VC+ | LIMIT"
                        )
                        .addComponents(
                            new ActionRowBuilder()
                                .addComponents(
                                    shortInput(
                                        "limit",
                                        "USER LIMIT",
                                        "Enter a number from 0 to 99",
                                        2
                                    )
                                )
                        );

                return interaction.showModal(
                    modal
                );
            }

            /*
            ----------------------------------------
            PERMIT
            ----------------------------------------
            */

            if (
                id ===
                "vc_permit"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_permit",
                        "PERMIT"
                    )
                );
            }

            /*
            ----------------------------------------
            REJECT
            ----------------------------------------
            */

            if (
                id ===
                "vc_reject"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_reject",
                        "REJECT"
                    )
                );
            }

            /*
            ----------------------------------------
            KICK
            ----------------------------------------
            */

            if (
                id ===
                "vc_kick"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_kick",
                        "KICK"
                    )
                );
            }

            /*
            ----------------------------------------
            TRANSFER
            ----------------------------------------
            */

            if (
                id ===
                "vc_transfer"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_transfer",
                        "TRANSFER"
                    )
                );
            }

            /*
            ----------------------------------------
            FOUNDER STFU
            ----------------------------------------
            */

            if (
                id ===
                "vc_stfu"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_stfu",
                        "STFU"
                    )
                );
            }

            /*
            ----------------------------------------
            FOUNDER UNSTFU
            ----------------------------------------
            */

            if (
                id ===
                "vc_unstfu"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_unstfu",
                        "UNSTFU"
                    )
                );
            }

            /*
            ----------------------------------------
            FOUNDER VC BAN
            ----------------------------------------
            */

            if (
                id ===
                "vc_ban"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_ban",
                        "VC BAN"
                    )
                );
            }

            /*
            ----------------------------------------
            FOUNDER VC UNBAN
            ----------------------------------------
            */

            if (
                id ===
                "vc_unban"
            ) {
                return interaction.showModal(
                    userModal(
                        "vc_modal_unban",
                        "VC UNBAN"
                    )
                );
            }

            /*
            ----------------------------------------
            SETTINGS
            ----------------------------------------
            */

            if (
                id ===
                "vc_settings"
            ) {
                return safeInteractionReply(
                    interaction,
                    "VC SETTINGS",
                    [
                        `Owner: <@${record.ownerId}>`,
                        `Locked: ${record.locked ? "Yes" : "No"}`,
                        `Users: ${channel.members.size}`,
                        `Limit: ${channel.userLimit || "Unlimited"}`,
                        `VC Bans: ${record.banned.length}`,
                        `STFU List: ${record.stfu.length}`
                    ].join("\n")
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Button error:",
                error
            );

            return safeInteractionReply(
                interaction,
                "ERROR",
                "Something went wrong while processing this control."
            );
        }
    }
);

/*
========================================================
MODAL INTERACTIONS
========================================================
*/

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
                !interaction.customId.startsWith(
                    "vc_modal_"
                )
            ) {
                return;
            }

            if (
                !interaction.guild
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
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "This modal must be used inside a temporary VC."
                );
            }

            const record =
                getTempVC(
                    interaction.guild,
                    channel.id
                );

            if (!record) {
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "This VC is no longer managed by VC+."
                );
            }

            const member =
                interaction.member;

            const founderOnly =
                [
                    "vc_modal_stfu",
                    "vc_modal_unstfu",
                    "vc_modal_ban",
                    "vc_modal_unban"
                ];

            if (
                founderOnly.includes(
                    interaction.customId
                )
            ) {
                if (
                    !isFounder(member)
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ACCESS DENIED",
                        "Founder rank or the Server Owner is required."
                    );
                }
            } else {
                if (
                    !canUseNormalVCControl(
                        member,
                        channel
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ACCESS DENIED",
                        "You do not own this temporary VC."
                    );
                }
            }

            /*
            ----------------------------------------
            RENAME
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_rename"
            ) {
                const name =
                    interaction.fields
                        .getTextInputValue(
                            "name"
                        )
                        .trim();

                if (!name) {
                    return safeInteractionReply(
                        interaction,
                        "ERROR",
                        "A channel name is required."
                    );
                }

                const finalName =
                    name.slice(
                        0,
                        100
                    );

                await channel.setName(
                    finalName,
                    "VC+ VC rename"
                );

                return safeInteractionReply(
                    interaction,
                    "VC RENAMED",
                    `The VC was renamed to ${finalName}.`
                );
            }

            /*
            ----------------------------------------
            LIMIT
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_limit"
            ) {
                const value =
                    parsePositiveInteger(
                        interaction.fields
                            .getTextInputValue(
                                "limit"
                            )
                    );

                if (
                    value === null ||
                    value < 0 ||
                    value > 99
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ERROR",
                        "The user limit must be between 0 and 99."
                    );
                }

                await channel.setUserLimit(
                    value
                );

                return safeInteractionReply(
                    interaction,
                    "VC LIMIT",
                    `The VC limit is now ${value === 0 ? "unlimited" : value}.`
                );
            }

            const userId =
                getModalUserId(
                    interaction
                );

            let target;

            try {
                target =
                    await interaction.guild
                        .members
                        .fetch(
                            userId
                        );
            } catch {
                return safeInteractionReply(
                    interaction,
                    "ERROR",
                    "That user could not be found."
                );
            }

            /*
            ----------------------------------------
            PERMIT
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_permit"
            ) {
                record.permitted = [
                    ...new Set([
                        ...record.permitted,
                        target.id
                    ])
                ];

                record.banned =
                    record.banned.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel:
                            true,

                        Connect:
                            true,

                        Speak:
                            true,

                        SendMessages:
                            true
                    }
                );

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "USER PERMITTED",
                    `${target} can now join this VC.`
                );
            }

            /*
            ----------------------------------------
            REJECT
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_reject"
            ) {
                record.banned = [
                    ...new Set([
                        ...record.banned,
                        target.id
                    ])
                ];

                record.permitted =
                    record.permitted.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect:
                            false
                    }
                );

                if (
                    channel.members.has(
                        target.id
                    )
                ) {
                    try {
                        await target.voice.disconnect(
                            "VC+ rejected user"
                        );
                    } catch {}
                }

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "USER REJECTED",
                    `${target} can no longer join this VC.`
                );
            }

            /*
            ----------------------------------------
            KICK
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_kick"
            ) {
                if (
                    !channel.members.has(
                        target.id
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ERROR",
                        "That user is not inside this VC."
                    );
                }

                try {
                    await target.voice.disconnect(
                        "VC+ VC kick"
                    );
                } catch {
                    return safeInteractionReply(
                        interaction,
                        "ERROR",
                        "I could not disconnect that user."
                    );
                }

                return safeInteractionReply(
                    interaction,
                    "USER KICKED",
                    `${target} was removed from the VC.`
                );
            }

            /*
            ----------------------------------------
            TRANSFER
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_transfer"
            ) {
                if (
                    !channel.members.has(
                        target.id
                    )
                ) {
                    return safeInteractionReply(
                        interaction,
                        "ERROR",
                        "The new owner must be inside the VC."
                    );
                }

                record.ownerId =
                    target.id;

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel:
                            true,

                        Connect:
                            true,

                        Speak:
                            true,

                        SendMessages:
                            true,

                        MoveMembers:
                            true,

                        MuteMembers:
                            true,

                        DeafenMembers:
                            true
                    }
                );

                saveDatabase();

                await refreshVCInterface(
                    channel
                );

                return safeInteractionReply(
                    interaction,
                    "OWNERSHIP TRANSFERRED",
                    `${target} is now the owner of this VC.`
                );
            }

            /*
            ----------------------------------------
            STFU
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_stfu"
            ) {
                record.stfu = [
                    ...new Set([
                        ...record.stfu,
                        target.id
                    ])
                ];

                if (
                    channel.members.has(
                        target.id
                    )
                ) {
                    try {
                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        );
                    } catch {}
                }

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "STFU",
                    `${target} has been added to the VC STFU list.`
                );
            }

            /*
            ----------------------------------------
            UNSTFU
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_unstfu"
            ) {
                record.stfu =
                    record.stfu.filter(
                        id =>
                            id !==
                            target.id
                    );

                if (
                    channel.members.has(
                        target.id
                    )
                ) {
                    try {
                        await target.voice.setMute(
                            false,
                            "VC+ Unstfu"
                        );
                    } catch {}
                }

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "UNSTFU",
                    `${target} has been removed from the VC STFU list.`
                );
            }

            /*
            ----------------------------------------
            VC BAN
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_ban"
            ) {
                record.banned = [
                    ...new Set([
                        ...record.banned,
                        target.id
                    ])
                ];

                record.permitted =
                    record.permitted.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel:
                            false,

                        Connect:
                            false
                    }
                );

                if (
                    channel.members.has(
                        target.id
                    )
                ) {
                    try {
                        await target.voice.disconnect(
                            "VC+ VC ban"
                        );
                    } catch {}
                }

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "VC BAN",
                    `${target} is now banned from this VC.`
                );
            }

            /*
            ----------------------------------------
            VC UNBAN
            ----------------------------------------
            */

            if (
                interaction.customId ===
                "vc_modal_unban"
            ) {
                record.banned =
                    record.banned.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel:
                            null,

                        Connect:
                            null,

                        Speak:
                            null,

                        SendMessages:
                            null
                    }
                );

                saveDatabase();

                return safeInteractionReply(
                    interaction,
                    "VC UNBAN",
                    `${target} is no longer banned from this VC.`
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Modal error:",
                error
            );

            return safeInteractionReply(
                interaction,
                "ERROR",
                "Something went wrong while processing that request."
            );
        }
    }
);

/*
========================================================
VC COMMANDS
========================================================
*/

async function handleVCCommand(
    message,
    args
) {
    const guild =
        message.guild;

    const member =
        message.member;

    const data =
        guildData(guild);

    const sub =
        (
            args.shift() ||
            "help"
        ).toLowerCase();

    /*
    ----------------------------------------
    VC HELP
    ----------------------------------------
    */

    if (
        sub === "help"
    ) {
        return message.reply(
            plain(
                "VC COMMANDS",
                [
                    "NORMAL VC",
                    "-vc help",
                    "-vc info",
                    "-vc lock",
                    "-vc unlock",
                    "-vc claim",
                    "-vc rename <name>",
                    "-vc limit <number>",
                    "-vc permit @user",
                    "-vc reject @user",
                    "-vc kick @user",
                    "-vc transfer @user",
                    "",
                    "FOUNDER ONLY",
                    "-vc setup",
                    "-vc setup #category",
                    "-vc setup filter",
                    "-vc setup filter on",
                    "-vc setup filter off",
                    "-vc setup filter add <word>",
                    "-vc setup filter remove <word>",
                    "-vc setup filter list",
                    "-vc setup filter strikes <number>",
                    "-vc setup filter timeout <minutes>",
                    "-vc channel #channel",
                    "-vc category #category",
                    "-vc reset",
                    "-vc list",
                    "-vc delete",
                    "-vc stfu @user",
                    "-vc unstfu @user",
                    "-vc ban @user",
                    "-vc unban @user"
                ].join("\n")
            )
        );
    }

    /*
    ----------------------------------------
    VC INFO
    ----------------------------------------
    */

    if (
        sub === "info"
    ) {
        const channel =
            member.voice.channel;

        if (
            !channel ||
            !isTempVC(
                guild,
                channel.id
            )
        ) {
            return replyError(
                message,
                "You must be inside a VC created by VC+."
            );
        }

        const record =
            getTempVC(
                guild,
                channel.id
            );

        return message.reply(
            plain(
                "VC INFO",
                [
                    `Owner: <@${record.ownerId}>`,
                    `Locked: ${record.locked ? "Yes" : "No"}`,
                    `Users: ${channel.members.size}`,
                    `Limit: ${channel.userLimit || "Unlimited"}`,
                    `VC Bans: ${record.banned.length}`,
                    `STFU List: ${record.stfu.length}`
                ].join("\n")
            )
        );
    }

    /*
    ----------------------------------------
    NORMAL VC COMMANDS
    ----------------------------------------
    */

    const normalCommands = [
        "lock",
        "unlock",
        "claim",
        "rename",
        "limit",
        "permit",
        "reject",
        "kick",
        "transfer"
    ];

    if (
        normalCommands.includes(
            sub
        )
    ) {
        const channel =
            member.voice.channel;

        if (
            !channel ||
            channel.type !==
                ChannelType.GuildVoice ||
            !isTempVC(
                guild,
                channel.id
            )
        ) {
            return replyError(
                message,
                "You must be inside a temporary VC created by VC+."
            );
        }

        const record =
            getTempVC(
                guild,
                channel.id
            );

        if (
            record.ownerId !==
                member.id &&
            !isFounder(member)
        ) {
            return replyError(
                message,
                "You do not own this temporary VC."
            );
        }

        if (
            sub === "lock"
        ) {
            record.locked =
                true;

            await channel.permissionOverwrites.edit(
                guild.roles.everyone,
                {
                    Connect:
                        false
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC LOCKED",
                    "This VC is now locked."
                )
            );
        }

        if (
            sub === "unlock"
        ) {
            record.locked =
                false;

            await channel.permissionOverwrites.edit(
                guild.roles.everyone,
                {
                    Connect:
                        null
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC UNLOCKED",
                    "This VC is now unlocked."
                )
            );
        }

        if (
            sub === "claim"
        ) {
            const oldOwner =
                guild.members.cache.get(
                    record.ownerId
                );

            if (
                oldOwner &&
                channel.members.has(
                    oldOwner.id
                ) &&
                oldOwner.id !==
                    member.id &&
                !isFounder(member)
            ) {
                return replyError(
                    message,
                    "The current owner is still inside this VC."
                );
            }

            record.ownerId =
                member.id;

            saveDatabase();

            await refreshVCInterface(
                channel
            );

            return message.reply(
                plain(
                    "VC CLAIMED",
                    "You are now the owner of this VC."
                )
            );
        }

        if (
            sub === "rename"
        ) {
            const name =
                args.join(" ")
                    .trim();

            if (!name) {
                return replyError(
                    message,
                    "Usage: -vc rename <name>"
                );
            }

            const finalName =
                name.slice(
                    0,
                    100
                );

            await channel.setName(
                finalName,
                "VC+ VC rename"
            );

            return message.reply(
                plain(
                    "VC RENAMED",
                    `The VC was renamed to ${finalName}.`
                )
            );
        }

        if (
            sub === "limit"
        ) {
            const value =
                parsePositiveInteger(
                    args[0]
                );

            if (
                value === null ||
                value < 0 ||
                value > 99
            ) {
                return replyError(
                    message,
                    "Usage: -vc limit <0-99>"
                );
            }

            await channel.setUserLimit(
                value
            );

            return message.reply(
                plain(
                    "VC LIMIT",
                    `The VC limit is now ${value === 0 ? "unlimited" : value}.`
                )
            );
        }

        if (
            [
                "permit",
                "reject",
                "kick",
                "transfer"
            ].includes(sub)
        ) {
            const target =
                getMentionedMember(
                    message
                );

            if (!target) {
                return replyError(
                    message,
                    `Usage: -vc ${sub} @user`
                );
            }

            if (
                sub ===
                "permit"
            ) {
                record.permitted = [
                    ...new Set([
                        ...record.permitted,
                        target.id
                    ])
                ];

                record.banned =
                    record.banned.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        ViewChannel:
                            true,

                        Connect:
                            true,

                        Speak:
                            true,

                        SendMessages:
                            true
                    }
                );

                saveDatabase();

                return message.reply(
                    plain(
                        "USER PERMITTED",
                        `${target} can now join this VC.`
                    )
                );
            }

            if (
                sub ===
                "reject"
            ) {
                record.banned = [
                    ...new Set([
                        ...record.banned,
                        target.id
                    ])
                ];

                record.permitted =
                    record.permitted.filter(
                        id =>
                            id !==
                            target.id
                    );

                await channel.permissionOverwrites.edit(
                    target.id,
                    {
                        Connect:
                            false
                    }
                );

                if (
                    channel.members.has(
                        target.id
                    )
                ) {
                    try {
                        await target.voice.disconnect(
                            "VC+ rejected user"
                        );
                    } catch {}
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "USER REJECTED",
                        `${target} can no longer join this VC.`
                    )
                );
            }

            if (
                sub ===
                "kick"
            ) {
                if (
                    !channel.members.has(
                        target.id
                    )
                ) {
                    return replyError(
                        message,
                        "That user is not inside this VC."
                    );
                }

                try {
                    await target.voice.disconnect(
                        "VC+ kick"
                    );
                } catch {
                    return replyError(
                        message,
                        "I could not disconnect that user."
                    );
                }

                return message.reply(
                    plain(
                        "USER KICKED",
                        `${target} was removed from the VC.`
                    )
                );
            }

            if (
                sub ===
                "transfer"
            ) {
                if (
                    !channel.members.has(
                        target.id
                    )
                ) {
                    return replyError(
                        message,
                        "The new owner must be inside the VC."
                    );
                }

                record.ownerId =
                    target.id;

                saveDatabase();

                await refreshVCInterface(
                    channel
                );

                return message.reply(
                    plain(
                        "OWNERSHIP TRANSFERRED",
                        `${target} is now the owner of this VC.`
                    )
                );
            }
        }
    }

    /*
    ----------------------------------------
    FOUNDER CHECK
    ----------------------------------------
    */

    if (
        !isFounder(member)
    ) {
        return replyError(
            message,
            "This VC command is restricted to Founder or Server Owner."
        );
    }

    /*
    ----------------------------------------
    VC SETUP
    ----------------------------------------
    */

    if (
        sub === "setup"
    ) {
        const next =
            (
                args.shift() ||
                ""
            ).toLowerCase();

        /*
        FILTER
        */

        if (
            next ===
            "filter"
        ) {
            const action =
                (
                    args.shift() ||
                    ""
                ).toLowerCase();

            if (!action) {
                return message.reply(
                    plain(
                        "VC FILTER",
                        [
                            "-vc setup filter on",
                            "-vc setup filter off",
                            "-vc setup filter add <word>",
                            "-vc setup filter remove <word>",
                            "-vc setup filter list",
                            "-vc setup filter strikes <number>",
                            "-vc setup filter timeout <minutes>"
                        ].join("\n")
                    )
                );
            }

            if (
                action ===
                "on"
            ) {
                data.filters.enabled =
                    true;

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        "The VC text filter is now enabled."
                    )
                );
            }

            if (
                action ===
                "off"
            ) {
                data.filters.enabled =
                    false;

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        "The VC text filter is now disabled."
                    )
                );
            }

            if (
                action ===
                "add"
            ) {
                const word =
                    args.join(" ")
                        .trim()
                        .toLowerCase();

                if (!word) {
                    return replyError(
                        message,
                        "Usage: -vc setup filter add <word>"
                    );
                }

                if (
                    data.filters.words.includes(
                        word
                    )
                ) {
                    return replyError(
                        message,
                        "That word is already in the filter."
                    );
                }

                data.filters.words.push(
                    word
                );

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        `Added ${word} to the filter.`
                    )
                );
            }

            if (
                action ===
                "remove"
            ) {
                const word =
                    args.join(" ")
                        .trim()
                        .toLowerCase();

                if (!word) {
                    return replyError(
                        message,
                        "Usage: -vc setup filter remove <word>"
                    );
                }

                data.filters.words =
                    data.filters.words.filter(
                        item =>
                            item !==
                            word
                    );

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        `Removed ${word} from the filter.`
                    )
                );
            }

            if (
                action ===
                "list"
            ) {
                return message.reply(
                    plain(
                        "VC FILTER",
                        [
                            `Enabled: ${data.filters.enabled ? "Yes" : "No"}`,
                            `Words: ${data.filters.words.length ? data.filters.words.join(", ") : "None"}`,
                            `Max Strikes: ${data.filters.maxStrikes}`,
                            `Timeout: ${data.filters.timeoutMinutes} minutes`
                        ].join("\n")
                    )
                );
            }

            if (
                action ===
                "strikes"
            ) {
                const number =
                    parsePositiveInteger(
                        args[0]
                    );

                if (
                    number === null ||
                    number < 1 ||
                    number > 20
                ) {
                    return replyError(
                        message,
                        "Maximum strikes must be between 1 and 20."
                    );
                }

                data.filters.maxStrikes =
                    number;

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        `Maximum strikes is now ${number}.`
                    )
                );
            }

            if (
                action ===
                "timeout"
            ) {
                const minutes =
                    parsePositiveInteger(
                        args[0]
                    );

                if (
                    minutes === null ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Timeout must be between 1 and 40320 minutes."
                    );
                }

                data.filters.timeoutMinutes =
                    minutes;

                saveDatabase();

                return message.reply(
                    plain(
                        "VC FILTER",
                        `Filter timeout is now ${minutes} minutes.`
                    )
                );
            }

            return replyError(
                message,
                "Unknown VC filter command."
            );
        }

        /*
        CATEGORY
        */

        let category =
            message.mentions.channels.find(
                channel =>
                    channel.type ===
                    ChannelType.GuildCategory
            );

        if (!category) {
            category =
                guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildCategory &&
                        channel.name.toLowerCase() ===
                            "voice"
                );
        }

        if (!category) {
            category =
                await guild.channels.create({
                    name: "VOICE",
                    type:
                        ChannelType.GuildCategory
                });
        }

        /*
        TRIGGER
        */

        let trigger =
            data.jtc.channelId
                ? guild.channels.cache.get(
                    data.jtc.channelId
                )
                : null;

        if (
            !trigger ||
            trigger.type !==
                ChannelType.GuildVoice
        ) {
            trigger =
                guild.channels.cache.find(
                    channel =>
                        channel.type ===
                            ChannelType.GuildVoice &&
                        channel.name.toLowerCase() ===
                            "vc-user"
                );
        }

        if (!trigger) {
            trigger =
                await guild.channels.create({
                    name:
                        "VC-USER",

                    type:
                        ChannelType.GuildVoice,

                    parent:
                        category.id
                });
        } else if (
            trigger.parentId !==
            category.id
        ) {
            try {
                await trigger.setParent(
                    category.id
                );
            } catch {
                return replyError(
                    message,
                    "I found VC-USER but could not move it into the selected category."
                );
            }
        }

        data.jtc.channelId =
            trigger.id;

        data.jtc.categoryId =
            category.id;

        saveDatabase();

        return message.reply(
            plain(
                "JOIN TO CREATE",
                [
                    "VC-USER is configured.",
                    `Category: ${category.name}`,
                    `Trigger: ${trigger.name}`,
                    "",
                    "Users joining VC-USER will receive their own temporary VC."
                ].join("\n")
            )
        );
    }

    /*
    ----------------------------------------
    VC CHANNEL
    ----------------------------------------
    */

    if (
        sub ===
        "channel"
    ) {
        const channel =
            message.mentions.channels.first();

        if (
            !channel ||
            channel.type !==
                ChannelType.GuildVoice
        ) {
            return replyError(
                message,
                "Usage: -vc channel #voice-channel"
            );
        }

        data.jtc.channelId =
            channel.id;

        data.jtc.categoryId =
            channel.parentId ||
            null;

        saveDatabase();

        return message.reply(
            plain(
                "JOIN TO CREATE",
                `${channel} is now the VC-USER trigger channel.`
            )
        );
    }

    /*
    ----------------------------------------
    VC CATEGORY
    ----------------------------------------
    */

    if (
        sub ===
        "category"
    ) {
        const category =
            message.mentions.channels.find(
                channel =>
                    channel.type ===
                    ChannelType.GuildCategory
            );

        if (!category) {
            return replyError(
                message,
                "Usage: -vc category #category"
            );
        }

        data.jtc.categoryId =
            category.id;

        saveDatabase();

        return message.reply(
            plain(
                "VC CATEGORY",
                `Temporary VCs will now be created in ${category}.`
            )
        );
    }

    /*
    ----------------------------------------
    RESET
    ----------------------------------------
    */

    if (
        sub ===
        "reset"
    ) {
        for (
            const channelId of
            Object.keys(
                data.tempVCs
            )
        ) {
            const channel =
                guild.channels.cache.get(
                    channelId
                );

            if (channel) {
                try {
                    await channel.delete(
                        "VC+ reset"
                    );
                } catch {}
            }

            delete data.tempVCs[
                channelId
            ];
        }

        data.jtc.channelId =
            null;

        data.jtc.categoryId =
            null;

        saveDatabase();

        return message.reply(
            plain(
                "VC RESET",
                "All temporary VCs were removed and the Join To Create configuration was reset."
            )
        );
    }

    /*
    ----------------------------------------
    VC LIST
    ----------------------------------------
    */

    if (
        sub ===
        "list"
    ) {
        const entries =
            Object.entries(
                data.tempVCs
            );

        if (!entries.length) {
            return message.reply(
                plain(
                    "VC LIST",
                    "There are no active temporary VCs."
                )
            );
        }

        const lines = [];

        for (
            const [
                channelId,
                record
            ] of entries
        ) {
            const channel =
                guild.channels.cache.get(
                    channelId
                );

            if (!channel) {
                continue;
            }

            lines.push(
                `${channel} — Owner: <@${record.ownerId}>`
            );
        }

        return message.reply(
            plain(
                "VC LIST",
                lines.length
                    ? lines.join("\n")
                    : "There are no active temporary VCs."
            )
        );
    }

    /*
    ----------------------------------------
    VC DELETE
    ----------------------------------------
    */

    if (
        sub ===
        "delete"
    ) {
        let deleted = 0;

        for (
            const channelId of
            Object.keys(
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
                channel.members.size >
                0
            ) {
                continue;
            }

            try {
                await channel.delete(
                    "VC+ Founder cleanup"
                );

                delete data.tempVCs[
                    channelId
                ];

                deleted++;
            } catch {}
        }

        saveDatabase();

        return message.reply(
            plain(
                "VC DELETE",
                `Deleted ${deleted} empty temporary VC${deleted === 1 ? "" : "s"}.`
            )
        );
    }

    /*
    ----------------------------------------
    FOUNDER VC COMMANDS
    ----------------------------------------
    */

    if (
        [
            "stfu",
            "unstfu",
            "ban",
            "unban"
        ].includes(sub)
    ) {
        const target =
            getMentionedMember(
                message
            );

        if (!target) {
            return replyError(
                message,
                `Usage: -vc ${sub} @user`
            );
        }

        const channel =
            member.voice.channel;

        if (
            !channel ||
            !isTempVC(
                guild,
                channel.id
            )
        ) {
            return replyError(
                message,
                "You must be inside a temporary VC."
            );
        }

        const record =
            getTempVC(
                guild,
                channel.id
            );

        if (
            sub ===
            "stfu"
        ) {
            record.stfu = [
                ...new Set([
                    ...record.stfu,
                    target.id
                ])
            ];

            if (
                channel.members.has(
                    target.id
                )
            ) {
                try {
                    await target.voice.setMute(
                        true,
                        "VC+ Founder STFU"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "STFU",
                    `${target} has been added to the VC STFU list.`
                )
            );
        }

        if (
            sub ===
            "unstfu"
        ) {
            record.stfu =
                record.stfu.filter(
                    id =>
                        id !==
                        target.id
                );

            if (
                channel.members.has(
                    target.id
                )
            ) {
                try {
                    await target.voice.setMute(
                        false,
                        "VC+ Founder Unstfu"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "UNSTFU",
                    `${target} has been removed from the VC STFU list.`
                )
            );
        }

        if (
            sub ===
            "ban"
        ) {
            record.banned = [
                ...new Set([
                    ...record.banned,
                    target.id
                ])
            ];

            record.permitted =
                record.permitted.filter(
                    id =>
                        id !==
                        target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel:
                        false,

                    Connect:
                        false
                }
            );

            if (
                channel.members.has(
                    target.id
                )
            ) {
                try {
                    await target.voice.disconnect(
                        "VC+ Founder VC ban"
                    );
                } catch {}
            }

            saveDatabase();

            return message.reply(
                plain(
                    "VC BAN",
                    `${target} is now banned from this VC.`
                )
            );
        }

        if (
            sub ===
            "unban"
        ) {
            record.banned =
                record.banned.filter(
                    id =>
                        id !==
                        target.id
                );

            await channel.permissionOverwrites.edit(
                target.id,
                {
                    ViewChannel:
                        null,

                    Connect:
                        null,

                    Speak:
                        null,

                    SendMessages:
                        null
                }
            );

            saveDatabase();

            return message.reply(
                plain(
                    "VC UNBAN",
                    `${target} is no longer banned from this VC.`
                )
            );
        }
    }

    return replyError(
        message,
        "Unknown VC command. Use -vc help."
    );
}

/*
========================================================
MESSAGE COMMAND HANDLER
========================================================
*/

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                message.author.bot ||
                !message.guild ||
                !message.content.startsWith(
                    PREFIX
                )
            ) {
                return;
            }

            if (
                await processVCFilter(
                    message
                )
            ) {
                return;
            }

            const raw =
                message.content
                    .slice(
                        PREFIX.length
                    )
                    .trim();

            if (!raw) {
                return;
            }

            const parts =
                raw.split(
                    /\s+/
                );

            const command =
                parts
                    .shift()
                    .toLowerCase();

            const args =
                parts;

            /*
            ========================================
            HELP
            ========================================
            */

            if (
                command ===
                "help"
            ) {
                return message.reply(
                    plain(
                        "COMMANDS",
                        [
                            "GENERAL",
                            "-help",
                            "",
                            "VOICE",
                            "-vc help",
                            "-vc info",
                            "-vc lock",
                            "-vc unlock",
                            "-vc claim",
                            "-vc rename <name>",
                            "-vc limit <number>",
                            "-vc permit @user",
                            "-vc reject @user",
                            "-vc kick @user",
                            "-vc transfer @user",
                            "",
                            "FOUNDER VC",
                            "-vc setup",
                            "-vc setup #category",
                            "-vc setup filter",
                            "-vc setup filter on",
                            "-vc setup filter off",
                            "-vc setup filter add <word>",
                            "-vc setup filter remove <word>",
                            "-vc setup filter list",
                            "-vc setup filter strikes <number>",
                            "-vc setup filter timeout <minutes>",
                            "-vc channel #channel",
                            "-vc category #category",
                            "-vc reset",
                            "-vc list",
                            "-vc delete",
                            "-vc stfu @user",
                            "-vc unstfu @user",
                            "-vc ban @user",
                            "-vc unban @user",
                            "",
                            "RANKS",
                            "-rank @user",
                            "-rank @user <rank>",
                            "",
                            "SECURITY",
                            "-godmode @user",
                            "-godmode @user off",
                            "",
                            "VOUCH",
                            "-vouch @user",
                            "-vouch give @user",
                            "-vouch take @user",
                            "-vouch limit",
                            "-vouch limit <number>",
                            "-vouch role",
                            "-vouch role set @role",
                            "-vouch clear",
                            "",
                            "MODERATION",
                            "-kick @user [reason]",
                            "-ban @user [reason]",
                            "-unban <user ID>",
                            "-unbanall",
                            "-foreverban @user",
                            "-foreverunban @user",
                            "-timeout @user <minutes> [reason]",
                            "-untimeout @user",
                            "-purge <amount>"
                        ].join("\n")
                    )
                );
            }

            /*
            ========================================
            VC
            ========================================
            */

            if (
                command ===
                "vc"
            ) {
                return handleVCCommand(
                    message,
                    args
                );
            }

            const member =
                message.member;

            /*
            ========================================
            RANK
            ========================================
            */

            if (
                command ===
                "rank"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return replyError(
                        message,
                        "Only the Founder or Server Owner can change ranks."
                    );
                }

                let target =
                    getMentionedMember(
                        message
                    );

                let remaining =
                    args.filter(
                        arg =>
                            !arg.startsWith(
                                "<@"
                            )
                    );

                if (
                    remaining[0]?.toLowerCase() ===
                    "set"
                ) {
                    remaining.shift();
                }

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -rank @user <rank>"
                    );
                }

                const rank =
                    normalizeRank(
                        remaining[0]
                    );

                if (!rank) {
                    return message.reply(
                        plain(
                            "RANK",
                            `${target} is currently ${getRankName(target, message.guild)}.`
                        )
                    );
                }

                if (
                    rank ===
                    "founder" &&
                    !isServerOwner(
                        member,
                        message.guild
                    )
                ) {
                    return replyError(
                        message,
                        "Only the actual Server Owner can assign Founder."
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return replyError(
                        message,
                        "The Server Owner cannot have their rank changed."
                    );
                }

                const data =
                    guildData(
                        message.guild
                    );

                data.ranks[
                    target.id
                ] = rank;

                if (
                    rank !==
                        "god" &&
                    rank !==
                        "founder"
                ) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "RANK UPDATED",
                        `${target} is now ${rank}.`
                    )
                );
            }

            /*
            ========================================
            GODMODE
            ========================================
            */

            if (
                command ===
                "godmode"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return replyError(
                        message,
                        "Only the Founder or Server Owner can manage Godmode."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -godmode @user or -godmode @user off"
                    );
                }

                const data =
                    guildData(
                        message.guild
                    );

                const off =
                    args.some(
                        arg =>
                            arg.toLowerCase() ===
                            "off"
                    );

                if (off) {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );

                    saveDatabase();

                    return message.reply(
                        plain(
                            "GODMODE",
                            `Godmode was removed from ${target}.`
                        )
                    );
                }

                if (
                    !data.godmode.includes(
                        target.id
                    )
                ) {
                    data.godmode.push(
                        target.id
                    );
                }

                saveDatabase();

                return message.reply(
                    plain(
                        "GODMODE",
                        `${target} now has Godmode.`
                    )
                );
            }

            /*
            ========================================
            VOUCH
            ========================================
            */

            if (
                command ===
                "vouch"
            ) {
                const data =
                    guildData(
                        message.guild
                    );

                const sub =
                    (
                        args.shift() ||
                        ""
                    ).toLowerCase();

                if (!sub) {
                    return message.reply(
                        plain(
                            "VOUCH",
                            [
                                "-vouch @user",
                                "-vouch give @user",
                                "-vouch take @user",
                                "-vouch limit",
                                "-vouch limit <number>",
                                "-vouch role",
                                "-vouch role set @role",
                                "-vouch clear"
                            ].join("\n")
                        )
                    );
                }

                if (
                    sub.startsWith(
                        "<@"
                    )
                ) {
                    const target =
                        message.mentions.members.first();

                    if (!target) {
                        return replyError(
                            message,
                            "That user could not be found."
                        );
                    }

                    const count =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} has ${count} vouch${count === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                GIVE
                */

                if (
                    sub ===
                    "give"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        return replyError(
                            message,
                            "Only Founder or God can give vouches."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vouch give @user"
                        );
                    }

                    data.vouches[
                        target.id
                    ] =
                        getVouchCount(
                            message.guild,
                            target.id
                        ) + 1;

                    data.vouchRevoked[
                        target.id
                    ] = false;

                    saveDatabase();

                    await syncVouchRole(
                        message.guild,
                        target
                    );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} now has ${data.vouches[target.id]} vouch${data.vouches[target.id] === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                TAKE
                */

                if (
                    sub ===
                    "take"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        return replyError(
                            message,
                            "Only Founder or God can take vouches."
                        );
                    }

                    const target =
                        getMentionedMember(
                            message
                        );

                    if (!target) {
                        return replyError(
                            message,
                            "Usage: -vouch take @user"
                        );
                    }

                    const current =
                        getVouchCount(
                            message.guild,
                            target.id
                        );

                    data.vouches[
                        target.id
                    ] =
                        Math.max(
                            0,
                            current - 1
                        );

                    data.vouchRevoked[
                        target.id
                    ] = true;

                    saveDatabase();

                    await syncVouchRole(
                        message.guild,
                        target
                    );

                    return message.reply(
                        plain(
                            "VOUCH",
                            `${target} now has ${data.vouches[target.id]} vouch${data.vouches[target.id] === 1 ? "" : "es"}.`
                        )
                    );
                }

                /*
                LIMIT
                */

                if (
                    sub ===
                    "limit"
                ) {
                    if (
                        !isFounder(member)
                    ) {
                        return replyError(
                            message,
                            "Only Founder or Server Owner can change the vouch limit."
                        );
                    }

                    const value =
                        parsePositiveInteger(
                            args[0]
                        );

                    if (
                        value ===
                        null
                    ) {
                        return message.reply(
                            plain(
                                "VOUCH LIMIT",
                                `The current vouch limit is ${data.vouchLimit}.`
                            )
                        );
                    }

                    if (
                        value < 1 ||
                        value > 1000
                    ) {
                        return replyError(
                            message,
                            "The vouch limit must be between 1 and 1000."
                        );
                    }

                    data.vouchLimit =
                        value;

                    saveDatabase();

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return message.reply(
                        plain(
                            "VOUCH LIMIT",
                            `The vouch limit is now ${value}.`
                        )
                    );
                }

                /*
                ROLE
                */

                if (
                    sub ===
                    "role"
                ) {
                    if (
                        !isFounder(
                            member
                        )
                    ) {
                        return replyError(
                            message,
                            "Only Founder or Server Owner can manage the vouch role."
                        );
                    }

                    const action =
                        (
                            args.shift() ||
                            ""
                        ).toLowerCase();

                    if (
                        action !==
                        "set"
                    ) {
                        const role =
                            data.roles.vouch
                                ? message.guild.roles.cache.get(
                                    data.roles.vouch
                                )
                                : null;

                        return message.reply(
                            plain(
                                "VOUCH ROLE",
                                role
                                    ? `Current vouch role: ${role}`
                                    : "No vouch role is configured."
                            )
                        );
                    }

                    const role =
                        getMentionedRole(
                            message
                        );

                    if (!role) {
                        return replyError(
                            message,
                            "Usage: -vouch role set @role"
                        );
                    }

                    if (
                        !canBotManageRole(
                            message.guild,
                            role
                        )
                    ) {
                        return replyError(
                            message,
                            "I cannot manage that role. Put my bot role above the vouch role and give me Manage Roles."
                        );
                    }

                    data.roles.vouch =
                        role.id;

                    saveDatabase();

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return message.reply(
                        plain(
                            "VOUCH ROLE",
                            `${role} is now the vouch role.`
                        )
                    );
                }

                /*
                CLEAR
                */

                if (
                    sub ===
                    "clear"
                ) {
                    if (
                        !isServerOwner(
                            member,
                            message.guild
                        )
                    ) {
                        return replyError(
                            message,
                            "Only the actual Server Owner can clear all vouches."
                        );
                    }

                    data.vouches =
                        {};

                    data.vouchRevoked =
                        {};

                    saveDatabase();

                    await syncAllVouchRoles(
                        message.guild
                    );

                    return message.reply(
                        plain(
                            "VOUCH",
                            "All vouches have been cleared."
                        )
                    );
                }

                return replyError(
                    message,
                    "Unknown vouch command."
                );
            }

            /*
            ========================================
            KICK
            ========================================
            */

            if (
                command ===
                "kick"
            ) {
                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -kick @user [reason]"
                    );
                }

                if (
                    !canManageTarget(
                        member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot kick this user because of the rank hierarchy."
                    );
                }

                if (
                    !target.kickable
                ) {
                    return replyError(
                        message,
                        "I cannot kick that user. Check the bot role hierarchy and permissions."
                    );
                }

                const reason =
                    cleanReason(
                        args
                    );

                await target.kick(
                    `VC+: ${reason}`
                );

                return message.reply(
                    plain(
                        "KICK",
                        `${target.user.tag} was kicked.\nReason: ${reason}`
                    )
                );
            }

            /*
            ========================================
            BAN
            ========================================
            */

            if (
                command ===
                "ban"
            ) {
                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -ban @user [reason]"
                    );
                }

                if (
                    !canManageTarget(
                        member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot ban this user because of the rank hierarchy."
                    );
                }

                if (
                    !target.bannable
                ) {
                    return replyError(
                        message,
                        "I cannot ban that user. Check the bot role hierarchy and permissions."
                    );
                }

                const reason =
                    cleanReason(
                        args
                    );

                await target.ban({
                    reason:
                        `VC+: ${reason}`
                });

                return message.reply(
                    plain(
                        "BAN",
                        `${target.user.tag} was banned.\nReason: ${reason}`
                    )
                );
            }

            /*
            ========================================
            UNBAN
            ========================================
            */

            if (
                command ===
                "unban"
            ) {
                if (
                    !isGod(member)
                ) {
                    return replyError(
                        message,
                        "You do not have permission to unban users."
                    );
                }

                let userId =
                    args[0]
                        ?.replace(
                            /[^0-9]/g,
                            ""
                        );

                if (
                    !userId &&
                    message.mentions.users.size
                ) {
                    userId =
                        message.mentions.users.first().id;
                }

                if (!userId) {
                    return replyError(
                        message,
                        "Usage: -unban <user ID>"
                    );
                }

                try {
                    const ban =
                        await message.guild.bans.fetch(
                            userId
                        );

                    await message.guild.members.unban(
                        userId,
                        `VC+: unbanned by ${message.author.tag}`
                    );

                    return message.reply(
                        plain(
                            "UNBAN",
                            `${ban.user.tag} was unbanned.`
                        )
                    );
                } catch {
                    return replyError(
                        message,
                        "That user is not currently banned or could not be unbanned."
                    );
                }
            }

            /*
            ========================================
            UNBAN ALL
            ========================================
            */

            if (
                command ===
                "unbanall"
            ) {
                if (
                    !isFounder(
                        member
                    )
                ) {
                    return replyError(
                        message,
                        "Only Founder or Server Owner can use -unbanall."
                    );
                }

                let bans;

                try {
                    bans =
                        await message.guild.bans.fetch();
                } catch {
                    return replyError(
                        message,
                        "I could not retrieve the server ban list."
                    );
                }

                if (
                    !bans.size
                ) {
                    return message.reply(
                        plain(
                            "UNBAN ALL",
                            "There are no banned users."
                        )
                    );
                }

                let count = 0;

                for (
                    const ban of
                    bans.values()
                ) {
                    try {
                        await message.guild.members.unban(
                            ban.user.id,
                            `VC+: unbanall by ${message.author.tag}`
                        );

                        count++;
                    } catch (
                        error
                    ) {
                        console.error(
                            "[VC+] Unbanall error:",
                            error
                        );
                    }
                }

                return message.reply(
                    plain(
                        "UNBAN ALL",
                        `Unbanned ${count} user${count === 1 ? "" : "s"}.`
                    )
                );
            }

            /*
            ========================================
            FOREVER BAN
            ========================================
            */

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isFounder(
                        member
                    )
                ) {
                    return replyError(
                        message,
                        "Only Founder or Server Owner can use -foreverban."
                    );
                }

                const target =
                    getMentionedMember(
                        message
                    );

                const userId =
                    target?.id ||
                    args[0]
                        ?.replace(
                            /[^0-9]/g,
                            ""
                        );

                if (!userId) {
                    return replyError(
                        message,
                        "Usage: -foreverban @user"
                    );
                }

                data.foreverBanned = [
                    ...new Set([
                        ...data.foreverBanned,
                        userId
                    ])
                ];

                saveDatabase();

                try {
                    await message.guild.members.ban(
                        userId,
                        {
                            reason:
                                `VC+: permanent ban by ${message.author.tag}`
                        }
                    );
                } catch {}

                return message.reply(
                    plain(
                        "FOREVER BAN",
                        `<@${userId}> has been permanently banned from this server.`
                    )
                );
            }

            /*
            ========================================
            FOREVER UNBAN
            ========================================
            */

            if (
                command ===
                "foreverunban"
            ) {
                if (
                    !isFounder(
                        member
                    )
                ) {
                    return replyError(
                        message,
                        "Only Founder or Server Owner can use -foreverunban."
                    );
                }

                const target =
                    message.mentions.users.first();

                const userId =
                    target?.id ||
                    args[0]
                        ?.replace(
                            /[^0-9]/g,
                            ""
                        );

                if (!userId) {
                    return replyError(
                        message,
                        "Usage: -foreverunban @user"
                    );
                }

                data.foreverBanned =
                    data.foreverBanned.filter(
                        id =>
                            id !==
                            userId
                    );

                saveDatabase();

                try {
                    await message.guild.members.unban(
                        userId,
                        `VC+: forever ban removed by ${message.author.tag}`
                    );
                } catch {}

                return message.reply(
                    plain(
                        "FOREVER UNBAN",
                        `<@${userId}> has been removed from the permanent ban list.`
                    )
                );
            }

            /*
            ========================================
            TIMEOUT
            ========================================
            */

            if (
                command ===
                "timeout"
            ) {
                const target =
                    getMentionedMember(
                        message
                    );

                const minutes =
                    parsePositiveInteger(
                        args[0]
                    );

                if (
                    !target ||
                    minutes ===
                        null
                ) {
                    return replyError(
                        message,
                        "Usage: -timeout @user <minutes> [reason]"
                    );
                }

                if (
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return replyError(
                        message,
                        "Timeout must be between 1 and 40320 minutes."
                    );
                }

                if (
                    !canManageTarget(
                        member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot timeout this user because of the rank hierarchy."
                    );
                }

                if (
                    !target.moderatable
                ) {
                    return replyError(
                        message,
                        "I cannot timeout that user."
                    );
                }

                const reason =
                    cleanReason(
                        args.slice(1)
                    );

                await target.timeout(
                    minutes *
                        60 *
                        1000,
                    `VC+: ${reason}`
                );

                return message.reply(
                    plain(
                        "TIMEOUT",
                        `${target.user.tag} was timed out for ${minutes} minute${minutes === 1 ? "" : "s"}.\nReason: ${reason}`
                    )
                );
            }

            /*
            ========================================
            UNTIMEOUT
            ========================================
            */

            if (
                command ===
                "untimeout"
            ) {
                const target =
                    getMentionedMember(
                        message
                    );

                if (!target) {
                    return replyError(
                        message,
                        "Usage: -untimeout @user"
                    );
                }

                if (
                    !canManageTarget(
                        member,
                        target
                    )
                ) {
                    return replyError(
                        message,
                        "You cannot remove this user's timeout because of the rank hierarchy."
                    );
                }

                if (
                    !target.moderatable
                ) {
                    return replyError(
                        message,
                        "I cannot modify that user's timeout."
                    );
                }

                await target.timeout(
                    null,
                    `VC+: timeout removed by ${message.author.tag}`
                );

                return message.reply(
                    plain(
                        "TIMEOUT REMOVED",
                        `${target.user.tag} is no longer timed out.`
                    )
                );
            }

            /*
            ========================================
            PURGE
            ========================================
            */

            if (
                command ===
                "purge"
            ) {
                const amount =
                    parsePositiveInteger(
                        args[0]
                    );

                if (
                    amount ===
                        null ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return replyError(
                        message,
                        "Usage: -purge <1-100>"
                    );
                }

                const allowed =
                    isGod(member) ||
                    getRankLevel(
                        member,
                        message.guild
                    ) >=
                    RANK_LEVELS.moderator;

                if (!allowed) {
                    return replyError(
                        message,
                        "You do not have permission to purge messages."
                    );
                }

                if (
                    !hasBotPermission(
                        message.guild,
                        PermissionFlagsBits.ManageMessages
                    )
                ) {
                    return replyError(
                        message,
                        "I need Manage Messages to purge messages."
                    );
                }

                const deleted =
                    await message.channel.bulkDelete(
                        amount + 1,
                        true
                    );

                const actual =
                    Math.max(
                        0,
                        deleted.size - 1
                    );

                return message.channel.send(
                    plain(
                        "PURGE",
                        `Deleted ${actual} message${actual === 1 ? "" : "s"}.`
                    )
                );
            }
        } catch (error) {
            console.error(
                "[VC+] messageCreate error:",
                error
            );

            return replyError(
                message,
                "An unexpected error occurred while processing that command."
            );
        }
    }
);

/*
========================================================
VOICE STATE
========================================================
*/

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

            const data =
                guildData(guild);

            /*
            ----------------------------------------
            JOIN TO CREATE
            ----------------------------------------
            */

            if (
                newState.channelId &&
                data.jtc.channelId &&
                newState.channelId ===
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

                if (tempVC) {
                    try {
                        await member.voice.setChannel(
                            tempVC
                        );
                    } catch (error) {
                        console.error(
                            "[VC+] Failed moving member:",
                            error
                        );

                        try {
                            await tempVC.delete(
                                "VC+ failed to move creator"
                            );
                        } catch {}

                        delete data.tempVCs[
                            tempVC.id
                        ];

                        saveDatabase();
                    }
                }
            }

            /*
            ----------------------------------------
            TEMP VC JOIN PROTECTION
            ----------------------------------------
            */

            if (
                newState.channelId &&
                isTempVC(
                    guild,
                    newState.channelId
                )
            ) {
                const channel =
                    newState.channel;

                const record =
                    getTempVC(
                        guild,
                        newState.channelId
                    );

                if (!record) {
                    return;
                }

                const member =
                    newState.member;

                /*
                VC BAN
                */

                if (
                    record.banned.includes(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.disconnect(
                            "VC+ temporary VC ban"
                        );
                    } catch {}

                    return;
                }

                /*
                STFU
                */

                if (
                    record.stfu.includes(
                        member.id
                    )
                ) {
                    try {
                        await member.voice.setMute(
                            true,
                            "VC+ STFU list"
                        );
                    } catch {}
                }

                /*
                LOCK
                */

                if (
                    record.locked &&
                    member.id !==
                        record.ownerId &&
                    !record.permitted.includes(
                        member.id
                    ) &&
                    !isFounder(member)
                ) {
                    try {
                        await member.voice.disconnect(
                            "VC+ locked VC"
                        );
                    } catch {}
                }
            }

            await cleanupEmptyTempVCs(
                guild
            );
        } catch (error) {
            console.error(
                "[VC+] voiceStateUpdate error:",
                error
            );
        }
    }
);

/*
========================================================
FOREVER BAN + VOUCH ROLE ON JOIN
========================================================
*/

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                guildData(
                    member.guild
                );

            if (
                data.foreverBanned.includes(
                    member.id
                )
            ) {
                try {
                    await member.ban({
                        reason:
                            "VC+ permanent ban protection"
                    });
                } catch (
                    error
                ) {
                    console.error(
                        "[VC+] Forever ban enforcement error:",
                        error
                    );
                }

                return;
            }

            await syncVouchRole(
                member.guild,
                member
            );
        } catch (error) {
            console.error(
                "[VC+] guildMemberAdd error:",
                error
            );
        }
    }
);

/*
========================================================
GUILD DELETE
========================================================
*/

client.on(
    "guildDelete",
    guild => {
        try {
            delete db[
                guild.id
            ];

            saveDatabase();
        } catch (error) {
            console.error(
                "[VC+] Guild cleanup error:",
                error
            );
        }
    }
);

/*
========================================================
READY
========================================================
*/

client.once(
    "ready",
    async () => {
        console.log(
            `[VC+] Logged in as ${client.user.tag}`
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        `${BOT_NAME} | ${PREFIX}help`,
                    type:
                        ActivityType.Watching
                }
            ],

            status:
                "online"
        });

        for (
            const guild of
            client.guilds.cache.values()
        ) {
            ensureGuildData(
                guild.id
            );

            try {
                await cleanupEmptyTempVCs(
                    guild
                );
            } catch (
                error
            ) {
                console.error(
                    `[VC+] Startup cleanup failed in ${guild.id}:`,
                    error
                );
            }
        }

        saveDatabase();

        console.log(
            "[VC+] Startup complete."
        );
    }
);

/*
========================================================
ERROR PROTECTION
========================================================
*/

client.on(
    "error",
    error => {
        console.error(
            "[VC+] Discord client error:",
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

/*
========================================================
GRACEFUL SHUTDOWN
========================================================
*/

let shuttingDown =
    false;

async function shutdown(
    signal
) {
    if (
        shuttingDown
    ) {
        return;
    }

    shuttingDown =
        true;

    console.log(
        `[VC+] ${signal} received. Saving database...`
    );

    saveDatabase();

    try {
        client.destroy();
    } catch {}

    process.exit(0);
}

process.on(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);

process.on(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);

/*
========================================================
LOGIN
========================================================
*/

client.login(
    TOKEN
);
