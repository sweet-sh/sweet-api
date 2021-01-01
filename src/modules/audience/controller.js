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
  audiences.map(audience => audience.users = audience.users.filter(o => o._id !== req.user._id));
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
  return res.status(201).send(sendResponse(audience, 201));
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
  users = [...users, req.user._id];  // You're always part of every Audience you own
  const result = await Audience.updateOne({ _id }, { name, capabilities, users });
  if (result.n === 1) {
    const audience = await Audience.findOne({ _id }).populate('users', 'username displayName lastUpdated imageEnabled image');
    return res.status(200).send(sendResponse(audience, 200));
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