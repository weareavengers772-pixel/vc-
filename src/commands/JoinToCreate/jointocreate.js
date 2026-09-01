```js
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder
} from "discord.js";

import { getColor } from "../../config/bot.js";
import { successEmbed, warningEmbed } from "../../utils/embeds.js";
import { logger } from "../../utils/logger.js";
import { InteractionHelper } from "../../utils/interactionHelper.js";

import {
    initializeJoinToCreate,
    getConfiguration,
    getChannelConfiguration,
    updateChannelConfig,
    removeTriggerChannel,
    logConfigurationChange
} from "../../services/joinToCreateService.js";


/* =========================================================
   PERMISSION SYSTEM
========================================================= */

function isVCAdmin(member) {
    if (!member) return false;

    // Server owner
    if (member.guild.ownerId === member.id) {
        return true;
    }

    const roleNames = member.roles.cache.map(role =>
        role.name.toLowerCase()
    );

    // Founder / God
    if (
        roleNames.includes("founder") ||
        roleNames.includes("god")
    ) {
        return true;
    }

    // Bleed / Anti-Nuke Admin
    if (
        roleNames.includes("bleed admin") ||
        roleNames.includes("anti-nuke admin")
    ) {
        return true;
    }

    // Administrator permission
    if (
        member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
        return true;
    }

    return false;
}


/* =========================================================
   VC OWNER CHECK
========================================================= */

function isVCOwner(member, channel) {
    if (!member || !channel) return false;

    return channel.permissionOverwrites.cache.some(
        overwrite =>
            overwrite.id === member.id &&
            overwrite.allow.has(PermissionFlagsBits.ManageChannels)
    );
}


/* =========================================================
   CONTROL CHECK
========================================================= */

function canControlVC(member, channel) {
    return (
        isVCAdmin(member) ||
        isVCOwner(member, channel)
    );
}


/* =========================================================
   COMMAND
========================================================= */

export default {

    data: new SlashCommandBuilder()
        .setName("vc")
        .setDescription("Manage the temporary VC system.")
        .setDMPermission(false)

        .addSubcommand(subcommand =>
            subcommand
                .setName("setup")
                .setDescription("Set up the temporary VC system.")
                .addChannelOption(option =>
                    option
                        .setName("category")
                        .setDescription("Category for temporary VCs.")
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName("dashboard")
                .setDescription("Manage the VC system.")
                .addChannelOption(option =>
                    option
                        .setName("trigger")
                        .setDescription("Join to Create channel.")
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
        ),

    category: "utility",


    /* =====================================================
       SLASH COMMAND
    ===================================================== */

    async execute(interaction, config, client) {

        try {

            if (!isVCAdmin(interaction.member)) {

                return InteractionHelper.safeReply(
                    interaction,
                    {
                        content:
                            "You do not have permission to use this command.",
                        flags: MessageFlags.Ephemeral
                    }
                );

            }

            const subcommand =
                interaction.options.getSubcommand();

            await InteractionHelper.safeDefer(
                interaction,
                {
                    flags: MessageFlags.Ephemeral
                }
            );


            if (subcommand === "setup") {

                return setupVC(
                    interaction,
                    client
                );

            }


            if (subcommand === "dashboard") {

                return dashboardVC(
                    interaction,
                    client
                );

            }

        } catch (error) {

            logger.error(
                "VC command error:",
                error
            );

            return InteractionHelper.safeReply(
                interaction,
                {
                    content:
                        "An error occurred while running the VC command.",
                    flags: MessageFlags.Ephemeral
                }
            );

        }

    },


    /* =====================================================
       PREFIX COMMAND
    ===================================================== */

    async prefixExecute(message, args, client) {

        try {

            const subcommand =
                args[0]?.toLowerCase();

            if (!subcommand) {

                return message.reply(
                    "Usage: `-vc setup` or `-vc dashboard`"
                );

            }


            if (!isVCAdmin(message.member)) {

                return message.reply(
                    "You do not have permission to use this command."
                );

            }


            if (subcommand === "setup") {

                return setupVCPrefix(
                    message,
                    client
                );

            }


            if (subcommand === "dashboard") {

                return message.reply(
                    "Use `/vc dashboard` to manage the VC system."
                );

            }


            return message.reply(
                "Unknown VC command. Use `-vc setup`."
            );

        } catch (error) {

            logger.error(
                "VC prefix command error:",
                error
            );

            return message.reply(
                "An error occurred while running the VC command."
            );

        }

    }

};


/* =========================================================
   PREFIX SETUP
========================================================= */

async function setupVCPrefix(message, client) {

    const guild = message.guild;

    const existing =
        await getConfiguration(
            client,
            guild.id
        );

    if (
        existing?.triggerChannels?.length
    ) {

        const channel =
            await guild.channels.fetch(
                existing.triggerChannels[0]
            ).catch(() => null);

        if (channel) {

            return message.reply(
                `VC system is already set up in ${channel}.`
            );

        }

    }


    const category =
        await guild.channels.create({
            name: "Temporary VCs",
            type: ChannelType.GuildCategory
        });


    const trigger =
        await guild.channels.create({
            name: "Join to Create",
            type: ChannelType.GuildVoice,
            parent: category.id,
            userLimit: 0,
            bitrate: 64000
        });


    await initializeJoinToCreate(
        client,
        guild.id,
        trigger.id,
        {
            nameTemplate: "{username}'s Room",
            userLimit: 0,
            bitrate: 64000,
            categoryId: category.id
        }
    );


    await logConfigurationChange(
        client,
        guild.id,
        message.author.id,
        "Initialized VC system",
        {
            triggerChannel: trigger.id,
            category: category.id
        }
    );


    return message.reply(
        `VC system is ready.\n\nJoin ${trigger} to create your own temporary VC.`
    );

}


/* =========================================================
   SLASH SETUP
========================================================= */

async function setupVC(interaction, client) {

    const guild = interaction.guild;

    const category =
        interaction.options.getChannel(
            "category"
        );


    const existing =
        await getConfiguration(
            client,
            guild.id
        );


    if (
        existing?.triggerChannels?.length
    ) {

        const channel =
            await guild.channels.fetch(
                existing.triggerChannels[0]
            ).catch(() => null);

        if (channel) {

            return InteractionHelper.safeEditReply(
                interaction,
                {
                    content:
                        `VC system is already set up in ${channel}.`
                }
            );

        }

    }


    const vcCategory =
        category ||
        await guild.channels.create({
            name: "Temporary VCs",
            type: ChannelType.GuildCategory
        });


    const trigger =
        await guild.channels.create({
            name: "Join to Create",
            type: ChannelType.GuildVoice,
            parent: vcCategory.id,
            userLimit: 0,
            bitrate: 64000
        });


    await initializeJoinToCreate(
        client,
        guild.id,
        trigger.id,
        {
            nameTemplate: "{username}'s Room",
            userLimit: 0,
            bitrate: 64000,
            categoryId: vcCategory.id
        }
    );


    await logConfigurationChange(
        client,
        guild.id,
        interaction.user.id,
        "Initialized VC system",
        {
            triggerChannel: trigger.id,
            category: vcCategory.id
        }
    );


    const embed =
        successEmbed(
            "VC Setup Complete",
            `Join ${trigger} to create your own temporary VC.\n\n` +
            `VC owners can control their own channel.\n` +
            `Founder, God, Bleed Admin and Anti-Nuke Admin can control all temporary VCs.`
        );


    return InteractionHelper.safeEditReply(
        interaction,
        {
            embeds: [embed]
        }
    );

}


/* =========================================================
   DASHBOARD
========================================================= */

async function dashboardVC(interaction, client) {

    const trigger =
        interaction.options.getChannel(
            "trigger"
        );


    const config =
        await getChannelConfiguration(
            client,
            interaction.guild.id,
            trigger.id
        );


    const channelConfig =
        config.channelConfig || {};


    const embed =
        new EmbedBuilder()
            .setTitle("VC Configuration")
            .setDescription(
                `Configuration for ${trigger}`
            )
            .setColor(
                getColor("info")
            )
            .addFields(
                {
                    name: "Channel Name",
                    value:
                        `\`${channelConfig.nameTemplate || "{username}'s Room"}\``
                },
                {
                    name: "User Limit",
                    value:
                        String(
                            channelConfig.userLimit ?? 0
                        ),
                    inline: true
                },
                {
                    name: "Bitrate",
                    value:
                        `${(channelConfig.bitrate ?? 64000) / 1000} kbps`,
                    inline: true
                }
            );


    const row =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        `vc_name_${trigger.id}`
                    )
                    .setLabel("Change Name")
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vc_limit_${trigger.id}`
                    )
                    .setLabel("User Limit")
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `vc_delete_${trigger.id}`
                    )
                    .setLabel("Delete")
                    .setStyle(
                        ButtonStyle.Danger
                    )

            );


    await InteractionHelper.safeEditReply(
        interaction,
        {
            embeds: [embed],
            components: [row]
        }
    );

}
```
