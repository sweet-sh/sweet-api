const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { isObjectIdValid, sendResponse, sendError } = require('../../utils');
const User = require('../../modules/user/model');
const Audience = require('../../modules/audience/model');

const listAudiences = async (req, res) => {
  const audiences = await Audience.find({ owner: req.user._id }).populate('users', 'username displayName lastUpdated imageEnabled image');
  if (!audiences) {
    return res.status(404).send(sendError(404, 'No audiences for this user.'));
  }
  // You're always part of every Audience you own, but don't show yourself in Audience queries
  audiences.map(audience => audience.users = audience.users.filter(o => !o._id.equals(req.user._id)));
  return res.status(200).send(sendResponse(audiences, 200));
};

const createAudience = async (req, res) => {
  const { name, capabilities } = req.body;
  const audience = new Audience({
    owner: req.user._id,
    capabilities,
    name,
    users: [ req.user._id ], // You're always part of every Audience you own
  });
  await audience.save();
  
  // Fetch new audience
  const newAudienceId = audience._id;
  let newAudience = await Audience.findOne({ _id: newAudienceId }).populate('users', 'username displayName lastUpdated imageEnabled image');
  if (!newAudience) {
    return res.status(404).send(sendError(404, 'Audience not found.'));
  }
  console.log(newAudience);
  // You're always part of every Audience you own, but don't show yourself in Audience queries
  newAudience.users = [];
  return res.status(201).send(sendResponse(newAudience, 201));
};

const deleteAudience = async (req, res) => {
  const result = await Audience.deleteOne({ _id: req.body._id });
  if (result.deletedCount === 1) {
    return res.sendStatus(200);
  } else {
    return res.status(404).send(sendError(404, 'Audience not found.'));
  }
};

const editAudience = async (req, res) => {
  const { name, users, capabilities, _id } = req.body;
  const usersIncludingYourself = [...users, req.user._id];  // You're always part of every Audience you own
  const result = await Audience.updateOne({ _id }, { name, capabilities, users: usersIncludingYourself });
  if (result.n === 1) {
    const audience = await Audience.findOne({ _id }).populate('users', 'username displayName lastUpdated imageEnabled image').lean();
    // You're always part of every Audience you own, but don't show yourself in Audience queries
    let returnedAudience = { ...audience, users: audience.users.filter(o => !o._id.equals(req.user._id)) };
    return res.status(200).send(sendResponse(returnedAudience, 200));
  } else {
    return res.status(404).send(sendError(404, 'Audience not found.'));
  }
};

module.exports = {
  listAudiences,
  createAudience,
  deleteAudience,
  editAudience
};