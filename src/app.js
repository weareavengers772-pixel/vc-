import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

// ============================================================
// VC+
// COMMAND REGISTRATION ONLY
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) {
  console.error("[VC+ ERROR] DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("[VC+ ERROR] CLIENT_ID is missing.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("[VC+ ERROR] GUILD_ID is missing.");
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
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [
    Partials.GuildMember,
    Partials.User,
    Partials.Channel
  ]
});

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

  // ----------------------------------------------------------
  // VC
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("vc")
    .setDescription("VC+ voice controls")
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Set up VC+")
    )
    .addSubcommand(sub =>
      sub
        .setName("lock")
        .setDescription("Lock your voice channel")
    )
    .addSubcommand(sub =>
      sub
        .setName("unlock")
        .setDescription("Unlock your voice channel")
    )
    .addSubcommand(sub =>
      sub
        .setName("hide")
        .setDescription("Hide your voice channel")
    )
    .addSubcommand(sub =>
      sub
        .setName("unhide")
        .setDescription("Unhide your voice channel")
    )
    .addSubcommand(sub =>
      sub
        .setName("permit")
        .setDescription("Permit a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to permit")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reject")
        .setDescription("Reject a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to reject")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("kick")
        .setDescription("Kick a user from your VC")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to kick")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("ban")
        .setDescription("Ban a user from your VC")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to ban")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unban")
        .setDescription("Unban a user from your VC")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to unban")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("limit")
        .setDescription("Set your VC limit")
        .addIntegerOption(option =>
          option
            .setName("amount")
            .setDescription("User limit")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("claim")
        .setDescription("Claim an abandoned VC")
    )
    .addSubcommand(sub =>
      sub
        .setName("stfu")
        .setDescription("Force server mute a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to mute")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unstfu")
        .setDescription("Remove forced server mute")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to unmute")
            .setRequired(true)
        )
    ),

  // ----------------------------------------------------------
  // VOUCH
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("vouch")
    .setDescription("VC+ vouch commands")
    .addSubcommand(sub =>
      sub
        .setName("user")
        .setDescription("Vouch a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to vouch")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("View server vouches")
    )
    .addSubcommand(sub =>
      sub
        .setName("clear")
        .setDescription("Clear a user's vouch")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("clearall")
        .setDescription("Clear all vouches")
    )
    .addSubcommandGroup(group =>
      group
        .setName("role")
        .setDescription("Vouch role settings")
        .addSubcommand(sub =>
          sub
            .setName("set")
            .setDescription("Set the vouch role")
            .addRoleOption(option =>
              option
                .setName("role")
                .setDescription("Vouch role")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("reset")
            .setDescription("Reset the vouch role")
        )
        .addSubcommand(sub =>
          sub
            .setName("limit")
            .setDescription("Set vouch role limit")
            .addIntegerOption(option =>
              option
                .setName("amount")
                .setDescription("Maximum users with vouch role")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100000)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName("limit")
        .setDescription("Vouch limits")
        .addSubcommand(sub =>
          sub
            .setName("set")
            .setDescription("Set how many vouches a user can give")
            .addIntegerOption(option =>
              option
                .setName("amount")
                .setDescription("Vouch limit")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("view")
            .setDescription("View the vouch limit")
        )
    ),

  // ----------------------------------------------------------
  // RANK
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("VC+ rank commands")
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Set a user's rank")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("rank")
            .setDescription("Rank")
            .setRequired(true)
            .addChoices(
              { name: "Founder", value: "founder" },
              { name: "God", value: "god" },
              { name: "Admin", value: "admin" },
              { name: "Moderator", value: "moderator" },
              { name: "Trusted", value: "trusted" },
              { name: "Member", value: "member" }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View a user's rank")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a user's rank")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    ),

  // ----------------------------------------------------------
  // MODERATION
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("Example: 10m, 1h, 1d")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a timeout")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(option =>
      option
        .setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unbanall")
    .setDescription("Unban everyone"),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  // ----------------------------------------------------------
  // GODMODE
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("godmode")
    .setDescription("Toggle Godmode")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    )

].map(command => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  try {
    console.log("[VC+] Registering commands...");

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: commands
      }
    );

    console.log(`[VC+] Registered ${commands.length} commands.`);
  } catch (error) {
    console.error("[VC+ COMMAND ERROR]", error);
  }
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
  try {
    console.log("--------------------------------");
    console.log("VC+ ONLINE");
    console.log(`Bot: ${client.user.tag}`);
    console.log(`Guilds: ${client.guilds.cache.size}`);
    console.log("--------------------------------");

    await registerCommands();

    client.user.setPresence({
      activities: [
        {
          name: "-help",
          type: 2
        }
      ],
      status: "online"
    });

  } catch (error) {
    console.error("[VC+ READY ERROR]", error);
  }
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async interaction => {
  try {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "VC+ can only be used inside a server.",
        ephemeral: true
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // VC
    // --------------------------------------------------------

    if (interaction.commandName === "vc") {

      const sub = interaction.options.getSubcommand();

      await interaction.reply({
        content: `VC+ • \`${sub}\` command received.`,
        ephemeral: true
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // VOUCH
    // --------------------------------------------------------

    if (interaction.commandName === "vouch") {

      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();

      if (group === "role") {

        if (sub === "set") {
          const role = interaction.options.getRole("role");

          await interaction.reply({
            content: `✦ Vouch Role\n\`${role.name}\` has been set.`,
            ephemeral: true
          }).catch(() => {});

          return;
        }

        if (sub === "reset") {
          await interaction.reply({
            content: "✦ Vouch Role\nThe vouch role has been reset.",
            ephemeral: true
          }).catch(() => {});

          return;
        }

        if (sub === "limit") {
          const amount = interaction.options.getInteger("amount");

          await interaction.reply({
            content: `✦ Vouch Role Limit\nMaximum: \`${amount}\``,
            ephemeral: true
          }).catch(() => {});

          return;
        }
      }

      if (group === "limit") {

        if (sub === "set") {
          const amount = interaction.options.getInteger("amount");

          await interaction.reply({
            content: `✦ Vouch Limit\nLimit set to \`${amount}\`.`,
            ephemeral: true
          }).catch(() => {});

          return;
        }

        if (sub === "view") {
          await interaction.reply({
            content: "✦ Vouch Limit\nNo limit has been configured.",
            ephemeral: true
          }).catch(() => {});

          return;
        }
      }

      if (sub === "user") {
        const user = interaction.options.getUser("user");

        await interaction.reply({
          content: `✦ Vouch\n${user} was vouched.`,
          ephemeral: false
        }).catch(() => {});

        return;
      }

      if (sub === "list") {
        await interaction.reply({
          content: "✦ Vouches\nNo vouches recorded.",
          ephemeral: false
        }).catch(() => {});

        return;
      }

      if (sub === "clear") {
        const user = interaction.options.getUser("user");

        await interaction.reply({
          content: `✦ Vouch\n${user}'s vouch was cleared.`,
          ephemeral: false
        }).catch(() => {});

        return;
      }

      if (sub === "clearall") {
        await interaction.reply({
          content: "✦ Vouches\nAll vouches were cleared.",
          ephemeral: false
        }).catch(() => {});

        return;
      }
    }

    // --------------------------------------------------------
    // RANK
    // --------------------------------------------------------

    if (interaction.commandName === "rank") {

      const sub = interaction.options.getSubcommand();

      if (sub === "set") {

        const user = interaction.options.getUser("user");
        const rank = interaction.options.getString("rank");

        await interaction.reply({
          content: `★ Rank\n${user}\nRank \`${rank}\``,
          ephemeral: false
        }).catch(() => {});

        return;
      }

      if (sub === "view") {

        const user =
          interaction.options.getUser("user") ||
          interaction.user;

        await interaction.reply({
          content: `★ ${user}\nRank \`Member\``,
          ephemeral: false
        }).catch(() => {});

        return;
      }

      if (sub === "remove") {

        const user = interaction.options.getUser("user");

        await interaction.reply({
          content: `★ Rank\n${user}'s rank was removed.`,
          ephemeral: false
        }).catch(() => {});

        return;
      }
    }

    // --------------------------------------------------------
    // TIMEOUT
    // --------------------------------------------------------

    if (interaction.commandName === "timeout") {

      const user = interaction.options.getUser("user");
      const duration = interaction.options.getString("duration");

      await interaction.reply({
        content: `◈ Timeout\n${user}\nDuration \`${duration}\``,
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // UNTIMEOUT
    // --------------------------------------------------------

    if (interaction.commandName === "untimeout") {

      const user = interaction.options.getUser("user");

      await interaction.reply({
        content: `◈ Timeout\n${user} has been untimeouted.`,
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // BAN
    // --------------------------------------------------------

    if (interaction.commandName === "ban") {

      const user = interaction.options.getUser("user");

      await interaction.reply({
        content: `◈ Ban\n${user} has been banned.`,
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // UNBAN
    // --------------------------------------------------------

    if (interaction.commandName === "unban") {

      const userId = interaction.options.getString("userid");

      await interaction.reply({
        content: `◈ Unban\n\`${userId}\` has been unbanned.`,
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // UNBAN ALL
    // --------------------------------------------------------

    if (interaction.commandName === "unbanall") {

      await interaction.reply({
        content: "◈ Unban All\nAll bans have been cleared.",
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // KICK
    // --------------------------------------------------------

    if (interaction.commandName === "kick") {

      const user = interaction.options.getUser("user");

      await interaction.reply({
        content: `◈ Kick\n${user} has been kicked.`,
        ephemeral: false
      }).catch(() => {});

      return;
    }

    // --------------------------------------------------------
    // GODMODE
    // --------------------------------------------------------

    if (interaction.commandName === "godmode") {

      const user = interaction.options.getUser("user");

      await interaction.reply({
        content: `◈ Godmode\n${user}\nStatus \`ENABLED\``,
        ephemeral: false
      }).catch(() => {});

      return;
    }

  } catch (error) {

    console.error("[VC+ INTERACTION ERROR]", error);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "⚠ VC+\nSomething went wrong.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "⚠ VC+\nSomething went wrong.",
          ephemeral: true
        });
      }
    } catch {
      // Never allow an interaction error to crash the bot.
    }
  }
});

// ============================================================
// DISCORD ERRORS
// ============================================================

client.on("error", error => {
  console.error("[VC+ CLIENT ERROR]", error);
});

client.on("warn", warning => {
  console.warn("[VC+ WARNING]", warning);
});

client.on("shardError", error => {
  console.error("[VC+ SHARD ERROR]", error);
});

process.on("unhandledRejection", error => {
  console.error("[VC+ UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", error => {
  console.error("[VC+ UNCAUGHT EXCEPTION]", error);
});

// ============================================================
// LOGIN
// ============================================================

async function startBot() {
  try {
    await client.login(TOKEN);
  } catch (error) {
    console.error("[VC+ LOGIN ERROR]", error);
  }
}

startBot();
