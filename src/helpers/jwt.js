const fs = require('fs');
const jwt = require('jsonwebtoken');

// use 'utf8' to get string instead of byte array (512 bit key)
var publicKey = fs.readFileSync('keys/public.key', 'utf8')
var privateKey = fs.readFileSync('keys/private.key', 'utf8')

const sign = (payload, _options) => {
  var signOptions = {
    issuer: _options.issuer,
    expiresIn: "30d",
    algorithm: "RS256"
  }
  return jwt.sign(payload, privateKey, signOptions)
}

const verify = (token, _options) => {
  var verifyOptions = {
    issuer: _options.issuer,
    expiresIn: "30d",
    algorithm: ["RS256"]
  }
  try {
    return jwt.verify(token, publicKey, verifyOptions)
  } catch (error) {
    console.error(error)
    return false
  }
}

const decode = (token) => {
  return jwt.decode(token, { complete: true })
}

module.exports = {
  sign,
  verify,
  decode,
}
