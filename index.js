const express = require('express')
const app = express()
const port = process.env.PORT || 8787
const bodyParser = require('body-parser')
const morgan = require('morgan')
const bcrypt = require('bcrypt');
const moment = require('moment')

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  next();
});

app.use(bodyParser())

const configDatabase = require('./database.js')
const mongoose = require('mongoose')
mongoose.connect(configDatabase.url, { useNewUrlParser: true })
const User = require('./models/user')
const Relationship = require('./models/relationship')
const Post = require('./models/post')
require('./models/tag')
require('./models/community')
require('./models/vote')
require('./models/image')

const sendError = (status, message) => {
  return {
    error: {
      message: message,
      status: status
    }
  }
}

const sendResponse = (data, status, message) => {
  return {
    data: data,
    message: message,
    status: status
  }
}

app.post('/api/login', function (req, res) {
  // Check if anything has been submitted
  if (!req.body.email || !req.body.password) {
    return res.status(401).send(sendError(401, "User not authenticated"))
  }
  User.findOne({ email: req.body.email })
    .then(user => {
      // If no user found
      if (!user) {
        return res.status(401).send(sendError(401, "User not authenticated"))
      }
      // Compare submitted password to database hash
      bcrypt.compare(req.body.password, user.password, function (err, result) {
        if (result) {
          return res.status(200).send(sendResponse(user, 200))
        } else {
          return res.status(401).send(sendError(401, "User not authenticated"))
        }
      });
    })
    .catch(error => {
      console.error(error)
      return res.status(401).send(sendError(401, "User not authenticated"))
    })
})

app.get('/api/posts/:context?/:timestamp?/:identifier?', async function (req, res) {
  const timestamp = req.params.timestamp ? new Date(parseInt(req.params.timestamp)) : Date.now()
  console.log(timestamp)
  const postsPerPage = 5
  const userId = req.header('Authorization');
  const user = (await User.findOne({ _id: userId }))
  const myFollowedUserIds = ((await Relationship.find({ from: user.email, value: 'follow' })).map(v => v.toUser)).concat([user._id])
  const myFlaggedUserEmails = ((await Relationship.find({ from: user.email, value: 'flag' })).map(v => v.to))
  const myMutedUserEmails = ((await Relationship.find({ from: user.email, value: 'mute' })).map(v => v.to))
  const myTrustedUserEmails = ((await Relationship.find({ from: user.email, value: 'trust' })).map(v => v.to))
  const usersFlaggedByMyTrustedUsers = ((await Relationship.find({ from: { $in: myTrustedUserEmails }, value: 'flag' })).map(v => v.to))
  const usersWhoTrustMeEmails = ((await Relationship.find({ to: user.email, value: 'trust' })).map(v => v.from)).concat([user.email])
  const myCommunities = user.communities
  if (req.params.context === 'community') {
    isMuted = (await Community.findById(req.params.identifier)).mutedMembers.some(v => v.equals(user._id))
  } else {
    isMuted = false
  }
  flagged = usersFlaggedByMyTrustedUsers.concat(myFlaggedUserEmails).filter(e => e !== user.email)

  let matchPosts
  let sortMethod = '-lastUpdated'
  let thisComm
  switch (req.params.context) {
    case 'home':
      // on the home page, we're looking for posts (and boosts) created by users we follow as well as posts in communities that we're in.
      // we're assuming the user is logged in if this request is being made (it's only made by code on a page that only loads if the user is logged in.)
      matchPosts = {
        $or: [{
          author: {
            $in: myFollowedUserIds
          }
        },
        {
          type: 'community',
          community: {
            $in: myCommunities
          }
        }
        ],
        type: { $ne: 'draft' }
      }
      break;
    case 'user':
      // if we're on a user's page, obviously we want their posts:
      matchPosts = {
        author: req.params.identifier,
        type: { $ne: 'draft' }
      }
      // but we also only want posts if they're non-community or they come from a community that we belong to:
      matchPosts.$or = [{
        community: {
          $exists: false
        }
      }, {
        community: {
          $in: myCommunities
        }
      }]
      break;
    case 'community':
      thisComm = await Community.findById(req.params.identifier)
      // we want posts from the community, but only if it's public or we belong to it:
      if (thisComm.settings.visibility === 'public' || myCommunities.some(v => v.toString() === req.params.identifier)) {
        matchPosts = {
          community: req.params.identifier
        }
      } else {
        // if we're not in the community and it's not public, there are no posts we're allowed to view!
        matchPosts = undefined
      }
      break;
    case 'tag':
      const getTag = () => {
        return Tag.findOne({ name: req.params.identifier })
          .then((tag) => {
            return { _id: { $in: tag.posts }, type: { $ne: 'draft' } }
          })
      }
      matchPosts = await getTag()
      break;
  }

  matchPosts[sortMethod.substring(1, sortMethod.length)] = { $lt: timestamp }

  const query = Post
    .find(matchPosts)
    .sort(sortMethod)
    .limit(postsPerPage)
    // these populate commands retrieve the complete data for these things that are referenced in the post documents
    .populate('author', 'username imageEnabled image displayName')
    .populate('community', 'name slug url imageEnabled image mutedMembers')
    // If there's a better way to populate a nested tree lmk because this is... dumb. Mitch says: probably just fetching the authors recursively in actual code below
    .populate('comments.author', 'username imageEnabled image displayName')
    .populate('comments.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.replies.replies.author', 'username imageEnabled image displayName')
    .populate('boostTarget')
    .populate('boostsV2.booster')

  // so this will be called when the query retrieves the posts we want
  const posts = await query

  if (!posts || !posts.length) {
    return res.status(404).send(sendError(404, 'No posts found'))
  }

  let displayedPost
  let oldesttimestamp
  // this gets the timestamp of the last post, this tells the browser to ask for posts older than this next time. used in feeds, not with single posts
  oldesttimestamp = '' + posts[posts.length - 1][sortMethod.substring(1, sortMethod.length)].getTime()

  const displayedPosts = [] // populated by the for loop below

  for (const post of posts) {
    // figure out if there is a newer instance of the post we're looking at. if it's an original post, check the boosts from
    // the context's relevant users; if it's a boost, check the original post if we're in fluid mode to see if lastUpdated is more
    // recent (meaning the original was bumped up from recieving a comment) and then for both fluid and chronological we have to check
    // to see if there is a more recent boost.
    if (req.params.context !== 'community' && req.params.context !== 'single') {
      let isThereNewerInstance = false
      const whosePostsCount = req.params.context === 'user' ? [new ObjectId(req.params.identifier)] : myFollowedUserIds
      if (post.type === 'original') {
        for (const boost of post.boostsV2) {
          if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
            isThereNewerInstance = true
          }
        }
      } else if (post.type === 'boost') {
        if (post.boostTarget !== null) {
          if (sortMethod === '-lastUpdated') {
            if (post.boostTarget.lastUpdated.getTime() > post.timestamp.getTime()) {
              isThereNewerInstance = true
            }
          }
          for (const boost of post.boostTarget.boostsV2) {
            if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
              isThereNewerInstance = true
            }
          }
        } else {
          console.log('Error fetching boostTarget of boost')
          isThereNewerInstance = true
        }
      }

      if (isThereNewerInstance) {
        continue
      }
    }

    let canDisplay = false
    // logged in users can't see private posts by users who don't trust them or community posts by muted members
    if ((post.privacy === 'private' && usersWhoTrustMeEmails.includes(post.authorEmail)) || post.privacy === 'public') {
      canDisplay = true
    }
    if (post.type === 'community') {
      // we don't have to check if the user is in the community before displaying posts to them if we're on the community's page, or if it's a single post page and: the community is public or the user wrote the post
      // in other words, we do have to check if the user is in the community if those things aren't true, hence the !
      if (!(req.params.context === 'community' || (req.params.context === 'single' && (post.author.equals(user) || post.community.settings.visibility === 'public')))) {
        if (myCommunities.some(m => m.equals(post.community._id))) {
          canDisplay = true
        } else {
          canDisplay = false
        }
      }
      // Hide muted community members
      const mutedMemberIds = post.community.mutedMembers.map(a => a._id.toString())
      if (mutedMemberIds.includes(post.author._id.toString())) {
        canDisplay = false
      }
    }

    // As a final hurrah, just hide all posts and boosts made by users you've muted
    if (myMutedUserEmails.includes(post.authorEmail)) {
      canDisplay = false
    }

    if (!canDisplay) {
      continue
    }

    let displayContext = post
    if (post.type === 'boost') {
      displayContext = post.boostTarget
      displayContext.author = await User.findById(displayContext.author, 'username imageEnabled image displayName')
      for (const boost of displayContext.boostsV2) {
        boost.booster = await User.findById(boost.booster, 'username imageEnabled image displayName')
      }
    }

    // Used to check if you can delete a post
    let isYourPost = displayContext.author._id.equals(user)

    // generate some arrays containing usernames that will be put in "boosted by" labels
    let boostsForHeader
    let youBoosted
    const followedBoosters = []
    const notFollowingBoosters = []
    if (req.params.context !== 'community') {
      youBoosted = false
      if (displayContext.boostsV2.length > 0) {
        displayContext.boostsV2.forEach((v, i, a) => {
          if (!(v.timestamp.getTime() === displayContext.timestamp.getTime())) { // do not include implicit boost
            if (v.booster._id.equals(user)) {
              followedBoosters.push('you')
              youBoosted = true
            } else {
              if (myFollowedUserIds.some(following => { if (following) { return following.equals(v.booster._id) } })) {
                followedBoosters.push(v.booster.username)
              } else {
                notFollowingBoosters.push(v.booster.username)
              }
            }
          }
        })
      }
      if (req.params.context === 'user' && !displayContext.author._id.equals(post.author._id)) {
        boostsForHeader = [post.author.username]
      } else {
        boostsForHeader = followedBoosters.slice(0, 3)
      }
    } else {
      if (req.params.context === 'user') {
        if (displayContext.author._id.toString() !== req.params.identifier) {
          boostsForHeader = [(await (User.findById(req.params.identifier, 'username'))).username]
        }
      }
    }

    displayedPost = Object.assign(displayContext, {
      deleteid: displayContext._id,
      timestampMs: displayContext.timestamp.getTime(),
      editedTimestampMs: displayContext.lastEdited ? displayContext.lastEdited.getTime() : '',
      headerBoosters: boostsForHeader,
      havePlused: displayContext.pluses.filter(plus => plus.author.equals(user))
    })

    displayedPost.followedBoosters = followedBoosters
    displayedPost.otherBoosters = notFollowingBoosters
    displayedPost.isYourPost = isYourPost
    displayedPost.youBoosted = youBoosted

    // get timestamps and full image urls for each comment
    const parseComments = (element, level) => {
      if (!level) {
        level = 1
      }
      element.forEach(async (comment) => {
        comment.canDisplay = true
        comment.muted = false
        // I'm not sure why, but boosts in the home feed don't display
        // comment authors below the top level - this fixes it, but
        // it's kind of a hack - I can't work out what's going on
        if (!comment.author.username) {
          comment.author = await User.findById(comment.author, 'username imageEnabled image displayName')
        }
        if (myMutedUserEmails.includes(comment.author.email)) {
          comment.muted = true
          comment.canDisplay = false
        }
        if (comment.deleted) {
          comment.canDisplay = false
        }
        for (let i = 0; i < comment.images.length; i++) {
          comment.images[i] = '/api/image/display/' + comment.images[i]
        }
        // If the comment's author is logged in, or the displayContext's author is logged in
        if (((comment.author._id.equals(user)) || (displayContext.author._id.equals(user))) && !comment.deleted) {
          comment.canDelete = true
        }
        if (level < 5) {
          comment.canReply = true
        }
        comment.level = level
        if (comment.replies) {
          parseComments(comment.replies, level + 1)
        }
      })
    }
    parseComments(displayedPost.comments)

    // wow, finally.
    displayedPosts.push(displayedPost)
  }
  return res.status(200).send(sendResponse(displayedPosts, 200))
})


app.listen(port)

console.log('Server booting on default port: ' + port)