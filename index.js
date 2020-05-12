/* eslint-disable no-restricted-syntax */
require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 8787;
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const reservedUsernames = require('./helpers/reservedUsernames');
const { parseText } = require('./helpers/parseText');
const { verifyPushToken } = require('./helpers/expoNotifications');

// JWT
const JWT = require('./helpers/jwt');

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Nodemailer
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
	host: process.env.EMAIL_SERVER,
	port: 587,
	secure: false, // upgrade later with STARTTLS
	auth: {
		user: process.env.EMAIL_USERNAME,
		pass: process.env.EMAIL_PASSWORD
	}
});
transporter.verify(function(error, success) {
	if (error) {
		console.log("Email server error!")
		console.log(error); 
	} else {
		console.log("Email server is ready to take our messages");
	}
});

app.use(bodyParser());

const configDatabase = require('./database.js');
const mongoose = require('mongoose');
mongoose.connect(configDatabase.url, { useNewUrlParser: true });
const ObjectId = mongoose.Types.ObjectId;
const User = require('./models/user');
const Relationship = require('./models/relationship');
const Post = require('./models/post');
require('./models/tag');
const Community = require('./models/community');
require('./models/vote');
const Image = require('./models/image');

const notifier = require('./helpers/notifier')
const { commentNotifier } = require('./helpers/commentNotifier')

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

function isObjectIdValid(string) {
  if (ObjectId.isValid(string)) {
    if (String(new ObjectId(string)) === string) {
      return true;
    }
  }
  return false;
}

function touchCommunity(id) {
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

async function hashPassword(password) {
  const saltRounds = 10;
  const hashedPassword = await new Promise((resolve, reject) => {
    bcrypt.hash(password, saltRounds, function(err, hash) {
      if (err) reject(err)
      resolve(hash)
    });
  })
  return hashedPassword
}

app.use('/api/*', async (req, res, next) => {
  console.log(req.originalUrl)
  console.log(req.headers)
  // We don't need to check headers for the login route
  if (req.originalUrl === '/api/login' || req.originalUrl === '/api/register') {
    console.log('Login/register route, proceed')
    return next()
  }
  // Immediately reject all unauthorized requests
  if (!req.headers.authorization) {
    console.log("JWT Token not supplied")
    return res.status(401).send(sendError(401, 'Not authorized to access this API'))
  }
  let verifyResult = JWT.verify(req.headers.authorization, { issuer: 'sweet.sh' });
  if (!verifyResult) {
    console.log("JWT Token failed verification", req.headers.authorization)
    return res.status(401).send(sendError(401, 'Not authorized to access this API'))
  }
  console.log("We all good!")
  console.log(verifyResult)
  req.user = (await User.findOne({ _id: verifyResult.id }));
  if (!req.user) {
    return res.status(404).send(sendError(404, 'No matching user registered in API'))
  }
  next()
})

app.post('/api/expo_token/register', async (req, res) => {
  console.log('Registering Expo token!', req.body.token)
  if (!req.body.token) {
    return res.status(400).send(sendError(400, 'No token submitted'));
  }
  if (!verifyPushToken(req.body.token)) {
    return res.status(400).send(sendError(400, 'Token invalid'));
  }
  req.user.expoPushTokens.push(req.body.token);
  await req.user.save()
    .catch(error => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error saving push token to database'));
    })
  console.log('Registered!')
  return res.sendStatus(200);
});

app.post('/api/register', async (req, res) => {
  // Check if data has been submitted
  if (!req.body.email || !req.body.password || !req.body.username) {
    return res.status(406).send(sendError(406, 'Required fields (email, password, username) blank.'));
  }
  // Check if a user with this username already exists
  const existingUsername = await (User.findOne({ username: req.body.username }));
  if (existingUsername) {
    return res.status(403).send(sendError(403, 'Sorry, this username is unavailable.'));
  }
  // Check if this username is in the list of reserved usernames
  if (reservedUsernames.includes(req.body.username)) {
    return res.status(403).send(sendError(403, 'Sorry, this username is unavailable.'));
  }
  // Check if a user with this email already exists
  const existingEmail = await (User.findOne({ email: req.body.email }));
  if (existingEmail) {
    return res.status(403).send(sendError(403, 'An account with this email already exists. Is it yours?'));
  }
  const verificationToken = nanoid();
  const newUser = new User({
    email: req.body.email,
    password: await hashPassword(req.body.password),
    username: req.body.username,
    joined: new Date(),
    verificationToken: verificationToken,
    verificationTokenExpiry: Date.now() + 3600000 // 1 hour
  });
  const savedUser = await newUser.save();
  const sweetbotFollow = new Relationship({
    from: req.body.email,
    to: 'support@sweet.sh',
    toUser: '5c962bccf0b0d14286e99b68',
    fromUser: newUser._id,
    value: 'follow'
  });
  const savedFollow = await sweetbotFollow.save();
  const sentEmail = await transporter.sendMail({
    from: '"Sweet Support" <support@sweet.sh>',
    to: req.body.email,
    subject: "Sweet - New user verification",
    text: 'Hi! You are receiving this because you have created a new account on sweet with this email.\n\n' +
    'Please click on the following link, or paste it into your browser, to verify your email:\n\n' +
    'https://sweet.sh/verify-email/' + verificationToken + '\n\n' +
    'If you did not create an account on sweet, please ignore and delete this email. The token will expire in an hour.\n'
  });
  if (!savedUser || !savedFollow || !sentEmail) {
    return res.status(500).send(sendError(500, 'There has been a problem processing your registration.'));
  }
  return res.sendStatus(200);
});

app.post('/api/login', async (req, res) => {
  // Check if data has been submitted
  if (!req.body.email || !req.body.password) {
    console.log("Login data missing")
    return res.status(401).send(sendError(401, 'User not authenticated'));
  }
  const user = await (User.findOne({ email: req.body.email }))
    .catch(error => {
      console.error(error);
      return res.status(401).send(sendError(401, 'User not authenticated'));
    });
  // If no user found
  if (!user) {
    console.log("No user found")
    return res.status(401).send(sendError(401, 'User not authenticated'));
  }
  console.log("Is verified:", user.isVerified)
  if (!user.isVerified) {
    console.log("User not verified")
    return res.status(401).send(sendError(401, 'This account has not been verified.'));
  }
  // Compare submitted password to database hash
  bcrypt.compare(req.body.password, user.password, (err, result) => {
    if (!result) {
      console.log("Password verification failed")
      return res.status(401).send(sendError(401, 'User not authenticated'));
    }
    const jwtOptions = {
      issuer: 'sweet.sh',
    }
    return res.status(200).send(sendResponse(JWT.sign({ id: user._id.toString() }, jwtOptions), 200));
  });
});

app.get('/api/posts/:context?/:timestamp?/:identifier?', async (req, res) => {
  const timestamp = req.params.timestamp ? new Date(parseInt(req.params.timestamp)) : Date.now();
  const postsPerPage = 20;

  // If we're looking for user posts, req.params.identifier might be a username
  // OR a MongoDB _id string. We need to work out which it is:
  let userIdentifier;
  if (req.params.context === 'user') {
    if (isObjectIdValid(req.params.identifier)) {
      userIdentifier = req.params.identifier;
    } else {
      userIdentifier = (await User.findOne({ username: req.params.identifier }))._id;
    }
  }

  const myFollowedUserIds = ((await Relationship.find({ from: req.user.email, value: 'follow' })).map(v => v.toUser)).concat([req.user._id]);
  const myFlaggedUsers = ((await Relationship.find({ fromUser: req.user._id, value: 'flag' })).map(v => v.toUser));
  const myMutedUserEmails = ((await Relationship.find({ from: req.user.email, value: 'mute' })).map(v => v.to));
  const myTrustedUserEmails = ((await Relationship.find({ from: req.user.email, value: 'trust' })).map(v => v.to));
  const usersFlaggedByMyTrustedUsers = ((await Relationship.find({ fromUser: { $in: myFlaggedUsers }, value: 'flag' })).map(v => v.toUser));
  const usersWhoTrustMeEmails = ((await Relationship.find({ to: req.user.email, value: 'trust' })).map(v => v.from)).concat([req.user.email]);
  const myCommunities = req.user.communities;
  if (req.params.context === 'community') {
    isMuted = (await Community.findById(req.params.identifier)).mutedMembers.some(v => v.equals(req.user._id));
  } else {
    isMuted = false;
  }
  flagged = usersFlaggedByMyTrustedUsers.concat(myFlaggedUsers).filter(e => e !== req.user._id);

  let matchPosts;
  let sortMethod = '-lastUpdated';
  let thisComm;
  switch (req.params.context) {
    case 'home':
      // on the home page, we're looking for posts (and boosts) created by users we follow as well as posts in communities that we're in.
      // we're assuming the user is logged in if this request is being made (it's only made by code on a page that only loads if the user is logged in.)
      matchPosts = {
        $or: [{
          author: {
            $in: myFollowedUserIds,
          },
        },
        {
          type: 'community',
          community: {
            $in: myCommunities,
          },
        },
        ],
        type: { $ne: 'draft' },
      };
      break;
    case 'user':
      // if we're on a user's page, obviously we want their posts:
      matchPosts = {
        author: userIdentifier,
        type: { $ne: 'draft' },
      };
      // but we also only want posts if they're non-community or they come from a community that we belong to:
      matchPosts.$or = [{
        community: {
          $exists: false,
        },
      }, {
        community: {
          $in: myCommunities,
        },
      }];
      break;
    case 'community':
      thisComm = await Community.findById(req.params.identifier);
      // we want posts from the community, but only if it's public or we belong to it:
      if (thisComm.settings.visibility === 'public' || myCommunities.some(v => v.toString() === req.params.identifier)) {
        matchPosts = {
          community: req.params.identifier,
        };
      } else {
        // if we're not in the community and it's not public, there are no posts we're allowed to view!
        matchPosts = undefined;
      }
      break;
    case 'tag':
      const getTag = () => {
        return Tag.findOne({ name: req.params.identifier })
          .then((tag) => {
            return { _id: { $in: tag.posts }, type: { $ne: 'draft' } };
          });
      };
      matchPosts = await getTag();
      break;
    case 'single':
      matchPosts = {
        _id: req.params.identifier,
        type: { $ne: 'draft' },
      };
      break;
    default:
      break;
  }

  matchPosts[sortMethod.substring(1, sortMethod.length)] = { $lt: timestamp };

  const query = Post
    .find(matchPosts)
    .sort(sortMethod)
    .limit(postsPerPage)
    // these populate commands retrieve the complete data for these things that are referenced in the post documents
    .populate('author', 'username imageEnabled image displayName')
    .populate('community', 'name slug url imageEnabled image mutedMembers settings')
    // If there's a better way to populate a nested tree lmk because this is... dumb. Mitch says: probably just fetching the authors recursively in actual code below
    .populate('comments.author', 'username imageEnabled image displayName')
    .populate('comments.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.replies.author', 'username imageEnabled image displayName')
    .populate('comments.replies.replies.replies.replies.author', 'username imageEnabled image displayName')
    .populate('boostTarget')
    .populate('boostsV2.booster', 'username imageEnabled image displayName')
    .populate('boostsV2.community', 'name slug url imageEnabled image mutedMembers settings');

  // so this will be called when the query retrieves the posts we want
  const posts = await query;

  if (!posts || !posts.length) {
    return res.status(404).send(sendError(404, 'No posts found'));
  }

  const displayedPosts = []; // populated by the for loop below

  let whosePostsCount;
  if (req.params.context === 'user') {
    whosePostsCount = [ObjectId(userIdentifier)];
  } else if (req.params.context === "home" || req.params.context === "tag") {
    whosePostsCount = myFollowedUserIds;
  } else if (req.params.context === "community") {
    whosePostsCount = thisComm.members;
  }

  for (const post of posts) {
    console.log('Processing', post._id)
    // figure out if there is a newer instance of the post we're looking at. if it's an original post, check the boosts from
    // the context's relevant users; if it's a boost, check the original post if we're in fluid mode to see if lastUpdated is more
    // recent (meaning the original was bumped up from recieving a comment) and then for both fluid and chronological we have to check
    // to see if there is a more recent boost.
    let newestVersion = post;
    let boostBlame;
    if (req.params.context !== 'single') {
      let isThereNewerInstance = false;
      if (post.type === 'original') {
        console.log("An OG post!", post.rawContent)
        for (const boost of post.boostsV2) {
          if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
            console.log("Got newer boost!", post.rawContent)
            isThereNewerInstance = true;
            newestVersion = boost;
          } else {
            console.log("Boost older")
          }
        }
      } else if (post.type === 'boost') {
        if (post.boostTarget !== null) {
          console.log("A boost!", post.boostTarget.rawContent)
          if (post.boostTarget.lastUpdated.getTime() > post.timestamp.getTime()) {
            console.log("Got newer OG post!", post.boostTarget.rawContent)
            isThereNewerInstance = true;
            newestVersion = post.boostTarget;
          } else {
            console.log("OG post older")
          }
          for (const boost of post.boostTarget.boostsV2) {
            if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
              console.log("Got newer other boost!", post.boostTarget.rawContent)
              isThereNewerInstance = true;
              newestVersion = boost;
            } else {
              console.log("Other boosts older")
            }
          }
        } else {
          console.log('Error fetching boostTarget of boost');
          isThereNewerInstance = true;
        }
      }

      if (isThereNewerInstance) {
        console.log("HIDING THIS POST")
        console.log("====================================")
        continue;
      }
      console.log("====================================")

    }

    let canDisplay = false;
    // logged in users can't see private posts by users who don't trust them or community posts by muted members
    if ((post.privacy === 'private' && usersWhoTrustMeEmails.includes(post.authorEmail)) || post.privacy === 'public') {
      canDisplay = true;
    }
    if (post.type === 'community') {
      // we don't have to check if the user is in the community before displaying posts to them if we're on the community's page, or if it's a single post page and: the community is public or the user wrote the post
      // in other words, we do have to check if the user is in the community if those things aren't true, hence the !
      if (!(req.params.context === 'community' || (req.params.context === 'single' && (post.author.equals(req.user) || post.community.settings.visibility === 'public')))) {
        if (myCommunities.some(m => m !== null && m.equals(post.community._id))) {
          canDisplay = true;
        } else {
          canDisplay = false;
        }
      }
      // Hide muted community members
      const mutedMemberIds = post.community.mutedMembers.map(a => a._id.toString());
      if (mutedMemberIds.includes(post.author._id.toString())) {
        canDisplay = false;
      }
    }

    // As a final hurrah, just hide all posts and boosts made by users you've muted
    if (myMutedUserEmails.includes(post.authorEmail)) {
      canDisplay = false;
    }

    if (!canDisplay) {
      continue;
    }

    let displayContext;
    if (post.type === 'boost') {
      displayContext = post.boostTarget;
      displayContext.author = await User.findById(displayContext.author, 'username imageEnabled image displayName');
      displayContext.community = await Community.findById(post.community, 'name slug url imageEnabled image mutedMembers settings');
      for (const boost of displayContext.boostsV2) {
        boost.booster = await User.findById(boost.booster, 'username imageEnabled image displayName');
        boost.community = await Community.findById(boost.community, 'name slug url imageEnabled image mutedMembers settings');
      }
      displayContext.type = "boost"

      // We construct some 'boost blame' information - explaining to the user why they're seeing a post on their feed.
      // The possible options are:
      // - If on a user's feed: because they boosted this post onto their feed. ({ reason: 'userBoost', culprit: userIdentifier })
      // - If in a community: because someone in this community boosted this post onto their feed ({ reason: 'communityBoost', culprit: booster._id })
      // - If on the general feed: because someone you follow boosted this post onto their feed ({ reason: 'followBoost', culprit: booster._id })
      // - Anywhere: because you boosted this post ({ reason: 'ownBoost', culprit: req.user._id })
      // Remember: `displayContext` for here is always the original boosted post, not the boost itself!
      // The boost itself is at `post`.
      console.log('+++++++++++++++++++++')
      console.log(newestVersion)
      console.log('+++++++++++++++++++++')
      // First check if you're the post's booster
      if (newestVersion.author._id.equals(req.user._id)) {
        boostBlame = { reason: 'ownBoost', culprit: newestVersion.author };
      } else {
        if (req.params.context === 'user') {
          boostBlame = { reason: 'userBoost', culprit: newestVersion.author };
        } else if (req.params.context === 'community') {
          boostBlame = ({ reason: 'communityBoost', culprit: newestVersion.author })
        } else if (req.params.context === 'home') {
          boostBlame = ({ reason: 'followBoost', culprit: newestVersion.author })
        }
      }
    } else {
      displayContext = post;
    }

    // Used to check if you can delete a post
    let isYourPost = displayContext.author._id.equals(req.user._id);

    let finalPost = {
      // This is necessary otherwise Mongoose keeps holding onto the object
      // and won't let us add properties to it
      ...displayContext.toObject(),
      deleteid: displayContext._id,
      timestampMs: displayContext.timestamp.getTime(),
      editedTimestampMs: displayContext.lastEdited ? displayContext.lastEdited.getTime() : '',
      // headerBoosters: boostsForHeader,
      havePlused: displayContext.pluses.filter(plus => plus.author.equals(req.user)),
      // followedBoosters: followedBoosters,
      // otherBoosters: notFollowingBoosters,
      isYourPost: isYourPost,
      // youBoosted: youBoosted,
      authorFlagged: flagged.some(v => v.equals(displayContext.author._id)),
      boostBlame: displayContext.type === 'boost' ? boostBlame : undefined
    }

    // get timestamps and full image urls for each comment
    const parseComments = (element, level) => {
      if (!level) {
        level = 1;
      }
      element.forEach(async (comment) => {
        comment.authorFlagged = flagged.some(v => v.equals(comment.author._id))
        comment.canDisplay = true;
        comment.muted = false;
        // I'm not sure why, but boosts in the home feed don't display
        // comment authors below the top level - this fixes it, but
        // it's kind of a hack - I can't work out what's going on
        if (!comment.author.username) {
          comment.author = await User.findById(comment.author, 'username imageEnabled image displayName');
        }
        if (myMutedUserEmails.includes(comment.author.email)) {
          comment.muted = true;
          comment.canDisplay = false;
        }
        if (comment.deleted) {
          comment.canDisplay = false;
        }
        for (let i = 0; i < comment.images.length; i++) {
          comment.images[i] = '/api/image/display/' + comment.images[i];
        }
        // If the comment's author is logged in, or the displayContext's author is logged in
        if (((comment.author._id.equals(req.user)) || (displayContext.author._id.equals(req.user))) && !comment.deleted) {
          comment.canDelete = true;
        }
        if (level < 5) {
          comment.canReply = true;
        }
        comment.level = level;
        if (comment.replies) {
          parseComments(comment.replies, level + 1);
        }
      });
    };
    parseComments(finalPost.comments);

    // wow, finally.
    displayedPosts.push(finalPost);
  }
  return res.status(200).send(sendResponse(displayedPosts, 200));
});

app.post('/api/plus/:postid', async (req, res) => {
  let plusAction;
  Post.findOne({
    _id: req.params.postid,
  }, {
    url: 1,
    author: 1,
    pluses: 1,
    numberOfPluses: 1,
  }).populate('author')
    .then((post) => {
      if (post.pluses.some(plus => plus.author.equals(req.user._id))) {
        // This post already has a plus from this user, so we're unplussing it
        post.pluses = post.pluses.filter(plus => !plus.author.equals(req.user._id));
        plusAction = 'remove';
      } else {
        post.pluses.push({ author: req.user._id, type: 'plus', timestamp: new Date() });
        plusAction = 'add';
      }
      post.numberOfPluses = post.pluses.length;
      post.save().then((updatedPost) => {
        // Don't notify yourself if you plus your own posts, you weirdo
        if (plusAction === 'add' && !post.author._id.equals(req.user._id)) {
          notifier.notify({
            type: 'user',
            cause: 'plus',
            notifieeID: post.author._id,
            sourceId: req.user._id,
            subjectId: null,
            url: '/' + post.author.username + '/' + post.url,
            context: 'post',
          })
        }
        return res.status(200).send(sendResponse({ pluses: post.pluses, plusAction }, 200));
      });
    })
    .catch(error => {
      console.log(error);
      return res.status(500).send(sendError(500, 'Error fetching post to plus'));
    });
});

// Responds to a post request that boosts a post.
// Inputs: id of the post to be boosted
// Outputs: a new post of type boost, adds the id of that new post into the boosts field of the old post, sends a notification to the
// user whose post was boosted.
app.post('/api/boost/:postid/:locationid?', async (req, res) => {
  let isCommunityBoost = false;
  let boostCommunity;
  console.log("Zero")
  const boostedTimestamp = new Date()
  const boostedPost = (await Post.findById(req.params.postid).populate('author'))
  if (!boostedPost) {
    return res.status(404).send(sendError(404, 'Post not found.'))
  }
  if (boostedPost.privacy !== 'public') {
    return res.status(401).send(sendError(401, 'Not authorised to boost this post.'))
  }
  if (req.params.locationid) {
    boostCommunity = (await Community.findById(req.params.locationid))
    if (!boostCommunity) {
      return res.status(404).send(sendError(404, 'Community not found.'))
    }
    isCommunityBoost = true;
  }
  const boost = new Post({
    type: 'boost',
    community: isCommunityBoost ? boostCommunity._id : undefined,
    authorEmail: req.user.email,
    author: req.user._id,
    url: nanoid(),
    privacy: 'public',
    timestamp: boostedTimestamp,
    lastUpdated: boostedTimestamp,
    boostTarget: boostedPost._id
  })
  boost.save().then(savedBoost => {
    console.log("One")
    const boost = {
      booster: req.user._id,
      community: isCommunityBoost ? boostCommunity._id : undefined,
      timestamp: boostedTimestamp,
      boost: savedBoost._id
    }
    boostedPost.boostsV2 = boostedPost.boostsV2.filter(boost => !boost.booster.equals(req.user._id))
    boostedPost.boostsV2.push(boost)
    boostedPost.save().then((boostedPost) => {
      console.log("Here")
      // don't notify the original post's author if they're creating the boost or are unsubscribed from this post
      if (!boostedPost.unsubscribedUsers.includes(boostedPost.author._id.toString()) && !boostedPost.author._id.equals(req.user._id)) {
        notifier.notify({
          type: 'user',
          cause: 'boost',
          notifieeID: boostedPost.author._id,
          sourceId: req.user._id,
          subjectId: null,
          url: '/' + boostedPost.author.username + '/' + boostedPost.url,
          context: 'post',
        })
      }
      return res.status(200).send(sendResponse({ boosts: boostedPost.boosts }, 200));
    })
  })
})

// Responds to a post request that boosts a post.
// Inputs: id of the post to be boosted
// Outputs: a new post of type boost, adds the id of that new post into the boosts field of the old post, sends a notification to the
// user whose post was boosted.
app.post('/removeboost/:postid', function (req, res) {
  Post.findOne({ _id: req.params.postid }, { boostsV2: 1, privacy: 1, author: 1, url: 1, timestamp: 1 })
    .then((boostedPost) => {
      const boost = boostedPost.boostsV2.find(b => {
        return b.booster.equals(req.user._id)
      })
      boostedPost.boostsV2 = boostedPost.boostsV2.filter(boost => {
        return !boost.booster.equals(req.user._id)
      })
      Post.deleteOne({
        _id: boost.boost
      }, function () {
        console.log('delete')
      })
      boostedPost.save().then(() => {
        res.redirect('back')
      })
    })
})

app.post('/api/post', async (req, res) => {
  const postContent = req.body.content;
  const {
    contentWarning,
    isPrivate,
    isCommunityPost,
    isDraft,
  } = req.body;

  if (!postContent) {
    return res.status(404).send(sendError(404, 'Post content empty'));
  }
  const parsedPayload = parseText(postContent);
  const inlineElements = {
    type: 'image(s)',
    images: req.body.images,
    position: parsedPayload.array.length, // At the end of the post
  };

  const newPostUrl = nanoid();
  const postCreationTime = new Date();

  const post = new Post({
    type: isCommunityPost ? 'community' : isDraft ? 'draft' : 'original',
    community: isCommunityPost ? req.body.communityId : undefined,
    authorEmail: req.user.email,
    author: req.user._id,
    url: newPostUrl,
    // Community posts are always public, drafts are always private, otherwise we check the privacy setting
    privacy: isCommunityPost ? 'public' : isDraft ? 'private' : isPrivate ? 'private' : 'public',
    timestamp: postCreationTime,
    lastUpdated: postCreationTime,
    rawContent: req.body.content,
    parsedContent: parsedPayload.text,
    numberOfComments: 0,
    mentions: parsedPayload.mentions,
    tags: parsedPayload.tags,
    contentWarnings: contentWarning,
    imageVersion: 3,
    inlineElements: req.body.images ? inlineElements : undefined,
    subscribedUsers: [req.user._id],
  });

  if (req.body.images) {
    req.body.images.forEach(async (filename) => {
      const image = new Image({
        context: isCommunityPost ? 'community' : 'user',
        filename: `images/${filename}`,
        url: `https://sweet-images.s3.eu-west-2.amazonaws.com/images/${filename}`,
        privacy: isPrivate ? 'private' : 'public',
        user: req.user._id,
        // DEBUG: NOT YET ENABLED
        // quality: postImageQuality,
        // height: metadata.height,
        // width: metadata.width
      });
      await image.save();
    });
  }

  const newPostId = post._id

  for (const mention of parsedPayload.mentions) {
    if (mention !== req.user.username) {
      User.findOne({ username: mention }).then(async mentioned => {
        if (isCommunityPost) {
          if (mentioned.communities.some(v => v.equals(post.community))) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: newPostId,
              url: '/' + req.user.username + '/' + newPostUrl,
              context: 'post',
            })
          }
        } else if (req.body.postPrivacy === 'private') {
          if (await Relationship.findOne({ value: 'trust', fromUser: req.user._id, toUser: mentioned._id })) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: newPostId,
              url: '/' + req.user.username + '/' + newPostUrl,
              context: 'post',
            })
          }
        } else {
          notifier.notify({
            type: 'user',
            cause: 'mention',
            notifieeID: mentioned._id,
            sourceId: req.user._id,
            subjectId: newPostId,
            url: '/' + req.user.username + '/' + newPostUrl,
            context: 'post',
          })
        }
      })
    }
  }

  for (const tag of parsedPayload.tags) {
    Tag.findOneAndUpdate(
      { name: tag },
      { $push: { posts: newPostId.toString() }, $set: { lastUpdated: postCreationTime } },
      { upsert: true, new: true },
      () => { }
    )
  }

  if (isCommunityPost) {
    Community.findOneAndUpdate({ _id: req.body.communityId }, { $set: { lastUpdated: new Date() } })
  }

  await post.save()
    .then((response) => {
      return res.status(200).send(sendResponse(response, 200));
    });
});

app.post('/api/comment/:postid/:commentid?', async (req, res) => {
  // loop over the array of comments adding 1 +  countComments on its replies to the count variable.
  function countComments(comments) {
    let count = 0;
    for (const comment of comments) {
      if (!comment.deleted) {
        count += 1;
        if (comment.replies.length) {
          count += countComments(comment.replies);
        }
      }
    }
    return count;
  }

  function findCommentByID(id, comments, depth = 1) {
    for (const comment of comments) {
      if (comment._id.equals(id)) {
        return { commentParent: comment, depth };
      } else {
        if (comment.replies.length > 0) {
          const searchReplies = findCommentByID(id, comment.replies, depth + 1);
          if (searchReplies !== 0) {
            return searchReplies;
          }
        }
      }
    }
    return 0;
  }

  const commentCreationTime = new Date();
  const commentId = ObjectId();
  const commentContent = req.body.content;

  if (!commentContent) {
    return res.status(404).send(sendError(404, 'Comment content empty'));
  }

  const parsedPayload = parseText(commentContent);
  const inlineElements = {
    type: 'image(s)',
    images: req.body.images,
    position: parsedPayload.array.length, // At the end of the comment
  };

  const comment = {
    _id: commentId,
    authorEmail: req.user.email,
    author: req.user._id,
    timestamp: commentCreationTime,
    rawContent: commentContent,
    parsedContent: parsedPayload.text,
    cachedHtml: { fullContentHtml: parsedPayload.text },
    mentions: parsedPayload.mentions,
    tags: parsedPayload.tags,
    inlineElements: req.body.images ? inlineElements : undefined,
  };

  Post.findOne({ _id: req.params.postid })
    .populate('author')
    .then(async (post) => {
      let postType;
      let postPrivacy;
      if (post.communityId) {
        postType = 'community';
        postPrivacy = (await Community.findById(post.communityId)).settings.visibility;
      } else {
        postType = 'original';
        postPrivacy = post.privacy;
      }
      let depth;
      let commentParent;
      if (!req.params.commentid) {
        depth = 1;
        commentParent = undefined;
        // This is a top level comment with no parent (identified by commentid)
        post.comments.push(comment);
      } else {
        // This is a child level comment so we have to drill through the comments
        // until we find it
        ({ commentParent, depth } = findCommentByID(req.params.commentid, post.comments));
        if (!commentParent) {
          console.log('Parent comment not found', req.params.commentid);
          return res.status(404).send(sendError(404, 'Parent comment not found'));
        } if (depth > 5) {
          console.log('Comment too deep', depth);
          return res.status(404).send(sendError(404, 'Comment too deep'));
        }
        commentParent.replies.push(comment);
      }

      post.numberOfComments = countComments(post.comments);
      post.lastUpdated = new Date();
      // We reset the cache time of the post to force the comments to reload on the web version
      post.cachedHTML.imageGalleryMTime = null;
      post.cachedHTML.embedsMTime = null;

      // Add user to subscribed users for post
      if ((!post.author._id.equals(req.user._id) && !post.subscribedUsers.includes(req.user._id.toString()))) { // Don't subscribe to your own post, or to a post you're already subscribed to
        post.subscribedUsers.push(req.user._id.toString());
      }

      if (req.body.images) {
        req.body.images.forEach(async (filename) => {
          const image = new Image({
            context: post.communityId ? 'community' : 'user',
            filename: 'images/' + filename,
            url: 'https://sweet-images.s3.eu-west-2.amazonaws.com/images/' + filename,
            privacy: postPrivacy,
            user: req.user._id,
            // DEBUG: NOT ENABLED
            // quality: postImageQuality,
            // height: metadata.height,
            // width: metadata.width
          });
          await image.save();
        });
      }

      post.save()
        .then(async () => {
          commentNotifier({
            post: post,
            postAuthor: post.author,
            postPrivacy: postPrivacy,
            commentAuthor: req.user,
            parsedPayload: parsedPayload,
          });
          return res.status(200).send(sendResponse(post, 200));
        });
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error saving comment'));
    });
});

app.get('/api/communities/all', (req, res) => {
  Community.find({})
    .sort('name')
    .then(communities => {
      if (!communities.length) {
        return res.status(404).send(sendError(404, 'No communities found!'));
      } else {
        return res.status(200).send(sendResponse(communities, 200));
      }
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error fetching communities'));
    });
});

app.get('/api/communities/:communityid', (req, res) => {
  Community.findById(req.params.communityid)
    .then(community => {
      if (!community) {
        return res.status(404).send(sendError(404, 'Community not found!'));
      } else {
        return res.status(200).send(sendResponse(community, 200));
      }
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error fetching community'));
    });
});

app.post('/api/community/join', async (req, res) => {
  const userToModify = (await User.findById(req.user._id));
  const communityToModify = await Community.findOne({ _id: req.body.communityId });
  if (!communityToModify || !userToModify) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  if (communityToModify.bannedMembers.includes(userToModify._id)) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  if (communityToModify.members.some(v => v.equals(userToModify._id)) || userToModify.communities.some(v => v.toString() === req.body.communityId)) {
    return res.status(406).send(sendError(406, 'User already member of community'));
  }
  communityToModify.members.push(userToModify._id);
  await communityToModify.save();
  touchCommunity(req.body.communityId);
  userToModify.communities.push(req.body.communityId);
  await userToModify.save();
  return res.sendStatus(200);
});

app.post('/api/community/leave', async (req, res) => {
  const userToModify = req.user;
  const communityToModify = await Community.findOne({ _id: req.body.communityId });
  if (!communityToModify || !userToModify) {
    return res.status(404).send(sendError(404, 'Community or user not found'));
  }
  communityToModify.members.pull(userToModify._id);
  await communityToModify.save();
  userToModify.communities.pull(req.body.communityId);
  await userToModify.save();
  return res.sendStatus(200);
});

app.get('/api/users/:sortorder', async (req, res) => {
  function c(e) {
    console.error('Error in user data builders');
    console.error(e);
    return res.status(500).send(sendError(500, 'Error fetching users'));
  }
  let sortOrder;
  switch (req.params.sortorder) {
    case 'asc_username':
      sortOrder = '-username';
      break;
    case 'desc_username':
      sortOrder = 'username';
      break;
    case 'desc_updated':
      sortOrder = '-lastUpdated';
      break;
    case 'asc_updated':
      sortOrder = 'lastUpdated';
      break;
    default:
      sortOrder = '-username';
      break;
  }
  const myRelationships = (await Relationship.find({ fromUser: req.user._id, value: { $in: ['follow', 'trust'] } }).catch(c)).map(v => v.toUser)
  const myUsers = (await User.find({ _id: { $in: myRelationships } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw').sort(sortOrder).catch(c))
  return res.status(200).send(sendResponse(myUsers, 200))
})

app.get('/api/user/:identifier', async (req, res) => {
  function c(e) {
    console.error('Error in user data builders');
    console.error(e);
    return res.status(500).send(sendError(500, 'Error in user data builders'));
  }
  // req.params.identifier might be a username OR a MongoDB _id string. We need to work
  // out which it is:
  let userQuery;
  if (isObjectIdValid(req.params.identifier)) {
    userQuery = { _id: req.params.identifier };
  } else {
    userQuery = { username: req.params.identifier };
  }

  const profileData = await User.findOne(userQuery, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw settings acceptedCodeOfConduct')
    .catch(err => {
      return res.status(500).send(sendError(500, 'Error fetching user'));
    });
  if (!profileData) {
    return res.status(404).send(sendError(404, 'User not found'));
  }
  const communitiesData = await Community.find({ members: profileData._id }, 'name slug url descriptionRaw descriptionParsed rulesRaw rulesParsed image imageEnabled membersCount').catch(c); // given to the renderer at the end
  const followersArray = (await Relationship.find({ to: profileData.email, value: 'follow' }, { from: 1 }).catch(c)).map(v => v.from); // only used for the below
  const followers = await User.find({ email: { $in: followersArray } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw').catch(c); // passed directly to the renderer
  const theirFollowedUserEmails = (await Relationship.find({ from: profileData.email, value: 'follow' }, { to: 1 }).catch(c)).map(v => v.to); // used in the below and to see if the profile user follows you
  const theirFollowedUserData = await User.find({ email: { $in: theirFollowedUserEmails } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw'); // passed directly to the renderer
  const usersWhoTrustThemArray = (await Relationship.find({ to: profileData.email, value: 'trust' }).catch(c)).map(v => v.from); // only used for the below
  const usersWhoTrustThem = await User.find({ email: { $in: usersWhoTrustThemArray } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw').catch(c); // passed directly to the renderer
  const theirTrustedUserEmails = (await Relationship.find({ from: profileData.email, value: 'trust' }).catch(c)).map(v => v.to); // used to see if the profile user trusts the logged in user (if not isOwnProfile) and the below
  const theirTrustedUserData = await User.find({ email: { $in: theirTrustedUserEmails } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw').catch(c); // given directly to the renderer

  let userFollowsYou = false;
  let userTrustsYou = false;
  let isOwnProfile;
  let flagsFromTrustedUsers;
  let flagged;
  let trusted;
  let followed;
  let muted;
  let myFlaggedUserData;
  let mutualTrusts;
  let mutualFollows;
  let mutualCommunities;
  // Is this the logged in user's own profile?
  if (profileData.email === req.user.email) {
    isOwnProfile = true;
    userTrustsYou = false;
    userFollowsYou = false;
    trusted = false;
    followed = false;
    muted = false;
    flagged = false;
    flagsFromTrustedUsers = 0;
    const myFlaggedUserEmails = (await Relationship.find({ from: req.user.email, value: 'flag' }).catch(c)).map(v => v.to); // only used in the below line
    myFlaggedUserData = await User.find({ email: { $in: myFlaggedUserEmails } }, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw settings').catch(c); // passed directly to the renderer, but only actually used if isOwnProfile, so we're only actually defining it in here
  } else {
    isOwnProfile = false;

    const myTrustedUserEmails = (await Relationship.find({ from: req.user.email, value: 'trust' }).catch(c)).map(v => v.to); // used for flag checking and to see if the logged in user trusts this user
    const myFollowedUserEmails = (await Relationship.find({ from: req.user.email, value: 'follow' }).catch(c)).map(v => v.to); // Used for mutual follows notification
    const myCommunities = await Community.find({ members: req.user._id }).catch(c); // Used for mutual communities notification

    // Check if profile user and logged in user have mutual trusts, follows, and communities
    mutualTrusts = usersWhoTrustThemArray.filter(v => myTrustedUserEmails.includes(v));
    mutualFollows = followersArray.filter(v => myFollowedUserEmails.includes(v));
    mutualCommunities = communitiesData.filter(community1 => myCommunities.some(community2 => community1._id.equals(community2._id))).map(community => community._id);

    // Check if profile user follows and/or trusts logged in user
    userTrustsYou = theirTrustedUserEmails.includes(req.user.email); // not sure if these includes are faster than an indexed query of the relationships collection would be
    userFollowsYou = theirFollowedUserEmails.includes(req.user.email);

    // Check if logged in user follows and/or trusts and/or has muted profile user
    trusted = myTrustedUserEmails.includes(profileData.email);
    followed = !!(await Relationship.findOne({ from: req.user.email, to: profileData.email, value: 'follow' }).catch(c));
    muted = !!(await Relationship.findOne({ from: req.user.email, to: profileData.email, value: 'mute' }).catch(c));

    const flagsOnUser = await Relationship.find({ to: profileData.email, value: 'flag' }).catch(c);
    flagsFromTrustedUsers = 0;
    flagged = false;
    for (const flag of flagsOnUser) {
      // Check if logged in user has flagged profile user
      if (flag.from === req.user.email) {
        flagged = true;
      }
      // Check if any of the logged in user's trusted users have flagged profile user
      if (myTrustedUserEmails.includes(flag.from)) {
        flagsFromTrustedUsers++;
      }
    }
  }
  const response = {
    loggedIn: req.user ? true : false,
    isOwnProfile,
    profileData,
    trusted,
    flagged,
    muted,
    followed,
    followersData: followers,
    usersWhoTrustThemData: usersWhoTrustThem,
    userFollowsYou,
    userTrustsYou,
    trustedUserData: theirTrustedUserData,
    followedUserData: theirFollowedUserData,
    communitiesData,
    flaggedUserData: myFlaggedUserData,
    flagsFromTrustedUsers,
    mutualTrusts,
    mutualFollows,
    mutualCommunities,
  };
  return res.status(200).send(sendResponse(response, 200));
});

app.post('/api/relationship', async (req, res) => {
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
});

app.post('/api/settings', (req, res) => {
  const newSettings = req.body;
  if (!newSettings) {
    return res.status(406).send(sendError(406, 'No new settings provided'));
  }
  req.user.settings = { ...req.user.settings, ...req.body }
  req.user.save()
    .then(user => {
      return res.status(200).send(sendResponse(user, 200))
    })
    .catch(error => {
      console.log(error);
      return res.status(500).send(sendError(500, 'Error saving new settings'));
    })
});

app.post('/api/report', async (req, res) => {
  const reportedPost = Post.findById(req.body.postid);
  if (!reportedPost) {
    return res.status(404).send(sendError(404, 'Post not found.'));
  }
  return res.sendStatus(200);
});

app.get('/api/code-of-conduct', async (req, res) => {
  if (req.user.acceptedCodeOfConduct) {
    return res.status(200).send(sendResponse({acceptanceStatus: true}, 200));
  } else {
    const codeOfConductText = '<p><strong>Sweet is dedicated to providing a harassment-free experience for everyone. We do not tolerate harassment of participants in any form.</strong></p><p><strong>You must read and accept this code of conduct to use the Sweet app and website.</strong></p><p>This code of conduct applies to all Sweet spaces, including public channels, private channels and direct messages, both online and off. Anyone who violates this code of conduct may be sanctioned or expelled from these spaces at the discretion of the administrators.</p><p>Members under 18 are allowed, but are asked to stay out of channels with adult imagery.</p><p>Some Sweet spaces, such as Communities, may have additional rules in place, which will be made clearly available to participants. Participants are responsible for knowing and abiding by these rules. This code of conduct holds priority in any disputes over rulings.</p><h4 id="types-of-harassment">Types of Harassment</h4><ul> <li>Offensive comments related to gender, gender identity and expression, sexual orientation, disability, mental illness, neuro(a)typicality, physical appearance, body size, race, immigration status, religion, or other identity marker. This includes anti-Indigenous/Nativeness and anti-Blackness.</li> <li>Unwelcome comments regarding a person’s lifestyle choices and practices, including those related to food, health, parenting, drugs, and employment.</li> <li>Deliberate misgendering or use of “dead” or rejected names</li> <li>Gratuitous or off-topic sexual images or behaviour in spaces where they’re not appropriate</li> <li>Physical contact and simulated physical contact (eg, textual descriptions like “hug” or “backrub”) without consent or after a request to stop.</li> <li>Threats of violence Incitement of violence towards any individual, including encouraging a person to commit suicide or to engage in self-harm</li> <li>Deliberate intimidation</li> <li>Stalking or following</li> <li>Harassing photography or recording, including logging online activity for harassment purposes</li> <li>Sustained disruption of discussion</li> <li>Unwelcome sexual attention</li> <li>Patterns of inappropriate social contact, such as requesting/assuming inappropriate levels of intimacy with others</li> <li>Continued one-on-one communication after requests to cease</li> <li>Deliberate “outing” of any aspect of a person’s identity without their consent except as necessary to protect vulnerable people from intentional abuse</li> <li>Publication of non-harassing private communication</li> <li>Microaggressions, which take the form of everyday jokes, put downs, and insults, that spread humiliating feelings to people of marginalized groups</li></ul><p>Jokes that resemble the above, such as “hipster racism”, still count as harassment even if meant satirically or ironically.</p><p>Sweet prioritizes marginalized people’s safety over privileged people’s comfort. The administrators will not act on complaints regarding:</p><ul> <li>“Reverse”-isms, including “reverse racism,” “reverse sexism,” and “cisphobia”</li> <li>Reasonable communication of boundaries, such as “leave me alone,” “go away,” or “I’m not discussing this with you.”</li> <li>Communicating in a “tone” you don’t find congenial</li> <li>Criticism of racist, sexist, cissexist, or otherwise oppressive behavior or assumptions.</li></ul><h4 id="reporting">Reporting</h4><p>If you are being harassed by a member of Sweet, notice that someone else is being harassed, or have any other concerns, please <strong>report the harassing content using the menu visible at the bottom of the post or comment</strong>. If the person being reported is an administrator, they will recuse themselves from handling your incident.</p><p>The administrators reserve the right to exclude people from Sweet based on their past behavior, including behavior outside Sweet spaces and behavior towards people who are not on Sweet. We will not name harassment victims without their affirmative consent.</p><p>Remember that you are able to flag people on Sweet, which is an anonymous way to make others aware of a person’s behaviour, but is not designed as a replacement for reporting.</p><h4 id="consequences">Consequences</h4><p>Participants asked to stop any harassing behavior are expected to comply immediately. If a participant engages in harassing behavior, the administrators may take any action they deem appropriate, up to and including expulsion from all Sweet spaces and identification of the participant as a harasser to other Sweet members or the general public.</p>'
    return res.status(200).send(sendResponse({acceptanceStatus: false, codeOfConductText: codeOfConductText}, 200));
  }
  await req.user.save();
  return res.sendStatus(200);
});

app.post('/api/code-of-conduct/accept', async (req, res) => {
  req.user.acceptedCodeOfConduct = true;
  await req.user.save();
  return res.sendStatus(200);
});

app.listen(port);

console.log('Server booting on default port: ' + port);