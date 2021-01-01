const mongoose = require('mongoose');
const DBReference = mongoose.Schema.Types.ObjectId

const audienceSchema = new mongoose.Schema({
  owner: { type: DBReference, ref: 'User' },
  users: [{ type: DBReference, ref: 'User' }],
  name: String,
  capabilities: {
    canSeeFlags: Boolean,
  }
})

audienceSchema.index({ owner: 1 })

module.exports = mongoose.model('Audience', audienceSchema)
