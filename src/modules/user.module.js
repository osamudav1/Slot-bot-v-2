const User = require("../database/entity/user.entitiy");

const getUser = async ({ id, firstName }) => {
  const update = { $set: {} };
  if (firstName) {
    update.$set.first_name = firstName;
  }

  let user = await User.findOneAndUpdate(
    { id: Number(id) },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!user.coins && user.coins !== 0) {
    user.coins = 0;
    await user.save();
  }

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
