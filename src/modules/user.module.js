const User = require("../database/entity/user.entitiy");

const getUser = async ({ id }) => {
  let user = await User.findOne({ id });

  if (!user) {
    user = new User({
      id: id,
      balance: 0,
    });
    await user.save();
  }

  return user;
};

const findUser = async (options) => {
  // Map TypeORM style options to Mongoose if needed, 
  // but for ranking.js it passes { order: { balance: 'DESC' }, take: 10 }
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
