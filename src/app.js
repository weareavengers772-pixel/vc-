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
    fs.mkdirSync(
        DATA_DIR,
        { recursive: true }
    );
}

let db = {
    guilds: {}
};

function loadDB() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify(
                    db,
                    null,
                    2
                )
            );

            return;
        }

        const raw =
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            );

        if (raw.trim()) {
            db = JSON.parse(raw);
        }

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
        const temp =
            `${DATA_FILE}.tmp`;

        fs.writeFileSync(
            temp,
            JSON.stringify(
                db,
                null,
                2
            )
        );

        fs.renameSync(
            temp,
            DATA_FILE
        );

    } catch (error) {
        console.error(
            "[VC+] Database save error:",
            error
        );
    }
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            ranks: {},
            foreverBanned: [],
            godmode: [],
            vouches: {},

            jtc: {
                categoryId: null,
                triggerId: null
            },

            roles: {
                member: null,
                vouch: null,
                founder: null,

                staff: null,
                moderator: null,
                admin: null,
                director: null,
                executive: null,
                coowner: null,
                owner: null,
                god: null
            },

            protection: {
                enabled: true,
                actionWindow: 10000,
                maxActions: 5
            }
        };

        saveDB();
    }

    const data =
        db.guilds[guildId];

    if (!data.vouches) {
        data.vouches = {};
    }

    if (!data.jtc) {
        data.jtc = {
            categoryId: null,
            triggerId: null
        };
    }

    if (!data.roles) {
        data.roles = {
            member: null,
            vouch: null,
            founder: null,

            staff: null,
            moderator: null,
            admin: null,
            director: null,
            executive: null,
            coowner: null,
            owner: null,
            god: null
        };
    }

    if (!data.protection) {
        data.protection = {
            enabled: true,
            actionWindow: 10000,
            maxActions: 5
        };
    }

    return data;
}

loadDB();

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

const RANK_NAMES = [
    "member",
    "staff",
    "moderator",
    "admin",
    "director",
    "executive",
    "coowner",
    "owner",
    "god",
    "founder"
];

const RANK_DISPLAY_NAMES = {
    member: "Member",
    staff: "Staff",
    moderator: "Moderator",
    admin: "Admin",
    director: "Director",
    executive: "Executive",
    coowner: "CoOwner",
    owner: "Owner",
    god: "God",
    founder: "Founder"
};

// ======================================================
// ROLE SYSTEM
// ======================================================

async function getOrCreateRole(
    guild,
    name
) {
    let role =
        guild.roles.cache.find(
            r =>
                r.name.toLowerCase() ===
                name.toLowerCase()
        );

    if (role) {
        return role;
    }

    try {
        role =
            await guild.roles.create({
                name,
                reason:
                    "VC+ rank system"
            });

        return role;

    } catch (error) {
        console.error(
            `[VC+] Couldn't create ${name} role:`,
            error
        );

        return null;
    }
}

async function setupRankRoles(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    try {
        // ------------------------------
        // MEMBER
        // ------------------------------

        const memberRole =
            await getOrCreateRole(
                guild,
                "Member"
            );

        if (memberRole) {
            data.roles.member =
                memberRole.id;
        }

        // ------------------------------
        // STAFF RANKS
        // ------------------------------

        for (
            const rank of RANK_NAMES
        ) {
            if (
                rank === "member"
            ) {
                continue;
            }

            const role =
                await getOrCreateRole(
                    guild,
                    RANK_DISPLAY_NAMES[
                        rank
                    ]
                );

            if (role) {
                data.roles[rank] =
                    role.id;
            }
        }

        // ------------------------------
        // VOUCH
        // ------------------------------

        const vouchRole =
            await getOrCreateRole(
                guild,
                "Vouch"
            );

        if (vouchRole) {
            data.roles.vouch =
                vouchRole.id;
        }

        saveDB();

        // ------------------------------
        // ROLE ORDER
        // ------------------------------

        await positionRankRoles(
            guild
        );

        return true;

    } catch (error) {
        console.error(
            "[VC+] Rank role setup error:",
            error
        );

        return false;
    }
}

async function positionRankRoles(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    /*
        Discord requires the bot's highest role
        to be ABOVE every role it manages.

        Founder becomes the highest USER/STAFF
        role, with Vouch directly below it.
    */

    try {
        const founderRole =
            guild.roles.cache.get(
                data.roles.founder
            );

        const vouchRole =
            guild.roles.cache.get(
                data.roles.vouch
            );

        if (
            founderRole &&
            vouchRole
        ) {
            await guild.roles.setPositions(
                [
                    {
                        role:
                            founderRole.id,
                        position:
                            guild.roles.highest.position - 1
                    },
                    {
                        role:
                            vouchRole.id,
                        position:
                            guild.roles.highest.position - 2
                    }
                ],
                "VC+ rank hierarchy"
            );
        }

        const order = [
            "god",
            "owner",
            "coowner",
            "executive",
            "director",
            "admin",
            "moderator",
            "staff"
        ];

        let position =
            founderRole
                ? founderRole.position - 2
                : guild.roles.highest.position - 2;

        for (
            const rank of order
        ) {
            const role =
                guild.roles.cache.get(
                    data.roles[rank]
                );

            if (!role) {
                continue;
            }

            position--;

            if (
                position >
                guild.roles.everyone.position
            ) {
                await role.setPosition(
                    position,
                    {
                        reason:
                            "VC+ rank hierarchy"
                    }
                ).catch(
                    () => {}
                );
            }
        }

    } catch (error) {
        console.error(
            "[VC+] Role positioning error:",
            error
        );
    }
}

// ======================================================
// GET RANK
// ======================================================

function getRank(member) {
    if (!member) {
        return 0;
    }

    if (
        member.guild.ownerId ===
        member.id
    ) {
        return RANKS.founder;
    }

    const data =
        getGuildData(
            member.guild.id
        );

    const storedRank =
        data.ranks[
            member.id
        ];

    return (
        RANKS[storedRank] ||
        1
    );
}

function getRankName(member) {
    const level =
        getRank(member);

    for (
        const [name, value]
        of Object.entries(RANKS)
    ) {
        if (
            value === level
        ) {
            return name;
        }
    }

    return "member";
}

function isFounder(member) {
    return (
        getRank(member) >=
        RANKS.founder
    );
}

function isGod(member) {
    return (
        getRank(member) >=
        RANKS.god
    );
}

function canModerate(
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

    return (
        getRank(actor) >
        getRank(target)
    );
}

// ======================================================
// APPLY RANK ROLE
// ======================================================

async function applyRankRole(
    member,
    rank
) {
    try {
        const data =
            getGuildData(
                member.guild.id
            );

        await setupRankRoles(
            member.guild
        );

        // Remove every VC+ rank role
        for (
            const rankName
            of RANK_NAMES
        ) {
            const roleId =
                data.roles[
                    rankName
                ];

            if (!roleId) {
                continue;
            }

            const role =
                member.guild.roles.cache.get(
                    roleId
                );

            if (
                role &&
                member.roles.cache.has(
                    role.id
                )
            ) {
                await member.roles
                    .remove(
                        role,
                        "VC+ rank update"
                    )
                    .catch(
                        () => {}
                    );
            }
        }

        const newRoleId =
            data.roles[rank];

        const newRole =
            member.guild.roles.cache.get(
                newRoleId
            );

        if (
            newRole &&
            !member.roles.cache.has(
                newRole.id
            )
        ) {
            await member.roles.add(
                newRole,
                "VC+ rank update"
            );
        }

        // Founder gets founder role
        if (
            rank === "founder"
        ) {
            data.roles.founder =
                newRoleId;
        }

        saveDB();

    } catch (error) {
        console.error(
            "[VC+] Apply rank role error:",
            error
        );
    }
}

// ======================================================
// MEMBER ROLE
// ======================================================

async function giveMemberRole(
    member
) {
    try {
        if (
            member.user.bot
        ) {
            return;
        }

        const data =
            getGuildData(
                member.guild.id
            );

        await setupRankRoles(
            member.guild
        );

        const memberRole =
            member.guild.roles.cache.get(
                data.roles.member
            );

        if (!memberRole) {
            return;
        }

        // Don't give Member to someone
        // who already has a higher VC+ rank.
        if (
            getRank(member) > 1
        ) {
            return;
        }

        if (
            !member.roles.cache.has(
                memberRole.id
            )
        ) {
            await member.roles.add(
                memberRole,
                "VC+ automatic Member role"
            );
        }

    } catch (error) {
        console.error(
            "[VC+] Member role error:",
            error
        );
    }
}

// ======================================================
// VOUCH ROLE
// ======================================================

async function updateVouchRole(
    guild,
    userId
) {
    try {
        const data =
            getGuildData(
                guild.id
            );

        await setupRankRoles(
            guild
        );

        const member =
            await guild.members.fetch(
                userId
            ).catch(
                () => null
            );

        if (!member) {
            return;
        }

        const vouchRole =
            guild.roles.cache.get(
                data.roles.vouch
            );

        if (!vouchRole) {
            return;
        }

        const vouches =
            getVouches(
                guild.id,
                userId
            );

        if (
            vouches.length > 0
        ) {
            if (
                !member.roles.cache.has(
                    vouchRole.id
                )
            ) {
                await member.roles.add(
                    vouchRole,
                    "VC+ vouch role"
                );
            }
        } else {
            if (
                member.roles.cache.has(
                    vouchRole.id
                )
            ) {
                await member.roles.remove(
                    vouchRole,
                    "VC+ vouch role removal"
                );
            }
        }

    } catch (error) {
        console.error(
            "[VC+] Vouch role error:",
            error
        );
    }
}

// ======================================================
// EMBEDS
// ======================================================

function box(
    title,
    description
) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(
            description
        )
        .setTimestamp();
}

function sendBox(
    message,
    title,
    description
) {
    return message.reply({
        embeds: [
            box(
                title,
                description
            )
        ]
    }).catch(
        () => {}
    );
}

// ======================================================
// TARGET FINDER
// ======================================================

async function getTarget(
    message,
    argument
) {
    if (!argument) {
        return null;
    }

    const id =
        argument
            .replace(
                /[<@!>]/g,
                ""
            )
            .trim();

    if (
        !/^\d+$/.test(id)
    ) {
        return null;
    }

    try {
        return await message.guild.members.fetch(
            id
        );
    } catch {
        return null;
    }
}

// ======================================================
// TEMP VC SYSTEM
// ======================================================

const temporaryVCs =
    new Map();

// ======================================================
// VC+ CREATION LOCK
// ======================================================

const vcPlusCreatingChannels =
    new Set();

// ======================================================
// VC SETUP
// ======================================================

async function setupGuildVC(
    guild
) {
    const data =
        getGuildData(
            guild.id
        );

    try {
        let category = null;
        let trigger = null;

        if (
            data.jtc.categoryId
        ) {
            category =
                guild.channels.cache.get(
                    data.jtc.categoryId
                );
        }

        if (!category) {
            vcPlusCreatingChannels.add(
                guild.id
            );

            try {
                category =
                    await guild.channels.create({
                        name: "VC+",
                        type:
                            ChannelType.GuildCategory,
                        reason:
                            "VC+ setup"
                    });
            } finally {
                vcPlusCreatingChannels.delete(
                    guild.id
                );
            }
        }

        if (
            data.jtc.triggerId
        ) {
            trigger =
                guild.channels.cache.get(
                    data.jtc.triggerId
                );
        }

        if (!trigger) {
            vcPlusCreatingChannels.add(
                guild.id
            );

            try {
                trigger =
                    await guild.channels.create({
                        name:
                            "Join to Create",
                        type:
                            ChannelType.GuildVoice,
                        parent:
                            category.id,
                        reason:
                            "VC+ setup"
                    });
            } finally {
                vcPlusCreatingChannels.delete(
                    guild.id
                );
            }
        }

        data.jtc.categoryId =
            category.id;

        data.jtc.triggerId =
            trigger.id;

        saveDB();

        return {
            category,
            trigger
        };

    } catch (error) {
        vcPlusCreatingChannels.delete(
            guild.id
        );

        console.error(
            "[VC+] Setup error:",
            error
        );

        return null;
    }
}

// ======================================================
// CREATE PERSONAL VC
// ======================================================

async function createPersonalVC(
    member
) {
    const guild =
        member.guild;

    const data =
        getGuildData(
            guild.id
        );

    const category =
        guild.channels.cache.get(
            data.jtc.categoryId
        );

    if (!category) {
        return null;
    }

    vcPlusCreatingChannels.add(
        guild.id
    );

    let channel;

    try {
        channel =
            await guild.channels.create({
                name:
                    `${member.user.username}'s VC`,

                type:
                    ChannelType.GuildVoice,

                parent:
                    category.id,

                permissionOverwrites: [
                    {
                        id:
                            guild.roles.everyone.id,

                        allow: [
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.ViewChannel
                        ]
                    },

                    {
                        id:
                            member.id,

                        allow: [
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Speak,
                            PermissionFlagsBits.ManageChannels
                        ]
                    }
                ],

                reason:
                    "VC+ personal voice channel"
            });

    } catch (error) {
        console.error(
            "[VC+] Personal VC creation error:",
            error
        );

        return null;

    } finally {
        vcPlusCreatingChannels.delete(
            guild.id
        );
    }

    temporaryVCs.set(
        channel.id,
        {
            guildId:
                guild.id,

            ownerId:
                member.id,

            banned:
                new Set(),

            rejected:
                new Set(),

            permitted:
                new Set(),

            stfu:
                new Set(),

            locked:
                false,

            interfaceMessageId:
                null
        }
    );

    return channel;
}

// ======================================================
// VC INTERFACE
// ======================================================

async function sendInterface(
    channel,
    ownerId
) {
    try {
        const embed =
            box(
                "VC+",
                [
                    `Owner: <@${ownerId}>`,
                    "",
                    "**Voice Master**",
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
                    "`-vc unstfu @user`"
                ].join("\n")
            );

        const sent =
            await channel.send({
                embeds: [embed]
            });

        const vc =
            temporaryVCs.get(
                channel.id
            );

        if (vc) {
            vc.interfaceMessageId =
                sent.id;
        }

    } catch (error) {
        console.error(
            "[VC+] Interface error:",
            error
        );
    }
}

// ======================================================
// HELP
// ======================================================

function helpEmbed() {
    return box(
        "VC+ Help",
        [
            "**General**",
            "```",
            "-help        View help menu",
            "-ping        Check bot latency",
            "-interface   Open VC interface",
            "-ranklist    View rank hierarchy",
            "```",

            "**Voice Master**",
            "```",
            "-vc setup",
            "-vc kick @user",
            "-vc ban @user",
            "-vc reject @user",
            "-vc permit @user",
            "-vc lock",
            "-vc unlock",
            "-vc limit 10",
            "-vc rename name",
            "-vc transfer @user",
            "-vc stfu @user",
            "-vc unstfu @user",
            "```",

            "**Vouch**",
            "```",
            "-vouch @user reason",
            "-vouches @user",
            "-vouchlist",
            "-removevouch @user number",
            "```",

            "**Utility**",
            "```",
            "-purge 50",
            "-clear 50",
            "```",

            "**Moderation**",
            "```",
            "-ban @user reason",
            "-kick @user reason",
            "-timeout @user minutes",
            "-untimeout @user",
            "-foreverban @user",
            "```",

            "**Management**",
            "```",
            "-rank @user rank",
            "-godmode on @user",
            "-godmode off @user",
            "```"
        ].join("\n")
    );
}

// ======================================================
// VOUCH HELPERS
// ======================================================

function getVouches(
    guildId,
    userId
) {
    const data =
        getGuildData(
            guildId
        );

    if (
        !data.vouches[userId]
    ) {
        data.vouches[userId] =
            [];
    }

    return data.vouches[userId];
}

function formatVouch(
    vouch,
    number
) {
    return [
        `**#${number}**`,
        `From: <@${vouch.from}>`,
        `Reason: ${vouch.reason}`,
        `<t:${Math.floor(
            vouch.timestamp / 1000
        )}:R>`
    ].join("\n");
}

// ======================================================
// READY
// ======================================================

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
                        `${PREFIX}help`,
                    type:
                        ActivityType.Listening
                }
            ],

            status:
                "online"
        });

        // Setup roles in every server
        for (
            const guild
            of client.guilds.cache.values()
        ) {
            await setupRankRoles(
                guild
            ).catch(
                () => {}
            );
        }
    }
);

// ======================================================
// NEW MEMBER
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {
        try {
            if (
                member.user.bot
            ) {
                return;
            }

            await giveMemberRole(
                member
            );

            // Forever ban protection
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
                }).catch(
                    () => {}
                );

                console.log(
                    `[VC+] Re-banned forever-banned user ${member.user.tag}`
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Guild member add error:",
                error
            );
        }
    }
);

// ======================================================
// MESSAGE COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {
        try {
            if (
                !message.guild
            ) {
                return;
            }

            if (
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

            const args =
                message.content
                    .slice(
                        PREFIX.length
                    )
                    .trim()
                    .split(/\s+/);

            const command =
                args
                    .shift()
                    ?.toLowerCase();

            if (!command) {
                return;
            }

            const member =
                message.member;

            // ==================================================
            // HELP
            // ==================================================

            if (
                command === "help"
            ) {
                return message.reply({
                    embeds: [
                        helpEmbed()
                    ]
                }).catch(
                    () => {}
                );
            }

            // ==================================================
            // PING
            // ==================================================

            if (
                command === "ping"
            ) {
                return sendBox(
                    message,
                    "Pong",
                    `Latency: **${client.ws.ping}ms**`
                );
            }

            // ==================================================
            // INTERFACE
            // ==================================================

            if (
                command === "interface"
            ) {
                if (
                    !member.voice.channel
                ) {
                    return sendBox(
                        message,
                        "VC+",
                        "You must be inside a voice channel."
                    );
                }

                const vc =
                    temporaryVCs.get(
                        member.voice.channel.id
                    );

                if (!vc) {
                    return sendBox(
                        message,
                        "VC+",
                        "This is not a VC+ voice channel."
                    );
                }

                return sendInterface(
                    member.voice.channel,
                    vc.ownerId
                );
            }

            // ==================================================
            // RANK LIST
            // ==================================================

            if (
                command ===
                "ranklist"
            ) {
                return sendBox(
                    message,
                    "Rank Hierarchy",
                    [
                        "10. Founder",
                        "9. God",
                        "8. Owner",
                        "7. CoOwner",
                        "6. Executive",
                        "5. Director",
                        "4. Admin",
                        "3. Moderator",
                        "2. Staff",
                        "1. Member"
                    ].join("\n")
                );
            }

            // ==================================================
            // PURGE / CLEAR
            // ==================================================

            if (
                command === "purge" ||
                command === "clear"
            ) {
                if (
                    !member.permissions.has(
                        PermissionFlagsBits.ManageMessages
                    ) &&
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Purge",
                        "You need **Manage Messages** to use this command."
                    );
                }

                const amount =
                    Number(args[0]);

                if (
                    !Number.isInteger(
                        amount
                    ) ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return sendBox(
                        message,
                        "Purge",
                        "Usage: `-purge 1-100`"
                    );
                }

                if (
                    !message.channel.isTextBased() ||
                    typeof message.channel.bulkDelete !==
                        "function"
                ) {
                    return sendBox(
                        message,
                        "Purge",
                        "This command can't be used in this channel."
                    );
                }

                try {
                    const messages =
                        await message.channel.bulkDelete(
                            amount,
                            true
                        );

                    const response =
                        await message.channel.send({
                            embeds: [
                                box(
                                    "Purge",
                                    `Deleted **${messages.size}** message${messages.size === 1 ? "" : "s"}.`
                                )
                            ]
                        });

                    setTimeout(
                        () => {
                            response
                                .delete()
                                .catch(
                                    () => {}
                                );
                        },
                        3000
                    );

                } catch (error) {
                    console.error(
                        "[VC+] Purge error:",
                        error
                    );

                    return sendBox(
                        message,
                        "Purge",
                        "I couldn't delete those messages. Check my permissions."
                    );
                }

                return;
            }

            // ==================================================
            // VOUCH
            // ==================================================

            if (
                command === "vouch"
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
                        "Usage: `-vouch @user reason`"
                    );
                }

                if (
                    target.id ===
                    message.author.id
                ) {
                    return sendBox(
                        message,
                        "Vouch",
                        "You can't vouch yourself."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ")
                        .trim();

                if (!reason) {
                    return sendBox(
                        message,
                        "Vouch",
                        "You need to provide a reason."
                    );
                }

                if (
                    reason.length > 500
                ) {
                    return sendBox(
                        message,
                        "Vouch",
                        "Your vouch reason is too long. Keep it under 500 characters."
                    );
                }

                const vouches =
                    getVouches(
                        message.guild.id,
                        target.id
                    );

                vouches.push({
                    from:
                        message.author.id,

                    reason,

                    timestamp:
                        Date.now()
                });

                saveDB();

                // Give Vouch role
                await updateVouchRole(
                    message.guild,
                    target.id
                );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "Vouch"
                        )
                        .setDescription(
                            [
                                `<@${message.author.id}> vouched for <@${target.id}>.`,
                                "",
                                "**Reason**",
                                reason,
                                "",
                                `**Total Vouches:** ${vouches.length}`
                            ].join("\n")
                        )
                        .setTimestamp();

                return message.reply({
                    embeds: [
                        embed
                    ]
                }).catch(
                    () => {}
                );
            }

            // ==================================================
            // VOUCHES
            // ==================================================

            if (
                command ===
                "vouches"
            ) {
                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                if (!target) {
                    return sendBox(
                        message,
                        "Vouches",
                        "Usage: `-vouches @user`"
                    );
                }

                const vouches =
                    getVouches(
                        message.guild.id,
                        target.id
                    );

                if (
                    vouches.length ===
                    0
                ) {
                    return sendBox(
                        message,
                        "Vouches",
                        `<@${target.id}> has no vouches yet.`
                    );
                }

                const recent =
                    vouches
                        .slice(-10)
                        .reverse();

                const description =
                    recent
                        .map(
                            (
                                vouch,
                                index
                            ) =>
                                formatVouch(
                                    vouch,
                                    vouches.length -
                                        index
                                )
                        )
                        .join(
                            "\n\n"
                        );

                return message.reply({
                    embeds: [
                        box(
                            `${target.user.username}'s Vouches`,
                            [
                                `Total: **${vouches.length}**`,
                                "",
                                description
                            ].join("\n")
                        )
                    ]
                }).catch(
                    () => {}
                );
            }

            // ==================================================
            // VOUCH LIST
            // ==================================================

            if (
                command ===
                "vouchlist"
            ) {
                const data =
                    getGuildData(
                        message.guild.id
                    );

                const entries =
                    Object.entries(
                        data.vouches
                    )
                        .map(
                            (
                                [
                                    userId,
                                    vouches
                                ]
                            ) => ({
                                userId,
                                count:
                                    vouches.length
                            })
                        )
                        .filter(
                            entry =>
                                entry.count >
                                0
                        )
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                b.count -
                                a.count
                        )
                        .slice(
                            0,
                            10
                        );

                if (
                    entries.length ===
                    0
                ) {
                    return sendBox(
                        message,
                        "Vouch Leaderboard",
                        "There are no vouches yet."
                    );
                }

                const description =
                    entries
                        .map(
                            (
                                entry,
                                index
                            ) =>
                                `**${index + 1}.** <@${entry.userId}> — **${entry.count}** vouch${entry.count === 1 ? "" : "es"}`
                        )
                        .join("\n");

                return sendBox(
                    message,
                    "Vouch Leaderboard",
                    description
                );
            }

            // ==================================================
            // REMOVE VOUCH
            // ==================================================

            if (
                command ===
                "removevouch"
            ) {
                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                const number =
                    Number(args[1]);

                if (
                    !target ||
                    !Number.isInteger(
                        number
                    ) ||
                    number < 1
                ) {
                    return sendBox(
                        message,
                        "Remove Vouch",
                        "Usage: `-removevouch @user number`"
                    );
                }

                const vouches =
                    getVouches(
                        message.guild.id,
                        target.id
                    );

                if (
                    number >
                    vouches.length
                ) {
                    return sendBox(
                        message,
                        "Remove Vouch",
                        "That vouch does not exist."
                    );
                }

                const vouch =
                    vouches[
                        number - 1
                    ];

                const isStaff =
                    getRank(member) >=
                    RANKS.moderator;

                if (
                    vouch.from !==
                        message.author.id &&
                    !isStaff
                ) {
                    return sendBox(
                        message,
                        "Remove Vouch",
                        "You can only remove your own vouch."
                    );
                }

                vouches.splice(
                    number - 1,
                    1
                );

                saveDB();

                // Remove Vouch role if they have zero left
                await updateVouchRole(
                    message.guild,
                    target.id
                );

                return sendBox(
                    message,
                    "Remove Vouch",
                    `Removed vouch **#${number}** from <@${target.id}>.`
                );
            }

            // ==================================================
            // VC COMMANDS
            // ==================================================

            if (
                command === "vc"
            ) {
                const sub =
                    args
                        .shift()
                        ?.toLowerCase();

                // ----------------------------------------------
                // SETUP
                // ----------------------------------------------

                if (
                    sub === "setup"
                ) {
                    if (
                        !member.permissions.has(
                            PermissionFlagsBits.ManageChannels
                        ) &&
                        !isFounder(member)
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "You need **Manage Channels** to use this command."
                        );
                    }

                    const result =
                        await setupGuildVC(
                            message.guild
                        );

                    if (!result) {
                        return sendBox(
                            message,
                            "VC+",
                            "I couldn't set up VC+. Check my channel permissions."
                        );
                    }

                    // Also make sure rank roles exist
                    await setupRankRoles(
                        message.guild
                    );

                    return sendBox(
                        message,
                        "VC+ Setup",
                        [
                            "Created/loaded:",
                            "",
                            "Category: **VC+**",
                            "Voice: **Join to Create**",
                            "",
                            "Roles:",
                            "**Founder**",
                            "**Vouch**",
                            "**Member**"
                        ].join("\n")
                    );
                }

                const voiceChannel =
                    member.voice.channel;

                if (!voiceChannel) {
                    return sendBox(
                        message,
                        "VC+",
                        "You must be inside your VC+ voice channel."
                    );
                }

                const vc =
                    temporaryVCs.get(
                        voiceChannel.id
                    );

                if (!vc) {
                    return sendBox(
                        message,
                        "VC+",
                        "This is not a VC+ personal voice channel."
                    );
                }

                const isOwner =
                    vc.ownerId ===
                    message.author.id;

                // ----------------------------------------------
                // KICK
                // ----------------------------------------------

                if (
                    sub === "kick"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "You can't kick yourself."
                        );
                    }

                    if (
                        target.voice.channelId !==
                        voiceChannel.id
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "That member isn't in your VC."
                        );
                    }

                    await target.voice
                        .disconnect(
                            "VC+ kick"
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `Kicked <@${target.id}> from the VC.`
                    );
                }

                // ----------------------------------------------
                // BAN
                // ----------------------------------------------

                if (
                    sub === "ban"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    vc.banned.add(
                        target.id
                    );

                    if (
                        target.voice.channelId ===
                        voiceChannel.id
                    ) {
                        await target.voice
                            .disconnect(
                                "VC+ ban"
                            )
                            .catch(
                                () => {}
                            );
                    }

                    return sendBox(
                        message,
                        "VC+",
                        `Banned <@${target.id}> from your VC.`
                    );
                }

                // ----------------------------------------------
                // REJECT
                // ----------------------------------------------

                if (
                    sub === "reject"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    vc.rejected.add(
                        target.id
                    );

                    return sendBox(
                        message,
                        "VC+",
                        `Rejected <@${target.id}> from your VC.`
                    );
                }

                // ----------------------------------------------
                // PERMIT
                // ----------------------------------------------

                if (
                    sub === "permit"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
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

                    return sendBox(
                        message,
                        "VC+",
                        `Permitted <@${target.id}> to join your VC.`
                    );
                }

                // ----------------------------------------------
                // LOCK
                // ----------------------------------------------

                if (
                    sub === "lock"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
                        );
                    }

                    vc.locked = true;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.guild.roles.everyone,
                            {
                                Connect:
                                    false
                            }
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        "Your VC is now locked."
                    );
                }

                // ----------------------------------------------
                // UNLOCK
                // ----------------------------------------------

                if (
                    sub === "unlock"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
                        );
                    }

                    vc.locked = false;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.guild.roles.everyone,
                            {
                                Connect:
                                    true
                            }
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        "Your VC is now unlocked."
                    );
                }

                // ----------------------------------------------
                // LIMIT
                // ----------------------------------------------

                if (
                    sub === "limit"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
                        );
                    }

                    const limit =
                        Number(args[0]);

                    if (
                        !Number.isInteger(
                            limit
                        ) ||
                        limit < 0 ||
                        limit > 99
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "Choose a limit between **0 and 99**."
                        );
                    }

                    await voiceChannel
                        .setUserLimit(
                            limit,
                            "VC+ user limit"
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `VC limit set to **${limit}**.`
                    );
                }

                // ----------------------------------------------
                // RENAME
                // ----------------------------------------------

                if (
                    sub === "rename"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
                        );
                    }

                    const name =
                        args
                            .join(" ")
                            .trim();

                    if (!name) {
                        return sendBox(
                            message,
                            "VC+",
                            "Give the VC a new name."
                        );
                    }

                    if (
                        name.length >
                        100
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "That name is too long."
                        );
                    }

                    await voiceChannel
                        .setName(
                            name,
                            "VC+ rename"
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `Renamed the VC to **${name}**.`
                    );
                }

                // ----------------------------------------------
                // TRANSFER
                // ----------------------------------------------

                if (
                    sub === "transfer"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    if (
                        target.id ===
                        message.author.id
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "You already own this VC."
                        );
                    }

                    vc.ownerId =
                        target.id;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.author.id,
                            {
                                ManageChannels:
                                    false
                            }
                        )
                        .catch(
                            () => {}
                        );

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            target.id,
                            {
                                ManageChannels:
                                    true,
                                Connect:
                                    true,
                                ViewChannel:
                                    true,
                                Speak:
                                    true
                            }
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `Transferred ownership to <@${target.id}>.`
                    );
                }

                // ----------------------------------------------
                // STFU
                // ----------------------------------------------

                if (
                    sub === "stfu"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    if (
                        isGod(target)
                    ) {
                        return sendBox(
                            message,
                            "VC+",
                            "You can't STFU a protected member."
                        );
                    }

                    vc.stfu.add(
                        target.id
                    );

                    await target.voice
                        .setMute(
                            true,
                            "VC+ STFU"
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `Server muted <@${target.id}>.`
                    );
                }

                // ----------------------------------------------
                // UNSTFU
                // ----------------------------------------------

                if (
                    sub === "unstfu"
                ) {
                    if (!isOwner) {
                        return sendBox(
                            message,
                            "VC+",
                            "Only the VC owner can use this command."
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
                            "VC+",
                            "Mention a valid member."
                        );
                    }

                    vc.stfu.delete(
                        target.id
                    );

                    await target.voice
                        .setMute(
                            false,
                            "VC+ UNSTFU"
                        )
                        .catch(
                            () => {}
                        );

                    return sendBox(
                        message,
                        "VC+",
                        `Unmuted <@${target.id}>.`
                    );
                }

                return sendBox(
                    message,
                    "VC+",
                    "Unknown VC command."
                );
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
                    return sendBox(
                        message,
                        "Rank",
                        "Only the **Founder** can change ranks."
                    );
                }

                const target =
                    await getTarget(
                        message,
                        args[0]
                    );

                const rank =
                    args[1]
                        ?.toLowerCase();

                if (
                    !target ||
                    !RANKS[rank]
                ) {
                    return sendBox(
                        message,
                        "Rank",
                        "Usage: `-rank @user rank`"
                    );
                }

                if (
                    target.id ===
                    message.guild.ownerId
                ) {
                    return sendBox(
                        message,
                        "Rank",
                        "The server owner is always Founder."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                data.ranks[
                    target.id
                ] = rank;

                saveDB();

                // Give actual Discord role
                await applyRankRole(
                    target,
                    rank
                );

                // Remove Member role for higher ranks
                if (
                    rank !== "member"
                ) {
                    const memberRole =
                        message.guild.roles.cache.get(
                            data.roles.member
                        );

                    if (
                        memberRole &&
                        target.roles.cache.has(
                            memberRole.id
                        )
                    ) {
                        await target.roles.remove(
                            memberRole,
                            "VC+ rank update"
                        ).catch(
                            () => {}
                        );
                    }
                }

                return sendBox(
                    message,
                    "Rank",
                    `Set <@${target.id}> to **${rank}**.`
                );
            }

            // ==================================================
            // GODMODE
            // ==================================================

            if (
                command ===
                "godmode"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Godmode",
                        "Only the **Founder** can use Godmode."
                    );
                }

                const mode =
                    args[0]
                        ?.toLowerCase();

                const target =
                    await getTarget(
                        message,
                        args[1]
                    );

                if (
                    !target ||
                    ![
                        "on",
                        "off"
                    ].includes(mode)
                ) {
                    return sendBox(
                        message,
                        "Godmode",
                        "Usage: `-godmode on/off @user`"
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    mode === "on"
                ) {
                    if (
                        !data.godmode.includes(
                            target.id
                        )
                    ) {
                        data.godmode.push(
                            target.id
                        );
                    }

                } else {
                    data.godmode =
                        data.godmode.filter(
                            id =>
                                id !==
                                target.id
                        );
                }

                saveDB();

                return sendBox(
                    message,
                    "Godmode",
                    `Godmode **${mode}** for <@${target.id}>.`
                );
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command === "ban"
            ) {
                if (
                    !member.permissions.has(
                        PermissionFlagsBits.BanMembers
                    ) &&
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Ban",
                        "You don't have permission to use this command."
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
                        "Mention a valid member."
                    );
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return sendBox(
                        message,
                        "Ban",
                        "You can't moderate that member."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

                await target.ban({
                    reason
                }).catch(
                    () => {}
                );

                return sendBox(
                    message,
                    "Ban",
                    `Banned <@${target.id}>.\nReason: **${reason}**`
                );
            }

            // ==================================================
            // KICK
            // ==================================================

            if (
                command === "kick"
            ) {
                if (
                    !member.permissions.has(
                        PermissionFlagsBits.KickMembers
                    ) &&
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Kick",
                        "You don't have permission to use this command."
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
                        "Mention a valid member."
                    );
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return sendBox(
                        message,
                        "Kick",
                        "You can't moderate that member."
                    );
                }

                const reason =
                    args
                        .slice(1)
                        .join(" ") ||
                    "No reason provided";

                await target.kick(
                    reason
                ).catch(
                    () => {}
                );

                return sendBox(
                    message,
                    "Kick",
                    `Kicked <@${target.id}>.\nReason: **${reason}**`
                );
            }

            // ==================================================
            // TIMEOUT
            // ==================================================

            if (
                command ===
                "timeout"
            ) {
                if (
                    !member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    ) &&
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Timeout",
                        "You don't have permission to use this command."
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
                    !Number.isInteger(
                        minutes
                    ) ||
                    minutes < 1 ||
                    minutes > 40320
                ) {
                    return sendBox(
                        message,
                        "Timeout",
                        "Usage: `-timeout @user minutes`"
                    );
                }

                if (
                    !canModerate(
                        member,
                        target
                    )
                ) {
                    return sendBox(
                        message,
                        "Timeout",
                        "You can't moderate that member."
                    );
                }

                await target.timeout(
                    minutes *
                        60 *
                        1000,
                    "VC+ timeout"
                ).catch(
                    () => {}
                );

                return sendBox(
                    message,
                    "Timeout",
                    `Timed out <@${target.id}> for **${minutes} minutes**.`
                );
            }

            // ==================================================
            // UNTIMEOUT
            // ==================================================

            if (
                command ===
                "untimeout"
            ) {
                if (
                    !member.permissions.has(
                        PermissionFlagsBits.ModerateMembers
                    ) &&
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Timeout",
                        "You don't have permission to use this command."
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
                        "Timeout",
                        "Mention a valid member."
                    );
                }

                await target.timeout(
                    null,
                    "VC+ untimeout"
                ).catch(
                    () => {}
                );

                return sendBox(
                    message,
                    "Timeout",
                    `Removed timeout from <@${target.id}>.`
                );
            }

            // ==================================================
            // FOREVER BAN
            // ==================================================

            if (
                command ===
                "foreverban"
            ) {
                if (
                    !isFounder(member)
                ) {
                    return sendBox(
                        message,
                        "Forever Ban",
                        "Only the **Founder** can use this command."
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
                        "Mention a valid member."
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
                        "VC+ Forever Ban"
                }).catch(
                    () => {}
                );

                return sendBox(
                    message,
                    "Forever Ban",
                    `<@${target.id}> has been permanently banned from this server.`
                );
            }

            // ==================================================
            // UNBAN REMOVED
            // ==================================================

            if (
                command ===
                "unban"
            ) {
                return sendBox(
                    message,
                    "Moderation",
                    "That command is not available."
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Command error:",
                error
            );

            return sendBox(
                message,
                "VC+",
                "Something went wrong while running that command."
            );
        }
    }
);

// ======================================================
// JOIN TO CREATE
// ======================================================

client.on(
    "voiceStateUpdate",
    async (
        oldState,
        newState
    ) => {
        try {
            const guild =
                newState.guild;

            const data =
                getGuildData(
                    guild.id
                );

            // ----------------------------------------------
            // JOIN TO CREATE
            // ----------------------------------------------

            if (
                newState.channelId &&
                newState.channelId ===
                    data.jtc.triggerId
            ) {
                const member =
                    newState.member;

                if (!member) {
                    return;
                }

                const personalVC =
                    await createPersonalVC(
                        member
                    );

                if (!personalVC) {
                    return;
                }

                await member.voice
                    .setChannel(
                        personalVC
                    )
                    .catch(
                        () => {}
                    );

                await sendInterface(
                    personalVC,
                    member.id
                );
            }

            // ----------------------------------------------
            // VC PERMISSIONS
            // ----------------------------------------------

            if (
                newState.channelId
            ) {
                const vc =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (vc) {
                    const member =
                        newState.member;

                    if (!member) {
                        return;
                    }

                    if (
                        vc.banned.has(
                            member.id
                        ) ||
                        vc.rejected.has(
                            member.id
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ rejected/banned"
                            )
                            .catch(
                                () => {}
                            );

                        return;
                    }

                    if (
                        vc.locked &&
                        member.id !==
                            vc.ownerId &&
                        !vc.permitted.has(
                            member.id
                        )
                    ) {
                        await member.voice
                            .disconnect(
                                "VC+ locked"
                            )
                            .catch(
                                () => {}
                            );
                    }
                }
            }

            // ----------------------------------------------
            // DELETE EMPTY VC
            // ----------------------------------------------

            if (
                oldState.channelId
            ) {
                const oldVC =
                    temporaryVCs.get(
                        oldState.channelId
                    );

                if (
                    oldVC &&
                    oldState.channel &&
                    oldState.channel.members.size ===
                        0
                ) {
                    temporaryVCs.delete(
                        oldState.channelId
                    );

                    await oldState.channel
                        .delete(
                            "VC+ empty personal channel"
                        )
                        .catch(
                            () => {}
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
// ANTI-NUKE
// ======================================================

const actionTracker =
    new Map();

function recordAction(
    guildId,
    userId
) {
    const data =
        getGuildData(
            guildId
        );

    const now =
        Date.now();

    if (
        !actionTracker.has(
            guildId
        )
    ) {
        actionTracker.set(
            guildId,
            new Map()
        );
    }

    const guildActions =
        actionTracker.get(
            guildId
        );

    if (
        !guildActions.has(
            userId
        )
    ) {
        guildActions.set(
            userId,
            []
        );
    }

    const actions =
        guildActions.get(
            userId
        );

    actions.push(now);

    const valid =
        actions.filter(
            time =>
                now - time <=
                data.protection.actionWindow
        );

    guildActions.set(
        userId,
        valid
    );

    return valid.length;
}

async function isTrustedExecutor(
    guild,
    userId
) {
    if (
        userId ===
        guild.ownerId
    ) {
        return true;
    }

    try {
        const member =
            await guild.members.fetch(
                userId
            );

        return isFounder(
            member
        );

    } catch {
        return false;
    }
}

async function punishNuker(
    guild,
    userId,
    reason
) {
    if (
        await isTrustedExecutor(
            guild,
            userId
        )
    ) {
        return;
    }

    try {
        const member =
            await guild.members.fetch(
                userId
            );

        if (
            member &&
            member.kickable
        ) {
            await member.kick(
                reason
            );
        }

    } catch (error) {
        console.error(
            "[VC+] Anti-nuke punishment error:",
            error
        );
    }
}

// ======================================================
// CHANNEL CREATE PROTECTION
// ======================================================

client.on(
    "channelCreate",
    async channel => {
        try {
            if (!channel.guild) {
                return;
            }

            if (
                vcPlusCreatingChannels.has(
                    channel.guild.id
                )
            ) {
                console.log(
                    `[VC+] Allowed VC+ channel: ${channel.name}`
                );

                return;
            }

            const data =
                getGuildData(
                    channel.guild.id
                );

            if (
                !data.protection.enabled
            ) {
                return;
            }

            const logs =
                await channel.guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.ChannelCreate,
                    limit: 1
                }).catch(
                    () => null
                );

            const entry =
                logs?.entries.first();

            if (!entry) {
                return;
            }

            const executor =
                entry.executor;

            if (!executor) {
                return;
            }

            if (
                await isTrustedExecutor(
                    channel.guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                recordAction(
                    channel.guild.id,
                    executor.id
                );

            await channel.delete(
                "VC+ unauthorized channel creation"
            ).catch(
                () => {}
            );

            if (
                count >=
                data.protection.maxActions
            ) {
                await punishNuker(
                    channel.guild,
                    executor.id,
                    "VC+ anti-nuke protection"
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Channel create protection error:",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL DELETE PROTECTION
// ======================================================

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
                !data.protection.enabled
            ) {
                return;
            }

            const logs =
                await channel.guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.ChannelDelete,
                    limit: 1
                }).catch(
                    () => null
                );

            const entry =
                logs?.entries.first();

            if (!entry) {
                return;
            }

            const executor =
                entry.executor;

            if (!executor) {
                return;
            }

            if (
                await isTrustedExecutor(
                    channel.guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                recordAction(
                    channel.guild.id,
                    executor.id
                );

            await punishNuker(
                channel.guild,
                executor.id,
                `VC+ unauthorized channel deletion (${count})`
            );

        } catch (error) {
            console.error(
                "[VC+] Channel delete protection error:",
                error
            );
        }
    }
);

// ======================================================
// ROLE CREATE PROTECTION
// ======================================================

client.on(
    "roleCreate",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled
            ) {
                return;
            }

            const logs =
                await role.guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.RoleCreate,
                    limit: 1
                }).catch(
                    () => null
                );

            const entry =
                logs?.entries.first();

            if (!entry) {
                return;
            }

            const executor =
                entry.executor;

            if (!executor) {
                return;
            }

            if (
                await isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                recordAction(
                    role.guild.id,
                    executor.id
                );

            await role.delete(
                "VC+ unauthorized role creation"
            ).catch(
                () => {}
            );

            if (
                count >=
                data.protection.maxActions
            ) {
                await punishNuker(
                    role.guild,
                    executor.id,
                    "VC+ anti-nuke protection"
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Role create protection error:",
                error
            );
        }
    }
);

// ======================================================
// ROLE DELETE PROTECTION
// ======================================================

client.on(
    "roleDelete",
    async role => {
        try {
            const data =
                getGuildData(
                    role.guild.id
                );

            if (
                !data.protection.enabled
            ) {
                return;
            }

            const logs =
                await role.guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.RoleDelete,
                    limit: 1
                }).catch(
                    () => null
                );

            const entry =
                logs?.entries.first();

            if (!entry) {
                return;
            }

            const executor =
                entry.executor;

            if (!executor) {
                return;
            }

            if (
                await isTrustedExecutor(
                    role.guild,
                    executor.id
                )
            ) {
                return;
            }

            const count =
                recordAction(
                    role.guild.id,
                    executor.id
                );

            if (
                count >=
                data.protection.maxActions
            ) {
                await punishNuker(
                    role.guild,
                    executor.id,
                    "VC+ anti-nuke protection"
                );
            }

        } catch (error) {
            console.error(
                "[VC+] Role delete protection error:",
                error
            );
        }
    }
);

// ======================================================
// ERROR PROTECTION
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

// ======================================================
// LOGIN
// ======================================================

if (
    !process.env.DISCORD_TOKEN
) {
    console.error(
        "[VC+] DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

client.login(
    process.env.DISCORD_TOKEN
);
