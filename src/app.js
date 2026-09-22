import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder
} from "discord.js";

import fs from "node:fs";
import path from "node:path";

// ============================================================
// VC+ CONFIG
// ============================================================

const PREFIX = "-";
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("[VC+ ERROR] DISCORD_TOKEN is missing.");
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
    Partials.User,
    Partials.GuildMember,
    Partials.Channel
  ]
});

// ============================================================
// DATABASE
// ============================================================

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "vcplus.json");

function defaultGuild() {
  return {
    vc: {
      categoryId: null,
      joinChannelId: null,
      tempChannels: {}
    },

    vouch: {
      roleId: null,
      roleLimit: 0,
      userLimit: 0,
      users: {}
    },

    ranks: {},

    godmode: {},

    stfu: {}
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(
        dataFile,
        JSON.stringify({}, null, 2)
      );
      return {};
    }

    const raw = fs.readFileSync(dataFile, "utf8");

    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error("[VC+ DATABASE LOAD ERROR]", error);

    try {
      if (fs.existsSync(dataFile)) {
        fs.copyFileSync(
          dataFile,
          `${dataFile}.broken`
        );
      }
    } catch {}

    return {};
  }
}

let db = loadDB();

function saveDB() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const tempFile = `${dataFile}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, dataFile);
  } catch (error) {
    console.error("[VC+ DATABASE SAVE ERROR]", error);
  }
}

function getGuildData(guildId) {
  if (!db[guildId]) {
    db[guildId] = defaultGuild();
    saveDB();
  }

  const guild = db[guildId];

  guild.vc ??= {};
  guild.vc.categoryId ??= null;
  guild.vc.joinChannelId ??= null;
  guild.vc.tempChannels ??= {};

  guild.vouch ??= {};
  guild.vouch.roleId ??= null;
  guild.vouch.roleLimit ??= 0;
  guild.vouch.userLimit ??= 0;
  guild.vouch.users ??= {};

  guild.ranks ??= {};
  guild.godmode ??= {};
  guild.stfu ??= {};

  return guild;
}

// ============================================================
// EMBEDS
// ============================================================

function box(title, description) {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "VC+"
    });
}

async function reply(message, title, description) {
  return message.reply({
    embeds: [
      box(title, description)
    ] 
  }).catch(() => null);
}

// ============================================================
// HELPERS
// ============================================================

function getMember(message, text) {
  const mentioned = message.mentions.members.first();

  if (mentioned) {
    return mentioned;
  }

  if (!text) {
    return null;
  }

  const id = text.replace(/[<@!>]/g, "");

  if (!/^\d{17,20}$/.test(id)) {
    return null;
  }

  return message.guild.members.cache.get(id) || null;
}

function getUserId(text) {
  if (!text) return null;

  return text.replace(/[<@!>]/g, "");
}

function isFounder(member, guildData) {
  if (!member) return false;

  if (member.id === member.guild.ownerId) {
    return true;
  }

  return (
    guildData.ranks[member.id]?.toLowerCase() === "founder"
  );
}

function rankLevel(rank) {
  const levels = {
    member: 1,
    trusted: 2,
    moderator: 3,
    admin: 4,
    god: 5,
    founder: 6
  };

  return levels[String(rank || "member").toLowerCase()] || 1;
}

function hasStaffAccess(member, guildData) {
  if (!member) return false;

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return true;
  }

  return rankLevel(
    guildData.ranks[member.id]
  ) >= 3;
}

function isVCOwner(member, channel, guildData) {
  if (!member || !channel) return false;

  const info = guildData.vc.tempChannels[channel.id];

  if (!info) return false;

  return info.ownerId === member.id;
}

function parseDuration(input) {
  if (!input) return null;

  const match = input
    .toLowerCase()
    .match(/^(\d+)(s|m|h|d)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

// ============================================================
// READY
// ============================================================

client.once("ready", () => {
  console.log("--------------------------------");
  console.log("VC+ ONLINE");
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Servers: ${client.guilds.cache.size}`);
  console.log("--------------------------------");

  client.user.setPresence({
    activities: [
      {
        name: "-help"
      }
    ],
    status: "online"
  });
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on("messageCreate", async message => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content
      .slice(PREFIX.length)
      .trim()
      .split(/\s+/);

    const command = args.shift()?.toLowerCase();

    if (!command) return;

    const guildData = getGuildData(message.guild.id);

    // ========================================================
    // HELP
    // ========================================================

    if (command === "help") {
      return reply(
        message,
        "VC+",
        [
          "**VC**",
          "`-vc setup` `-vc lock` `-vc unlock`",
          "`-vc hide` `-vc unhide` `-vc permit @user`",
          "`-vc reject @user` `-vc kick @user`",
          "`-vc ban @user` `-vc unban @user`",
          "`-vc limit 5` `-vc claim`",

          "",
          "**VOUCH**",
          "`-vouch @user`",
          "`-vouch role set @role`",
          "`-vouch role reset`",
          "`-vouch role limit 5`",
          "`-vouch limit set 1`",
          "`-vouch limit`",
          "`-vouch list`",
          "`-vouch clear @user`",
          "`-vouch clearall`",

          "",
          "**RANK**",
          "`-rank @user founder`",
          "`-rank @user`",
          "`-rank remove @user`",

          "",
          "**MODERATION**",
          "`-timeout @user 10m`",
          "`-untimeout @user`",
          "`-ban @user`",
          "`-unban ID`",
          "`-unbanall`",
          "`-kick @user`",

          "",
          "**SPECIAL**",
          "`-vc stfu @user`",
          "`-vc unstfu @user`",
          "`-godmode @user`"
        ].join("\n")
      );
    }

    // ========================================================
    // VC COMMANDS
    // ========================================================

    if (command === "vc") {
      const sub = args.shift()?.toLowerCase();

      // ------------------------------------------------------
      // SETUP
      // ------------------------------------------------------

      if (sub === "setup") {
        if (!hasStaffAccess(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need staff access to use this command."
          );
        }

        let category = message.guild.channels.cache.find(
          channel =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === "VC+"
        );

        if (!category) {
          category = await message.guild.channels.create({
            name: "VC+",
            type: ChannelType.GuildCategory
          });
        }

        let joinChannel = message.guild.channels.cache.find(
          channel =>
            channel.type === ChannelType.GuildVoice &&
            channel.name === "🔊 Join to Create" &&
            channel.parentId === category.id
        );

        if (!joinChannel) {
          joinChannel = await message.guild.channels.create({
            name: "🔊 Join to Create",
            type: ChannelType.GuildVoice,
            parent: category.id
          });
        }

        guildData.vc.categoryId = category.id;
        guildData.vc.joinChannelId = joinChannel.id;

        saveDB();

        return reply(
          message,
          "✓ VC+ Setup",
          `Category and Join to Create channel are ready.`
        );
      }

      // ------------------------------------------------------
      // CHANNEL REQUIRED
      // ------------------------------------------------------

      const voiceChannel =
        message.member.voice.channel;

      if (
        sub !== "setup" &&
        !voiceChannel
      ) {
        return reply(
          message,
          "⚠ VC+",
          "You need to be in a voice channel."
        );
      }

      // ------------------------------------------------------
      // CLAIM
      // ------------------------------------------------------

      if (sub === "claim") {
        const info =
          guildData.vc.tempChannels[voiceChannel.id];

        if (!info) {
          return reply(
            message,
            "⚠ VC+",
            "This is not a VC+ channel."
          );
        }

        if (info.ownerId === message.author.id) {
          return reply(
            message,
            "⚠ VC+",
            "You already own this voice channel."
          );
        }

        const oldOwner =
          voiceChannel.guild.members.cache.get(
            info.ownerId
          );

        if (
          oldOwner &&
          oldOwner.voice.channelId === voiceChannel.id
        ) {
          return reply(
            message,
            "⚠ VC+",
            "The current owner is still here."
          );
        }

        info.ownerId = message.author.id;

        await voiceChannel.setName(
          `${message.member.displayName}'s VC`
        ).catch(() => {});

        saveDB();

        return reply(
          message,
          "✓ VC Claimed",
          `${message.author} now owns this voice channel.`
        );
      }

      // ------------------------------------------------------
      // OWNER REQUIRED
      // ------------------------------------------------------

      if (!isVCOwner(
        message.member,
        voiceChannel,
        guildData
      )) {
        return reply(
          message,
          "⚠ VC+",
          "You don't own this voice channel."
        );
      }

      // ------------------------------------------------------
      // LOCK
      // ------------------------------------------------------

      if (sub === "lock") {
        await voiceChannel.permissionOverwrites.edit(
          message.guild.roles.everyone,
          {
            Connect: false
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ Voice Locked",
          "Your voice channel is now locked."
        );
      }

      // ------------------------------------------------------
      // UNLOCK
      // ------------------------------------------------------

      if (sub === "unlock") {
        await voiceChannel.permissionOverwrites.edit(
          message.guild.roles.everyone,
          {
            Connect: null
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ Voice Unlocked",
          "Your voice channel is now unlocked."
        );
      }

      // ------------------------------------------------------
      // HIDE
      // ------------------------------------------------------

      if (sub === "hide") {
        await voiceChannel.permissionOverwrites.edit(
          message.guild.roles.everyone,
          {
            ViewChannel: false
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ Voice Hidden",
          "Your voice channel is now hidden."
        );
      }

      // ------------------------------------------------------
      // UNHIDE
      // ------------------------------------------------------

      if (sub === "unhide") {
        await voiceChannel.permissionOverwrites.edit(
          message.guild.roles.everyone,
          {
            ViewChannel: null
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ Voice Visible",
          "Your voice channel is visible again."
        );
      }

      // ------------------------------------------------------
      // PERMIT
      // ------------------------------------------------------

      if (sub === "permit") {
        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        await voiceChannel.permissionOverwrites.edit(
          target.id,
          {
            Connect: true,
            ViewChannel: true
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ User Permitted",
          `${target} can now join your voice channel.`
        );
      }

      // ------------------------------------------------------
      // REJECT
      // ------------------------------------------------------

      if (sub === "reject") {
        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        await voiceChannel.permissionOverwrites.edit(
          target.id,
          {
            Connect: false
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ User Rejected",
          `${target} can no longer join your voice channel.`
        );
      }

      // ------------------------------------------------------
      // KICK
      // ------------------------------------------------------

      if (sub === "kick") {
        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        if (
          target.voice.channelId !== voiceChannel.id
        ) {
          return reply(
            message,
            "⚠ VC+",
            "That user isn't in your voice channel."
          );
        }

        await target.voice.disconnect().catch(() => {});

        return reply(
          message,
          "✓ User Kicked",
          `${target} was removed from your voice channel.`
        );
      }

      // ------------------------------------------------------
      // BAN
      // ------------------------------------------------------

      if (sub === "ban") {
        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        await voiceChannel.permissionOverwrites.edit(
          target.id,
          {
            Connect: false
          }
        ).catch(() => {});

        if (
          target.voice.channelId === voiceChannel.id
        ) {
          await target.voice.disconnect().catch(() => {});
        }

        return reply(
          message,
          "✓ User Banned",
          `${target} is banned from your voice channel.`
        );
      }

      // ------------------------------------------------------
      // UNBAN
      // ------------------------------------------------------

      if (sub === "unban") {
        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        await voiceChannel.permissionOverwrites.edit(
          target.id,
          {
            Connect: null
          }
        ).catch(() => {});

        return reply(
          message,
          "✓ User Unbanned",
          `${target} can join your voice channel again.`
        );
      }

      // ------------------------------------------------------
      // LIMIT
      // ------------------------------------------------------

      if (sub === "limit") {
        const amount = Number(args[0]);

        if (
          !Number.isInteger(amount) ||
          amount < 0 ||
          amount > 99
        ) {
          return reply(
            message,
            "⚠ VC+",
            "Use a number from 0 to 99."
          );
        }

        await voiceChannel.setUserLimit(
          amount
        ).catch(() => {});

        return reply(
          message,
          "✓ User Limit",
          `Your voice channel limit is now \`${amount}\`.`
        );
      }

      // ------------------------------------------------------
      // STFU
      // ------------------------------------------------------

      if (sub === "stfu") {
        if (!isFounder(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need Founder rank to use this command."
          );
        }

        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        guildData.stfu[target.id] = true;
        saveDB();

        if (target.voice.channel) {
          await target.voice.setMute(
            true,
            "VC+ STFU"
          ).catch(() => {});
        }

        return reply(
          message,
          "🔇 Server Mute",
          `${target} has been server muted.\n\nUse \`-vc unstfu @user\` to release.`
        );
      }

      // ------------------------------------------------------
      // UNSTFU
      // ------------------------------------------------------

      if (sub === "unstfu") {
        if (!isFounder(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need Founder rank to use this command."
          );
        }

        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ VC+",
            "Mention a valid user."
          );
        }

        delete guildData.stfu[target.id];

        saveDB();

        if (target.voice.channel) {
          await target.setMute(
            false,
            "VC+ STFU removed"
          ).catch(() => {});
        }

        return reply(
          message,
          "✓ Server Mute Removed",
          `${target} can speak again.`
        );
      }

      return reply(
        message,
        "⚠ VC+",
        "Unknown VC command. Use `-help`."
      );
    }

    // ========================================================
    // VOUCH
    // ========================================================

    if (command === "vouch") {
      const first = args.shift()?.toLowerCase();

      // ------------------------------------------------------
      // ROLE
      // ------------------------------------------------------

      if (first === "role") {
        const action = args.shift()?.toLowerCase();

        if (!hasStaffAccess(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need staff access to use this command."
          );
        }

        if (action === "set") {
          const role = message.mentions.roles.first();

          if (!role) {
            return reply(
              message,
              "⚠ Vouch",
              "Mention a role."
            );
          }

          guildData.vouch.roleId = role.id;
          saveDB();

          return reply(
            message,
            "✦ Vouch Role",
            `${role} is now the official vouch role.`
          );
        }

        if (action === "reset") {
          guildData.vouch.roleId = null;
          saveDB();

          return reply(
            message,
            "✦ Vouch Role",
            "The vouch role has been reset."
          );
        }

        if (action === "limit") {
          const amount = Number(args[0]);

          if (
            !Number.isInteger(amount) ||
            amount < 1
          ) {
            return reply(
              message,
              "⚠ Vouch",
              "Use a valid role limit."
            );
          }

          guildData.vouch.roleLimit = amount;
          saveDB();

          return reply(
            message,
            "✦ Vouch Role Limit",
            `Maximum users: \`${amount}\``
          );
        }

        return reply(
          message,
          "⚠ Vouch",
          "Use `set`, `reset`, or `limit`."
        );
      }

      // ------------------------------------------------------
      // LIMIT
      // ------------------------------------------------------

      if (first === "limit") {
        const action = args.shift()?.toLowerCase();

        if (action === "set") {
          if (!hasStaffAccess(message.member, guildData)) {
            return reply(
              message,
              "⚠ Permission Denied",
              "You need staff access to use this command."
            );
          }

          const amount = Number(args[0]);

          if (
            !Number.isInteger(amount) ||
            amount < 1
          ) {
            return reply(
              message,
              "⚠ Vouch",
              "Use a valid limit."
            );
          }

          guildData.vouch.userLimit = amount;
          saveDB();

          return reply(
            message,
            "✦ Vouch Limit",
            `Each user can give up to \`${amount}\` active vouches.`
          );
        }

        if (!action) {
          return reply(
            message,
            "✦ Vouch Limit",
            guildData.vouch.userLimit
              ? `Current limit: \`${guildData.vouch.userLimit}\``
              : "No vouch limit is configured."
          );
        }

        return reply(
          message,
          "⚠ Vouch",
          "Use `-vouch limit set 1` or `-vouch limit`."
        );
      }

      // ------------------------------------------------------
      // LIST
      // ------------------------------------------------------

      if (first === "list") {
        const entries = Object.entries(
          guildData.vouch.users
        );

        if (!entries.length) {
          return reply(
            message,
            "✦ Vouches",
            "No vouches recorded."
          );
        }

        const lines = entries
          .slice(0, 25)
          .map(([userId, info]) =>
            `<@${userId}> — <@${info.by}>`
          );

        return reply(
          message,
          "✦ Vouches",
          lines.join("\n")
        );
      }

      // ------------------------------------------------------
      // CLEARALL
      // ------------------------------------------------------

      if (first === "clearall") {
        if (!hasStaffAccess(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need staff access to use this command."
          );
        }

        const roleId =
          guildData.vouch.roleId;

        for (const userId of Object.keys(
          guildData.vouch.users
        )) {
          const member =
            message.guild.members.cache.get(userId);

          if (
            member &&
            roleId &&
            member.roles.cache.has(roleId)
          ) {
            await member.roles.remove(
              roleId,
              "VC+ vouch clearall"
            ).catch(() => {});
          }
        }

        guildData.vouch.users = {};

        saveDB();

        return reply(
          message,
          "✦ Vouches Cleared",
          "All recorded vouches were cleared."
        );
      }

      // ------------------------------------------------------
      // CLEAR
      // ------------------------------------------------------

      if (first === "clear") {
        if (!hasStaffAccess(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need staff access to use this command."
          );
        }

        const target = getMember(
          message,
          args[0]
        );

        if (!target) {
          return reply(
            message,
            "⚠ Vouch",
            "Mention a valid user."
          );
        }

        delete guildData.vouch.users[target.id];

        if (guildData.vouch.roleId) {
          await target.roles.remove(
            guildData.vouch.roleId,
            "VC+ vouch cleared"
          ).catch(() => {});
        }

        saveDB();

        return reply(
          message,
          "✦ Vouch Cleared",
          `${target}'s vouch was removed.`
        );
      }

      // ------------------------------------------------------
      // GIVE VOUCH
      // ------------------------------------------------------

      const target = getMember(
        message,
        first
      );

      if (!target) {
        return reply(
          message,
          "⚠ Vouch",
          "Use `-vouch @user`."
        );
      }

      if (target.id === message.author.id) {
        return reply(
          message,
          "⚠ Vouch",
          "You cannot vouch yourself."
        );
      }

      if (!guildData.vouch.roleId) {
        return reply(
          message,
          "⚠ Vouch",
          "A vouch role has not been configured."
        );
      }

      const role =
        message.guild.roles.cache.get(
          guildData.vouch.roleId
        );

      if (!role) {
        guildData.vouch.roleId = null;
        saveDB();

        return reply(
          message,
          "⚠ Vouch",
          "The configured vouch role no longer exists."
        );
      }

      // User limit
      if (
        guildData.vouch.userLimit > 0
      ) {
        const currentCount =
          Object.values(
            guildData.vouch.users
          ).filter(
            entry =>
              entry.by === message.author.id
          ).length;

        if (
          currentCount >=
          guildData.vouch.userLimit
        ) {
          return reply(
            message,
            "⚠ Vouch Limit",
            "You have reached your vouch limit."
          );
        }
      }

      // Already vouched
      if (
        guildData.vouch.users[target.id]
      ) {
        return reply(
          message,
          "⚠ Vouch",
          `${target} is already vouched.`
        );
      }

      // Role limit
      if (
        guildData.vouch.roleLimit > 0
      ) {
        const holders =
          role.members.size;

        if (
          holders >=
          guildData.vouch.roleLimit
        ) {
          return reply(
            message,
            "⚠ Vouch Role Limit",
            "The vouch role has reached its limit."
          );
        }
      }

      guildData.vouch.users[target.id] = {
        by: message.author.id,
        timestamp: Date.now()
      };

      saveDB();

      await target.roles.add(
        role,
        "VC+ vouch"
      ).catch(() => {});

      return reply(
        message,
        "✦ Vouch",
        `${target} was vouched.\n\nVouch role • Added`
      );
    }

    // ========================================================
    // RANK
    // ========================================================

    if (command === "rank") {
      const target = getMember(
        message,
        args[0]
      );

      const second = args[1]?.toLowerCase();

      // ------------------------------------------------------
      // REMOVE
      // ------------------------------------------------------

      if (args[0]?.toLowerCase() === "remove") {
        const removeTarget = getMember(
          message,
          args[1]
        );

        if (!hasStaffAccess(message.member, guildData)) {
          return reply(
            message,
            "⚠ Permission Denied",
            "You need staff access to use this command."
          );
        }

        if (!removeTarget) {
          return reply(
            message,
            "⚠ Rank",
            "Mention a valid user."
          );
        }

        delete guildData.ranks[removeTarget.id];
        saveDB();

        return reply(
          message,
          "★ Rank",
          `${removeTarget}'s rank was removed.`
        );
      }

      // ------------------------------------------------------
      // VIEW
      // ------------------------------------------------------

      if (!second) {
        const viewTarget =
          target || message.member;

        const rank =
          guildData.ranks[viewTarget.id] ||
          "Member";

        const vouches =
          Object.values(
            guildData.vouch.users
          ).filter(
            entry =>
              entry.by === viewTarget.id
          ).length;

        return reply(
          message,
          `★ ${viewTarget.displayName}`,
          [
            `Rank \`${rank}\``,
            `Vouches \`${vouches}\``,
            `Godmode \`${guildData.godmode[viewTarget.id] ? "On" : "Off"}\``
          ].join("\n")
        );
      }

      // ------------------------------------------------------
      // SET
      // ------------------------------------------------------

      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      if (!target) {
        return reply(
          message,
          "⚠ Rank",
          "Mention a valid user."
        );
      }

      const validRanks = [
        "founder",
        "god",
        "admin",
        "moderator",
        "trusted",
        "member"
      ];

      if (!validRanks.includes(second)) {
        return reply(
          message,
          "⚠ Rank",
          "Valid ranks: Founder, God, Admin, Moderator, Trusted, Member."
        );
      }

      guildData.ranks[target.id] =
        second;

      saveDB();

      return reply(
        message,
        "★ Rank",
        `${target}\nRank \`${second}\``
      );
    }

    // ========================================================
    // GODMODE
    // ========================================================

    if (command === "godmode") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const target = getMember(
        message,
        args[0]
      );

      if (!target) {
        return reply(
          message,
          "⚠ Godmode",
          "Mention a valid user."
        );
      }

      const enabled =
        !guildData.godmode[target.id];

      guildData.godmode[target.id] =
        enabled;

      saveDB();

      return reply(
        message,
        "◈ Godmode",
        [
          `${target}`,
          `Status \`${enabled ? "ENABLED" : "DISABLED"}\``,
          enabled
            ? "Server mute protection is active."
            : "Server mute protection is disabled."
        ].join("\n")
      );
    }

    // ========================================================
    // TIMEOUT
    // ========================================================

    if (command === "timeout") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const target = getMember(
        message,
        args[0]
      );

      const duration =
        parseDuration(args[1]);

      if (!target || !duration) {
        return reply(
          message,
          "⚠ Timeout",
          "Use `-timeout @user 10m`."
        );
      }

      await target.timeout(
        duration,
        `VC+ timeout by ${message.author.tag}`
      ).catch(() => {});

      return reply(
        message,
        "✓ Timeout",
        `${target} has been timed out for \`${args[1]}\`.`
      );
    }

    // ========================================================
    // UNTIMEOUT
    // ========================================================

    if (command === "untimeout") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const target = getMember(
        message,
        args[0]
      );

      if (!target) {
        return reply(
          message,
          "⚠ Timeout",
          "Mention a valid user."
        );
      }

      await target.timeout(
        null,
        `VC+ timeout removed by ${message.author.tag}`
      ).catch(() => {});

      return reply(
        message,
        "✓ Timeout Removed",
        `${target} is no longer timed out.`
      );
    }

    // ========================================================
    // BAN
    // ========================================================

    if (command === "ban") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const target = getMember(
        message,
        args[0]
      );

      if (!target) {
        return reply(
          message,
          "⚠ Ban",
          "Mention a valid user."
        );
      }

      await target.ban({
        reason: `VC+ ban by ${message.author.tag}`
      }).catch(() => {});

      return reply(
        message,
        "✓ Banned",
        `${target.user.tag} has been banned.`
      );
    }

    // ========================================================
    // KICK
    // ========================================================

    if (command === "kick") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const target = getMember(
        message,
        args[0]
      );

      if (!target) {
        return reply(
          message,
          "⚠ Kick",
          "Mention a valid user."
        );
      }

      await target.kick(
        `VC+ kick by ${message.author.tag}`
      ).catch(() => {});

      return reply(
        message,
        "✓ Kicked",
        `${target.user.tag} has been kicked.`
      );
    }

    // ========================================================
    // UNBAN
    // ========================================================

    if (command === "unban") {
      if (!hasStaffAccess(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need staff access to use this command."
        );
      }

      const userId =
        getUserId(args[0]);

      if (!userId || !/^\d{17,20}$/.test(userId)) {
        return reply(
          message,
          "⚠ Unban",
          "Use a valid user ID."
        );
      }

      await message.guild.members.unban(
        userId,
        `VC+ unban by ${message.author.tag}`
      ).catch(() => {});

      return reply(
        message,
        "✓ Unbanned",
        `<@${userId}> has been unbanned.`
      );
    }

    // ========================================================
    // UNBAN ALL
    // ========================================================

    if (command === "unbanall") {
      if (!isFounder(message.member, guildData)) {
        return reply(
          message,
          "⚠ Permission Denied",
          "You need Founder rank to use this command."
        );
      }

      const bans =
        await message.guild.bans.fetch()
          .catch(() => null);

      if (!bans) {
        return reply(
          message,
          "⚠ Unban All",
          "I couldn't fetch the server bans."
        );
      }

      let count = 0;

      for (const [userId] of bans) {
        await message.guild.members.unban(
          userId,
          "VC+ unbanall"
        ).catch(() => {});

        count++;
      }

      return reply(
        message,
        "✓ Unban All",
        `Removed \`${count}\` bans.`
      );
    }

  } catch (error) {
    console.error("[VC+ MESSAGE ERROR]", error);

    await reply(
      message,
      "⚠ VC+",
      "Something went wrong while processing that command."
    );
  }
});

// ============================================================
// VOICE STATE
// ============================================================

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = newState.guild;

    if (!guild) return;

    const guildData =
      getGuildData(guild.id);

    // --------------------------------------------------------
    // GODMODE
    // --------------------------------------------------------

    const member =
      newState.member;

    if (member) {
      if (
        guildData.godmode[member.id] &&
        newState.serverMute
      ) {
        await member.voice.setMute(
          false,
          "VC+ Godmode"
        ).catch(() => {});
      }

      // ------------------------------------------------------
      // STFU
      // ------------------------------------------------------

      if (
        guildData.stfu[member.id] &&
        newState.channel &&
        !newState.serverMute
      ) {
        await member.voice.setMute(
          true,
          "VC+ STFU"
        ).catch(() => {});
      }
    }

    // --------------------------------------------------------
    // JOIN TO CREATE
    // --------------------------------------------------------

    if (
      newState.channelId &&
      newState.channelId ===
        guildData.vc.joinChannelId
    ) {
      const categoryId =
        guildData.vc.categoryId;

      const category =
        categoryId
          ? guild.channels.cache.get(categoryId)
          : null;

      if (!category) return;

      const existingNames =
        guild.channels.cache
          .filter(
            channel =>
              channel.type === ChannelType.GuildVoice &&
              channel.parentId === category.id
          )
          .map(channel => channel.name);

      let name =
        `${newState.member?.displayName || "User"}'s VC`;

      let number = 2;

      while (existingNames.includes(name)) {
        name =
          `${newState.member?.displayName || "User"}'s VC ${number}`;
        number++;
      }

      const temp =
        await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: category.id
        }).catch(error => {
          console.error(
            "[VC+ CREATE VC ERROR]",
            error
          );

          return null;
        });

      if (!temp) return;

      guildData.vc.tempChannels[temp.id] = {
        ownerId: newState.member.id
      };

      saveDB();

      await newState.setChannel(
        temp
      ).catch(async () => {
        delete guildData.vc.tempChannels[temp.id];

        saveDB();

        await temp.delete().catch(() => {});
      });
    }

    // --------------------------------------------------------
    // DELETE EMPTY TEMP VC
    // --------------------------------------------------------

    const oldChannel =
      oldState.channel;

    if (!oldChannel) return;

    const info =
      guildData.vc.tempChannels[
        oldChannel.id
      ];

    if (!info) return;

    if (oldChannel.members.size === 0) {
      delete guildData.vc.tempChannels[
        oldChannel.id
      ];

      saveDB();

      await oldChannel.delete(
        "VC+ empty temporary channel"
      ).catch(() => {});
    }

  } catch (error) {
    console.error(
      "[VC+ VOICE ERROR]",
      error
    );
  }
});

// ============================================================
// VOUCH ROLE PROTECTION
// ============================================================

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const guildData =
      getGuildData(newMember.guild.id);

    const roleId =
      guildData.vouch.roleId;

    if (!roleId) return;

    const hadRole =
      oldMember.roles.cache.has(roleId);

    const hasRole =
      newMember.roles.cache.has(roleId);

    if (!hadRole && hasRole) {
      const valid =
        Boolean(
          guildData.vouch.users[
            newMember.id
          ]
        );

      if (!valid) {
        await newMember.roles.remove(
          roleId,
          "VC+ vouch role protection"
        ).catch(() => {});
      }
    }

  } catch (error) {
    console.error(
      "[VC+ VOUCH ROLE ERROR]",
      error
    );
  }
});

// ============================================================
// CLIENT ERRORS
// ============================================================

client.on("error", error => {
  console.error(
    "[VC+ CLIENT ERROR]",
    error
  );
});

client.on("warn", warning => {
  console.warn(
    "[VC+ WARNING]",
    warning
  );
});

client.on("shardError", error => {
  console.error(
    "[VC+ SHARD ERROR]",
    error
  );
});

// ============================================================
// PROCESS PROTECTION
// ============================================================

process.on("unhandledRejection", error => {
  console.error(
    "[VC+ UNHANDLED REJECTION]",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "[VC+ UNCAUGHT EXCEPTION]",
    error
  );
});

// ============================================================
// LOGIN
// ============================================================

async function startBot() {
  try {
    await client.login(TOKEN);
  } catch (error) {
    console.error(
      "[VC+ LOGIN ERROR]",
      error
    );
  }
}

startBot();
