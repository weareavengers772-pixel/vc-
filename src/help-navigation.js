import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const HELP_PAGES = [
    {
        name: "General",
        description: "-help\nOpen the VC+ help menu.\n\n-ping\nCheck bot latency."
    },
    {
        name: "Moderation",
        description: "-ban @user [reason]\nServer owner only.\n\n-unban USER_ID\nUnban a user.\n\n-unbanall\nUnban all users.\n\n-kick @user [reason]\nKick a member.\n\n-timeout @user 10m [reason]\nTimeout a member.\n\n-untimeout @user\nRemove a timeout.\n\n-foreverban @user [reason]\nForever ban through VC+.\n\n-unforeverban USER_ID\nRemove a VC+ forever ban.\n\n-purge 1-100\nDelete messages.\n\n-clear 1-100\nAlias for purge."
    },
    {
        name: "Ranks",
        description: "-rank @user <rank>\nSet a VC+ rank.\n\n-rank @user\nView a user's rank.\n\n-ranklist\nView rank hierarchy.\n\n-removerank @user\nServer owner only. Remove a VC+ rank."
    },
    {
        name: "Godmode",
        description: "-godmode @user\nGive internal Godmode.\n\n-godmode remove @user\nRemove internal Godmode."
    },
    {
        name: "Vouches",
        description: "-vouch set role @Role\nSet the vouch role.\n\n-vouch role\nView the vouch role.\n\n-vouch give @user reason\nGive a vouch and assign the role.\n\n-vouch clear @user\nClear a user's vouches and remove the role.\n\n-vouch clear everyone\nClear everyone's vouches and remove the role from everyone.\n\n-vouch list\nView vouches.\n\n-vouches @user\nView a user's vouches."
    },
    {
        name: "Voice",
        description: "-vc setup\nServer owner only. Create Join-to-Create.\n\n-vc kick @user\nDisconnect a user.\n\n-vc disconnect @user\nDisconnect a user.\n\n-vc ban @user\nBan a user from the VC.\n\n-vc reject @user\nReject a user.\n\n-vc permit @user\nPermit a user.\n\n-vc lock\nLock the VC.\n\n-vc unlock\nUnlock the VC.\n\n-vc limit number\nSet the user limit.\n\n-vc rename name\nRename the VC.\n\n-vc transfer @user\nTransfer ownership.\n\n-vc claim\nClaim an abandoned VC.\n\n-vc forceclaim\nForce claim a VC.\n\n-vc stfu @user\nFounder and God only. Server mute a user.\n\n-vc unstfu @user\nFounder and God only. Remove server mute."
    },
    {
        name: "Filter",
        description: "-filter add word\nAdd a filtered word.\n\n-filter remove word\nRemove a filtered word."
    },
    {
        name: "Server Setup",
        description: "-vc setup\nCreate the Join-to-Create system.\n\n-interface\nCreate the VC+ server interface.\n\n-vouch set role @Role\nConfigure the vouch role."
    }
];

function helpPayload(page) {
    const safePage = ((page % HELP_PAGES.length) + HELP_PAGES.length) % HELP_PAGES.length;
    const current = HELP_PAGES[safePage];

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`VC+ | ${current.name}`)
                .setDescription(`\\`\\`\\`\n${current.description}\n\\`\\`\\``)
                .setFooter({ text: `Page ${safePage + 1}/${HELP_PAGES.length}` })
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("help_prev")
                    .setLabel("<")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`help_page_${safePage}`)
                    .setLabel(`${safePage + 1}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId("help_next")
                    .setLabel(">")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

const originalEmit = Client.prototype.emit;

Client.prototype.emit = function patchedEmit(eventName, ...args) {
    if (eventName === "interactionCreate") {
        const interaction = args[0];

        if (
            interaction?.isButton?.() &&
            (interaction.customId === "help_prev" || interaction.customId === "help_next")
        ) {
            void (async () => {
                try {
                    const pageButton = interaction.message?.components
                        ?.flatMap(row => row.components ?? [])
                        ?.find(component => component.customId?.startsWith("help_page_"));

                    const match = pageButton?.customId?.match(/help_page_(\\d+)/);
                    let page = match ? Number(match[1]) : 0;

                    if (interaction.customId === "help_prev") page -= 1;
                    if (interaction.customId === "help_next") page += 1;

                    await interaction.update(helpPayload(page));
                } catch (error) {
                    console.error("[VC+ HELP NAVIGATION]", error);
                }
            })();

            // Do not emit this help interaction to the normal VC button handler.
            // This guarantees help navigation never checks the user's voice state.
            return true;
        }
    }

    return originalEmit.call(this, eventName, ...args);
};
