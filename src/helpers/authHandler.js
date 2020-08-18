const JWT = require('./jwt');
const User = require('../modules/user/model');


const authHandler = async (req, res, next) => {
  console.log(req.originalUrl)
  console.log(req.headers)
  // We don't need to check headers for the login route
  if (req.originalUrl === '/api/login' || req.originalUrl === '/api/register') {
    return next()
  }
  // Immediately reject all unauthorized requests
  if (!req.headers.authorization) {
    return res.status(401).send(sendError(401, 'Not authorized to access this API'))
  }
  let verifyResult = JWT.verify(req.headers.authorization, { issuer: 'sweet.sh' });
  if (!verifyResult) {
    return res.status(401).send(sendError(401, 'Not authorized to access this API'))
  }
  req.user = (await User.findOne({ _id: verifyResult.id }));
  if (!req.user) {
    return res.status(404).send(sendError(404, 'No matching user registered in API'))
  }
  next()
};

module.exports = {
  authHandler,
};
