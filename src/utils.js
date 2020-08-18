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

const sendError = (status, message) => {
  return {
    error: {
      message,
      status,
    },
  };
};

const sendResponse = (data, status, message) => {
  return {
    data,
    message,
    status,
  };
};

module.exports = {
  isObjectIdValid,
  sendError,
  sendResponse,
}
