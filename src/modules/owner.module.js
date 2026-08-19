const normalizeOwnerValue = (value) => String(value || "").trim().replace(/^@/, "").toLowerCase();

const isOwner = (ctx) => {
  const configured = normalizeOwnerValue(process.env.OWNER_ID);
  if (!configured || !ctx?.from) return false;
  const userId = String(ctx.from.id || "").trim();
  const username = normalizeOwnerValue(ctx.from.username);
  return configured === userId || (username && configured === username);
};

const ownerContact = () => {
  const configured = String(process.env.OWNER_ID || "").trim();
  if (/^\d+$/.test(configured)) return `tg://user?id=${configured}`;
  const username = configured.replace(/^@/, "");
  return username ? `https://t.me/${username}` : "https://t.me";
};

module.exports = { isOwner, ownerContact, normalizeOwnerValue };
