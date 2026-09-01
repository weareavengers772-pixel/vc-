```js
import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";

import { InteractionHelper } from "../../utils/interactionHelper.js";
import { createEmbed } from "../../utils/embeds.js";
import { createSelectMenu } from "../../utils/components.js";
import { logger } from "../../utils/logger.js";

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";

const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;

function formatCategoryName(rawCategory) {
    return rawCategory
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function createInitialHelpMenu(client) {
    const commandsPath = path.join(__dirname, "../../commands");

    const categoryDirs = (
        await fs.readdir(commandsPath, {
            withFileTypes: true,
        })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: "All Commands",
            description: "Browse every available command",
            value: ALL_COMMANDS_ID,
        },

        ...categoryDirs.map((category) => {
            const categoryName =
                formatCategoryName(category);

            return {
                label: categoryName,
                description:
                    `View commands in the ${categoryName} category`,
                value: category,
            };
        }),
    ];

    const botName =
        client?.user?.username || "Bot";

    const embed = createEmbed({
        title: `${botName} Help`,

        description:
            "Set up your server, configure your systems, and browse commands below.",

        color: "primary",

        thumbnail:
            client?.user?.displayAvatarURL?.({
                size: 1024,
            }),

        fields: [
            {
                name: "Getting Started",

                value: [
                    "**1. Launch setup** — Run `/configwizard` to configure your server.",
                    "**2. Enable systems** — Use `/commands dashboard` to manage features.",
                    "**3. Browse commands** — Select a category below.",
                ].join("\n"),

                inline: false,
            },

            {
                name: "How It Works",

                value: [
                    "• Dashboard commands manage each feature.",
                    "• Settings are saved per server.",
                    "• Slash commands and prefix commands are supported.",
                    "• Prefix commands use `-`.",
                ].join("\n"),

                inline: false,
            },

            {
                name: "\u200B",

                value:
                    `-# ${botName} is [open source](https://youtu.be/1jCZX8s3bJE?si=NPOYx-vxVE1I5vJK)`,

                inline: false,
            },
        ],
    });

    embed.setFooter({
        text: "Made with ❤️",
    });

    embed.setTimestamp();

    const bugReportButton =
        new ButtonBuilder()
            .setCustomId(
                BUG_REPORT_BUTTON_ID
            )
            .setLabel("Report Bug")
            .setStyle(ButtonStyle.Danger);

    const supportButton =
        new ButtonBuilder()
            .setLabel("Support Server")
            .setURL(
                "https://discord.gg/QnWNz2dKCE"
            )
            .setStyle(ButtonStyle.Link);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Select to view the commands",
        options
    );

    const buttonRow =
        new ActionRowBuilder().addComponents(
            bugReportButton,
            supportButton
        );

    return {
        embeds: [embed],
        components: [
            buttonRow,
            selectRow,
        ],
    };
}

export default {
    slashOnly: false,

    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription(
            "Displays the help menu with all available commands"
        ),

    async execute(
        interaction,
        guildConfig,
        client
    ) {
        try {
            await InteractionHelper.safeDefer(
                interaction
            );

            const {
                embeds,
                components,
            } =
                await createInitialHelpMenu(
                    client
                );

            await InteractionHelper.safeEditReply(
                interaction,
                {
                    embeds,
                    components,
                }
            );

            setTimeout(async () => {
                try {
                    if (
                        !InteractionHelper.isInteractionValid(
                            interaction
                        )
                    ) {
                        return;
                    }

                    const closedEmbed =
                        createEmbed({
                            title:
                                "Help menu closed",

                            description:
                                "Help menu has been closed. Use -help again.",

                            color: "secondary",
                        });

                    await InteractionHelper.safeEditReply(
                        interaction,
                        {
                            embeds: [
                                closedEmbed,
                            ],
                            components: [],
                        }
                    );
                } catch (error) {
                    logger.debug(
                        "Help menu close failed:",
                        error?.message
                    );
                }
            }, HELP_MENU_TIMEOUT_MS);

        } catch (error) {
            logger.error(
                "Help command failed:",
                error
            );

            try {
                await InteractionHelper.safeEditReply(
                    interaction,
                    {
                        content:
                            "The help command encountered an error.",

                        embeds: [],

                        components: [],
                    }
                );
            } catch {
                // Prevent a second error from causing another crash.
            }
        }
    },
};
```
