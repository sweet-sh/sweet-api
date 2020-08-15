const { nanoid } = require('nanoid');
const { isObjectIdValid } = require('@/utils');
const notifier = require('@/helpers/notifier')
const { commentNotifier } = require('@/helpers/commentNotifier')
const { parseText } = require('@/helpers/parseText');
const { sendResponse, sendError } = require('@/utils')


const listPosts = async (req, res) => {
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
    case 'url':
      matchPosts = {
        url: req.params.identifier,
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
    // console.log('Processing', post._id)
    // figure out if there is a newer instance of the post we're looking at. if it's an original post, check the boosts from
    // the context's relevant users; if it's a boost, check the original post if we're in fluid mode to see if lastUpdated is more
    // recent (meaning the original was bumped up from recieving a comment) and then for both fluid and chronological we have to check
    // to see if there is a more recent boost.
    let newestVersion = post;
    let boostBlame;
    if (req.params.context !== 'single') {
      let isThereNewerInstance = false;
      if (post.type === 'original') {
        // console.log("An OG post!", post.rawContent)
        for (const boost of post.boostsV2) {
          if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
            // console.log("Got newer boost!", post.rawContent)
            isThereNewerInstance = true;
            newestVersion = boost;
          } else {
            // console.log("Boost older")
          }
        }
      } else if (post.type === 'boost') {
        if (post.boostTarget !== null) {
          // console.log("A boost!", post.boostTarget.rawContent)
          if (post.boostTarget.lastUpdated.getTime() > post.timestamp.getTime()) {
            // console.log("Got newer OG post!", post.boostTarget.rawContent)
            isThereNewerInstance = true;
            newestVersion = post.boostTarget;
          } else {
            // console.log("OG post older")
          }
          for (const boost of post.boostTarget.boostsV2) {
            if (boost.timestamp.getTime() > post.lastUpdated.getTime() && whosePostsCount.some(f => boost.booster.equals(f))) {
              // console.log("Got newer other boost!", post.boostTarget.rawContent)
              isThereNewerInstance = true;
              newestVersion = boost;
            } else {
              // console.log("Other boosts older")
            }
          }
        } else {
          // console.log('Error fetching boostTarget of boost');
          isThereNewerInstance = true;
        }
      }

      if (isThereNewerInstance) {
        // console.log("HIDING THIS POST")
        // console.log("====================================")
        continue;
      }
      // console.log("====================================")

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
      // console.log('+++++++++++++++++++++')
      // console.log(newestVersion)
      // console.log('+++++++++++++++++++++')
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
}

module.exports.listPosts = listPosts;


const plusPost = async (req, res) => {
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
}

module.exports.plusPost = plusPost;


/*
 * Responds to a post request that boosts a post.
 *
 * Inputs: id of the post to be boosted
 * Outputs: a new post of type boost, adds the id of that new post into the
 *   boosts field of the old post, sends a notification to the user whose post
 *   was boosted.
*/
const boostPost = async (req, res) => {
  let isCommunityBoost = false;
  let boostCommunity;
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
    const boost = {
      booster: req.user._id,
      community: isCommunityBoost ? boostCommunity._id : undefined,
      timestamp: boostedTimestamp,
      boost: savedBoost._id
    }
    boostedPost.boostsV2 = boostedPost.boostsV2.filter(boost => !boost.booster.equals(req.user._id))
    boostedPost.boostsV2.push(boost)
    boostedPost.save().then((boostedPost) => {
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
}

module.exports.boostPost = boostPost;


/* 
 * Responds to a post request that boosts a post.
 * Inputs: id of the post to be boosted
 * Outputs: a new post of type boost, adds the id of that new post into the
 *   boosts field of the old post, sends a notification to the user whose post
 *   was boosted.
*/
const unboostPost = async (req, res) {
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
}

const createPost = async (req, res) => {
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
}

module.exports.createPost = createPost;

const createComment = async (req, res) => {
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
          // console.log('Parent comment not found', req.params.commentid);
          return res.status(404).send(sendError(404, 'Parent comment not found'));
        } if (depth > 5) {
          // console.log('Comment too deep', depth);
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
            commentParent: commentParent,
            parsedPayload: parsedPayload,
          });
          return res.status(200).send(sendResponse(post, 200));
        });
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error saving comment'));
    });
}

module.exports.createComment = createComment;
