const { Composer, Markup } = require("telegraf");
const Group = require("../database/entity/group.entity");

const { isOwner } = require("../modules/owner.module");

const composer = new Composer();

const GROUPS_PER_PAGE = 20;

const getGroupListPage = async (page) => {
  const skip = (page - 1) * GROUPS_PER_PAGE;
  const groups = await Group.find().skip(skip).limit(GROUPS_PER_PAGE);
  const totalGroups = await Group.countDocuments();
  const totalPages = Math.ceil(totalGroups / GROUPS_PER_PAGE);

  let text = `📢 **Group List (Page ${page}/${totalPages})**\nTotal Groups: ${totalGroups}\n\n`;
  groups.forEach((group, index) => {
    const link = group.groupLink ? `[Link](${group.groupLink})` : "No Link";
    text += `${skip + index + 1}. **${group.groupName}** (${link})\nID: \`${group.groupId}\`\nStatus: ${group.isActive ? "✅ Active" : "❌ Inactive"}\n\n`;
  });

  const buttons = [];
  if (page > 1) {
    buttons.push(Markup.button.callback("⬅️ Previous", `glogs_page_${page - 1}`));
  }
  if (page < totalPages) {
    buttons.push(Markup.button.callback("Next ➡️", `glogs_page_${page + 1}`));
  }

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
};

composer.command("glogs", async (ctx) => {
  if (!isOwner(ctx)) return;

  const { text, keyboard } = await getGroupListPage(1);
  await ctx.replyWithMarkdown(text, keyboard);
});

composer.action(/glogs_page_(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Not authorized");

  const page = parseInt(ctx.match[1]);
  const { text, keyboard } = await getGroupListPage(page);

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...keyboard
    });
  } catch (err) {
    // Ignore
  }
  await ctx.answerCbQuery();
});

module.exports = composer;
