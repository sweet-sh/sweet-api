const mongoose = require('mongoose');
const DBReference = mongoose.Schema.Types.ObjectId

const librarySchema = new mongoose.Schema({
  user: { type: DBReference, ref: 'User' },
  post: { type: DBReference, ref: 'Post' }
})

librarySchema.index({ user: 1 })

module.exports = mongoose.model('Library', librarySchema)
