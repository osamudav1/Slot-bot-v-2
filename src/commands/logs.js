const { Composer, Markup } = require("telegraf");
const User = require("../database/entity/user.entitiy");

const { isOwner } = require("../modules/owner.module");

const composer = new Composer();

const USERS_PER_PAGE = 20;

const getUserListPage = async (page) => {
  const skip = (page - 1) * USERS_PER_PAGE;
  const users = await User.find().skip(skip).limit(USERS_PER_PAGE);
  const totalUsers = await User.countDocuments();
  const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE);

  let text = `👤 **User List (Page ${page}/${totalPages})**\nTotal Users: ${totalUsers}\n\n`;
  users.forEach((user, index) => {
    text += `${skip + index + 1}. [${user.first_name}](tg://user?id=${user.id}) (\`${user.id}\`)\n`;
  });

  const buttons = [];
  if (page > 1) {
    buttons.push(Markup.button.callback("⬅️ Previous", `logs_page_${page - 1}`));
  }
  if (page < totalPages) {
    buttons.push(Markup.button.callback("Next ➡️", `logs_page_${page + 1}`));
  }

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
};

composer.command("logs", async (ctx) => {
  if (!isOwner(ctx)) return;

  const { text, keyboard } = await getUserListPage(1);
  await ctx.replyWithMarkdown(text, keyboard);
});

composer.action(/logs_page_(\d+)/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Not authorized");

  const page = parseInt(ctx.match[1]);
  const { text, keyboard } = await getUserListPage(page);

  try {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...keyboard
    });
  } catch (err) {
    // Ignore if content is same
  }
  await ctx.answerCbQuery();
});

module.exports = composer;
