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

// ======================================================
// CONFIG
// ======================================================

const PREFIX = "-";
const BOT_NAME = "VC+";

// ======================================================
// CLIENT
// ======================================================

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

// ======================================================
// DATABASE
// ======================================================

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

let db = {
    guilds: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify(db, null, 2)
            );
            return;
        }

        db = JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            )
        );

        if (!db.guilds) {
            db.guilds = {};
        }
    } catch (error) {
        console.error(
            "[VC+] Database load error:",
            error
        );

        db = {
            guilds: {}
        };
    }
}

function saveDB() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(db, null, 2)
        );
    } catch (error) {
        console.error(
            "[VC+] Database save error:",
            error
        );
    }
}

loadDB();

// ======================================================
// GUILD DATABASE
// ======================================================

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            foreverBanned: [],
            godmode: [],
            vouches: {},
            jtc: null,

            roles: {
                vouch: null
            },

            protection: {
                enabled: true,
                channelCreate: true,
                channelDelete: true,
                roleCreate: true,
                roleDelete: true,
                webhookCreate: true
            },

            filters: {
                enabled: true,
                words: [],
                strikes: {},
                logChannelId: null,
                maxStrikes: 3,
                timeoutMinutes: 10,
                warningDeleteMs: 5000
            }
        };
    }

    const data = db.guilds[guildId];

    data.ranks ??= {};
    data.foreverBanned ??= [];
    data.godmode ??= [];
    data.vouches ??= {};
    data.jtc ??= null;

    data.roles ??= {};
    data.roles.vouch ??= null;

    data.protection ??= {};
    data.protection.enabled ??= true;
    data.protection.channelCreate ??= true;
    data.protection.channelDelete ??= true;
    data.protection.roleCreate ??= true;
    data.protection.roleDelete ??= true;
    data.protection.webhookCreate ??= true;

    data.filters ??= {};
    data.filters.enabled ??= true;
    data.filters.words ??= [];
    data.filters.strikes ??= {};
    data.filters.logChannelId ??= null;
    data.filters.maxStrikes ??= 3;
    data.filters.timeoutMinutes ??= 10;
    data.filters.warningDeleteMs ??= 5000;

    return data;
}

// ======================================================
// RANK SYSTEM
// ======================================================

const RANKS = {
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

function normalizeRank(rank) {
    if (!rank) {
        return "member";
    }

    const value = String(rank)
        .toLowerCase()
        .replace(/[\s_-]/g, "");

    if (value === "co-owner") {
        return "coowner";
    }

    if (RANKS[value]) {
        return value;
    }

    return "member";
}

function getRank(member) {
    if (!member) {
        return "member";
    }

    if (
        member.guild &&
        member.id === member.guild.ownerId
    ) {
        return "founder";
    }

    const data = getGuildData(
        member.guild.id
    );

    return normalizeRank(
        data.ranks[member.id]
    );
}

function getRankLevel(member) {
    return RANKS[getRank(member)] ?? 1;
}

function isFounder(member) {
    return getRankLevel(member) >= RANKS.founder;
}

function isGod(member) {
    if (!member) {
        return false;
    }

    const data = getGuildData(
        member.guild.id
    );

    return (
        isFounder(member) ||
        getRank(member) === "god" ||
        data.godmode.includes(member.id)
    );
}

function isTrustedExecutor(member) {
    return isGod(member);
}

function canModerate(actor, target) {
    if (!actor || !target) {
        return false;
    }

    if (actor.id === target.id) {
        return false;
    }

    if (isFounder(actor)) {
        return true;
    }

    if (isFounder(target)) {
        return false;
    }

    return (
        getRankLevel(actor) >
        getRankLevel(target)
    );
}

// ======================================================
// EMBEDS
// ======================================================

function successEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`VC+ • ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setTitle("VC+ • Error")
        .setDescription(description)
        .setTimestamp();
}

function infoEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`VC+ • ${title}`)
        .setDescription(description)
        .setTimestamp();
}

// ======================================================
// FILTER HELPERS
// ======================================================

function normalizeFilterText(text) {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function filterTermMatches(text, term) {
    const normalizedText =
        normalizeFilterText(text);

    const normalizedTerm =
        normalizeFilterText(term);

    if (!normalizedText || !normalizedTerm) {
        return false;
    }

    return normalizedText.includes(
        normalizedTerm
    );
}

function getFilterMatch(message) {
    const data = getGuildData(
        message.guild.id
    );

    if (!data.filters.enabled) {
        return null;
    }

    for (const term of data.filters.words) {
        if (
            typeof term === "string" &&
            filterTermMatches(
                message.content,
                term
            )
        ) {
            return term;
        }
    }

    return null;
}

async function sendFilterLog(
    guild,
    message,
    reason,
    strike
) {
    const data = getGuildData(
        guild.id
    );

    if (!data.filters.logChannelId) {
        return;
    }

    const channel =
        guild.channels.cache.get(
            data.filters.logChannelId
        );

    if (!channel?.isTextBased()) {
        return;
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                "VC+ • AutoMod Action"
            )
            .addFields(
                {
                    name: "User",
                    value:
                        `${message.author.tag} (${message.author.id})`
                },
                {
                    name: "Reason",
                    value: reason
                },
                {
                    name: "Strike",
                    value:
                        `${strike}/${data.filters.maxStrikes}`
                }
            )
            .setTimestamp();

    await channel.send({
        embeds: [embed]
    }).catch(() => {});
}

async function handleFilteredMessage(
    message
) {
    if (!message.guild) {
        return false;
    }

    if (message.author.bot) {
        return false;
    }

    const member =
        message.member;

    if (
        member &&
        isGod(member)
    ) {
        return false;
    }

    const match =
        getFilterMatch(message);

    if (!match) {
        return false;
    }

    const data =
        getGuildData(
            message.guild.id
        );

    try {
        await message.delete();
    } catch {}

    const userId =
        message.author.id;

    data.filters.strikes[userId] =
        (data.filters.strikes[userId] ?? 0) + 1;

    const strike =
        data.filters.strikes[userId];

    const maxStrikes =
        data.filters.maxStrikes;

    await sendFilterLog(
        message.guild,
        message,
        "Configured message filter",
        strike
    );

    if (strike >= maxStrikes) {
        const target =
            message.member;

        if (
            target &&
            target.moderatable
        ) {
            await target.timeout(
                data.filters.timeoutMinutes *
                    60 *
                    1000,
                "VC+ AutoMod"
            ).catch(() => {});
        }

        data.filters.strikes[userId] = 0;

        const warning =
            await message.channel.send({
                embeds: [
                    errorEmbed(
                        `${message.author} has reached the AutoMod strike limit and was timed out.`
                    )
                ]
            }).catch(() => null);

        if (warning) {
            setTimeout(() => {
                warning.delete().catch(() => {});
            }, data.filters.warningDeleteMs);
        }

        saveDB();

        return true;
    }

    const warning =
        await message.channel.send({
            embeds: [
                errorEmbed(
                    `${message.author}, that message was removed by the server's AutoMod. Strike ${strike}/${maxStrikes}.`
                )
            ]
        }).catch(() => null);

    if (warning) {
        setTimeout(() => {
            warning.delete().catch(() => {});
        }, data.filters.warningDeleteMs);
    }

    saveDB();

    return true;
}

// ======================================================
// VOUCH ROLE
// ======================================================

async function ensureVouchRole(guild) {
    const data =
        getGuildData(guild.id);

    if (
        data.roles.vouch
    ) {
        const existing =
            guild.roles.cache.get(
                data.roles.vouch
            );

        if (existing) {
            return existing;
        }
    }

    const role =
        await guild.roles.create({
            name: "Vouched",
            reason: "VC+ Vouch System"
        }).catch(() => null);

    if (!role) {
        return null;
    }

    data.roles.vouch =
        role.id;

    saveDB();

    return role;
}

// ======================================================
// TEMP VC DATA
// ======================================================

const tempVCs = new Map();

function createVCData(
    guildId,
    ownerId
) {
    return {
        guildId,
        ownerId,
        banned: new Set(),
        rejected: new Set(),
        permitted: new Set(),
        stfu: new Set(),
        locked: false,
        interfaceMessageId: null
    };
}

function getTempVC(channelId) {
    return tempVCs.get(channelId);
}

function isTempVC(channelId) {
    return tempVCs.has(channelId);
}

// ======================================================
// VC PERMISSIONS
// ======================================================

async function applyVCBan(
    channel,
    userId
) {
    await channel.permissionOverwrites.edit(
        userId,
        {
            ViewChannel: false,
            Connect: false,
            Speak: false
        }
    ).catch(() => {});
}

async function removeVCBan(
    channel,
    userId
) {
    await channel.permissionOverwrites.delete(
        userId
    ).catch(() => {});
}

// ======================================================
// VC INTERFACE
// ======================================================

async function updateVCInterface(
    channel
) {
    const vc =
        getTempVC(channel.id);

    if (!vc) {
        return;
    }

    const owner =
        channel.guild.members.cache.get(
            vc.ownerId
        );

    const embed =
        new EmbedBuilder()
            .setTitle("VC+ • Voice Control")
            .setDescription(
                [
                    `**Owner:** ${owner ?? `<@${vc.ownerId}>`}`,
                    `**Channel:** ${channel}`,
                    "",
                    "**Member Controls**",
                    "`-vc kick @user`",
                    "`-vc disconnect @user`",
                    "`-vc ban @user`",
                    "`-vc reject @user`",
                    "`-vc permit @user`",
                    "",
                    "**VC Controls**",
                    "`-vc lock` / `-vc unlock`",
                    "`-vc limit 10`",
                    "`-vc rename name`",
                    "`-vc transfer @user`",
                    "`-vc claim`",
                    "`-vc forceclaim`",
                    "",
                    "STFU/UNSTFU are command-only."
                ].join("\n")
            )
            .setFooter({
                text:
                    `VC+ • Voice control system • ${
                        owner?.displayName ?? "Unknown"
                    }`
            })
            .setTimestamp();

    if (vc.interfaceMessageId) {
        const message =
            await channel.messages.fetch(
                vc.interfaceMessageId
            ).catch(() => null);

        if (message) {
            await message.edit({
                embeds: [embed]
            }).catch(() => {});

            return;
        }
    }

    const message =
        await channel.send({
            embeds: [embed]
        }).catch(() => null);

    if (message) {
        vc.interfaceMessageId =
            message.id;

        saveDB();
    }
}

// ======================================================
// CREATE VC
// ======================================================

async function createPersonalVC(
    member,
    jtcChannel
) {
    const guild =
        member.guild;

    const category =
        jtcChannel.parent;

    const channel =
        await guild.channels.create({
            name:
                `${member.displayName}'s VC`,
            type:
                ChannelType.GuildVoice,
            parent:
                category?.id ?? null,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak
                    ]
                },
                {
                    id: member.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ]
        });

    const vc =
        createVCData(
            guild.id,
            member.id
        );

    tempVCs.set(
        channel.id,
        vc
    );

    await member.voice.setChannel(
        channel
    ).catch(() => {});

    await updateVCInterface(
        channel
    );

    return channel;
}

// ======================================================
// DELETE EMPTY VC
// ======================================================

async function deleteEmptyVC(
    channel
) {
    if (!isTempVC(channel.id)) {
        return;
    }

    if (
        channel.members.size > 0
    ) {
        return;
    }

    tempVCs.delete(
        channel.id
    );

    await channel.delete(
        "VC+ Empty temporary VC"
    ).catch(() => {});
}

// ======================================================
// COMMAND HELP
// ======================================================

function helpEmbed() {
    return new EmbedBuilder()
        .setTitle("VC+ • Command Center")
        .setDescription(
            [
                "**Voice Commands**",
                "`-vc setup`",
                "`-vc kick @user`",
                "`-vc disconnect @user`",
                "`-vc ban @user`",
                "`-vc reject @user`",
                "`-vc permit @user`",
                "`-vc lock`",
                "`-vc unlock`",
                "`-vc limit <number>`",
                "`-vc rename <name>`",
                "`-vc transfer @user`",
                "`-vc claim`",
                "`-vc forceclaim`",
                "`-vc stfu @user`",
                "`-vc unstfu @user`",
                "",
                "**Moderation**",
                "`-ban @user`",
                "`-kick @user`",
                "`-timeout @user <minutes>`",
                "`-untimeout @user`",
                "`-foreverban @user`",
                "`-rank @user <rank>`",
                "`-godmode @user`",
                "`-purge <amount>`",
                "",
                "**AutoMod**",
                "`-filter on`",
                "`-filter off`",
                "`-filter add <phrase>`",
                "`-filter remove <phrase>`",
                "`-filter list`",
                "`-filter log #channel`",
                "`-filter strikes @user`",
                "`-filter reset @user`"
            ].join("\n")
        )
        .setTimestamp();
}

// ======================================================
// MESSAGE COMMAND HANDLER
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (!message.guild) {
                return;
            }

            if (
                await handleFilteredMessage(
                    message
                )
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

            const args =
                message.content
                    .slice(PREFIX.length)
                    .trim()
                    .split(/\s+/);

            const command =
                args.shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            const member =
                message.member;

            const data =
                getGuildData(
                    message.guild.id
                );

            // ==================================================
            // HELP
            // ==================================================

            if (
                command === "help" ||
                command === "commands"
            ) {
                await message.reply({
                    embeds: [
                        helpEmbed()
                    ]
                });

                return;
            }

            // ==================================================
            // FILTER
            // ==================================================

            if (
                command === "filter"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need **God** or **Founder** rank to manage AutoMod."
                            )
                        ]
                    });

                    return;
                }

                const action =
                    args.shift()
                        ?.toLowerCase();

                if (!action) {
                    await message.reply({
                        embeds: [
                            infoEmbed(
                                "AutoMod",
                                [
                                    "`-filter on`",
                                    "`-filter off`",
                                    "`-filter add <phrase>`",
                                    "`-filter remove <phrase>`",
                                    "`-filter list`",
                                    "`-filter log #channel`",
                                    "`-filter strikes @user`",
                                    "`-filter reset @user`"
                                ].join("\n")
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "on"
                ) {
                    data.filters.enabled =
                        true;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "AutoMod Enabled",
                                "The custom message filter is now enabled."
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "off"
                ) {
                    data.filters.enabled =
                        false;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "AutoMod Disabled",
                                "The custom message filter is now disabled."
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "add"
                ) {
                    const phrase =
                        args.join(" ").trim();

                    if (!phrase) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Provide a phrase to add."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        data.filters.words.includes(
                            phrase
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "That filter already exists."
                                )
                            ]
                        });

                        return;
                    }

                    data.filters.words.push(
                        phrase
                    );

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Added",
                                "The new filter has been added."
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "remove"
                ) {
                    const phrase =
                        args.join(" ").trim();

                    const index =
                        data.filters.words.findIndex(
                            item =>
                                normalizeFilterText(
                                    item
                                ) ===
                                normalizeFilterText(
                                    phrase
                                )
                        );

                    if (index === -1) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "That filter does not exist."
                                )
                            ]
                        });

                        return;
                    }

                    data.filters.words.splice(
                        index,
                        1
                    );

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Filter Removed",
                                "The filter has been removed."
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "list"
                ) {
                    await message.reply({
                        embeds: [
                            infoEmbed(
                                "Configured Filters",
                                data.filters.words.length
                                    ? `${data.filters.words.length} filter(s) configured.`
                                    : "No filters are configured."
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "log"
                ) {
                    const channel =
                        message.mentions.channels.first();

                    if (!channel) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a text channel."
                                )
                            ]
                        });

                        return;
                    }

                    data.filters.logChannelId =
                        channel.id;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "AutoMod Logging",
                                `Logs will now be sent to ${channel}.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "strikes"
                ) {
                    const target =
                        message.mentions.users.first();

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user."
                                )
                            ]
                        });

                        return;
                    }

                    const strikes =
                        data.filters.strikes[
                            target.id
                        ] ?? 0;

                    await message.reply({
                        embeds: [
                            infoEmbed(
                                "AutoMod Strikes",
                                `${target} currently has **${strikes}/${data.filters.maxStrikes}** strikes.`
                            )
                        ]
                    });

                    return;
                }

                if (
                    action === "reset"
                ) {
                    const target =
                        message.mentions.users.first();

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user."
                                )
                            ]
                        });

                        return;
                    }

                    delete data.filters.strikes[
                        target.id
                    ];

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Strikes Reset",
                                `${target}'s AutoMod strikes have been reset.`
                            )
                        ]
                    });

                    return;
                }
            }

            // ==================================================
            // VC COMMANDS
            // ==================================================

            if (
                command === "vc"
            ) {
                const subcommand =
                    args.shift()
                        ?.toLowerCase();

                const allowed = [
                    "setup",
                    "kick",
                    "disconnect",
                    "ban",
                    "reject",
                    "permit",
                    "lock",
                    "unlock",
                    "limit",
                    "rename",
                    "transfer",
                    "claim",
                    "forceclaim",
                    "stfu",
                    "unstfu"
                ];

                if (
                    !allowed.includes(
                        subcommand
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Unknown VC command. Use `-help`."
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // SETUP
                // ==================================================

                if (
                    subcommand === "setup"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Only **God** or **Founder** can configure VC+."
                                )
                            ]
                        });

                        return;
                    }

                    const existing =
                        data.jtc;

                    if (
                        existing &&
                        message.guild.channels.cache.get(
                            existing
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                infoEmbed(
                                    "Already Setup",
                                    `Join-to-create is already configured as <#${existing}>.`
                                )
                            ]
                        });

                        return;
                    }

                    const jtc =
                        await message.guild.channels.create({
                            name: "Join To Create",
                            type:
                                ChannelType.GuildVoice
                        });

                    data.jtc =
                        jtc.id;

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC+ Setup",
                                `Join ${jtc} to automatically create your personal voice channel.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // FIND CURRENT VC
                // ==================================================

                const currentChannel =
                    member.voice.channel;

                if (
                    !currentChannel ||
                    !isTempVC(
                        currentChannel.id
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You must be inside a VC+ personal voice channel."
                            )
                        ]
                    });

                    return;
                }

                const vc =
                    getTempVC(
                        currentChannel.id
                    );

                if (!vc) {
                    return;
                }

                // ==================================================
                // OWNER CHECK
                // ==================================================

                const isOwner =
                    vc.ownerId ===
                    member.id;

                if (
                    !isOwner &&
                    !isFounder(member) &&
                    subcommand !== "forceclaim"
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You do not own this voice channel."
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // TARGET
                // ==================================================

                const target =
                    message.mentions.members.first();

                // ==================================================
                // KICK
                // ==================================================

                if (
                    subcommand === "kick"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user to kick."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        !isFounder(member) &&
                        !canModerate(
                            member,
                            target
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot kick that member."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        target.voice.channelId !==
                        currentChannel.id
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "That user is not in your VC."
                                )
                            ]
                        });

                        return;
                    }

                    await target.voice.disconnect(
                        "VC+ Kick"
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Member Kicked",
                                `${target} was disconnected from the VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // DISCONNECT
                // ==================================================

                if (
                    subcommand === "disconnect"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user to disconnect."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        !isFounder(member) &&
                        isFounder(target)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot disconnect the Founder."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        target.voice.channelId !==
                        currentChannel.id
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "That user is not in your VC."
                                )
                            ]
                        });

                        return;
                    }

                    await target.voice.disconnect(
                        "VC+ Disconnect"
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Disconnected",
                                `${target} was disconnected and may join again.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // BAN
                // ==================================================

                if (
                    subcommand === "ban"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user to ban."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        target.id ===
                        member.id
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot ban yourself."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        !isFounder(member) &&
                        isFounder(target)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot ban the Founder."
                                )
                            ]
                        });

                        return;
                    }

                    vc.banned.add(
                        target.id
                    );

                    vc.rejected.delete(
                        target.id
                    );

                    vc.permitted.delete(
                        target.id
                    );

                    await applyVCBan(
                        currentChannel,
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        currentChannel.id
                    ) {
                        await target.voice.disconnect(
                            "VC+ Voice Ban"
                        ).catch(() => {});
                    }

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Member Banned",
                                `${target} can no longer see or join this VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // REJECT
                // ==================================================

                if (
                    subcommand === "reject"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user to reject."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        !isFounder(member) &&
                        isFounder(target)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot reject the Founder."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        target.voice.channelId !==
                        currentChannel.id
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "That user is not currently in your VC."
                                )
                            ]
                        });

                        return;
                    }

                    // Reject = ONE-TIME disconnect.
                    // It does NOT permanently ban the user.
                    vc.rejected.delete(
                        target.id
                    );

                    await target.voice.disconnect(
                        "VC+ Reject"
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Member Rejected",
                                `${target} was disconnected. They can join the VC again.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // PERMIT
                // ==================================================

                if (
                    subcommand === "permit"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user to permit."
                                )
                            ]
                        });

                        return;
                    }

                    vc.banned.delete(
                        target.id
                    );

                    vc.rejected.delete(
                        target.id
                    );

                    vc.permitted.add(
                        target.id
                    );

                    await removeVCBan(
                        currentChannel,
                        target.id
                    );

                    await currentChannel.permissionOverwrites.edit(
                        target.id,
                        {
                            ViewChannel: true,
                            Connect: true,
                            Speak: true
                        }
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Member Permitted",
                                `${target} is permitted to use this VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // LOCK
                // ==================================================

                if (
                    subcommand === "lock"
                ) {
                    vc.locked =
                        true;

                    await currentChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: false
                        }
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Locked",
                                "Your VC is now locked."
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // UNLOCK
                // ==================================================

                if (
                    subcommand === "unlock"
                ) {
                    vc.locked =
                        false;

                    await currentChannel.permissionOverwrites.edit(
                        message.guild.roles.everyone.id,
                        {
                            Connect: true
                        }
                    ).catch(() => {});

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Unlocked",
                                "Your VC is now unlocked."
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // LIMIT
                // ==================================================

                if (
                    subcommand === "limit"
                ) {
                    const amount =
                        Number(args[0]);

                    if (
                        !Number.isInteger(amount) ||
                        amount < 0 ||
                        amount > 99
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Use a number from **0–99**."
                                )
                            ]
                        });

                        return;
                    }

                    await currentChannel.setUserLimit(
                        amount
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "User Limit Updated",
                                `The VC limit is now **${amount === 0 ? "unlimited" : amount}**.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // RENAME
                // ==================================================

                if (
                    subcommand === "rename"
                ) {
                    const name =
                        args.join(" ").trim();

                    if (!name) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Provide a new VC name."
                                )
                            ]
                        });

                        return;
                    }

                    await currentChannel.setName(
                        name.slice(0, 100)
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Renamed",
                                `Your VC is now **${name.slice(0, 100)}**.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // TRANSFER
                // ==================================================

                if (
                    subcommand === "transfer"
                ) {
                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention the new owner."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        vc.banned.has(
                            target.id
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "You cannot transfer ownership to a banned member."
                                )
                            ]
                        });

                        return;
                    }

                    vc.ownerId =
                        target.id;

                    await updateVCInterface(
                        currentChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Ownership Transferred",
                                `${target} now owns this VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // CLAIM
                // ==================================================

                if (
                    subcommand === "claim"
                ) {
                    if (
                        currentChannel.members.has(
                            vc.ownerId
                        )
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "The current owner is still in the VC."
                                )
                            ]
                        });

                        return;
                    }

                    vc.ownerId =
                        member.id;

                    await updateVCInterface(
                        currentChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "VC Claimed",
                                "You now own this VC."
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // FORCE CLAIM
                // ==================================================

                if (
                    subcommand === "forceclaim"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Only God or Founder can force claim a VC."
                                )
                            ]
                        });

                        return;
                    }

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention the member who should become owner."
                                )
                            ]
                        });

                        return;
                    }

                    vc.ownerId =
                        target.id;

                    await updateVCInterface(
                        currentChannel
                    );

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Force Claim",
                                `${target} now owns this VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // STFU
                // ==================================================

                if (
                    subcommand === "stfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Only God or Founder can use STFU."
                                )
                            ]
                        });

                        return;
                    }

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        isFounder(target)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "The Founder cannot be STFU'd."
                                )
                            ]
                        });

                        return;
                    }

                    if (
                        getRank(target) ===
                            "god" &&
                        !isFounder(member)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Only the Founder can STFU a God."
                                )
                            ]
                        });

                        return;
                    }

                    vc.stfu.add(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        currentChannel.id
                    ) {
                        await target.voice.setMute(
                            true,
                            "VC+ STFU"
                        ).catch(() => {});
                    }

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "STFU Enabled",
                                `${target} is now persistently muted in this VC.`
                            )
                        ]
                    });

                    return;
                }

                // ==================================================
                // UNSTFU
                // ==================================================

                if (
                    subcommand === "unstfu"
                ) {
                    if (
                        !isGod(member)
                    ) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Only God or Founder can use UNSTFU."
                                )
                            ]
                        });

                        return;
                    }

                    if (!target) {
                        await message.reply({
                            embeds: [
                                errorEmbed(
                                    "Mention a user."
                                )
                            ]
                        });

                        return;
                    }

                    vc.stfu.delete(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        currentChannel.id
                    ) {
                        await target.voice.setMute(
                            false,
                            "VC+ UNSTFU"
                        ).catch(() => {});
                    }

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "STFU Disabled",
                                `${target} can speak again.`
                            )
                        ]
                    });

                    return;
                }
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command === "ban"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need God or Founder rank."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Mention a member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot ban that member."
                            )
                        ]
                    });

                    return;
                }

                await target.ban({
                    reason: `VC+ by ${member.user.tag}`
                }).catch(async () => {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "I couldn't ban that member. Check my role position and permissions."
                            )
                        ]
                    });
                    return;
                });

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Member Banned",
                            `${target.user.tag} was banned.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // KICK
            // ==================================================

            if (
                command === "kick"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need God or Founder rank."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Mention a member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot kick that member."
                            )
                        ]
                    });

                    return;
                }

                await target.kick(
                    `VC+ by ${member.user.tag}`
                ).catch(() => {});

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Member Kicked",
                            `${target.user.tag} was kicked.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command === "timeout"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need God or Founder rank."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                const minutes =
                    Number(args[1]);

                if (
                    !target ||
                    !Number.isFinite(minutes) ||
                    minutes <= 0
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-timeout @user <minutes>`"
                            )
                        ]
                    });

                    return;
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot timeout that member."
                            )
                        ]
                    });

                    return;
                }

                await target.timeout(
                    Math.min(
                        minutes,
                        40320
                    ) * 60 * 1000,
                    `VC+ by ${member.user.tag}`
                ).catch(() => {});

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Member Timed Out",
                            `${target} was timed out for **${Math.min(minutes, 40320)} minutes**.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command === "untimeout"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need God or Founder rank."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Mention a member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You cannot remove that member's timeout."
                            )
                        ]
                    });

                    return;
                }

                await target.timeout(
                    null,
                    `VC+ by ${member.user.tag}`
                ).catch(() => {});

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Timeout Removed",
                            `${target} is no longer timed out.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command === "foreverban"
            ) {
                if (
                    !isFounder(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Only the Founder can use foreverban."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Mention a member."
                            )
                        ]
                    });

                    return;
                }

                if (
                    !data.foreverBanned.includes(
                        target.id
                    )
                ) {
                    data.foreverBanned.push(
                        target.id
                    );
                }

                await target.ban({
                    reason:
                        "VC+ Forever Ban"
                }).catch(() => {});

                saveDB();

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Forever Ban",
                            `${target.user.tag} has been permanently blocked by VC+.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // RANK
            // ==================================================

            if (
                command === "rank"
            ) {
                if (
                    !isFounder(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Only the Founder can change ranks."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                const rank =
                    normalizeRank(
                        args.find(
                            value =>
                                RANKS[
                                    value.toLowerCase()
                                ]
                        )
                    );

                if (
                    !target ||
                    !rank
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Usage: `-rank @user <member/staff/moderator/admin/director/executive/coowner/owner/god/founder>`"
                            )
                        ]
                    });

                    return;
                }

                data.ranks[
                    target.id
                ] = rank;

                saveDB();

                await message.reply({
                    embeds: [
                        successEmbed(
                            "Rank Updated",
                            `${target} is now **${rank}**.`
                        )
                    ]
                });

                return;
            }

            // ==================================================
            // GODMODE
            // ==================================================

            if (
                command === "godmode"
            ) {
                if (
                    !isFounder(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Only the Founder can manage Godmode."
                            )
                        ]
                    });

                    return;
                }

                const target =
                    message.mentions.members.first();

                if (!target) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Mention a member."
                            )
                        ]
                    });

                    return;
                }

                const index =
                    data.godmode.indexOf(
                        target.id
                    );

                if (index === -1) {
                    data.godmode.push(
                        target.id
                    );

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Godmode Enabled",
                                `${target} now has Godmode.`
                            )
                        ]
                    });
                } else {
                    data.godmode.splice(
                        index,
                        1
                    );

                    saveDB();

                    await message.reply({
                        embeds: [
                            successEmbed(
                                "Godmode Disabled",
                                `${target} no longer has Godmode.`
                            )
                        ]
                    });
                }

                return;
            }

            // ==================================================
            // PURGE
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    !isGod(member)
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "You need God or Founder rank."
                            )
                        ]
                    });

                    return;
                }

                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(amount) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "Choose an amount from **1–100**."
                            )
                        ]
                    });

                    return;
                }

                if (
                    !message.channel.isTextBased()
                ) {
                    return;
                }

                const deleted =
                    await message.channel.bulkDelete(
                        amount,
                        true
                    ).catch(
                        () => null
                    );

                if (!deleted) {
                    await message.reply({
                        embeds: [
                            errorEmbed(
                                "I couldn't delete those messages."
                            )
                        ]
                    });

                    return;
                }

                const response =
                    await message.channel.send({
                        embeds: [
                            successEmbed(
                                "Messages Purged",
                                `Deleted **${deleted.size}** messages.`
                            )
                        ]
                    });

                setTimeout(() => {
                    response.delete()
                        .catch(() => {});
                }, 5000);

                return;
            }
        } catch (error) {
            console.error(
                "[VC+] Command error:",
                error
            );

            await message.reply({
                embeds: [
                    errorEmbed(
                        "An unexpected error occurred while running that command."
                    )
                ]
            }).catch(() => {});
        }
    }
);

// ======================================================
// VOICE STATE SYSTEM
// ======================================================

client.on(
    "voiceStateUpdate",
    async (oldState, newState) => {
        try {
            const member =
                newState.member ||
                oldState.member;

            if (!member?.guild) {
                return;
            }

            const guild =
                member.guild;

            const data =
                getGuildData(
                    guild.id
                );

            // ==================================================
            // JOIN TO CREATE
            // ==================================================

            if (
                newState.channelId &&
                newState.channelId ===
                    data.jtc
            ) {
                const jtcChannel =
                    guild.channels.cache.get(
                        data.jtc
                    );

                if (jtcChannel) {
                    await createPersonalVC(
                        member,
                        jtcChannel
                    );
                }

                return;
            }

            // ==================================================
            // PERSONAL VC
            // ==================================================

            const newVC =
                newState.channelId
                    ? getTempVC(
                        newState.channelId
                    )
                    : null;

            if (newVC) {
                // Persistent STFU
                if (
                    newVC.stfu.has(
                        member.id
                    )
                ) {
                    await member.voice.setMute(
                        true,
                        "VC+ Persistent STFU"
                    ).catch(() => {});
                }

                // Persistent VC BAN
                if (
                    newVC.banned.has(
                        member.id
                    )
                ) {
                    await member.voice.disconnect(
                        "VC+ Voice Ban"
                    ).catch(() => {});

                    return;
                }
            }

            // ==================================================
            // OLD VC CLEANUP
            // ==================================================

            if (
                oldState.channelId &&
                oldState.channelId !==
                    newState.channelId
            ) {
                const oldChannel =
                    guild.channels.cache.get(
                        oldState.channelId
                    );

                if (
                    oldChannel &&
                    isTempVC(
                        oldChannel.id
                    )
                ) {
                    const oldVC =
                        getTempVC(
                            oldChannel.id
                        );

                    if (
                        oldVC &&
                        oldVC.stfu.has(
                            member.id
                        )
                    ) {
                        oldVC.stfu.delete(
                            member.id
                        );
                    }

                    await deleteEmptyVC(
                        oldChannel
                    );
                }
            }
        } catch (error) {
            console.error(
                "[VC+] Voice state error:",
                error
            );
        }
    }
);

// ======================================================
// SECURITY / ANTI-NUKE
// ======================================================

const securityActions = new Map();

function trackSecurityAction(
    guildId,
    userId,
    action
) {
    const key =
        `${guildId}:${userId}:${action}`;

    const now =
        Date.now();

    const history =
        securityActions.get(key) ?? [];

    history.push(now);

    const filtered =
        history.filter(
            time =>
                now - time <
                10_000
        );

    securityActions.set(
        key,
        filtered
    );

    return filtered.length;
}

async function getAuditExecutor(
    guild,
    type
) {
    const logs =
        await guild.fetchAuditLogs({
            type,
            limit: 1
        }).catch(() => null);

    if (!logs) {
        return null;
    }

    const entry =
        logs.entries.first();

    if (!entry) {
        return null;
    }

    if (
        Date.now() -
            entry.createdTimestamp >
        10_000
    ) {
        return null;
    }

    return entry.executor;
}

async function securityPunish(
    guild,
    executor,
    reason
) {
    if (!executor) {
        return;
    }

    const member =
        guild.members.cache.get(
            executor.id
        );

    if (!member) {
        return;
    }

    if (
        isTrustedExecutor(member)
    ) {
        return;
    }

    if (
        member.bannable
    ) {
        await member.ban({
            reason:
                `VC+ Security: ${reason}`
        }).catch(() => {});
    }
}

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.channelCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) {
                return;
            }

            const count =
                trackSecurityAction(
                    channel.guild.id,
                    executor.id,
                    "channelCreate"
                );

            if (
                count >= 5
            ) {
                await channel.delete(
                    "VC+ Anti-Nuke"
                ).catch(() => {});

                await securityPunish(
                    channel.guild,
                    executor,
                    "Mass channel creation"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Channel create security error:",
                error
            );
        }
    }
);

client.on(
    "channelDelete",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.channelDelete
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

            if (!executor) {
                return;
            }

            const count =
                trackSecurityAction(
                    channel.guild.id,
                    executor.id,
                    "channelDelete"
                );

            if (
                count >= 3
            ) {
                await securityPunish(
                    channel.guild,
                    executor,
                    "Mass channel deletion"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Channel delete security error:",
                error
            );
        }
    }
);

client.on(
    "roleCreate",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.roleCreate
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleCreate
                );

            if (!executor) {
                return;
            }

            const count =
                trackSecurityAction(
                    role.guild.id,
                    executor.id,
                    "roleCreate"
                );

            if (
                count >= 5
            ) {
                await role.delete(
                    "VC+ Anti-Nuke"
                ).catch(() => {});

                await securityPunish(
                    role.guild,
                    executor,
                    "Mass role creation"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Role create security error:",
                error
            );
        }
    }
);

client.on(
    "roleDelete",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled ||
                !data.protection.roleDelete
            ) {
                return;
            }

            const executor =
                await getAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleDelete
                );

            if (!executor) {
                return;
            }

            const count =
                trackSecurityAction(
                    role.guild.id,
                    executor.id,
                    "roleDelete"
                );

            if (
                count >= 3
            ) {
                await securityPunish(
                    role.guild,
                    executor,
                    "Mass role deletion"
                );
            }
        } catch (error) {
            console.error(
                "[VC+] Role delete security error:",
                error
            );
        }
    }
);

// ======================================================
// MEMBER JOIN / FOREVER BAN
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            const data =
                getGuildData(
                    member.guild.id
                );

            if (
                data.foreverBanned.includes(
                    member.id
                )
            ) {
                await member.ban({
                    reason:
                        "VC+ Forever Ban"
                }).catch(() => {});

                return;
            }
        } catch (error) {
            console.error(
                "[VC+] Member join error:",
                error
            );
        }
    }
);

// ======================================================
// READY
// ======================================================

client.once(
    "ready",
    () => {
        console.log(
            `[VC+] Logged in as ${client.user.tag}`
        );

        console.log(
            `[VC+] Connected to ${client.guilds.cache.size} guild(s)`
        );

        console.log(
            "[VC+] AutoMod online"
        );

        client.user.setPresence({
            activities: [
                {
                    name:
                        "VC+ Voice Control",
                    type:
                        ActivityType.Watching
                }
            ],
            status:
                "online"
        });
    }
);

// ======================================================
// ERROR HANDLING
// ======================================================

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
    "shardError",
    error => {
        console.error(
            "[VC+] Shard error:",
            error
        );
    }
);

client.on(
    "warn",
    warning => {
        console.warn(
            "[VC+] Warning:",
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

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

let shuttingDown = false;

async function gracefulShutdown(
    signal
) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `[VC+] ${signal} received. Saving database and shutting down...`
    );

    saveDB();

    try {
        await client.destroy();
    } catch (error) {
        console.error(
            "[VC+] Shutdown error:",
            error
        );
    }

    process.exit(0);
}

process.once(
    "SIGINT",
    () =>
        gracefulShutdown(
            "SIGINT"
        )
);

process.once(
    "SIGTERM",
    () =>
        gracefulShutdown(
            "SIGTERM"
        )
);

// ======================================================
// LOGIN
// ======================================================

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "[VC+] DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
