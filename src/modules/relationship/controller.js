const notifier = require('../../helpers/notifier');
const Relationship = require('../../modules/relationship/model')
const User = require('../../modules/user/model')

const createRelationship = async (req, res) => {
  if (req.body.fromId !== req.user._id.toString()) {
    return res.status(401).send(sendError(401, 'From user does not match authorized user'));
  }
  const fromUser = req.user;
  const toUser = (await User.findById(req.body.toId));
  if (!toUser) {
    return res.status(404).send(sendError(404, 'To user not found'));
  }
  switch (req.body.action) {
    case 'add':
      const relationship = new Relationship({
        from: fromUser.email,
        to: toUser.email,
        fromUser: fromUser._id,
        toUser: toUser._id,
        value: req.body.type,
      });
      relationship.save()
        .then(() => {
          // Do not notify when users are flagged, muted, or blocked (blocking not currently implemented)
          if (req.body.type !== 'block' && req.body.type !== 'flag' && req.body.type !== 'mute') {
            notifier.notify({
              type: 'user',
              cause: 'relationship',
              notifieeID: toUser._id,
              sourceId: fromUser._id,
              subjectId: fromUser._id,
              url: '/' + fromUser.username,
              context: req.body.type,
            })
          }
          return res.sendStatus(200);
        })
        .catch(error => {
          console.error(error);
          return res.status(500).send(sendError(500, 'Error adding relationship'));
        });
    case 'remove':
      Relationship.findOneAndRemove({
        fromUser: fromUser._id,
        toUser: toUser._id,
        value: req.body.type,
      })
        .then(() => {
          return res.sendStatus(200);
        })
        .catch(() => {
          console.error(error);
          return res.status(500).send(sendError(500, 'Error removing relationship'));
        });
  }
}

module.exports = {
  createRelationship,
};
