import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const HELP_PAGES = [
{ name: "General", description: "-help\nOpen the VC+ help panel.\n\n-ping\nCheck bot latency.\n\n-config\nView VC+ server configuration." },
{ name: "Moderation", description: "-ban @user [reason]\nServer owner only.\n\n-unban USER_ID\nUnban a user.\n\n-unbanall\nUnban everyone.\n\n-kick @user [reason]\nKick a member.\n\n-timeout @user 10m [reason]\nTimeout a member.\n\n-untimeout @user\nRemove a timeout.\n\n-foreverban @user [reason]\nVC+ permanent ban.\n\n-unforeverban USER_ID\nRemove a VC+ permanent ban.\n\n-purge 1-100\nDelete messages.\n\n-clear 1-100\nAlias for purge.\n\n-warn @user reason\nWarn a member.\n\n-warnings @user\nView warnings.\n\n-clearwarnings @user\nClear warnings.\n\n-modlogs\nView moderation logs." },
{ name: "Ranks", description: "-rank @user\nView rank.\n\n-rank @user <rank>\nSet rank.\n\n-ranklist\nView rank hierarchy.\n\n-removerank @user\nServer owner only. Remove VC+ rank.\n\nFounder 10\nGod 9\nOwner 8\nCo-Owner 7\nExecutive 6\nDirector 5\nAdmin 4\nModerator 3\nStaff 2\nMember 1" },
{ name: "Godmode", description: "-godmode @user\nGive internal Godmode.\n\n-godmode remove @user\nRemove internal Godmode." },
{ name: "Vouches", description: "-vouch set role @Role\nSet automatic vouch role.\n\n-vouch role\nView vouch role.\n\n-vouch give @user reason\nGive a vouch and assign role.\n\n-vouch remove @user\nRemove a vouch.\n\n-vouch clear @user\nClear user's vouches and role.\n\n-vouch clear everyone\nClear all vouches and roles.\n\n-vouch list\nView vouches.\n\n-vouches @user\nView vouch count and history." },
{ name: "Voice", description: "-vc setup\nServer owner only. Create Join-to-Create.\n\n-vc kick @user\nDisconnect user.\n\n-vc disconnect @user\nDisconnect user.\n\n-vc ban @user\nBan user from VC.\n\n-vc reject @user\nReject user.\n\n-vc permit @user\nPermit user.\n\n-vc deny @user\nDeny user.\n\n-vc lock\nLock VC.\n\n-vc unlock\nUnlock VC.\n\n-vc limit <number>\nSet limit.\n\n-vc name <name>\nRename VC.\n\n-vc rename <name>\nRename VC.\n\n-vc bitrate <number>\nSet bitrate.\n\n-vc region <region>\nSet region.\n\n-vc hide\nHide VC.\n\n-vc unhide\nShow VC." },
{ name: "Voice Control", description: "-vc owner\nView VC owner.\n\n-vc info\nView VC information.\n\n-vc transfer @user\nTransfer ownership.\n\n-vc claim\nClaim abandoned VC.\n\n-vc forceclaim\nForce claim VC.\n\n-vc reset\nReset supported VC settings.\n\n-vc stfu @user\nFounder and God only. Server mute.\n\n-vc unstfu @user\nFounder and God only. Remove server mute." },
{ name: "Filter", description: "-filter add word\nAdd filtered word.\n\n-filter remove word\nRemove filtered word." },
{ name: "Staff", description: "-staff\nView staff information.\n\n-stafflist\nView staff members.\n\n-note @user <note>\nAdd staff note.\n\n-notes @user\nView staff notes." },
{ name: "Users", description: "-userinfo @user\nView user information.\n\n-serverinfo\nView server information.\n\n-avatar @user\nView avatar.\n\n-banner @user\nView banner.\n\n-roles @user\nView roles." },
{ name: "Setup", description: "-vc setup\nCreate Join-to-Create.\n\n-interface\nCreate VC+ server interface.\n\n-vouch set role @Role\nConfigure vouch role.\n\n-config\nView configuration." }
];

function helpPayload(page) {
    const safePage = ((page % HELP_PAGES.length) + HELP_PAGES.length) % HELP_PAGES.length;
    const current = HELP_PAGES[safePage];
    return {
        embeds: [new EmbedBuilder().setTitle(`VC+ | ${current.name}`).setDescription(`\\`\\`\\`\n${current.description}\n\\`\\`\\``).setFooter({ text: `Page ${safePage + 1}/${HELP_PAGES.length} | VC+` })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("help_prev").setLabel("<").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`help_page_${safePage}`).setLabel(`${safePage + 1}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId("help_next").setLabel(">").setStyle(ButtonStyle.Secondary)
        )]
    };
}

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function patchedEmit(eventName, ...args) {
    if (eventName === "interactionCreate") {
        const interaction = args[0];
        if (interaction?.isButton?.() && (interaction.customId === "help_prev" || interaction.customId === "help_next")) {
            void (async () => {
                try {
                    const pageButton = interaction.message?.components?.flatMap(row => row.components ?? [])?.find(component => component.customId?.startsWith("help_page_"));
                    const match = pageButton?.customId?.match(/help_page_(\\d+)/);
                    let page = match ? Number(match[1]) : 0;
                    if (interaction.customId === "help_prev") page -= 1;
                    if (interaction.customId === "help_next") page += 1;
                    await interaction.update(helpPayload(page));
                } catch (error) {
                    console.error("[VC+ HELP NAVIGATION]", error);
                }
            })();
            return true;
        }
    }
    return originalEmit.call(this, eventName, ...args);
};
