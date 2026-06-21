const Group = require("../database/entity/group.entity");

const getGroup = async (groupId) => {
  return await Group.findOne({ groupId });
};

const registerGroup = async (groupId, groupName, registeredBy) => {
  return await Group.findOneAndUpdate(
    { groupId },
    { groupName, registeredBy, isActive: true },
    { upsert: true, new: true }
  );
};

const createGroupRequest = async (groupId, groupName) => {
    return await Group.findOneAndUpdate(
      { groupId },
      { groupName },
      { upsert: true, new: true }
    );
};

const getTotalGroups = async () => {
    return await Group.countDocuments();
};

module.exports = {
  getGroup,
  registerGroup,
  createGroupRequest,
  getTotalGroups
};
