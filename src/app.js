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
        {
            recursive: true
        }
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

        const tempFile =
            `${DATA_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(
                db,
                null,
                2
            )
        );

        fs.renameSync(
            tempFile,
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
                vouch: null
            },

            protection: {
                enabled: true,
                actionWindow: 10000,
                maxActions: 3
            }
        };

        saveDB();
    }

    const data =
        db.guilds[guildId];

    if (!data.ranks) {
        data.ranks = {};
    }

    if (!data.foreverBanned) {
        data.foreverBanned = [];
    }

    if (!data.godmode) {
        data.godmode = [];
    }

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
        data.roles = {};
    }

    if (!("vouch" in data.roles)) {
        data.roles.vouch = null;
    }

    if (!data.protection) {
        data.protection = {
            enabled: true,
            actionWindow: 10000,
            maxActions: 3
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
// RANK LOOKUP
// ======================================================

function getRank(member) {

    if (!member) {
        return 0;
    }

    // SERVER OWNER IS ALWAYS FOUNDER
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
        data.ranks[member.id];

    return (
        RANKS[storedRank] ||
        RANKS.member
    );
}

function getRankName(member) {

    const level =
        getRank(member);

    for (
        const [name, value]
        of Object.entries(RANKS)
    ) {
        if (value === level) {
            return name;
        }
    }

    return "member";
}

function isFounder(member) {

    if (!member) {
        return false;
    }

    return (
        getRank(member) >=
        RANKS.founder
    );
}

function isGod(member) {

    if (!member) {
        return false;
    }

    // Founder is always God-level
    if (
        getRank(member) >=
        RANKS.founder
    ) {
        return true;
    }

    // Actual God rank
    if (
        getRank(member) >=
        RANKS.god
    ) {
        return true;
    }

    // Godmode granted by Founder
    const data =
        getGuildData(
            member.guild.id
        );

    return data.godmode.includes(
        member.id
    );
}

function isServerOwner(member) {

    return (
        member &&
        member.guild.ownerId ===
        member.id
    );
}

// ======================================================
// SECURITY TRUST
// ======================================================

async function isSecurityTrusted(
    member
) {

    if (!member) {
        return false;
    }

    // SERVER OWNER
    if (
        member.guild.ownerId ===
        member.id
    ) {
        return true;
    }

    // GOD + FOUNDER
    return (
        isGod(member)
    );
}

async function isTrustedExecutor(
    guild,
    userId
) {

    // VC+ itself
    if (
        client.user &&
        userId ===
            client.user.id
    ) {
        return true;
    }

    // Server owner
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

        return await isSecurityTrusted(
            member
        );

    } catch {

        return false;
    }
}

// ======================================================
// MODERATION HIERARCHY
// ======================================================

function canModerate(
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

    // Founder can moderate anyone
    if (
        isFounder(actor)
    ) {
        return true;
    }

    // Nobody below Founder can moderate Founder
    if (
        isFounder(target)
    ) {
        return false;
    }

    return (
        getRank(actor) >
        getRank(target)
    );
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
    }).catch(() => {});
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

    if (!/^\d+$/.test(id)) {
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
// VOUCH SYSTEM
// ======================================================

function getVouches(
    guildId,
    userId
) {

    const data =
        getGuildData(
            guildId
        );

    if (!data.vouches[userId]) {
        data.vouches[userId] = [];
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
// VOUCH ROLE
// ======================================================

async function getVouchRole(
    guild
) {

    const data =
        getGuildData(
            guild.id
        );

    let role =
        guild.roles.cache.get(
            data.roles.vouch
        );

    if (role) {
        return role;
    }

    role =
        guild.roles.cache.find(
            r =>
                r.name.toLowerCase() ===
                "vouch"
        );

    if (!role) {

        try {

            role =
                await guild.roles.create({
                    name: "Vouch",

                    reason:
                        "VC+ Vouch System"
                });

        } catch (error) {

            console.error(
                "[VC+] Could not create Vouch role:",
                error
            );

            return null;
        }
    }

    data.roles.vouch =
        role.id;

    saveDB();

    return role;
}

// ======================================================
// UPDATE VOUCH ROLE
// ======================================================

async function updateVouchRole(
    guild,
    userId
) {

    try {

        const member =
            await guild.members.fetch(
                userId
            ).catch(() => null);

        if (!member) {
            return;
        }

        const role =
            await getVouchRole(
                guild
            );

        if (!role) {
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
                    role.id
                )
            ) {

                await member.roles.add(
                    role,
                    "VC+ Vouch System"
                ).catch(() => {});
            }

            return;
        }

        if (
            member.roles.cache.has(
                role.id
            )
        ) {

            await member.roles.remove(
                role,
                "VC+ Vouch System"
            ).catch(() => {});
        }

    } catch (error) {

        console.error(
            "[VC+] Vouch role error:",
            error
        );
    }
}

// ======================================================
// ENFORCE VOUCH ROLE
// ======================================================

client.on(
    "guildMemberUpdate",
    async (
        oldMember,
        newMember
    ) => {

        try {

            const data =
                getGuildData(
                    newMember.guild.id
                );

            const vouchRoleId =
                data.roles.vouch;

            if (!vouchRoleId) {
                return;
            }

            const oldHas =
                oldMember.roles.cache.has(
                    vouchRoleId
                );

            const newHas =
                newMember.roles.cache.has(
                    vouchRoleId
                );

            if (oldHas === newHas) {
                return;
            }

            await updateVouchRole(
                newMember.guild,
                newMember.id
            );

        } catch (error) {

            console.error(
                "[VC+] Vouch enforcement error:",
                error
            );
        }
    }
);

// ======================================================
// TEMPORARY VC SYSTEM
// ======================================================

const temporaryVCs =
    new Map();

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
                            "VC+ Setup"
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
                            "VC+ Setup"
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
            "[VC+] VC setup error:",
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

    let channel = null;

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
                    "VC+ Personal Voice Channel"
            });

    } catch (error) {

        console.error(
            "[VC+] Personal VC error:",
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
                    "`-vc claim`",
                    "`-vc forceclaim`",
                    "`-vc stfu @user`",
                    "`-vc unstfu @user`"
                ].join("\n")
            );

        const sent =
            await channel.send({
                embeds: [
                    embed
                ]
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
            "-help",
            "-ping",
            "-interface",
            "-ranklist",
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
            "-vc claim",
            "-vc forceclaim",
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
            "```",

            "**Utility**",
            "```",
            "-purge 50",
            "-clear 50",
            "```"
        ].join("\n")
    );
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

        for (
            const guild
            of client.guilds.cache.values()
        ) {

            await getVouchRole(
                guild
            ).catch(() => {});
        }

        console.log(
            "[VC+] Security system online."
        );

        console.log(
            "[VC+] Founder + God security enabled."
        );
    }
);

// ======================================================
// MEMBER JOIN
// ======================================================

client.on(
    "guildMemberAdd",
    async member => {

        try {

            if (member.user.bot) {
                return;
            }

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

                console.log(
                    `[VC+] Re-banned ${member.user.tag}`
                );
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
// MESSAGE COMMANDS
// ======================================================

client.on(
    "messageCreate",
    async message => {

        try {

            if (!message.guild) {
                return;
            }

            if (message.author.bot) {
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

            if (command === "help") {

                return message.reply({
                    embeds: [
                        helpEmbed()
                    ]
                }).catch(() => {});
            }

            // ==================================================
            // PING
            // ==================================================

            if (command === "ping") {

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
                command ===
                "interface"
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
                        member.voice
                            .channel.id
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

                try {

                    const deleted =
                        await message.channel.bulkDelete(
                            amount,
                            true
                        );

                    const response =
                        await message.channel.send({
                            embeds: [
                                box(
                                    "Purge",
                                    `Deleted **${deleted.size}** message${deleted.size === 1 ? "" : "s"}.`
                                )
                            ]
                        });

                    setTimeout(
                        () => {
                            response
                                .delete()
                                .catch(() => {});
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
                        "I couldn't delete those messages."
                    );
                }

                return;
            }

            // ==================================================
            // VOUCH
            // ==================================================

            if (
                command ===
                "vouch"
            ) {

                if (
                    !isServerOwner(member) &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Vouch",
                        "Only the **Server Owner** or **Founder** can vouch for members."
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
                        "Your reason must be under 500 characters."
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

                await updateVouchRole(
                    message.guild,
                    target.id
                );

                return sendBox(
                    message,
                    "Vouch",
                    [
                        `<@${message.author.id}> vouched for <@${target.id}>.`,
                        "",
                        `**Reason:** ${reason}`,
                        "",
                        `**Total Vouches:** ${vouches.length}`
                    ].join("\n")
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
                        `<@${target.id}> has no vouches.`
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
                }).catch(() => {});
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
                            ([userId, vouches]) => ({
                                userId,
                                count:
                                    vouches.length
                            })
                        )
                        .filter(
                            entry =>
                                entry.count > 0
                        )
                        .sort(
                            (a, b) =>
                                b.count -
                                a.count
                        )
                        .slice(0, 10);

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
                                `**${index + 1}.** <@${entry.userId}> — **${entry.count}**`
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
                    vouches[number - 1];

                const staff =
                    getRank(member) >=
                    RANKS.moderator;

                if (
                    vouch.from !==
                        message.author.id &&
                    !staff &&
                    !isServerOwner(member) &&
                    !isFounder(member)
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
            // VC
            // ==================================================

            if (
                command ===
                "vc"
            ) {

                const sub =
                    args
                        .shift()
                        ?.toLowerCase();

                // ----------------------------------------------
                // SETUP
                // ----------------------------------------------

                if (
                    sub ===
                    "setup"
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
                            "I couldn't set up VC+."
                        );
                    }

                    await getVouchRole(
                        message.guild
                    );

                    return sendBox(
                        message,
                        "VC+ Setup",
                        [
                            "Category: **VC+**",
                            "Voice: **Join to Create**",
                            "",
                            "Ranks: **Database only**",
                            "Vouch: **Bot controlled**"
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
                        "This isn't a VC+ personal channel."
                    );
                }

                const isOwner =
                    vc.ownerId ===
                    message.author.id;

                // ----------------------------------------------
                // CLAIM
                // ----------------------------------------------

                if (
                    sub ===
                    "claim"
                ) {

                    if (isOwner) {

                        return sendBox(
                            message,
                            "VC+",
                            "You already own this VC."
                        );
                    }

                    const currentOwner =
                        await message.guild.members
                            .fetch(
                                vc.ownerId
                            )
                            .catch(
                                () => null
                            );

                    const ownerStillThere =
                        currentOwner &&
                        currentOwner.voice
                            .channelId ===
                        voiceChannel.id;

                    if (
                        ownerStillThere &&
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "The current VC owner is still here."
                        );
                    }

                    const oldOwner =
                        vc.ownerId;

                    vc.ownerId =
                        message.author.id;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            oldOwner,
                            {
                                ManageChannels:
                                    false
                            }
                        )
                        .catch(() => {});

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.author.id,
                            {
                                Connect:
                                    true,

                                ViewChannel:
                                    true,

                                Speak:
                                    true,

                                ManageChannels:
                                    true
                            }
                        )
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `<@${message.author.id}> claimed the VC.`
                    );
                }

                // ----------------------------------------------
                // FORCECLAIM
                // ----------------------------------------------

                if (
                    sub ===
                    "forceclaim"
                ) {

                    if (
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "Only the **Founder** can forceclaim a VC."
                        );
                    }

                    if (isOwner) {

                        return sendBox(
                            message,
                            "VC+",
                            "You already own this VC."
                        );
                    }

                    const oldOwner =
                        vc.ownerId;

                    vc.ownerId =
                        message.author.id;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            oldOwner,
                            {
                                ManageChannels:
                                    false
                            }
                        )
                        .catch(() => {});

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.author.id,
                            {
                                Connect:
                                    true,

                                ViewChannel:
                                    true,

                                Speak:
                                    true,

                                ManageChannels:
                                    true
                            }
                        )
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `<@${message.author.id}> forceclaimed the VC.`
                    );
                }

                // ----------------------------------------------
                // STFU
                // ----------------------------------------------

                if (
                    sub ===
                    "stfu"
                ) {

                    if (
                        !isFounder(member) &&
                        !isGod(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "Only **Founder** or **God** can use STFU."
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

                    // God cannot STFU Founder
                    if (
                        !isFounder(member) &&
                        isFounder(target)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "Only a **Founder** can STFU a Founder."
                        );
                    }

                    // God cannot STFU another God
                    if (
                        !isFounder(member) &&
                        isGod(target)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "You can't STFU a God-level member."
                        );
                    }

                    if (
                        target.voice.channelId !==
                        voiceChannel.id
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "That member isn't in this VC."
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
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `Server muted <@${target.id}>. They cannot unmute themselves until STFU is removed.`
                    );
                }

                // ----------------------------------------------
                // UNSTFU
                // ----------------------------------------------

                if (
                    sub ===
                    "unstfu"
                ) {

                    if (
                        !isFounder(member) &&
                        !isGod(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "Only **Founder** or **God** can use UNSTFU."
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
                        !isFounder(member) &&
                        isFounder(target)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "Only a **Founder** can modify a Founder."
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
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `<@${target.id}> has been unmuted.`
                    );
                }

                // ----------------------------------------------
                // OWNER-ONLY VC COMMANDS
                // ----------------------------------------------

                if (
                    ![
                        "kick",
                        "ban",
                        "reject",
                        "permit",
                        "lock",
                        "unlock",
                        "limit",
                        "rename",
                        "transfer"
                    ].includes(sub)
                ) {

                    return sendBox(
                        message,
                        "VC+",
                        "Unknown VC command."
                    );
                }

                // ----------------------------------------------
                // FOUNDER/GOD VC BYPASS
                // ----------------------------------------------

                const hasVCAccess =
                    isFounder(member) ||
                    isGod(member) ||
                    isOwner;

                if (!hasVCAccess) {

                    return sendBox(
                        message,
                        "VC+",
                        "Only the **VC owner**, **God**, or **Founder** can use this command."
                    );
                }

                // ----------------------------------------------
                // KICK
                // ----------------------------------------------

                if (
                    sub ===
                    "kick"
                ) {

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
                        target.voice.channelId !==
                        voiceChannel.id
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "That member isn't in this VC."
                        );
                    }

                    if (
                        isFounder(target) &&
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "You can't kick a Founder."
                        );
                    }

                    await target.voice
                        .disconnect(
                            "VC+ Kick"
                        )
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `Kicked <@${target.id}>.`
                    );
                }

                // ----------------------------------------------
                // BAN
                // ----------------------------------------------

                if (
                    sub ===
                    "ban"
                ) {

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
                        isFounder(target) &&
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "You can't ban a Founder from a VC."
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
                                "VC+ Ban"
                            )
                            .catch(() => {});
                    }

                    return sendBox(
                        message,
                        "VC+",
                        `Banned <@${target.id}> from this VC.`
                    );
                }

                // ----------------------------------------------
                // REJECT
                // ----------------------------------------------

                if (
                    sub ===
                    "reject"
                ) {

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
                        isFounder(target) &&
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "You can't reject a Founder."
                        );
                    }

                    vc.rejected.add(
                        target.id
                    );

                    return sendBox(
                        message,
                        "VC+",
                        `Rejected <@${target.id}>.`
                    );
                }

                // ----------------------------------------------
                // PERMIT
                // ----------------------------------------------

                if (
                    sub ===
                    "permit"
                ) {

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
                        `Permitted <@${target.id}>.`
                    );
                }

                // ----------------------------------------------
                // LOCK
                // ----------------------------------------------

                if (
                    sub ===
                    "lock"
                ) {

                    vc.locked = true;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.guild
                                .roles
                                .everyone,
                            {
                                Connect:
                                    false
                            }
                        )
                        .catch(() => {});

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
                    sub ===
                    "unlock"
                ) {

                    vc.locked = false;

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            message.guild
                                .roles
                                .everyone,
                            {
                                Connect:
                                    true
                            }
                        )
                        .catch(() => {});

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
                    sub ===
                    "limit"
                ) {

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
                            "Choose a limit from **0-99**."
                        );
                    }

                    await voiceChannel
                        .setUserLimit(
                            limit,
                            "VC+ Limit"
                        )
                        .catch(() => {});

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
                    sub ===
                    "rename"
                ) {

                    const name =
                        args
                            .join(" ")
                            .trim();

                    if (!name) {

                        return sendBox(
                            message,
                            "VC+",
                            "Give the VC a name."
                        );
                    }

                    if (
                        name.length > 100
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
                            "VC+ Rename"
                        )
                        .catch(() => {});

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
                    sub ===
                    "transfer"
                ) {

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

                    if (
                        isFounder(target) &&
                        !isFounder(member)
                    ) {

                        return sendBox(
                            message,
                            "VC+",
                            "You can't transfer ownership to a protected Founder."
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
                        .catch(() => {});

                    await voiceChannel
                        .permissionOverwrites
                        .edit(
                            target.id,
                            {
                                Connect:
                                    true,

                                ViewChannel:
                                    true,

                                Speak:
                                    true,

                                ManageChannels:
                                    true
                            }
                        )
                        .catch(() => {});

                    return sendBox(
                        message,
                        "VC+",
                        `Transferred ownership to <@${target.id}>.`
                    );
                }

                return;
            }

            // ==================================================
            // RANK
            // ==================================================

            if (
                command ===
                "rank"
            ) {

                if (
                    !isServerOwner(member) &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Rank",
                        "Only the **Server Owner** or **Founder** can give or change ranks."
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
                        "The Server Owner is always Founder."
                    );
                }

                // Only Founder can assign Founder
                if (
                    rank === "founder" &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Rank",
                        "Only a **Founder** can assign Founder rank."
                    );
                }

                // Only Founder can change protected ranks
                if (
                    (
                        isFounder(target) ||
                        isGod(target)
                    ) &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Rank",
                        "You can't change a protected rank."
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

                return sendBox(
                    message,
                    "Rank",
                    `Set <@${target.id}> to **${RANK_DISPLAY_NAMES[rank]}**.`
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
                    !isFounder(member) &&
                    !isServerOwner(member)
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

                if (
                    target.id ===
                    member.id
                ) {

                    return sendBox(
                        message,
                        "Godmode",
                        "You already have Founder privileges."
                    );
                }

                const data =
                    getGuildData(
                        message.guild.id
                    );

                if (
                    mode ===
                    "on"
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
                    [
                        `<@${target.id}> Godmode is now **${mode.toUpperCase()}**.`,
                        "",
                        mode === "on"
                            ? "They now have God-level VC+ privileges."
                            : "Their temporary Godmode privileges have been removed."
                    ].join("\n")
                );
            }

            // ==================================================
            // BAN
            // ==================================================

            if (
                command ===
                "ban"
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

                const success =
                    await target.ban({
                        reason
                    })
                    .then(() => true)
                    .catch(() => false);

                if (!success) {

                    return sendBox(
                        message,
                        "Ban",
                        "Discord wouldn't let me ban that member. Check my role hierarchy and permissions."
                    );
                }

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
                command ===
                "kick"
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

                const success =
                    await target.kick(
                        reason
                    )
                    .then(() => true)
                    .catch(() => false);

                if (!success) {

                    return sendBox(
                        message,
                        "Kick",
                        "Discord wouldn't let me kick that member. Check my role hierarchy and permissions."
                    );
                }

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

                const success =
                    await target.timeout(
                        minutes * 60 * 1000,
                        "VC+ Timeout"
                    )
                    .then(() => true)
                    .catch(() => false);

                if (!success) {

                    return sendBox(
                        message,
                        "Timeout",
                        "Discord wouldn't let me timeout that member. Check my role hierarchy and permissions."
                    );
                }

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

                if (
                    !isFounder(member) &&
                    !canModerate(
                        member,
                        target
                    )
                ) {

                    return sendBox(
                        message,
                        "Timeout",
                        "You can't modify that member's timeout."
                    );
                }

                await target.timeout(
                    null,
                    "VC+ UnTimeout"
                ).catch(() => {});

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
                    !isServerOwner(member) &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Forever Ban",
                        "Only the **Server Owner** or **Founder** can use this command."
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

                if (
                    isFounder(target) &&
                    !isFounder(member)
                ) {

                    return sendBox(
                        message,
                        "Forever Ban",
                        "You can't forever-ban a Founder."
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

                const success =
                    await target.ban({
                        reason:
                            "VC+ Forever Ban"
                    })
                    .then(() => true)
                    .catch(() => false);

                if (!success) {

                    return sendBox(
                        message,
                        "Forever Ban",
                        "I couldn't ban that member. Check my role hierarchy and permissions."
                    );
                }

                return sendBox(
                    message,
                    "Forever Ban",
                    `<@${target.id}> has been permanently banned.`
                );
            }

            // ==================================================
            // UNBAN
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
// ENFORCE STFU
// ======================================================

async function enforceSTFU(
    member,
    vc
) {

    if (!member || !vc) {
        return;
    }

    // Founder cannot be forced muted
    if (
        isFounder(member)
    ) {
        return;
    }

    // God-level users cannot be force-muted
    // by another God. Founder can override this.
    if (
        isGod(member)
    ) {
        return;
    }

    if (
        !vc.stfu.has(
            member.id
        )
    ) {
        return;
    }

    try {

        if (
            !member.voice.serverMute
        ) {

            await member.voice.setMute(
                true,
                "VC+ STFU Enforcement"
            );
        }

    } catch (error) {

        console.error(
            "[VC+] STFU enforcement error:",
            error
        );
    }
}

// ======================================================
// VOICE STATE
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

            // ==================================================
            // JOIN TO CREATE
            // ==================================================

            if (
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
                    .catch(() => {});

                await sendInterface(
                    personalVC,
                    member.id
                );

                return;
            }

            // ==================================================
            // VC SECURITY
            // ==================================================

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

                    // Founder bypasses VC restrictions
                    if (
                        !isFounder(member)
                    ) {

                        // BANNED
                        if (
                            vc.banned.has(
                                member.id
                            )
                        ) {

                            await member.voice
                                .disconnect(
                                    "VC+ Ban"
                                )
                                .catch(() => {});

                            return;
                        }

                        // REJECTED
                        if (
                            vc.rejected.has(
                                member.id
                            )
                        ) {

                            await member.voice
                                .disconnect(
                                    "VC+ Reject"
                                )
                                .catch(() => {});

                            return;
                        }

                        // LOCKED
                        if (
                            vc.locked &&
                            member.id !==
                                vc.ownerId &&
                            !vc.permitted.has(
                                member.id
                            ) &&
                            !isGod(member)
                        ) {

                            await member.voice
                                .disconnect(
                                    "VC+ Locked"
                                )
                                .catch(() => {});

                            return;
                        }
                    }

                    // STFU enforcement
                    await enforceSTFU(
                        member,
                        vc
                    );
                }
            }

            // ==================================================
            // STFU RE-ENFORCEMENT
            // ==================================================

            if (
                newState.channelId &&
                (
                    oldState.serverMute !==
                    newState.serverMute
                )
            ) {

                const vc =
                    temporaryVCs.get(
                        newState.channelId
                    );

                if (vc) {

                    const member =
                        newState.member;

                    if (member) {

                        await enforceSTFU(
                            member,
                            vc
                        );
                    }
                }
            }

            // ==================================================
            // DELETE EMPTY PERSONAL VC
            // ==================================================

            if (
                oldState.channelId
            ) {

                const vc =
                    temporaryVCs.get(
                        oldState.channelId
                    );

                if (
                    vc &&
                    oldState.channel &&
                    oldState.channel.members
                        .size === 0
                ) {

                    temporaryVCs.delete(
                        oldState.channelId
                    );

                    await oldState.channel
                        .delete(
                            "VC+ Empty VC"
                        )
                        .catch(() => {});
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
// ANTI-NUKE TRACKER
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

    actions.push(
        now
    );

    const valid =
        actions.filter(
            time =>
                now - time <=
                data.protection
                    .actionWindow
        );

    guildActions.set(
        userId,
        valid
    );

    return valid.length;
}

// ======================================================
// PUNISH NUKE USER
// ======================================================

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
            ).catch(() => null);

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
            "[VC+] Punish error:",
            error
        );
    }
}

// ======================================================
// AUDIT LOG EXECUTOR
// ======================================================

async function getAuditExecutor(
    guild,
    type
) {

    try {

        const logs =
            await guild.fetchAuditLogs({
                type,
                limit: 1
            });

        const entry =
            logs.entries.first();

        if (!entry) {
            return null;
        }

        if (
            Date.now() -
            entry.createdTimestamp >
            10000
        ) {
            return null;
        }

        return (
            entry.executor ||
            null
        );

    } catch {

        return null;
    }
}

// ======================================================
// CHANNEL CREATE SECURITY
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

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelCreate
                );

            if (!executor) {
                return;
            }

            if (
                client.user &&
                executor.id ===
                    client.user.id
            ) {
                return;
            }

            const member =
                await channel.guild
                    .members
                    .fetch(
                        executor.id
                    )
                    .catch(
                        () => null
                    );

            if (
                await isSecurityTrusted(
                    member
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
                "VC+ Security: Unauthorized Channel"
            ).catch(() => {});

            if (
                count >=
                data.protection.maxActions
            ) {

                await punishNuker(
                    channel.guild,
                    executor.id,
                    "VC+ Security: Repeated unauthorized changes"
                );
            }

        } catch (error) {

            console.error(
                "[VC+] Channel create security:",
                error
            );
        }
    }
);

// ======================================================
// CHANNEL DELETE SECURITY
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

            const executor =
                await getAuditExecutor(
                    channel.guild,
                    AuditLogEvent.ChannelDelete
                );

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

            if (
                count >= 2
            ) {

                await punishNuker(
                    channel.guild,
                    executor.id,
                    "VC+ Security: Unauthorized channel deletion"
                );
            }

        } catch (error) {

            console.error(
                "[VC+] Channel delete security:",
                error
            );
        }
    }
);

// ======================================================
// ROLE CREATE SECURITY
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

            if (
                data.roles.vouch ===
                role.id
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
                "VC+ Security: Unauthorized Role"
            ).catch(() => {});

            if (
                count >=
                data.protection.maxActions
            ) {

                await punishNuker(
                    role.guild,
                    executor.id,
                    "VC+ Security: Repeated unauthorized role creation"
                );
            }

        } catch (error) {

            console.error(
                "[VC+] Role create security:",
                error
            );
        }
    }
);

// ======================================================
// ROLE DELETE SECURITY
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

            const executor =
                await getAuditExecutor(
                    role.guild,
                    AuditLogEvent.RoleDelete
                );

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
                count >= 2
            ) {

                await punishNuker(
                    role.guild,
                    executor.id,
                    "VC+ Security: Unauthorized role deletion"
                );
            }

        } catch (error) {

            console.error(
                "[VC+] Role delete security:",
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
