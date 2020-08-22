const bcrypt = require('bcrypt');


const hashPassword = async (password) => {
  const saltRounds = 10;
  const hashedPassword = await new Promise((resolve, reject) => {
    bcrypt.hash(password, saltRounds, (err, hash) => {
      err ? reject(err) : resolve(hash)
    });
  })
  return hashedPassword
}

module.exports = {
  hashPassword,
};
