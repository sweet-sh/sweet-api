const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { isObjectIdValid, sendResponse, sendError } = require('../../utils');
const User = require('../../modules/user/model');
const Post = require('../../modules/post/model');
const Library = require('../../modules/library/model');

const addToLibrary = async (req, res) => {
  // Check if a post was sent to the API at all
  if (!req.body.postId) {
    return res
      .status(500)
      .send(sendError(500, 'No post supplied'));
  }
  const postId = req.body.postId;
  // Check if the post really exists
  if (!isObjectIdValid(postId)) {
    return res
      .status(500)
      .send(sendError(500, 'Error fetching post to add to library'));
  }
  const post = await Post.findOne({ _id: postId }).catch(e => {
    return res
      .status(500)
      .send(sendError(500, 'Error fetching post to add to library'));
  });
  let libraryRecord = await Library.findOne({ user: req.user._id, post: postId });
  // There's no library record for this user and post, let's create one.
  if (libraryRecord) {
    return res
      .status(500)
      .send(sendError(500, 'Post already exists in library'));
  }
  libraryRecord = new Library({
    user: req.user._id,
    post: postId
  });
  await libraryRecord.save();
  return res
    .status(200)
    .send(sendResponse({ libraryRecord }, 200));
};

const removeFromLibrary = async (req, res) => {
  // Check if a post was sent to the API at all
  if (!req.body.postId) {
    return res
      .status(500)
      .send(sendError(500, 'No post supplied'));
  }
  const postId = req.body.postId;
  let libraryRecord = await Library.findOne({ user: req.user._id, post: postId });
  // There's no library record for this user and post, return here.
  if (!libraryRecord) {
    return res
      .status(500)
      .send(sendError(500, 'No such record in library'));
  }
  await Library.deleteOne({ user: req.user._id, post: postId });
  return res
    .sendStatus(200);
};

module.exports = {
  addToLibrary,
  removeFromLibrary,
};