const Group = require("../database/entity/group.entity");

const getGroup = async (groupId) => {
  return await Group.findOne({ groupId });
};

const registerGroup = async (groupId, groupName, registeredBy, groupLink) => {
  return await Group.findOneAndUpdate(
    { groupId },
    { groupName, registeredBy, isActive: true, groupLink },
    { upsert: true, new: true }
  );
};

const createGroupRequest = async (groupId, groupName, groupLink) => {
    return await Group.findOneAndUpdate(
      { groupId },
      { groupName, groupLink },
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
