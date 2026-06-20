const User = require("../database/entity/user.entitiy");

const getUser = async ({ id }) => {
  // Use findOneAndUpdate with upsert: true to atomically find or create the user
  // This prevents race conditions where two messages from the same user arrive at the same time
  let user = await User.findOneAndUpdate(
    { id },
    { $setOnInsert: { id: id, balance: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return user;
};

const findUser = async (options) => {
  let query = User.find();
  
  if (options.order) {
    const sort = {};
    for (const key in options.order) {
      sort[key] = options.order[key].toLowerCase() === 'desc' ? -1 : 1;
    }
    query = query.sort(sort);
  }
  
  if (options.take) {
    query = query.limit(options.take);
  }

  return await query.exec();
};

const setUser = async ({ user }) => {
  if (user.save) {
    await user.save();
  } else {
    await User.findOneAndUpdate({ id: user.id }, user, { upsert: true });
  }
};

module.exports = { getUser, setUser, findUser };
