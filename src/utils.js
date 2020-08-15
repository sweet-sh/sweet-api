const mongoose = require('mongoose');


const ObjectId = mongoose.Types.ObjectId;

const isObjectIdValid = (string) => {
  if (ObjectId.isValid(string)) {
    if (String(new ObjectId(string)) === string) {
      return true;
    }
  }
  return false;
}

module.exports.isObjectIdValid = isObjectIdValid;

const sendError = (status, message) => {
  return {
    error: {
      message,
      status,
    },
  };
};

module.exports.sendError = sendError;

const sendResponse = (data, status, message) => {
  return {
    data,
    message,
    status,
  };
};

module.exports.sendResponse = sendResponse;
