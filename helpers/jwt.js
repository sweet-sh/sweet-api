const fs = require('fs')
const jwt = require('jsonwebtoken')

// use 'utf8' to get string instead of byte array  (512 bit key)
var privateKey = fs.readFileSync('./private.key', 'utf8')
var publicKey = fs.readFileSync('./public.key', 'utf8')

module.exports = {
  sign: (payload, _options) => {
    // Token signing options
    var signOptions = {
      issuer: _options.issuer,
      expiresIn: "30d",    // 30 day validity
      algorithm: "RS256"
    }
    return jwt.sign(payload, privateKey, signOptions)
  },
  verify: (token, _options) => {
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
  },
  decode: (token) => {
    return jwt.decode(token, { complete: true })
    //returns null if token is invalid
  }
}