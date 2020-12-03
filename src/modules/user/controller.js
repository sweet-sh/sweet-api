const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const tempy = require('tempy');
const JSZip = require('jszip');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { isObjectIdValid, sendResponse, sendError } = require('../../utils');
const JWT = require('../../helpers/jwt');
const { reservedUsernames } = require('../../config/constants');
const { verifyPushToken } = require('../../helpers/expoNotifications');
const { mailer } = require('../../mailer');
const Community = require('../../modules/community/model')
const Post = require('../../modules/post/model')
const Relationship = require('../../modules/relationship/model')
const User = require('../../modules/user/model')
const Vote = require('../../modules/vote/model')
const Image = require('../../modules/image/model')
const Tag = require('../../modules/tag/model')

const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const {
  Schema,
  DOMParser,
  DOMSerializer,
  Node,
  Fragment,
} = require("prosemirror-model");
const { schema } = require("../post/reactNativePostSchema");
const serializer = DOMSerializer.fromSchema(schema);

const registerExpoToken = async (req, res) => {
  console.log('Registering Expo token!', req.body.token)
  if (!req.body.token) {
    return res.status(400).send(sendError(400, 'No token submitted'));
  }
  if (!verifyPushToken(req.body.token)) {
    return res.status(400).send(sendError(400, 'Token invalid'));
  }
  const user = User.findOne({ _id: req.user._id });
  user.expoPushTokens.push(req.body.token);
  await user.save()
    .catch(error => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error saving push token to database'));
    })
  console.log('Registered!')
  return res.sendStatus(200);
}

const register = async (req, res) => {
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
  const sentEmail = await mailer.sendMail({
    from: '"Sweet Support" <support@sweet.sh>',
    to: req.body.email,
    subject: "Sweet - New user verification",
    text: 'Hi! You are receiving this because you have created a new account on Sweet with this email.\n\n' +
      'Please click on the following link, or paste it into your browser, to verify your email:\n\n' +
      'https://sweet.sh/verify-email/' + verificationToken + '\n\n' +
      'If you did not create an account on Sweet, please ignore and delete this email. The token will expire in an hour.\n'
  });
  if (!savedUser || !savedFollow || !sentEmail) {
    return res.status(500).send(sendError(500, 'There has been a problem processing your registration.'));
  }
  return res.sendStatus(200);
}

const login = async (req, res) => {
  // Check if data has been submitted
  if (!req.body.email || !req.body.password) {
    // console.log("Login data missing")
    return res.status(401).send(sendError(401, 'User not authenticated'));
  }
  const user = await (User.findOne({ email: req.body.email }))
    .catch(error => {
      console.error(error);
      return res.status(401).send(sendError(401, 'User not authenticated'));
    });
  // If no user found
  if (!user) {
    // console.log("No user found")
    return res.status(401).send(sendError(401, 'User not authenticated'));
  }
  // console.log("Is verified:", user.isVerified)
  if (!user.isVerified) {
    // console.log("User not verified")
    return res.status(403).send(sendError(403, 'This account has not been verified.'));
  }
  // Compare submitted password to database hash
  bcrypt.compare(req.body.password, user.password, (err, result) => {
    if (!result) {
      // console.log("Password verification failed")
      return res.status(401).send(sendError(401, 'User not authenticated'));
    }
    const jwtOptions = {
      issuer: 'sweet.sh',
    }
    return res.status(200).send(sendResponse(JWT.sign({ id: user._id.toString() }, jwtOptions), 200));
  });
}

const listAllUsers = (req, res) => {
  User.find()
    .then((users) => {
      const usersPayload = [];
      users.forEach((user) => {
        const userObject = {
          id: user._id,
          displayName: user.displayName,
          username: user.username,
          value: user.username,
          image: user.imageEnabled
            ? `https://sweet-images.s3.amazonaws.com/${user.image}`
            : '/images/cake.svg',
        };
        usersPayload.push(userObject);
      });
      res.status(200).send(sendResponse(usersPayload, 200));
    })
    .catch((error) => {
      console.log(error);
      return res.status(500).send(sendError(500, 'Error fetching users'));
    });
};

const listUsers = async (req, res) => {
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
}

const detailUser = async (req, res) => {
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

  const profileData = await User.findOne(userQuery, 'email username imageEnabled image displayName aboutParsed aboutRaw location pronouns websiteParsed websiteRaw settings acceptedCodeOfConduct lastOnline lastUpdated')
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
}

const changeSettings = async (req, res) => {
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
}

const reportUser = async (req, res) => {
  const reportedPost = await Post.findById(req.body.postid).populate('author');
  if (!reportedPost) {
    return res.status(404).send(sendError(404, 'Post not found.'));
  }
  const sentEmail = await mailer.sendMail({
    from: '"Sweet Support" <support@sweet.sh>',
    to: '"Sweet Support" <support@sweet.sh>',
    subject: "Sweet - Post report",
    text: `Post ID: ${reportedPost._id}\n
          Post author: @${reportedPost.author.username}\n
          Post author email: @${reportedPost.author.email}\n
          Post content (JSON): ${reportedPost.jsonBody}\n\n
          Reporter: @${req.user.username}\n
          Reporter email: ${req.user.email}\n`,
  });
  return res.sendStatus(200);
}

const getCoC = async (req, res) => {
  if (req.user.acceptedCodeOfConduct) {
    return res.status(200).send(sendResponse({ acceptanceStatus: true }, 200));
  } else {
    const codeOfConductText = '<p><strong>Sweet is dedicated to providing a harassment-free experience for everyone. We do not tolerate harassment of participants in any form.</strong></p><p><strong>You must read and accept this code of conduct to use the Sweet app and website.</strong></p><p>This code of conduct applies to all Sweet spaces, including public channels, private channels and direct messages, both online and off. Anyone who violates this code of conduct may be sanctioned or expelled from these spaces at the discretion of the administrators.</p><p>Members under 18 are allowed, but are asked to stay out of channels with adult imagery.</p><p>Some Sweet spaces, such as Communities, may have additional rules in place, which will be made clearly available to participants. Participants are responsible for knowing and abiding by these rules. This code of conduct holds priority in any disputes over rulings.</p><h4 id="types-of-harassment">Types of Harassment</h4><ul> <li>Offensive comments related to gender, gender identity and expression, sexual orientation, disability, mental illness, neuro(a)typicality, physical appearance, body size, race, immigration status, religion, or other identity marker. This includes anti-Indigenous/Nativeness and anti-Blackness.</li> <li>Unwelcome comments regarding a person’s lifestyle choices and practices, including those related to food, health, parenting, drugs, and employment.</li> <li>Deliberate misgendering or use of “dead” or rejected names</li> <li>Gratuitous or off-topic sexual images or behaviour in spaces where they’re not appropriate</li> <li>Physical contact and simulated physical contact (eg, textual descriptions like “hug” or “backrub”) without consent or after a request to stop.</li> <li>Threats of violence Incitement of violence towards any individual, including encouraging a person to commit suicide or to engage in self-harm</li> <li>Deliberate intimidation</li> <li>Stalking or following</li> <li>Harassing photography or recording, including logging online activity for harassment purposes</li> <li>Sustained disruption of discussion</li> <li>Unwelcome sexual attention</li> <li>Patterns of inappropriate social contact, such as requesting/assuming inappropriate levels of intimacy with others</li> <li>Continued one-on-one communication after requests to cease</li> <li>Deliberate “outing” of any aspect of a person’s identity without their consent except as necessary to protect vulnerable people from intentional abuse</li> <li>Publication of non-harassing private communication</li> <li>Microaggressions, which take the form of everyday jokes, put downs, and insults, that spread humiliating feelings to people of marginalized groups</li></ul><p>Jokes that resemble the above, such as “hipster racism”, still count as harassment even if meant satirically or ironically.</p><p>Sweet prioritizes marginalized people’s safety over privileged people’s comfort. The administrators will not act on complaints regarding:</p><ul> <li>“Reverse”-isms, including “reverse racism,” “reverse sexism,” and “cisphobia”</li> <li>Reasonable communication of boundaries, such as “leave me alone,” “go away,” or “I’m not discussing this with you.”</li> <li>Communicating in a “tone” you don’t find congenial</li> <li>Criticism of racist, sexist, cissexist, or otherwise oppressive behavior or assumptions.</li></ul><h4 id="reporting">Reporting</h4><p>If you are being harassed by a member of Sweet, notice that someone else is being harassed, or have any other concerns, please <strong>report the harassing content using the menu visible at the bottom of the post or comment</strong>. If the person being reported is an administrator, they will recuse themselves from handling your incident.</p><p>The administrators reserve the right to exclude people from Sweet based on their past behavior, including behavior outside Sweet spaces and behavior towards people who are not on Sweet. We will not name harassment victims without their affirmative consent.</p><p>Remember that you are able to flag people on Sweet, which is an anonymous way to make others aware of a person’s behaviour, but is not designed as a replacement for reporting.</p><h4 id="consequences">Consequences</h4><p>Participants asked to stop any harassing behavior are expected to comply immediately. If a participant engages in harassing behavior, the administrators may take any action they deem appropriate, up to and including expulsion from all Sweet spaces and identification of the participant as a harasser to other Sweet members or the general public.</p>'
    return res.status(200).send(sendResponse({ acceptanceStatus: false, codeOfConductText: codeOfConductText }, 200));
  }
}

const acceptCoC = async (req, res) => {
  req.user.acceptedCodeOfConduct = true;
  await req.user.save();
  return res.sendStatus(200);
};

const exportUserData = async (req, res) => {
  const user = await User.find({ _id: req.user._id }, 'settings lastUpdated email username joined aboutRaw displayName location pronouns websiteRaw communities -_id').populate('communities', 'created lastUpdated name descriptionRaw rulesRaw -_id');
  const votes = await Vote.find({ creator: req.user._id }, '-_id status community parsedReference proposedValue timestamp lastUpdated votes voteThreshold expiryTime').populate('community', '-_id created lastUpdated name descriptionRaw rulesRaw');
  const relationships = await Relationship.find({ $or: [{ fromUser: req.user._id }, { toUser: req.user._id }], value: { $in: ['trust', 'follow'] } }, 'fromUser toUser value -_id').populate('fromUser', 'username displayName -_id').populate('toUser', 'username displayName -_id');
  let posts = await Post.find({ author: req.user._id, type: { $in: ['original', 'community'] } }, '-_id type author community url privacy audiences timestamp lastUpdated lastEdited comments mentons tags pluses contentWarnings jsonBody comments.author comments.timestamp comments.jsonBody comments.replies.author comments.replies.timestamp comments.replies.jsonBody comments.replies.replies.author comments.replies.replies.timestamp comments.replies.replies.jsonBody comments.replies.replies.replies.author comments.replies.replies.replies.timestamp comments.replies.replies.replies.jsonBody').populate('author', 'username email displayName -_id')
    .populate(
      'pluses',
      'username displayName -_id'
    )
    .populate(
      'community',
      'name -_id',
    )
    .populate('comments.author', 'username displayName -_id')
    .populate(
      'comments.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.replies.replies.author',
      'username displayName -_id',
    );
  let commentsArray = [];
  // const recursiveFind = (object, post, level) => {
  //   if (object.comments && object.comments.length) {
  //     object.comments.forEach(comment => {
  //       if (comment.author.equals(req.user._id)) {
  //         if (level === 0 && commentsArray.some((savedPost) => !savedPost._id.equals(post._id))) {
  //           commentsArray.push({
  //             url: post.url,
  //             author: post.author,
  //             comments: []
  //           });
  //         }
  //         const targetPost = commentsArray.find((savedPost) => savedPost._id.equals(post._id));
  //         targetPost.comments.push(comment);
  //       }
  //     });
  //   }
  //   if (object.replies && object.replies.length) {
  //     object.replies.forEach((reply) => {
  //       if (reply.author.equals(req.user._id)) {
  //         const targetPost = commentsArray.find((savedPost) => savedPost._id.equals(post._id));
  //         targetPost.comments.push(comment);
  //       }
  //     });
  //   }
  //   if (object.replies && object.replies.length) {
  //     recursiveFind(object.replies)
  //   }
  // }
  Post.find().populate('author', '-_id type author community url privacy audiences timestamp lastUpdated lastEdited comments mentons tags pluses contentWarnings jsonBody comments.author comments.timestamp comments.jsonBody comments.replies.author comments.replies.timestamp comments.replies.jsonBody comments.replies.replies.author comments.replies.replies.timestamp comments.replies.replies.jsonBody comments.replies.replies.replies.author comments.replies.replies.replies.timestamp comments.replies.replies.replies.jsonBody').populate('author', 'username displayName -_id')
    .populate(
      'pluses',
      'username displayName -_id'
    )
    .populate(
      'community',
      'name -_id',
    )
    .populate('comments.author', 'username displayName -_id')
    .populate(
      'comments.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.replies.author',
      'username displayName -_id',
    )
    .populate(
      'comments.replies.replies.replies.replies.author',
      'username displayName -_id',
    ).then(async (posts) => {
      posts.forEach(async (post) => {
        if (!post.author.equals(req.user._id)) {
          // Find all comments made by user
          if (post.comments && post.comments.length) {
            recursiveFind(post, post, 0);
          }
        }
      });
    });
  posts = JSON.parse(JSON.stringify(posts));
  const recursiveProcessHTML = (object) => {
    const { document } = (new JSDOM(`...`)).window;
    const div = document.createElement("div");
    const node = Node.fromJSON(schema, object.jsonBody);
    const serializedFragment = serializer.serializeFragment(node, { "document": document });
    div.appendChild(serializedFragment);
    console.log(div.innerHTML)
    object.html = div.innerHTML;
    object.jsonBody = undefined;
    if (object.comments && object.comments.length) {
      object.comments.forEach((comment) => {
        recursiveProcessHTML(comment)
      });
    }
    if (object.replies && object.replies.length) {
      object.replies.forEach((reply) => {
        recursiveProcessHTML(reply)
      });
    }
  };
  if (posts.length) {
    posts.forEach((post) => {
      recursiveProcessHTML(post);
    });
  }
  const userJSON = JSON.stringify(user, null, 4);
  const votesJSON = JSON.stringify(votes, null, 4);
  const relationshipsJSON = JSON.stringify(relationships, null, 4);
  const postsJSON = JSON.stringify(posts, null, 4);
  const userFile = tempy.file({ extension: 'json' });
  const votesFile = tempy.file({ extension: 'json' });
  const relationshipsFile = tempy.file({ extension: 'json' });
  const postsFile = tempy.file({ extension: 'json' });
  await fs.writeFile(userFile, userJSON, (error) => {
    if (error) {
      console.log(error);
      return res.status(500).send(sendError(500, 'Unexpected error exporting user data.'))
    }
  });
  await fs.writeFile(votesFile, votesJSON, (error) => {
    if (error) {
      console.log(error);
      return res.status(500).send(sendError(500, 'Unexpected error exporting user data.'))
    }
  });
  await fs.writeFile(relationshipsFile, relationshipsJSON, (error) => {
    if (error) {
      console.log(error);
      return res.status(500).send(sendError(500, 'Unexpected error exporting user data.'))
    }
  });
  await fs.writeFile(postsFile, postsJSON, (error) => {
    if (error) {
      console.log(error);
      return res.status(500).send(sendError(500, 'Unexpected error exporting user data.'))
    }
  });
  let zip = new JSZip();
  zip.file("sweet-export/user.json", userJSON);

  res.send(data)
};

const deleteUser = async (req, res) => {
  console.log('Deleting user!');

  const recursiveParentDelete = (node) => {
    // Tracks up a node tree until it finds
    // an extant node, and deletes everything
    // below that node.
    // console.log('    ID:', node.id);
    if (node.parent.deleted) {
      // console.log('      (deleted)')
      recursiveParentDelete(node.parent);
    } else {
      // console.log('    Parent node extant, deleting this node')
      if (node.parent.replies) {
        node.parent.replies = node.parent.replies.filter(o => o._id.toString() !== node._id.toString());
      } else {
        node.parent.comments = node.parent.comments.filter(o => o._id.toString() !== node._id.toString());
      }
    }
  }

  const recursiveDelete = (tree, parent) => {
    tree.forEach((node, index) => {
      // console.log('-----------');
      // console.log('ID:', node.id);
      // console.log('Index:', index);
      let numberOfSiblings = parent.replies
        ? parent.replies.length - 1
        : parent.comments.length - 1;
      // console.log('Siblings:', numberOfSiblings);
      node.parent = parent;
      if (node.author.equals(req.user._id)) {
        // console.log(node.id, 'matches!');
        // Check if target has children
        if (node.replies && node.replies.length) {
          // console.log('This node has replies, wiping node data');
          // We feel sorry for the children - just wipe the target's memory
          node.parsedContent = '';
          node.rawContent = '';
          node.jsonBody = null;
          node.deleted = true;
        } else {
          // There are no children, the target can be destroyed
          // console.log('This node has no replies, deleting node');
          if (parent.replies) {
            parent.replies = parent.replies.filter((o) => o._id.toString() !== node._id.toString());
          } else {
            parent.comments = parent.comments.filter((o) => o._id.toString() !== node._id.toString());
          }
          if (numberOfSiblings === 0 && parent.deleted) {
            // There are also no siblings, and the element's parent
            // has been deleted, so we can even destroy that!
            // console.log('    Deleting node\'s parent(s)')
            recursiveParentDelete(node.parent)
          }
        }
      } else {
        // console.log(node.id, 'does not match, continuing...');
      }
      if (node.replies) {
        recursiveDelete(node.replies, node);
      }
    });
  }

  Post.find().then(async (posts) => {
    posts.forEach(async (post) => {
      // Edit the post, if it doesn't match the user's id
      if (!post.author.equals(req.user._id)) {
        // 1. Delete all comments made by user
        if (post.comments && post.comments.length) {
          recursiveDelete(post.comments, post);
        }

        // 2. Remove user from subscribed post users
        post.subscribedUsers = post.subscribedUsers.filter((v) => v.toString() !== req.user._id.toString());
        post.unsubscribedUsers = post.unsubscribedUsers.filter((v) => v.toString() !== req.user._id.toString());

        // 2b. Remove user from post's boosters
        if (post.boostsV2 && post.boostsV2.length) {
          post.boostsV2.forEach((boostDocument) => {
            if (boostDocument.booster.toString() === req.user._id.toString()) {
              Post.deleteOne({ _id: boostDocument.boost });
            }
          });
          post.boostsV2 = post.boostsV2.filter((v) => v.booster.toString() !== req.user._id.toString());
        }

        // 2c. Remove user from post's mentions
        post.mentions = post.mentions.filter((v) => v !== req.user.username);

        // 2d. Remove user from post's pluses
        post.pluses = post.pluses.filter((plus) => plus.author.toString() !== req.user._id.toString())
        post.numberOfPluses = post.pluses.length;

        const updatePost = await post.save();
      }

      // 3. Delete the post, if it matches
      if (post.author.equals(req.user._id)) {
        // Delete images
        const imageDocuments = await Image.find({ post: post._id });
        if (imageDocuments.length) {
          imageDocuments.forEach((image) => {
            s3.deleteObject({
              Bucket: 'sweet-images',
              Key: image.filename, // images/image.jpg
            })
              .promise()
              .catch((e) => console.log('Error deleting images with post', e));
            Image.deleteOne({ _id: image._id });
          });
        }

        // Update tags
        if (post.tags) {
          post.tags.forEach((tag) => {
            Tag.findOneAndUpdate({ name: tag }, { $pull: { posts: post._id } });
          });
        }

        // Delete boosts
        if (post.type === 'original' && post.boostsV2 && post.boostsV2.length) {
          post.boostsV2.forEach((boostDocument) => {
            Post.deleteOne({ _id: boostDocument.boost });
          });
        }

        // Delete notifications
        User.updateMany({}, { $pull: { notifications: { subjectId: post._id } } }).then(r => console.log(r)).catch(e => console.log(e));

        // Finally, delete the post!
        Post.deleteOne({ _id: post._id }).then(r => console.log(r)).catch(e => console.log(e));
      }
    });
  });

  console.log('1. Comments deleted');
  console.log('2. Subscriptions deleted');
  console.log('3a. Images deleted');
  console.log('3b. Tags updated');
  console.log('3c. Boosts deleted');
  console.log('3d. Notifications deleted');
  console.log('3e. Post deleted');


  // 4. Remove all user's remaining images
  const deleteImages = await Image.find({ author: req.user._id }).then(
    async (images) => {
      images.forEach(async (image) => {
        console.log('Deleting image')
        s3.deleteObject({
          Bucket: 'sweet-images',
          Key: image.filename, // [images/image.jpg]
        })
          .promise()
          .catch((e) => console.error('User deletion: error deleting image:', e));
        const deleteImage = await Image.deleteOne({ _id: image._id }).then(r => console.log(r)).catch(e => console.log(e));
      });
    });
  console.log('4. Images deleted');

  // 5. Remove user from communities
  const removeFromCommunities = await Community.updateMany(
    {},
    {
      $pull: {
        members: req.user._id,
        bannedMembers: req.user._id,
        mutedMembers: req.user._id,
        membershipRequests: req.user._id,
      },
    },
  ).then(r => console.log(r)).catch(e => console.log(e));
  console.log('5. User removed from communities');

  // 6a. Remove user from community votes
  const removeFromVotes = await Vote.updateMany({},
    { $pull: { voters: req.user._id } },
  ).then(r => console.log(r)).catch(e => console.log(e));
  console.log('5. User removed from community votes');

  // 6b. Remove user's community votes
  const removeVotes = await Vote.deleteMany({ creator: req.user._id }).then(r => console.log(r)).catch(e => console.log(e));
  console.log('6. User community votes removed');

  // 7. Remove user relationships
  const removeRelationships = await Relationship.deleteMany({ $or: [{ fromUser: req.user._id }, { toUser: req.user._id }] }).then(r => console.log(r)).catch(e => console.log(e));
  console.log('7. User removed from relationships');

  // 8. Remove all other notifications involving user
  User.updateMany(
    {},
    {
      $pull: {
        notifications: {
          $or: [{ sourceId: req.user._id }, { subjectId: req.user._id }],
        },
      },
    },
  )
    .then((r) => console.log(r))
    .catch((e) => console.log(e));
  console.log('8. User removed from notifications');

  // 9. Last but not least, delete the user
  User.deleteOne({ _id: req.user._id }).then((r) => console.log(r)).catch((e) => console.log(e));

  console.log('Done!');
  const sentEmail = await mailer.sendMail({
    from: '"Sweet Support" <support@sweet.sh>',
    to: '"Sweet Support" <support@sweet.sh>',
    subject: "Sweet - User deletion report",
    text: `Deleted user: @${req.user.username}\n
          Deletion time: ${new Date().toLocaleString("en-GB")}\n`,
  });
  res.status(200).send(sendResponse({ userDeleted: true }, 200, 'So long and thanks for all the fish.'));
};

module.exports = {
  acceptCoC,
  changeSettings,
  detailUser,
  getCoC,
  listUsers,
  listAllUsers,
  login,
  register,
  registerExpoToken,
  reportUser,
  deleteUser,
  exportUserData
};
