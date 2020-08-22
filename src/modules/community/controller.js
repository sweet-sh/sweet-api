const { sendResponse, sendError } = require('../../utils');
const Community = require('../../modules/community/model')
const User = require('../../modules/user/model')

const listCommunities = async (req, res) => {
  Community.find({})
    .sort('name')
    .then(communities => {
      if (!communities.length) {
        return res.status(404).send(sendError(404, 'No communities found!'));
      } else {
        return res.status(200).send(sendResponse(communities, 200));
      }
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error fetching communities'));
    });
}

const detailCommunity = async (req, res) => {
  Community.findById(req.params.communityid)
    .then(community => {
      if (!community) {
        return res.status(404).send(sendError(404, 'Community not found!'));
      } else {
        return res.status(200).send(sendResponse(community, 200));
      }
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error fetching community'));
    });
}

const joinCommunity = async (req, res) => {
  const userToModify = (await User.findById(req.user._id));
  const communityToModify = await Community.findOne({ _id: req.body.communityId });
  if (!communityToModify || !userToModify) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  if (communityToModify.bannedMembers.includes(userToModify._id)) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  if (communityToModify.members.some(v => v.equals(userToModify._id)) || userToModify.communities.some(v => v.toString() === req.body.communityId)) {
    return res.status(406).send(sendError(406, 'User already member of community'));
  }
  communityToModify.members.push(userToModify._id);
  await communityToModify.save();
  touchCommunity(req.body.communityId);
  userToModify.communities.push(req.body.communityId);
  await userToModify.save();
  return res.sendStatus(200);
}

const leaveCommunity = async (req, res) => {
  const userToModify = req.user;
  const communityToModify = await Community.findOne({ _id: req.body.communityId });
  if (!communityToModify || !userToModify) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  communityToModify.members.pull(userToModify._id);
  await communityToModify.save();
  userToModify.communities.pull(req.body.communityId);
  await userToModify.save();
  return res.sendStatus(200);
}

module.exports = {
  listCommunities,
  detailCommunity,
  joinCommunity,
  leaveCommunity,
};
