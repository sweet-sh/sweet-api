const Community = require('./models');

const touchCommunity = (id) => {
  Community.findOneAndUpdate({
    _id: id,
  }, {
    $set: {
      lastUpdated: new Date(),
    },
  }).then(community => {
    return community;
  });
}

module.exports = {
  touchCommunity,
};
