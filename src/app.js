import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent
} from "discord.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* =========================================================
   VC+
   ========================================================= */

const BOT_NAME = "VC+";
const VERSION = "1.0.0";
const PREFIX = "-";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "vcplus.json");

/* =========================================================
   CLIENT
   ========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks
  ],

  partials: [
    Partials.GuildMember,
    Partials.Channel,
    Partials.Message
  ]
});

/* =========================================================
   DATABASE
   ========================================================= */

function defaultGuild() {
  return {
    prefix: PREFIX,

    vc: {
      categoryId: null,
      triggerId: null,
      owners: {},
      channels: {}
    },

    vouches: {},
    vouchRole: null,

    ranks: {},

    security: {
      enabled: false,

      whitelist: [],

      protectedRoles: [],

      punishment: "both",

      logs: null,

      limits: {
        ban: 3,
        kick: 3,
        role: 3,
        channel: 3,
        webhook: 3
      },

      actions: {
        ban: [],
        kick: [],
        role: [],
        channel: [],
        webhook: []
      }
    }
  };
}

let db = {};

/* =========================================================
   DATABASE LOAD
   ========================================================= */

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
      db = {};
      saveDatabase();
      return;
    }

    const raw = fs.readFileSync(DATA_FILE, "utf8");

    if (!raw.trim()) {
      db = {};
      return;
    }

    db = JSON.parse(raw);

    if (!db || typeof db !== "object") {
      db = {};
    }

  } catch (error) {
    console.error("[VC+ DATABASE LOAD ERROR]", error);
    db = {};
  }
}

/* =========================================================
   DATABASE SAVE
   ========================================================= */

let saveQueue = Promise.resolve();

function saveDatabase() {
  saveQueue = saveQueue
    .then(async () => {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        const tempFile = `${DATA_FILE}.tmp`;

        fs.writeFileSync(
          tempFile,
          JSON.stringify(db, null, 2),
          "utf8"
        );

        fs.renameSync(tempFile, DATA_FILE);
      } catch (error) {
        console.error("[VC+ DATABASE SAVE ERROR]", error);
      }
    })
    .catch(error => {
      console.error("[VC+ SAVE QUEUE ERROR]", error);
    });

  return saveQueue;
}

/* =========================================================
   GUILD DATA
   ========================================================= */

function getGuildData(guildId) {
  if (!db[guildId]) {
    db[guildId] = defaultGuild();
  }

  const data = db[guildId];

  data.vc ??= {
    categoryId: null,
    triggerId: null,
    owners: {},
    channels: {}
  };

  data.vc.owners ??= {};
  data.vc.channels ??= {};

  data.vouches ??= {};
  data.ranks ??= {};

  data.security ??= {};
  data.security.enabled ??= false;
  data.security.whitelist ??= [];
  data.security.protectedRoles ??= [];
  data.security.punishment ??= "both";
  data.security.logs ??= null;

  data.security.limits ??= {};
  data.security.limits.ban ??= 3;
  data.security.limits.kick ??= 3;
  data.security.limits.role ??= 3;
  data.security.limits.channel ??= 3;
  data.security.limits.webhook ??= 3;

  data.security.actions ??= {};
  data.security.actions.ban ??= [];
  data.security.actions.kick ??= [];
  data.security.actions.role ??= [];
  data.security.actions.channel ??= [];
  data.security.actions.webhook ??= [];

  return data;
}

/* =========================================================
   MESSAGE STYLE
   ========================================================= */

function box(message, type = "error") {
  const symbol = type === "success" ? "✓" : "⚠";

  return [
    "╭─ vc+",
    "│",
    `│ ${symbol} ${message}`,
    "╰─ vc+"
  ].join("\n");
}

function success(message) {
  return box(message, "success");
}

function error(message) {
  return box(message, "error");
}

/* =========================================================
   SAFE REPLY
   ========================================================= */

async function reply(message, content) {
  try {
    if (!message.channel) return;

    return await message.reply({
      content,
      allowedMentions: {
        repliedUser: false
      }
    });
  } catch (err) {
    console.error("[VC+ REPLY ERROR]", err);
  }
}

/* =========================================================
   PERMISSIONS
   ========================================================= */

function isServerOwner(message) {
  return message.guild?.ownerId === message.author.id;
}

function getRank(message) {
  if (!message.guild) return "member";

  if (isServerOwner(message)) {
    return "founder";
  }

  const data = getGuildData(message.guild.id);

  return (
    data.ranks[message.author.id]?.toLowerCase() ||
    "member"
  );
}

function isFounder(message) {
  return (
    isServerOwner(message) ||
    getRank(message) === "founder"
  );
}

function isGod(message) {
  return (
    isFounder(message) ||
    getRank(message) === "god"
  );
}

function hasDiscordPermission(message, permission) {
  try {
    return message.member?.permissions?.has(permission) ?? false;
  } catch {
    return false;
  }
}

function canModerate(message) {
  return (
    isFounder(message) ||
    hasDiscordPermission(
      message,
      PermissionsBitField.Flags.ManageGuild
    )
  );
}

/* =========================================================
   ROLE SAFETY
   ========================================================= */

function canBotManageRole(guild, role) {
  try {
    const me = guild.members.me;

    if (!me || !role) return false;
    if (role.managed) return false;

    return role.position < me.roles.highest.position;
  } catch {
    return false;
  }
}

/* =========================================================
   VOUCH ROLE
   ========================================================= */

async function giveVouchRole(member) {
  try {
    if (!member?.guild) return false;

    const data = getGuildData(member.guild.id);

    if (!data.vouchRole) {
      return true;
    }

    const role = member.guild.roles.cache.get(
      data.vouchRole
    );

    if (!role) {
      data.vouchRole = null;
      await saveDatabase();
      return false;
    }

    if (!canBotManageRole(member.guild, role)) {
      return false;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(
        role,
        "VC+ automatic vouch role"
      );
    }

    return true;

  } catch (err) {
    console.error("[VC+ VOUCH ROLE ERROR]", err);
    return false;
  }
}

async function removeVouchRole(member) {
  try {
    if (!member?.guild) return false;

    const data = getGuildData(member.guild.id);

    if (!data.vouchRole) {
      return true;
    }

    const role = member.guild.roles.cache.get(
      data.vouchRole
    );

    if (!role) {
      data.vouchRole = null;
      await saveDatabase();
      return true;
    }

    if (!canBotManageRole(member.guild, role)) {
      return false;
    }

    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(
        role,
        "VC+ vouch removed"
      );
    }

    return true;

  } catch (err) {
    console.error("[VC+ REMOVE VOUCH ROLE ERROR]", err);
    return false;
  }
}

/* =========================================================
   VOUCH COMMAND
   ========================================================= */

async function handleVouch(message, args) {
  const guild = message.guild;

  if (!guild) return;

  const data = getGuildData(guild.id);

  /* ---------------------------------------------
     ROLE
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "role") {
    if (!isFounder(message)) {
      return reply(message, error("Founder only."));
    }

    const action = args[1]?.toLowerCase();

    if (action === "set") {
      const role =
        message.mentions.roles.first() ||
        guild.roles.cache.get(args[2]);

      if (!role) {
        return reply(
          message,
          error("mention a valid role.")
        );
      }

      if (role.managed) {
        return reply(
          message,
          error("that role is managed by Discord.")
        );
      }

      if (!canBotManageRole(guild, role)) {
        return reply(
          message,
          error("move that role below my bot role.")
        );
      }

      data.vouchRole = role.id;

      await saveDatabase();

      return reply(
        message,
        success(`vouch role set to ${role}.`)
      );
    }

    if (action === "reset") {
      data.vouchRole = null;

      await saveDatabase();

      return reply(
        message,
        success("vouch role reset.")
      );
    }

    return reply(
      message,
      error(
        "use `-vouch role set @role` or `-vouch role reset`."
      )
    );
  }

  /* ---------------------------------------------
     INFO
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "info") {
    const member =
      message.mentions.members.first() ||
      guild.members.cache.get(args[1]);

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    const count = data.vouches[member.id] || 0;

    return reply(
      message,
      `╭─ vc+\n│\n│ ${member} has **${count}** vouch${count === 1 ? "" : "es"}.\n╰─ vc+`
    );
  }

  /* ---------------------------------------------
     LIST
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "list") {
    const entries = Object.entries(data.vouches);

    if (!entries.length) {
      return reply(
        message,
        box("no vouches yet.")
      );
    }

    const lines = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, count], index) => {
        return `│ ${index + 1}. <@${id}> — **${count}**`;
      });

    return reply(
      message,
      [
        "╭─ vouches",
        "│",
        ...lines,
        "╰─ vc+"
      ].join("\n")
    );
  }

  /* ---------------------------------------------
     CLEAR ALL
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "clearall") {
    if (!isFounder(message)) {
      return reply(
        message,
        error("Founder only.")
      );
    }

    data.vouches = {};

    await saveDatabase();

    if (data.vouchRole) {
      const role = guild.roles.cache.get(
        data.vouchRole
      );

      if (role) {
        for (const [, member] of role.members) {
          try {
            await removeVouchRole(member);
          } catch (err) {
            console.error(
              "[VC+ CLEARALL ROLE ERROR]",
              err
            );
          }
        }
      }
    }

    return reply(
      message,
      success("all vouches cleared.")
    );
  }

  /* ---------------------------------------------
     CLEAR USER
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "clear") {
    if (!isFounder(message)) {
      return reply(
        message,
        error("Founder only.")
      );
    }

    const member =
      message.mentions.members.first() ||
      guild.members.cache.get(args[1]);

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    delete data.vouches[member.id];

    await saveDatabase();

    await removeVouchRole(member);

    return reply(
      message,
      success(`cleared all vouches from ${member}.`)
    );
  }

  /* ---------------------------------------------
     REMOVE
     --------------------------------------------- */

  if (args[0]?.toLowerCase() === "remove") {
    if (!isFounder(message)) {
      return reply(
        message,
        error("Founder only.")
      );
    }

    const member =
      message.mentions.members.first() ||
      guild.members.cache.get(args[1]);

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    const count = data.vouches[member.id] || 0;

    if (count <= 0) {
      return reply(
        message,
        error(`${member.user.username} has no vouches.`)
      );
    }

    if (count === 1) {
      delete data.vouches[member.id];
    } else {
      data.vouches[member.id] = count - 1;
    }

    await saveDatabase();

    /*
     * Keep role if they still have vouches.
     */
    if (!data.vouches[member.id]) {
      await removeVouchRole(member);
    }

    return reply(
      message,
      success(`removed a vouch from ${member}.`)
    );
  }

  /* ---------------------------------------------
     ADD VOUCH
     --------------------------------------------- */

  const member =
    message.mentions.members.first() ||
    guild.members.cache.get(args[0]);

  if (!member) {
    return reply(
      message,
      error("mention a user.")
    );
  }

  if (member.id === message.author.id) {
    return reply(
      message,
      error("you can't vouch for yourself.")
    );
  }

  data.vouches[member.id] =
    (data.vouches[member.id] || 0) + 1;

  await saveDatabase();

  /*
   * AUTOMATICALLY GIVE VOUCH ROLE
   */
  const roleSuccess = await giveVouchRole(member);

  if (data.vouchRole && !roleSuccess) {
    return reply(
      message,
      success(
        `vouched ${member}, but I couldn't give the vouch role.`
      )
    );
  }

  return reply(
    message,
    success(`vouched ${member}.`)
  );
}

/* =========================================================
   VC SETUP
   ========================================================= */

async function vcSetup(message) {
  const guild = message.guild;

  if (!guild) return;

  if (!canModerate(message)) {
    return reply(
      message,
      error("you can't use this command.")
    );
  }

  const data = getGuildData(guild.id);

  try {
    let category = null;
    let trigger = null;

    if (data.vc.categoryId) {
      category =
        guild.channels.cache.get(
          data.vc.categoryId
        ) || null;
    }

    if (!category) {
      category = await guild.channels.create({
        name: "VC+",
        type: ChannelType.GuildCategory
      });

      data.vc.categoryId = category.id;
    }

    if (data.vc.triggerId) {
      trigger =
        guild.channels.cache.get(
          data.vc.triggerId
        ) || null;
    }

    if (!trigger) {
      trigger = await guild.channels.create({
        name: "Join to Create",
        type: ChannelType.GuildVoice,
        parent: category.id
      });

      data.vc.triggerId = trigger.id;
    }

    await saveDatabase();

    return reply(
      message,
      success("VC+ voice system is ready.")
    );

  } catch (err) {
    console.error("[VC+ VC SETUP ERROR]", err);

    return reply(
      message,
      error(
        "I couldn't finish the VC setup. Check my Manage Channels permission."
      )
    );
  }
}

/* =========================================================
   VC RESET
   ========================================================= */

async function vcReset(message) {
  if (!canModerate(message)) {
    return reply(
      message,
      error("you can't use this command.")
    );
  }

  const data = getGuildData(message.guild.id);

  try {
    for (const channelId of Object.keys(
      data.vc.channels
    )) {
      const channel =
        message.guild.channels.cache.get(channelId);

      if (channel) {
        try {
          await channel.delete(
            "VC+ reset"
          );
        } catch {}
      }
    }

    const trigger =
      message.guild.channels.cache.get(
        data.vc.triggerId
      );

    if (trigger) {
      try {
        await trigger.delete("VC+ reset");
      } catch {}
    }

    const category =
      message.guild.channels.cache.get(
        data.vc.categoryId
      );

    if (category) {
      try {
        await category.delete("VC+ reset");
      } catch {}
    }

    data.vc = {
      categoryId: null,
      triggerId: null,
      owners: {},
      channels: {}
    };

    await saveDatabase();

    return reply(
      message,
      success("VC+ voice system reset.")
    );

  } catch (err) {
    console.error("[VC+ VC RESET ERROR]", err);

    return reply(
      message,
      error("I couldn't reset the VC system.")
    );
  }
}

/* =========================================================
   FIND USER VC
   ========================================================= */

function getUserVC(guild, userId) {
  const data = getGuildData(guild.id);

  for (const [channelId, ownerId] of Object.entries(
    data.vc.owners
  )) {
    if (ownerId === userId) {
      return guild.channels.cache.get(channelId);
    }
  }

  return null;
}

/* =========================================================
   VC OWNERSHIP
   ========================================================= */

function canControlVC(message, channel) {
  if (!channel) return false;

  if (isFounder(message)) {
    return true;
  }

  const data = getGuildData(message.guild.id);

  return data.vc.owners[channel.id] === message.author.id;
}

/* =========================================================
   VC PANEL
   ========================================================= */

async function sendVCPanel(channel, ownerId) {
  try {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vc_lock")
        .setLabel("Lock")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_unlock")
        .setLabel("Unlock")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_hide")
        .setLabel("Hide")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_unhide")
        .setLabel("Unhide")
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vc_permit")
        .setLabel("Permit")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_reject")
        .setLabel("Reject")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_kick")
        .setLabel("Kick")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("vc_ban")
        .setLabel("Ban")
        .setStyle(ButtonStyle.Danger)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vc_unban")
        .setLabel("Unban")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_limit")
        .setLabel("Limit")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_claim")
        .setLabel("Claim")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("vc_ghost")
        .setLabel("Ghost")
        .setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      content:
        `╭─ vc+\n│\n│ **voice controls**\n│ owner — <@${ownerId}>\n│\n│ use the buttons below to manage your VC.\n╰─ vc+`,
      components: [
        row1,
        row2,
        row3
      ]
    });

  } catch (err) {
    console.error(
      "[VC+ PANEL ERROR]",
      err
    );
  }
}

/* =========================================================
   CREATE VC
   ========================================================= */

async function createTemporaryVC(member) {
  const guild = member.guild;
  const data = getGuildData(guild.id);

  if (!data.vc.categoryId) return;

  const category =
    guild.channels.cache.get(
      data.vc.categoryId
    );

  if (!category) return;

  try {
    const channel =
      await guild.channels.create({
        name: `${member.user.username}'s VC`,
        type: ChannelType.GuildVoice,
        parent: category.id
      });

    data.vc.owners[channel.id] =
      member.id;

    data.vc.channels[channel.id] =
      true;

    await saveDatabase();

    try {
      await member.voice.setChannel(channel);
    } catch {}

    await sendVCPanel(
      channel,
      member.id
    );

  } catch (err) {
    console.error(
      "[VC+ CREATE VC ERROR]",
      err
    );
  }
}

/* =========================================================
   DELETE EMPTY VCS
   ========================================================= */

async function cleanupVC(channel) {
  try {
    if (!channel?.guild) return;

    const data =
      getGuildData(channel.guild.id);

    if (!data.vc.owners[channel.id]) {
      return;
    }

    if (channel.members.size > 0) {
      return;
    }

    delete data.vc.owners[channel.id];
    delete data.vc.channels[channel.id];

    await saveDatabase();

    try {
      await channel.delete(
        "VC+ empty temporary VC"
      );
    } catch {}

  } catch (err) {
    console.error(
      "[VC+ CLEANUP ERROR]",
      err
    );
  }
}

/* =========================================================
   VC COMMANDS
   ========================================================= */

async function handleVC(message, args) {
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return reply(
      message,
      [
        "╭─ vc+",
        "│",
        "│ `-vc setup`",
        "│ `-vc reset`",
        "│ `-vc lock`",
        "│ `-vc unlock`",
        "│ `-vc hide`",
        "│ `-vc unhide`",
        "│ `-vc permit @user`",
        "│ `-vc reject @user`",
        "│ `-vc kick @user`",
        "│ `-vc ban @user`",
        "│ `-vc unban @user`",
        "│ `-vc limit 10`",
        "│ `-vc rename name`",
        "│ `-vc claim`",
        "│ `-vc ghost`",
        "│ `-vc unghost`",
        "╰─ vc+"
      ].join("\n")
    );
  }

  if (sub === "setup") {
    return vcSetup(message);
  }

  if (sub === "reset") {
    return vcReset(message);
  }

  const channel =
    message.member?.voice?.channel;

  if (!channel) {
    return reply(
      message,
      error("you aren't in a voice channel.")
    );
  }

  if (!canControlVC(message, channel)) {
    return reply(
      message,
      error("this isn't your VC.")
    );
  }

  const data = getGuildData(
    message.guild.id
  );

  if (sub === "lock") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          Connect: false
        }
      );

      return reply(
        message,
        success("VC locked.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't lock this VC.")
      );
    }
  }

  if (sub === "unlock") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          Connect: null
        }
      );

      return reply(
        message,
        success("VC unlocked.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't unlock this VC.")
      );
    }
  }

  if (sub === "hide") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          ViewChannel: false
        }
      );

      return reply(
        message,
        success("VC hidden.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't hide this VC.")
      );
    }
  }

  if (sub === "unhide") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          ViewChannel: null
        }
      );

      return reply(
        message,
        success("VC visible.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't unhide this VC.")
      );
    }
  }

  if (sub === "limit") {
    const amount = Number(args[1]);

    if (
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > 99
    ) {
      return reply(
        message,
        error("use a limit between 0 and 99.")
      );
    }

    try {
      await channel.setUserLimit(amount);

      return reply(
        message,
        success(`VC limit set to ${amount}.`)
      );
    } catch {
      return reply(
        message,
        error("I couldn't change the VC limit.")
      );
    }
  }

  if (sub === "rename") {
    const name = args
      .slice(1)
      .join(" ")
      .trim();

    if (!name) {
      return reply(
        message,
        error("give the VC a name.")
      );
    }

    if (name.length > 100) {
      return reply(
        message,
        error("that name is too long.")
      );
    }

    try {
      await channel.setName(name);

      return reply(
        message,
        success("VC renamed.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't rename this VC.")
      );
    }
  }

  if (
    ["permit", "reject", "kick", "ban", "unban"]
      .includes(sub)
  ) {
    const member =
      message.mentions.members.first() ||
      message.guild.members.cache.get(
        args[1]
      );

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    if (sub === "permit") {
      try {
        await channel.permissionOverwrites.edit(
          member.id,
          {
            Connect: true,
            ViewChannel: true
          }
        );

        return reply(
          message,
          success(`permitted ${member}.`)
        );
      } catch {
        return reply(
          message,
          error("I couldn't permit that user.")
        );
      }
    }

    if (sub === "reject") {
      try {
        await channel.permissionOverwrites.edit(
          member.id,
          {
            Connect: false
          }
        );

        return reply(
          message,
          success(`rejected ${member}.`)
        );
      } catch {
        return reply(
          message,
          error("I couldn't reject that user.")
        );
      }
    }

    if (sub === "kick") {
      try {
        if (member.voice.channelId === channel.id) {
          await member.voice.disconnect(
            "VC+ owner kick"
          );
        }

        return reply(
          message,
          success(`kicked ${member}.`)
        );
      } catch {
        return reply(
          message,
          error("I couldn't kick that user.")
        );
      }
    }

    if (sub === "ban") {
      try {
        await channel.permissionOverwrites.edit(
          member.id,
          {
            Connect: false
          }
        );

        if (member.voice.channelId === channel.id) {
          await member.voice.disconnect(
            "VC+ voice ban"
          );
        }

        return reply(
          message,
          success(`banned ${member} from this VC.`)
        );
      } catch {
        return reply(
          message,
          error("I couldn't ban that user.")
        );
      }
    }

    if (sub === "unban") {
      try {
        await channel.permissionOverwrites.delete(
          member.id
        );

        return reply(
          message,
          success(`unbanned ${member}.`)
        );
      } catch {
        return reply(
          message,
          error("I couldn't unban that user.")
        );
      }
    }
  }

  if (sub === "claim") {
    if (channel.members.size === 0) {
      return reply(
        message,
        error("this VC is empty.")
      );
    }

    data.vc.owners[channel.id] =
      message.author.id;

    await saveDatabase();

    return reply(
      message,
      success("you claimed this VC.")
    );
  }

  if (sub === "ghost") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          ViewChannel: false,
          Connect: false
        }
      );

      return reply(
        message,
        success("ghost mode enabled.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't enable ghost mode.")
      );
    }
  }

  if (sub === "unghost") {
    try {
      await channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        {
          ViewChannel: null,
          Connect: null
        }
      );

      return reply(
        message,
        success("ghost mode disabled.")
      );
    } catch {
      return reply(
        message,
        error("I couldn't disable ghost mode.")
      );
    }
  }

  return reply(
    message,
    error("unknown VC command.")
  );
}

/* =========================================================
   RANKS
   ========================================================= */

const RANKS = [
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

async function handleRank(message, args) {
  if (!args[0]) {
    return reply(
      message,
      [
        "╭─ ranks",
        "│",
        ...RANKS.map(
          (rank, i) =>
            `│ ${i + 1}. ${rank}`
        ),
        "╰─ vc+"
      ].join("\n")
    );
  }

  const action =
    args[0].toLowerCase();

  if (action === "list") {
    return reply(
      message,
      [
        "╭─ ranks",
        "│",
        ...RANKS.map(
          (rank, i) =>
            `│ ${i + 1}. ${rank}`
        ),
        "╰─ vc+"
      ].join("\n")
    );
  }

  if (action === "set") {
    if (!isFounder(message)) {
      return reply(
        message,
        error("Founder only.")
      );
    }

    const member =
      message.mentions.members.first() ||
      message.guild.members.cache.get(
        args[1]
      );

    const rank =
      args[2]?.toLowerCase();

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    if (!RANKS.includes(rank)) {
      return reply(
        message,
        error("invalid rank.")
      );
    }

    const data = getGuildData(
      message.guild.id
    );

    data.ranks[member.id] = rank;

    await saveDatabase();

    return reply(
      message,
      success(`set ${member}'s rank to ${rank}.`)
    );
  }

  if (action === "remove") {
    if (!isFounder(message)) {
      return reply(
        message,
        error("Founder only.")
      );
    }

    const member =
      message.mentions.members.first() ||
      message.guild.members.cache.get(
        args[1]
      );

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    const data = getGuildData(
      message.guild.id
    );

    delete data.ranks[member.id];

    await saveDatabase();

    return reply(
      message,
      success(`removed ${member}'s rank.`)
    );
  }

  const member =
    message.mentions.members.first() ||
    message.guild.members.cache.get(
      args[0]
    );

  if (!member) {
    return reply(
      message,
      error("user not found.")
    );
  }

  const data = getGuildData(
    message.guild.id
  );

  const rank =
    member.id === message.guild.ownerId
      ? "founder"
      : data.ranks[member.id] || "member";

  return reply(
    message,
    [
      "╭─ rank",
      "│",
      `│ ${member}`,
      `│ ${rank}`,
      "╰─ vc+"
    ].join("\n")
  );
}

/* =========================================================
   MODERATION
   ========================================================= */

async function handleModeration(
  message,
  command,
  args
) {
  if (!canModerate(message)) {
    return reply(
      message,
      error("you can't use this command.")
    );
  }

  const guild = message.guild;

  if (
    ["ban", "kick", "timeout", "untimeout"]
      .includes(command)
  ) {
    const member =
      message.mentions.members.first() ||
      guild.members.cache.get(args[0]);

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    if (
      member.id === guild.ownerId
    ) {
      return reply(
        message,
        error("you can't moderate the server owner.")
      );
    }

    if (
      message.member &&
      member.roles.highest.position >=
        message.member.roles.highest.position &&
      !isFounder(message)
    ) {
      return reply(
        message,
        error("that user is above your role.")
      );
    }

    const reason =
      args.slice(1).join(" ") ||
      "No reason provided";

    try {
      if (command === "ban") {
        await member.ban({
          reason: `VC+ — ${reason}`
        });

        return reply(
          message,
          success(`banned ${member}.`)
        );
      }

      if (command === "kick") {
        await member.kick(
          `VC+ — ${reason}`
        );

        return reply(
          message,
          success(`kicked ${member}.`)
        );
      }

      if (command === "timeout") {
        const minutes =
          Number(args[1]);

        if (
          !Number.isFinite(minutes) ||
          minutes <= 0 ||
          minutes > 40320
        ) {
          return reply(
            message,
            error(
              "timeout must be between 1 and 40320 minutes."
            )
          );
        }

        await member.timeout(
          minutes * 60 * 1000,
          `VC+ — ${reason}`
        );

        return reply(
          message,
          success(
            `timed out ${member} for ${minutes}m.`
          )
        );
      }

      if (command === "untimeout") {
        await member.timeout(
          null,
          "VC+ timeout removed"
        );

        return reply(
          message,
          success(`removed ${member}'s timeout.`)
        );
      }

    } catch (err) {
      console.error(
        `[VC+ ${command.toUpperCase()} ERROR]`,
        err
      );

      return reply(
        message,
        error(
          `I couldn't ${command} that user.`
        )
      );
    }
  }

  if (
    command === "unban"
  ) {
    const id = args[0];

    if (!id || !/^\d{17,20}$/.test(id)) {
      return reply(
        message,
        error("give me a valid user ID.")
      );
    }

    try {
      await guild.members.unban(
        id,
        "VC+ unban"
      );

      return reply(
        message,
        success(`unbanned ${id}.`)
      );
    } catch {
      return reply(
        message,
        error("I couldn't unban that user.")
      );
    }
  }

  if (
    command === "purge" ||
    command === "clear"
  ) {
    const amount =
      Number(args[0]);

    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > 100
    ) {
      return reply(
        message,
        error("choose a number between 1 and 100.")
      );
    }

    try {
      const deleted =
        await message.channel.bulkDelete(
          amount,
          true
        );

      const response =
        await message.channel.send(
          success(
            `cleared ${deleted.size} messages.`
          )
        );

      setTimeout(() => {
        response.delete().catch(() => {});
      }, 3000);

    } catch {
      return reply(
        message,
        error("I couldn't clear those messages.")
      );
    }
  }
}

/* =========================================================
   SECURITY
   ========================================================= */

function securityTrusted(guild, userId) {
  const data = getGuildData(guild.id);

  if (guild.ownerId === userId) {
    return true;
  }

  if (data.ranks[userId] === "founder") {
    return true;
  }

  return data.security.whitelist.includes(
    userId
  );
}

function securityRecord(
  guild,
  type,
  userId
) {
  const data = getGuildData(guild.id);

  const now = Date.now();

  data.security.actions[type] ??= [];

  data.security.actions[type] =
    data.security.actions[type].filter(
      x => now - x.time < 10000
    );

  data.security.actions[type].push({
    userId,
    time: now
  });

  return data.security.actions[type]
    .filter(
      x => x.userId === userId
    ).length;
}

async function securityLog(
  guild,
  text
) {
  try {
    const data = getGuildData(
      guild.id
    );

    if (!data.security.logs) return;

    const channel =
      guild.channels.cache.get(
        data.security.logs
      );

    if (!channel?.isTextBased()) {
      return;
    }

    await channel.send({
      content: text
    });

  } catch (err) {
    console.error(
      "[VC+ SECURITY LOG ERROR]",
      err
    );
  }
}

async function securityPunish(
  guild,
  userId
) {
  try {
    const data =
      getGuildData(guild.id);

    const member =
      await guild.members.fetch(
        userId
      ).catch(() => null);

    if (!member) return;

    const punishment =
      data.security.punishment;

    if (
      punishment === "roles" ||
      punishment === "both"
    ) {
      try {
        const manageable =
          member.roles.cache.filter(
            role =>
              role.id !== guild.id &&
              canBotManageRole(guild, role) &&
              !data.security.protectedRoles.includes(
                role.id
              )
          );

        if (manageable.size) {
          await member.roles.remove(
            manageable,
            "VC+ security"
          );
        }
      } catch (err) {
        console.error(
          "[VC+ SECURITY ROLE PUNISH ERROR]",
          err
        );
      }
    }

    if (
      punishment === "ban" ||
      punishment === "both"
    ) {
      try {
        await guild.members.ban(
          userId,
          {
            reason:
              "VC+ security — unauthorized action"
          }
        );
      } catch (err) {
        console.error(
          "[VC+ SECURITY BAN ERROR]",
          err
        );
      }
    }

    await securityLog(
      guild,
      [
        "╭─ security",
        "│",
        `│ ⚠ <@${userId}> tried to wiz your server.`,
        "│   user has been banned.",
        "╰─ vc+"
      ].join("\n")
    );

  } catch (err) {
    console.error(
      "[VC+ SECURITY PUNISH ERROR]",
      err
    );
  }
}

/* =========================================================
   SECURITY AUDIT LOG CHECK
   ========================================================= */

async function checkSecurity(
  guild,
  type,
  auditType
) {
  try {
    const data =
      getGuildData(guild.id);

    if (!data.security.enabled) {
      return;
    }

    const logs =
      await guild.fetchAuditLogs({
        type: auditType,
        limit: 1
      });

    const entry =
      logs.entries.first();

    if (!entry) return;

    const executor =
      entry.executor;

    if (!executor) return;

    /*
     * Ignore old entries.
     */
    if (
      Date.now() -
        entry.createdTimestamp >
      10000
    ) {
      return;
    }

    if (
      securityTrusted(
        guild,
        executor.id
      )
    ) {
      return;
    }

    const count =
      securityRecord(
        guild,
        type,
        executor.id
      );

    const limit =
      data.security.limits[type] ||
      3;

    if (count >= limit) {
      await securityPunish(
        guild,
        executor.id
      );
    }

  } catch (err) {
    console.error(
      `[VC+ SECURITY ${type.toUpperCase()} ERROR]`,
      err
    );
  }
}

/* =========================================================
   SECURITY COMMAND
   ========================================================= */

async function handleSecurity(
  message,
  args
) {
  if (!isFounder(message)) {
    return reply(
      message,
      error("Founder only.")
    );
  }

  const data =
    getGuildData(
      message.guild.id
    );

  const sub =
    args[0]?.toLowerCase();

  if (!sub || sub === "status") {
    return reply(
      message,
      [
        "╭─ security",
        "│",
        `│ status — ${data.security.enabled ? "enabled" : "disabled"}`,
        `│ punishment — ${data.security.punishment}`,
        `│ whitelist — ${data.security.whitelist.length}`,
        `│ logs — ${
          data.security.logs
            ? `<#${data.security.logs}>`
            : "not set"
        }`,
        "╰─ vc+"
      ].join("\n")
    );
  }

  if (sub === "setup") {
    data.security.enabled = true;

    await saveDatabase();

    return reply(
      message,
      success("security enabled.")
    );
  }

  if (sub === "enable") {
    data.security.enabled = true;

    await saveDatabase();

    return reply(
      message,
      success("security enabled.")
    );
  }

  if (sub === "disable") {
    data.security.enabled = false;

    await saveDatabase();

    return reply(
      message,
      success("security disabled.")
    );
  }

  if (sub === "whitelist") {
    const action =
      args[1]?.toLowerCase();

    const member =
      message.mentions.members.first() ||
      message.guild.members.cache.get(
        args[2]
      );

    if (
      action === "list"
    ) {
      if (!data.security.whitelist.length) {
        return reply(
          message,
          box("security whitelist is empty.")
        );
      }

      return reply(
        message,
        [
          "╭─ whitelist",
          "│",
          ...data.security.whitelist.map(
            id => `│ <@${id}>`
          ),
          "╰─ vc+"
        ].join("\n")
      );
    }

    if (!member) {
      return reply(
        message,
        error("user not found.")
      );
    }

    if (
      action === "add" ||
      action === "whitelist"
    ) {
      if (
        !data.security.whitelist.includes(
          member.id
        )
      ) {
        data.security.whitelist.push(
          member.id
        );
      }

      await saveDatabase();

      return reply(
        message,
        success(`whitelisted ${member}.`)
      );
    }

    if (
      action === "remove" ||
      action === "unwhitelist"
    ) {
      data.security.whitelist =
        data.security.whitelist.filter(
          id => id !== member.id
        );

      await saveDatabase();

      return reply(
        message,
        success(`removed ${member} from whitelist.`)
      );
    }
  }

  if (sub === "logs") {
    const channel =
      message.mentions.channels.first() ||
      message.guild.channels.cache.get(
        args[1]
      );

    if (!channel) {
      return reply(
        message,
        error("mention a text channel.")
      );
    }

    data.security.logs =
      channel.id;

    await saveDatabase();

    return reply(
      message,
      success(`security logs set to ${channel}.`)
    );
  }

  if (sub === "punishment") {
    const punishment =
      args[1]?.toLowerCase();

    if (
      !["roles", "ban", "both"]
        .includes(punishment)
    ) {
      return reply(
        message,
        error("use `roles`, `ban`, or `both`.")
      );
    }

    data.security.punishment =
      punishment;

    await saveDatabase();

    return reply(
      message,
      success(
        `security punishment set to ${punishment}.`
      )
    );
  }

  if (
    ["ban", "kick", "role", "channel", "webhook"]
      .includes(sub)
  ) {
    const limit =
      Number(args[1]);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return reply(
        message,
        error("choose a limit between 1 and 100.")
      );
    }

    data.security.limits[sub] =
      limit;

    await saveDatabase();

    return reply(
      message,
      success(
        `${sub} security limit set to ${limit}.`
      )
    );
  }

  if (sub === "reset") {
    data.security =
      defaultGuild().security;

    await saveDatabase();

    return reply(
      message,
      success("security reset.")
    );
  }

  return reply(
    message,
    [
      "╭─ security",
      "│",
      "│ `-security setup`",
      "│ `-security status`",
      "│ `-security enable`",
      "│ `-security disable`",
      "│ `-security whitelist add @user`",
      "│ `-security whitelist remove @user`",
      "│ `-security whitelist list`",
      "│ `-security logs #channel`",
      "│ `-security punishment roles`",
      "│ `-security punishment ban`",
      "│ `-security punishment both`",
      "│ `-security ban 3`",
      "│ `-security kick 3`",
      "│ `-security role 3`",
      "│ `-security channel 3`",
      "│ `-security webhook 3`",
      "│ `-security reset`",
      "╰─ vc+"
    ].join("\n")
  );
}

/* =========================================================
   HELP
   ========================================================= */

async function handleHelp(message, args) {
  const page =
    args[0]?.toLowerCase();

  if (!page) {
    return reply(
      message,
      [
        "╭─ vc+",
        "│",
        "│ **commands**",
        "│",
        "│ `-help moderation`",
        "│ `-help voice`",
        "│ `-help vouch`",
        "│ `-help security`",
        "│ `-help ranks`",
        "│ `-help config`",
        "│",
        "╰─ vc+"
      ].join("\n")
    );
  }

  const pages = {
    moderation: [
      "`-ban @user [reason]`",
      "`-unban user_id`",
      "`-kick @user [reason]`",
      "`-timeout @user 10 [reason]`",
      "`-untimeout @user`",
      "`-purge 50`",
      "`-clear 50`"
    ],

    voice: [
      "`-vc setup`",
      "`-vc reset`",
      "`-vc lock`",
      "`-vc unlock`",
      "`-vc hide`",
      "`-vc unhide`",
      "`-vc permit @user`",
      "`-vc reject @user`",
      "`-vc kick @user`",
      "`-vc ban @user`",
      "`-vc unban @user`",
      "`-vc limit 10`",
      "`-vc rename name`",
      "`-vc claim`",
      "`-vc ghost`"
    ],

    vouch: [
      "`-vouch @user`",
      "`-vouch remove @user`",
      "`-vouch clear @user`",
      "`-vouch clearall`",
      "`-vouch info @user`",
      "`-vouch list`",
      "`-vouch role set @role`",
      "`-vouch role reset`"
    ],

    security: [
      "`-security setup`",
      "`-security status`",
      "`-security whitelist add @user`",
      "`-security whitelist remove @user`",
      "`-security whitelist list`",
      "`-security logs #channel`",
      "`-security punishment roles`",
      "`-security punishment ban`",
      "`-security punishment both`",
      "`-security reset`"
    ],

    ranks: [
      "`-rank @user`",
      "`-rank set @user rank`",
      "`-rank remove @user`",
      "`-rank list`"
    ],

    config: [
      "`-config`",
      "`-config status`",
      "`-config reset`"
    ]
  };

  if (!pages[page]) {
    return reply(
      message,
      error("that help page doesn't exist.")
    );
  }

  return reply(
    message,
    [
      `╭─ ${page}`,
      "│",
      ...pages[page].map(
        command => `│ ${command}`
      ),
      "╰─ vc+"
    ].join("\n")
  );
}

/* =========================================================
   CONFIG
   ========================================================= */

async function handleConfig(
  message,
  args
) {
  if (!isFounder(message)) {
    return reply(
      message,
      error("Founder only.")
    );
  }

  const data =
    getGuildData(
      message.guild.id
    );

  if (
    args[0]?.toLowerCase() ===
    "reset"
  ) {
    db[message.guild.id] =
      defaultGuild();

    await saveDatabase();

    return reply(
      message,
      success("VC+ configuration reset.")
    );
  }

  return reply(
    message,
    [
      "╭─ config",
      "│",
      `│ prefix — ${data.prefix}`,
      `│ vouch role — ${
        data.vouchRole
          ? `<@&${data.vouchRole}>`
          : "not set"
      }`,
      `│ VC category — ${
        data.vc.categoryId
          ? `<#${data.vc.categoryId}>`
          : "not set"
      }`,
      `│ VC trigger — ${
        data.vc.triggerId
          ? `<#${data.vc.triggerId}>`
          : "not set"
      }`,
      `│ security — ${
        data.security.enabled
          ? "enabled"
          : "disabled"
      }`,
      "╰─ vc+"
    ].join("\n")
  );
}

/* =========================================================
   BUTTONS
   ========================================================= */

client.on(
  "interactionCreate",
  async interaction => {
    try {
      if (!interaction.isButton()) {
        return;
      }

      if (
        !interaction.guild ||
        !interaction.member
      ) {
        return;
      }

      const channel =
        interaction.member.voice?.channel;

      if (!channel) {
        return interaction.reply({
          content: error(
            "you aren't in a voice channel."
          ),
          ephemeral: true
        });
      }

      const fakeMessage = {
        guild: interaction.guild,
        member: interaction.member,
        author: interaction.user
      };

      if (
        !canControlVC(
          fakeMessage,
          channel
        )
      ) {
        return interaction.reply({
          content: error(
            "this isn't your VC."
          ),
          ephemeral: true
        });
      }

      const id =
        interaction.customId;

      if (id === "vc_lock") {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            Connect: false
          }
        );

        return interaction.reply({
          content: success("VC locked."),
          ephemeral: true
        });
      }

      if (id === "vc_unlock") {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            Connect: null
          }
        );

        return interaction.reply({
          content: success("VC unlocked."),
          ephemeral: true
        });
      }

      if (id === "vc_hide") {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            ViewChannel: false
          }
        );

        return interaction.reply({
          content: success("VC hidden."),
          ephemeral: true
        });
      }

      if (id === "vc_unhide") {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            ViewChannel: null
          }
        );

        return interaction.reply({
          content: success("VC visible."),
          ephemeral: true
        });
      }

      if (id === "vc_limit") {
        return interaction.reply({
          content: error(
            "use `-vc limit <number>` to set the limit."
          ),
          ephemeral: true
        });
      }

      if (id === "vc_ghost") {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          {
            ViewChannel: false,
            Connect: false
          }
        );

        return interaction.reply({
          content: success(
            "ghost mode enabled."
          ),
          ephemeral: true
        });
      }

      if (id === "vc_claim") {
        const data =
          getGuildData(
            interaction.guild.id
          );

        data.vc.owners[channel.id] =
          interaction.user.id;

        await saveDatabase();

        return interaction.reply({
          content: success(
            "you claimed this VC."
          ),
          ephemeral: true
        });
      }

      return interaction.reply({
        content: error(
          "this button isn't configured yet."
        ),
        ephemeral: true
      });

    } catch (err) {
      console.error(
        "[VC+ BUTTON ERROR]",
        err
      );

      try {
        if (interaction.replied) {
          await interaction.followUp({
            content: error(
              "something went wrong."
            ),
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: error(
              "something went wrong."
            ),
            ephemeral: true
          });
        }
      } catch {}
    }
  }
);

/* =========================================================
   VOICE STATE
   ========================================================= */

client.on(
  "voiceStateUpdate",
  async (oldState, newState) => {
    try {
      const guild =
        newState.guild ||
        oldState.guild;

      if (!guild) return;

      const data =
        getGuildData(guild.id);

      /*
       * User joined Join to Create
       */
      if (
        newState.channelId &&
        newState.channelId ===
          data.vc.triggerId
      ) {
        await createTemporaryVC(
          newState.member
        );
      }

      /*
       * User left temporary VC
       */
      if (
        oldState.channel &&
        oldState.channelId !==
          newState.channelId
      ) {
        await cleanupVC(
          oldState.channel
        );
      }

    } catch (err) {
      console.error(
        "[VC+ VOICE STATE ERROR]",
        err
      );
    }
  }
);

/* =========================================================
   SECURITY EVENTS
   ========================================================= */

client.on(
  "guildBanAdd",
  async ban => {
    await checkSecurity(
      ban.guild,
      "ban",
      AuditLogEvent.MemberBanAdd
    );
  }
);

client.on(
  "guildMemberRemove",
  async member => {
    await checkSecurity(
      member.guild,
      "kick",
      AuditLogEvent.MemberKick
    );
  }
);

client.on(
  "roleCreate",
  async role => {
    await checkSecurity(
      role.guild,
      "role",
      AuditLogEvent.RoleCreate
    );
  }
);

client.on(
  "roleDelete",
  async role => {
    await checkSecurity(
      role.guild,
      "role",
      AuditLogEvent.RoleDelete
    );
  }
);

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild) return;

    await checkSecurity(
      channel.guild,
      "channel",
      AuditLogEvent.ChannelCreate
    );
  }
);

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild) return;

    await checkSecurity(
      channel.guild,
      "channel",
      AuditLogEvent.ChannelDelete
    );
  }
);

client.on(
  "webhookUpdate",
  async channel => {
    if (!channel.guild) return;

    await checkSecurity(
      channel.guild,
      "webhook",
      AuditLogEvent.WebhookCreate
    );
  }
);

/* =========================================================
   MESSAGE HANDLER
   ========================================================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const data =
        getGuildData(
          message.guild.id
        );

      const prefix =
        data.prefix || PREFIX;

      if (!message.content.startsWith(prefix)) {
        return;
      }

      const args =
        message.content
          .slice(prefix.length)
          .trim()
          .split(/\s+/);

      const command =
        args.shift()?.toLowerCase();

      if (!command) return;

      /* ---------------------------------------------
         HELP
         --------------------------------------------- */

      if (command === "help") {
        return handleHelp(
          message,
          args
        );
      }

      /* ---------------------------------------------
         VC
         --------------------------------------------- */

      if (command === "vc") {
        return handleVC(
          message,
          args
        );
      }

      /* ---------------------------------------------
         VOUCH
         --------------------------------------------- */

      if (command === "vouch") {
        return handleVouch(
          message,
          args
        );
      }

      /* ---------------------------------------------
         RANK
         --------------------------------------------- */

      if (command === "rank") {
        return handleRank(
          message,
          args
        );
      }

      /* ---------------------------------------------
         SECURITY
         --------------------------------------------- */

      if (command === "security") {
        return handleSecurity(
          message,
          args
        );
      }

      /* ---------------------------------------------
         CONFIG
         --------------------------------------------- */

      if (command === "config") {
        return handleConfig(
          message,
          args
        );
      }

      /* ---------------------------------------------
         MODERATION
         --------------------------------------------- */

      if (
        [
          "ban",
          "unban",
          "kick",
          "timeout",
          "untimeout",
          "purge",
          "clear"
        ].includes(command)
      ) {
        return handleModeration(
          message,
          command,
          args
        );
      }

    } catch (err) {
      console.error(
        "[VC+ MESSAGE HANDLER ERROR]",
        err
      );

      await reply(
        message,
        error("something went wrong.")
      );
    }
  }
);

/* =========================================================
   READY
   ========================================================= */

client.once(
  "ready",
  async () => {
    console.log(
      `[VC+] logged in as ${client.user.tag}`
    );

    console.log(
      `[VC+] version ${VERSION}`
    );

    try {
      client.user.setPresence({
        activities: [
          {
            name: "-help",
            type: 2
          }
        ],
        status: "online"
      });
    } catch (err) {
      console.error(
        "[VC+ PRESENCE ERROR]",
        err
      );
    }
  }
);

/* =========================================================
   CLIENT ERROR PROTECTION
   ========================================================= */

client.on(
  "error",
  error => {
    console.error(
      "[VC+ CLIENT ERROR]",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "[VC+ WARNING]",
      warning
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[VC+ UNHANDLED REJECTION]",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[VC+ UNCAUGHT EXCEPTION]",
      error
    );
  }
);

/* =========================================================
   START
   ========================================================= */

loadDatabase();

const token =
  process.env.DISCORD_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN;

if (!token) {
  console.error(
    "[VC+ LOGIN ERROR] DISCORD_TOKEN is missing."
  );

  process.exit(1);
}

client
  .login(token)
  .catch(error => {
    console.error(
      "[VC+ LOGIN ERROR]",
      error
    );

    process.exit(1);
  });
