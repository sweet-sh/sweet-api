const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { isObjectIdValid, sendResponse, sendError } = require('../../utils');
const notifier = require('../../helpers/notifier');
const { commentNotifier } = require('../../helpers/commentNotifier');
const { parseText } = require('../../helpers/parseText');
const Community = require('../../modules/community/model');
const Image = require('../../modules/image/model');
const Post = require('../../modules/post/model');
const Relationship = require('../../modules/relationship/model');
const Tag = require('../../modules/tag/model');
const User = require('../../modules/user/model');
const { canCommentOnPost } = require('./rules');
const { collapseImages, findMentions } = require('./utils');

const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const {
  Schema,
  DOMParser,
  DOMSerializer,
  Node,
  Fragment,
} = require("prosemirror-model");
const { schema } = require("./reactNativePostSchema");
const serializer = DOMSerializer.fromSchema(schema);

const aws = require('aws-sdk');
const s3 = new aws.S3({
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET,
});

const listPosts = async (req, res) => {
  const timestamp = req.params.timestamp
    ? new Date(parseInt(req.params.timestamp))
    : Date.now();
  const postsPerPage = 20;

  // If we're looking for user or community posts, req.params.identifier might be a username
  // OR a MongoDB _id string. We need to work out which it is:
  let userIdentifier;
  let communityIdentifier;
  if (req.params.context === 'user') {
    if (isObjectIdValid(req.params.identifier)) {
      userIdentifier = req.params.identifier;
    } else {
      userIdentifier = (await User.findOne({ username: req.params.identifier }))
        ._id;
    }
  }
  if (req.params.context === 'community') {
    if (isObjectIdValid(req.params.identifier)) {
      communityIdentifier = req.params.identifier;
    } else {
      communityIdentifier = (await Community.findOne({ slug: req.params.identifier }))._id;
    }
  }

  const myFollowedUserIds = (
    await Relationship.find({ from: req.user.email, value: 'follow' })
  )
    .map((v) => v.toUser)
    .concat([req.user._id]);
  const myFlaggedUsers = (
    await Relationship.find({ fromUser: req.user._id, value: 'flag' })
  ).map((v) => v.toUser);
  const myMutedUserEmails = (
    await Relationship.find({ from: req.user.email, value: 'mute' })
  ).map((v) => v.to);
  const myTrustedUserEmails = (
    await Relationship.find({ from: req.user.email, value: 'trust' })
  ).map((v) => v.to);
  const usersFlaggedByMyTrustedUsers = (
    await Relationship.find({
      fromUser: { $in: myFlaggedUsers },
      value: 'flag',
    })
  ).map((v) => v.toUser);
  const usersWhoTrustMeEmails = (
    await Relationship.find({ to: req.user.email, value: 'trust' })
  )
    .map((v) => v.from)
    .concat([req.user.email]);
  const myCommunities = req.user.communities;
  let isMuted;
  if (req.params.context === 'community') {
    isMuted = (
      await Community.findById(communityIdentifier)
    ).mutedMembers.some((v) => v.equals(req.user._id));
  } else {
    isMuted = false;
  }
  const flagged = usersFlaggedByMyTrustedUsers
    .concat(myFlaggedUsers)
    .filter((e) => e !== req.user._id);

  let matchPosts;
  let sortMethod = '-lastUpdated';
  let thisComm;
  switch (req.params.context) {
    case 'home':
      // on the home page, we're looking for posts (and boosts) created by users we follow as well as posts in communities that we're in.
      // we're assuming the user is logged in if this request is being made (it's only made by code on a page that only loads if the user is logged in.)
      matchPosts = {
        $or: [
          {
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
      sortMethod = req.user.settings.homeTagTimelineSorting === 'fluid' ? '-lastUpdated' : '-timestamp'
      break;
    case 'user':
      // if we're on a user's page, obviously we want their posts:
      matchPosts = {
        author: userIdentifier,
        type: { $ne: 'draft' },
      };
      // but we also only want posts if they're non-community or they come from a community that we belong to:
      matchPosts.$or = [
        {
          community: {
            $exists: false,
          },
        },
        {
          community: {
            $in: myCommunities,
          },
        },
      ];
      sortMethod = req.user.settings.userTimelineSorting === 'fluid' ? '-lastUpdated' : '-timestamp'
      break;
    case 'community':
      thisComm = await Community.findById(communityIdentifier);
      // we want posts from the community, but only if it's public or we belong to it:
      if (
        thisComm.settings.visibility === 'public' ||
        myCommunities.some((v) => v.toString() === communityIdentifier.toString())
      ) {
        matchPosts = {
          community: communityIdentifier,
        };
      } else {
        // if we're not in the community and it's not public, there are no posts we're allowed to view!
        matchPosts = undefined;
      }
      sortMethod = req.user.settings.communityTimelineSorting === 'fluid' ? '-lastUpdated' : '-timestamp'
      break;
    case 'tag':
      const getTag = () => {
        return Tag.findOne({ name: req.params.identifier }).then((tag) => {
          return { _id: { $in: tag.posts }, type: { $ne: 'draft' } };
        });
      };
      matchPosts = await getTag();
      sortMethod = req.user.settings.homeTagTimelineSorting === 'fluid' ? '-lastUpdated' : '-timestamp'
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

  const query = Post.find(matchPosts)
    .sort(sortMethod)
    .limit(postsPerPage)
    // these populate commands retrieve the complete data for these things that are referenced in the post documents
    .populate('author', 'username email imageEnabled image displayName')
    .populate(
      'community',
      'name slug url imageEnabled image mutedMembers settings',
    )
    // If there's a better way to populate a nested tree lmk because this is... dumb. Mitch says: probably just fetching the authors recursively in actual code below
    .populate('comments.author', 'username imageEnabled image displayName')
    .populate(
      'comments.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate('boostTarget')
    .populate('boostsV2.booster', 'username imageEnabled image displayName')
    .populate(
      'boostsV2.community',
      'name slug url imageEnabled image mutedMembers settings',
    );

  // so this will be called when the query retrieves the posts we want
  const posts = await query;

  if (!posts || !posts.length) {
    return res.status(404).send(sendError(404, 'No posts found'));
  }

  const displayedPosts = []; // populated by the for loop below

  let whosePostsCount;
  if (req.params.context === 'user') {
    whosePostsCount = [ObjectId(userIdentifier)];
  } else if (req.params.context === 'home') {
    whosePostsCount = myFollowedUserIds;
  } else if (req.params.context === 'community') {
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
    if (req.params.context !== 'single' && req.params.context !== 'tag') {
      let isThereNewerInstance = false;
      if (post.type === 'original') {
        // console.log("An OG post!", post.rawContent)
        for (const boost of post.boostsV2) {
          if (
            boost.timestamp.getTime() > post.lastUpdated.getTime() &&
            whosePostsCount.some((f) => boost.booster.equals(f))
          ) {
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
          if (
            post.boostTarget.lastUpdated.getTime() > post.timestamp.getTime()
          ) {
            // console.log("Got newer OG post!", post.boostTarget.rawContent)
            isThereNewerInstance = true;
            newestVersion = post.boostTarget;
          } else {
            // console.log("OG post older")
          }
          for (const boost of post.boostTarget.boostsV2) {
            if (
              boost.timestamp.getTime() > post.lastUpdated.getTime() &&
              whosePostsCount.some((f) => boost.booster.equals(f))
            ) {
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
    if (
      (post.privacy === 'private' &&
        usersWhoTrustMeEmails.includes(post.author.email)) ||
      post.privacy === 'public'
    ) {
      canDisplay = true;
    }
    if (post.type === 'community') {
      // we don't have to check if the user is in the community before displaying posts to them if we're on the community's page, or if it's a single post page and: the community is public or the user wrote the post
      // in other words, we do have to check if the user is in the community if those things aren't true, hence the !
      if (
        !(
          req.params.context === 'community' ||
          (req.params.context === 'single' &&
            (post.author._id.equals(req.user._id) ||
              post.community.settings.visibility === 'public'))
        )
      ) {
        if (
          myCommunities.some((m) => m !== null && m.equals(post.community._id))
        ) {
          canDisplay = true;
        } else {
          canDisplay = false;
        }
      }
      // Hide muted community members
      const mutedMemberIds = post.community.mutedMembers.map((a) =>
        a._id.toString(),
      );
      if (mutedMemberIds.includes(post.author._id.toString())) {
        canDisplay = false;
      }
    }

    // As a final hurrah, just hide all posts and boosts made by users you've muted
    if (myMutedUserEmails.includes(post.author.email)) {
      canDisplay = false;
    }

    if (!canDisplay) {
      // console.log("Cannot display this post; hiding.")
      continue;
    }

    let displayContext;
    if (post.type === 'boost') {
      displayContext = post.boostTarget;
      displayContext.author = await User.findById(
        displayContext.author,
        'username imageEnabled image displayName',
      );
      displayContext.community = await Community.findById(
        post.community,
        'name slug url imageEnabled image mutedMembers settings',
      );
      for (const boost of displayContext.boostsV2) {
        boost.booster = await User.findById(
          boost.booster,
          'username imageEnabled image displayName',
        );
        boost.community = await Community.findById(
          boost.community,
          'name slug url imageEnabled image mutedMembers settings',
        );
      }
      displayContext.type = 'boost';

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
          boostBlame = {
            reason: 'communityBoost',
            culprit: newestVersion.author,
          };
        } else if (req.params.context === 'home') {
          boostBlame = { reason: 'followBoost', culprit: newestVersion.author };
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
      havePlused: displayContext.pluses.some((plus) =>
        plus.author._id.equals(req.user._id),
      ),
      isYourPost: isYourPost,
      viewingContext: req.params.context,
      // youBoosted: youBoosted,
      authorFlagged: flagged.some((v) => v.equals(displayContext.author._id)),
      boostBlame: displayContext.type === 'boost' ? boostBlame : undefined,
      canReply: canCommentOnPost({
        user: req.user,
        post: displayContext,
        communityId: req.params.identifier,
      }),
    };

    // get timestamps and full image urls for each comment
    const parseComments = (element, level) => {
      if (!level) {
        level = 1;
      }
      element.forEach(async (comment) => {
        if (!comment.deleted) {
          // We have to parse Prosemirror JSON into HTML for the web app - see below in the
          // post parser for an explanation
          // if (req.headers['user-agent'].includes('Expo')) {
          const { document } = (new JSDOM(`...`)).window;
          const div = document.createElement("div");
          const node = Node.fromJSON(schema, comment.jsonBody);
          const serializedFragment = serializer.serializeFragment(node, { "document": document });
          div.appendChild(serializedFragment);
          comment.renderedHTML = div.innerHTML;
          // }

          comment.authorFlagged = flagged.some((v) =>
            v.equals(comment.author._id),
          );
          comment.canDisplay = true;
          comment.muted = false;
          // I'm not sure why, but boosts in the home feed don't display
          // comment authors below the top level - this fixes it, but
          // it's kind of a hack - I can't work out what's going on
          if (!comment.author.username) {
            comment.author = await User.findById(
              comment.author,
              'username imageEnabled image displayName',
            );
          }
          if (myMutedUserEmails.includes(comment.author.email)) {
            comment.muted = true;
            comment.canDisplay = false;
          }
          for (let i = 0; i < comment.images.length; i++) {
            comment.images[i] = '/api/image/display/' + comment.images[i];
          }
          // If the comment's author is logged in, or the displayContext's author is logged in
          if (
            (comment.author._id.equals(req.user._id) ||
              displayContext.author._id.equals(req.user._id)) &&
            !comment.deleted
          ) {
            comment.canDelete = true;
          }
          if (level < 5) {
            comment.canReply = true;
          }
        }
        comment.level = level;
        if (comment.replies) {
          parseComments(comment.replies, level + 1);
        }
      });
    };
    parseComments(finalPost.comments);

    // Here we parse the Prosemirror JSON into HTML using a custom schema.
    // I hoped this would be unnecessary, but I can't find a good way for the React Native app
    // to parse PM into HTML as it doesn't have a DOM and I couldn't get JSDOM to work on it. So
    // we parse the HTML here and send it to the app.
    // if (req.headers['user-agent'].includes('Expo')) {
    const { document } = (new JSDOM(`...`)).window;
    const div = document.createElement("div");
    const node = Node.fromJSON(schema, finalPost.jsonBody);
    const serializedFragment = serializer.serializeFragment(node, { "document": document });
    div.appendChild(serializedFragment);
    finalPost.renderedHTML = div.innerHTML;
    // }



    // wow, finally.
    displayedPosts.push(finalPost);
  }
  return res.status(200).send(sendResponse(displayedPosts, 200));
};

const plusPost = async (req, res) => {
  let plusAction;
  Post.findOne(
    {
      _id: req.params.postid,
    },
    {
      url: 1,
      author: 1,
      pluses: 1,
      numberOfPluses: 1,
    },
  )
    .populate('author')
    .then((post) => {
      if (post.pluses.some((plus) => plus.author.equals(req.user._id))) {
        // This post already has a plus from this user, so we're unplussing it
        post.pluses = post.pluses.filter(
          (plus) => !plus.author.equals(req.user._id),
        );
        plusAction = 'remove';
      } else {
        post.pluses.push({
          author: req.user._id,
          type: 'plus',
          timestamp: new Date(),
        });
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
          });
        }
        return res
          .status(200)
          .send(sendResponse({ pluses: post.pluses, plusAction }, 200));
      });
    })
    .catch((error) => {
      console.log(error);
      return res
        .status(500)
        .send(sendError(500, 'Error fetching post to plus'));
    });
};

const boostPost = async (req, res) => {
  let isCommunityBoost = false;
  let boostCommunity;
  const boostedTimestamp = new Date();
  const boostedPost = await Post.findById(req.params.postid).populate('author');
  if (!boostedPost) {
    return res.status(404).send(sendError(404, 'Post not found.'));
  }
  if (boostedPost.privacy !== 'public') {
    return res
      .status(401)
      .send(sendError(401, 'Not authorised to boost this post.'));
  }
  if (req.params.locationid) {
    boostCommunity = await Community.findById(req.params.locationid);
    if (!boostCommunity) {
      return res.status(404).send(sendError(404, 'Community not found.'));
    }
    isCommunityBoost = true;
  }
  const boost = new Post({
    type: 'boost',
    community: isCommunityBoost ? boostCommunity._id : undefined,
    author: req.user._id,
    url: nanoid(),
    privacy: 'public',
    timestamp: boostedTimestamp,
    lastUpdated: boostedTimestamp,
    boostTarget: boostedPost._id,
  });
  boost.save().then((savedBoost) => {
    const boost = {
      booster: req.user._id,
      community: isCommunityBoost ? boostCommunity._id : undefined,
      timestamp: boostedTimestamp,
      boost: savedBoost._id,
    };
    boostedPost.boostsV2 = boostedPost.boostsV2.filter(
      (boost) => !boost.booster.equals(req.user._id),
    );
    boostedPost.boostsV2.push(boost);
    boostedPost.save().then((boostedPost) => {
      // don't notify the original post's author if they're creating the boost or are unsubscribed from this post
      if (
        !boostedPost.unsubscribedUsers.includes(
          boostedPost.author._id.toString(),
        ) &&
        !boostedPost.author._id.equals(req.user._id)
      ) {
        notifier.notify({
          type: 'user',
          cause: 'boost',
          notifieeID: boostedPost.author._id,
          sourceId: req.user._id,
          subjectId: null,
          url: '/' + boostedPost.author.username + '/' + boostedPost.url,
          context: 'post',
        });
      }
      return res
        .status(200)
        .send(sendResponse({ boosts: boostedPost.boosts }, 200));
    });
  });
};

const unboostPost = async (req, res) => {
  Post.findOne(
    { _id: req.params.postid },
    { boostsV2: 1, privacy: 1, author: 1, url: 1, timestamp: 1 },
  ).then((boostedPost) => {
    const boost = boostedPost.boostsV2.find((b) => {
      return b.booster.equals(req.user._id);
    });
    boostedPost.boostsV2 = boostedPost.boostsV2.filter((boost) => {
      return !boost.booster.equals(req.user._id);
    });
    Post.deleteOne(
      {
        _id: boost.boost,
      },
      function () {
        console.log('delete');
      },
    );
    boostedPost.save().then(() => {
      res.redirect('back');
    });
  });
};

const createPost = async (req, res) => {
  console.log(req.body);
  const { source, context, contextId, body, contentWarning, tags, audience } = req.body;

  if (!body) {
    return res.status(404).send(sendError(404, 'Post content empty'));
  }

  // Posts sent by the mobile app have a different payload
  let isCommunityPost;
  let communityId;
  let parsedAudience;
  let parsedBody;
  let extractedImages;
  let parsedMentions;
  let parsedTags;
  if (source === 'mobile') {
    const parsedPayload = parseText(body);
    isCommunityPost = req.body.isCommunityPost || false;
    communityId = isCommunityPost
      ? contextId
        ? contextId
        : req.body.communityId
      : undefined;
    // We're doing this manually before we transition to the actual audiences API
    parsedAudience = [req.body.isPrivate ? 'private' : 'public'];
    parsedBody = parsedPayload.json;
    // Manually creating a parsable array out of what the mobile app sends
    extractedImages = req.body.images ? req.body.images.map((s) => ({ src: `images/${s}`, alt: null })) : [];
    if (extractedImages.length) {
      console.log("Let's go!");
      // We need to append our extracted images to the Prosemirror JSON object... manually.
      // May God forgive us for our sins
      // We know that we can only have up to four images per mobile post, so that's always
      // just one gallery (but let's double check anyway)
      // Terrifying chunking function from https://stackoverflow.com/a/37826698
      const chunkArray = (inputArray, perChunk) => {
        return inputArray.reduce((all, one, i) => {
          const ch = Math.floor(i / perChunk);
          all[ch] = [].concat((all[ch] || []), one);
          return all;
        }, []);
      };
      console.log(JSON.stringify(parsedBody));
      const chunks = chunkArray(extractedImages, 4);
      chunks.forEach((chunk) => {
        const galleryObject = {
          type: 'gallery',
          content: chunk.map((image) => ({ type: 'image', attrs: image })),
        };
        parsedBody.content.push(galleryObject);
      });
    }
    console.log(JSON.stringify(parsedBody));
    parsedMentions = parsedPayload.mentions;
    parsedTags = parsedPayload.tags;
  } else {
    isCommunityPost = context === 'community' && contextId !== null;
    communityId = contextId;
    // We're doing this manually before we transition to the actual audiences API
    parsedAudience = audience ? audience.map((o) => o.value) : [];
    const bodyReturn = collapseImages(body);
    parsedBody = bodyReturn.parsedBody;
    extractedImages = bodyReturn.extractedImages;
    parsedMentions = findMentions(parsedBody);
    parsedTags = tags;
  }

  const newPostUrl = nanoid();
  const postCreationTime = new Date();

  const post = new Post({
    type: isCommunityPost ? 'community' : 'original',
    community: communityId,
    author: req.user._id,
    url: newPostUrl,
    audiences: parsedAudience,
    privacy: parsedAudience.includes('public') ? 'public' : 'private',
    timestamp: postCreationTime,
    lastUpdated: postCreationTime,
    numberOfComments: 0,
    mentions: parsedMentions,
    tags: parsedTags,
    contentWarnings: contentWarning,
    subscribedUsers: [req.user._id],
    jsonBody: parsedBody,
  });

  console.log(post);

  const newPostId = post._id;

  if (extractedImages && extractedImages.length) {
    extractedImages.forEach(async (attrs) => {
      const image = new Image({
        context: isCommunityPost ? 'community' : 'user',
        filename: attrs.src,
        url: `https://sweet-images.s3.eu-west-2.amazonaws.com/${attrs.src}`,
        privacy: parsedAudience.includes('public') ? 'public' : 'private',
        user: req.user._id,
        post: newPostId,
      });
      await image.save();
    });
  }


  for (const mention of parsedMentions) {
    if (mention !== req.user.username) {
      User.findOne({ username: mention }).then(async (mentioned) => {
        if (isCommunityPost) {
          if (mentioned.communities.some((v) => v.equals(post.community))) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: newPostId,
              url: `/${req.user.username}/${newPostUrl}`,
              context: 'post',
            });
          }
        } else if (parsedAudience.includes('public') === false) {
          if (
            await Relationship.findOne({
              value: 'trust',
              fromUser: req.user._id,
              toUser: mentioned._id,
            })
          ) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: newPostId,
              url: `/${req.user.username}/${newPostUrl}`,
              context: 'post',
            });
          }
        } else {
          notifier.notify({
            type: 'user',
            cause: 'mention',
            notifieeID: mentioned._id,
            sourceId: req.user._id,
            subjectId: newPostId,
            url: `/${req.user.username}/${newPostUrl}`,
            context: 'post',
          });
        }
      });
    }
  }

  for (const tag of parsedTags) {
    Tag.findOneAndUpdate(
      { name: tag },
      {
        $push: { posts: newPostId.toString() },
        $set: { lastUpdated: postCreationTime },
      },
      { upsert: true, new: true },
      () => { },
    );
  }

  if (isCommunityPost) {
    Community.findOneAndUpdate(
      { _id: req.body.communityId },
      { $set: { lastUpdated: new Date() } },
    );
  }

  await post
    .save()
    .then((response) => res.status(200).send(sendResponse(response, 200)));
};

// const createPostV1 = async (req, res) => {
//   const postContent = req.body.content;
//   const {
//     contentWarning,
//     isPrivate,
//     isCommunityPost,
//     isDraft,
//   } = req.body;

//   if (!postContent) {
//     return res.status(404).send(sendError(404, 'Post content empty'));
//   }
//   const parsedPayload = parseText(postContent);
//   const inlineElements = {
//     type: 'image(s)',
//     images: req.body.images,
//     position: parsedPayload.array.length, // At the end of the post
//   };

//   const newPostUrl = nanoid();
//   const postCreationTime = new Date();

//   const post = new Post({
//     type: isCommunityPost ? 'community' : isDraft ? 'draft' : 'original',
//     community: isCommunityPost ? req.body.communityId : undefined,
//     authorEmail: req.user.email,
//     author: req.user._id,
//     url: newPostUrl,
//     // Community posts are always public, drafts are always private, otherwise we check the privacy setting
//     privacy: isCommunityPost ? 'public' : isDraft ? 'private' : isPrivate ? 'private' : 'public',
//     timestamp: postCreationTime,
//     lastUpdated: postCreationTime,
//     rawContent: req.body.content,
//     parsedContent: parsedPayload.text,
//     numberOfComments: 0,
//     mentions: parsedPayload.mentions,
//     tags: parsedPayload.tags,
//     contentWarnings: contentWarning,
//     imageVersion: 3,
//     inlineElements: req.body.images ? inlineElements : undefined,
//     subscribedUsers: [req.user._id],
//   });

//   if (req.body.images) {
//     req.body.images.forEach(async (filename) => {
//       const image = new Image({
//         context: isCommunityPost ? 'community' : 'user',
//         filename: `images/${filename}`,
//         url: `https://sweet-images.s3.eu-west-2.amazonaws.com/images/${filename}`,
//         privacy: isPrivate ? 'private' : 'public',
//         user: req.user._id,
//         // DEBUG: NOT YET ENABLED
//         // quality: postImageQuality,
//         // height: metadata.height,
//         // width: metadata.width
//       });
//       await image.save();
//     });
//   }

//   const newPostId = post._id

//   for (const mention of parsedPayload.mentions) {
//     if (mention !== req.user.username) {
//       User.findOne({ username: mention }).then(async mentioned => {
//         if (isCommunityPost) {
//           if (mentioned.communities.some(v => v.equals(post.community))) {
//             notifier.notify({
//               type: 'user',
//               cause: 'mention',
//               notifieeID: mentioned._id,
//               sourceId: req.user._id,
//               subjectId: newPostId,
//               url: '/' + req.user.username + '/' + newPostUrl,
//               context: 'post',
//             })
//           }
//         } else if (req.body.postPrivacy === 'private') {
//           if (await Relationship.findOne({ value: 'trust', fromUser: req.user._id, toUser: mentioned._id })) {
//             notifier.notify({
//               type: 'user',
//               cause: 'mention',
//               notifieeID: mentioned._id,
//               sourceId: req.user._id,
//               subjectId: newPostId,
//               url: '/' + req.user.username + '/' + newPostUrl,
//               context: 'post',
//             })
//           }
//         } else {
//           notifier.notify({
//             type: 'user',
//             cause: 'mention',
//             notifieeID: mentioned._id,
//             sourceId: req.user._id,
//             subjectId: newPostId,
//             url: '/' + req.user.username + '/' + newPostUrl,
//             context: 'post',
//           })
//         }
//       })
//     }
//   }

//   for (const tag of parsedPayload.tags) {
//     Tag.findOneAndUpdate(
//       { name: tag },
//       { $push: { posts: newPostId.toString() }, $set: { lastUpdated: postCreationTime } },
//       { upsert: true, new: true },
//       () => { }
//     )
//   }

//   if (isCommunityPost) {
//     Community.findOneAndUpdate({ _id: req.body.communityId }, { $set: { lastUpdated: new Date() } })
//   }

//   await post.save()
//     .then((response) => {
//       return res.status(200).send(sendResponse(response, 200));
//     });
// }

const createComment = async (req, res) => {
  // loop over the array of comments adding 1 +  countComments on its replies to the count variable.
  const countComments = (comments) => {
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
  };

  const findCommentByID = (id, comments, depth = 1) => {
    for (const comment of comments) {
      if (comment._id.equals(id)) {
        return { directParent: comment, depth };
      } else if (comment.replies.length > 0) {
        const searchReplies = findCommentByID(id, comment.replies, depth + 1);
        if (searchReplies !== 0) {
          return searchReplies;
        }
      }
    }
    return 0;
  };

  // Starts here

  console.log(req.body);
  const { source, body, parentPost, parentComment } = req.body;
  if (!body) {
    return res.status(404).send(sendError(404, 'Comment content empty'));
  }
  if (!parentPost) {
    return res.status(404).send(sendError(404, 'No comment parent specified'));
  }

  const commentCreationTime = new Date();

  const commentId = ObjectId();

  let parsedBody;
  let extractedImages;
  let parsedMentions;

  // See createPost() for more on this
  if (source === 'mobile') {
    const parsedPayload = parseText(body);
    parsedBody = parsedPayload.json;
    console.log(JSON.stringify(parsedBody));
    // Manually creating a parsable array out of what the mobile app sends
    extractedImages = req.body.images ? req.body.images.map((s) => ({ src: `images/${s}`, alt: null })) : [];
    // A copy of the function from createPost() - this should be made into a utility function
    if (extractedImages.length) {
      const chunkArray = (inputArray, perChunk) => {
        return inputArray.reduce((all, one, i) => {
          const ch = Math.floor(i / perChunk);
          all[ch] = [].concat((all[ch] || []), one);
          return all;
        }, []);
      };
      const chunks = chunkArray(extractedImages, 4);
      chunks.forEach((chunk) => {
        const galleryObject = {
          type: 'gallery',
          content: chunk.map((image) => ({ type: 'image', attrs: image })),
        };
        parsedBody.content.push(galleryObject);
      });
    }
    parsedMentions = parsedPayload.mentions;
  } else {
    const bodyReturn = collapseImages(body);
    parsedBody = bodyReturn.parsedBody;
    extractedImages = bodyReturn.extractedImages;
    parsedMentions = findMentions(parsedBody);
  }

  const comment = {
    _id: commentId,
    author: req.user._id,
    timestamp: commentCreationTime,
    jsonBody: parsedBody,
    mentions: parsedMentions,
  };

  Post.findOne({ _id: parentPost })
    .populate('author', 'username email imageEnabled image displayName')
    .then(async (post) => {
      let postType;
      let postPrivacy;
      if (post.communityId) {
        postType = 'community';
        postPrivacy = (await Community.findById(post.communityId)).settings
          .visibility;
      } else {
        postType = 'original';
        postPrivacy = post.privacy;
      }
      let depth;
      let directParent;
      if (!parentComment) {
        depth = 1;
        directParent = undefined;
        // This is a top level comment with no direct parent (identified by parentComment)
        post.comments.push(comment);
      } else {
        // This is a child level comment so we have to drill through the comments
        // until we find it
        ({ directParent, depth } = findCommentByID(
          parentComment,
          post.comments,
        ));
        if (!directParent) {
          return res
            .status(404)
            .send(sendError(404, 'Parent comment not found'));
        }
        if (depth > 5) {
          return res.status(404).send(sendError(404, 'Comment too deep'));
        }
        directParent.replies.push(comment);
      }

      post.numberOfComments = countComments(post.comments);
      post.lastUpdated = new Date();

      // Add user to subscribed users for post
      if (
        !post.author._id.equals(req.user._id) &&
        !post.subscribedUsers.includes(req.user._id.toString())
      ) {
        // Don't subscribe to your own post, or to a post you're already subscribed to
        post.subscribedUsers.push(req.user._id.toString());
      }

      if (extractedImages) {
        extractedImages.forEach(async (attrs) => {
          const image = new Image({
            context: postType === 'community' ? 'community' : 'user',
            filename: attrs.src,
            url: `https://sweet-images.s3.eu-west-2.amazonaws.com/${attrs.src}`,
            privacy: postPrivacy,
            user: req.user._id,
            post: post._id,
          });
          await image.save();
        });
      }

      post.save().then(async () => {
        commentNotifier({
          comment,
          post,
          postAuthor: post.author,
          postPrivacy,
          commentAuthor: req.user,
          commentParent: directParent,
          mentions: parsedMentions,
        });
        comment.author = await User.findById(comment.author, 'username imageEnabled image displayName');
        comment.canDisplay = true;
        comment.canReply = true;
        comment.canDelete = true;
        return res
          .status(200)
          .send(sendResponse({ parentPost, parentComment, comment }, 200));
      });
    })
    .catch((error) => {
      console.error(error);
      return res.status(500).send(sendError(500, 'Error saving comment'));
    });
};

const deleteComment = async (req, res) => {
  if (!req.body.postId || !req.body.commentId) {
    return res
      .status(404)
      .send(sendError(404, 'Comment or post ID not specified.'));
  }
  Post.findOne({ _id: req.body.postId }).then((post) => {
    let commentsByUser = 0;
    let latestTimestamp = 0;
    let numberOfComments = 0;
    let target;

    function findNested(array, id, parent) {
      array.forEach((element) => {
        if (!element.deleted) {
          numberOfComments++;
        }
        if (
          element.author.toString() === req.user._id.toString() &&
          !element.deleted
        ) {
          commentsByUser++;
        }
        if (element.timestamp > latestTimestamp) {
          latestTimestamp = element.timestamp;
        }
        element.numberOfSiblings = parent.replies
          ? parent.replies.length - 1
          : post.comments.length - 1;
        element.parent = parent;
        if (!target && element._id && element._id.equals(id)) {
          target = element;
          commentsByUser--;
          numberOfComments--;
          console.log('numberOfComments', numberOfComments);
        }
        if (element.replies) {
          findNested(element.replies, id, element);
        }
      });
    }

    findNested(post.comments, req.body.commentId, post);
    if (target) {
      post.numberOfComments = numberOfComments;
    }

    // i'll be impressed if someone trips this one, comment ids aren't displayed for comments that the logged in user didn't make
    if (
      !target.author.equals(req.user._id) &&
      post.author.toString() !== req.user._id.toString()
    ) {
      res
        .status(400)
        .send(
          "you do not appear to be who you would like us to think that you are! this comment ain't got your brand on it",
        );
      return;
    }

    if (target.images && target.images.length) {
      for (const image of target.images) {
        s3.deleteObject({
          Bucket: 'sweet-images',
          Key: image, // [images/image.jpg]
        })
          .promise()
          .catch((e) => console.error('Error deleting images with comment', e));
        Image.deleteOne({ filename: image });
      }
    } else if (target.inlineElements && target.inlineElements.length) {
      for (const ie of target.inlineElements) {
        if (ie.type === 'image(s)') {
          for (const image of ie.images) {
            s3.deleteObject({
              Bucket: 'sweet-images',
              Key: image, // [images/image.jpg]
            })
              .promise()
              .catch((e) =>
                console.error('Error deleting images with comment', e),
              );
            Image.deleteOne({ filename: image });
          }
        }
      }
    }

    // Check if target has children
    if (target.replies && target.replies.length) {
      // We feel sorry for the children - just wipe the target's memory
      target.parsedContent = '';
      target.rawContent = '';
      target.jsonBody = null;
      target.deleted = true;
    } else {
      // There are no children, the target can be destroyed
      target.remove();
      if (target.numberOfSiblings === 0 && target.parent.deleted) {
        // There are also no siblings, and the element's parent
        // has been deleted, so we can even destroy that!
        target.parent.remove();
      }
    }

    post
      .save()
      .then((comment) => {
        post.lastUpdated = latestTimestamp;
        // unsubscribe the author of the deleted comment from the post if they have no other comments on it
        if (commentsByUser === 0) {
          post.subscribedUsers = post.subscribedUsers.filter((v, i, a) => {
            return v !== req.user._id.toString();
          });
          post.save().catch((err) => {
            console.error(err);
          });
        }
        const response = {
          numberOfComments: numberOfComments,
        };
        return res.status(200).send(sendResponse(response, 200));
      })
      .catch((error) => {
        console.error(error);
        return res
          .status(500)
          .send(sendError(500, 'Unexpected error deleting comment.'));
      });
  });
};

const unsubscribeFromPost = (req, res) => {
  Post.findOne({
    _id: req.body.postId,
  }).then(async (post) => {
    if (post.type === 'boost') {
      post = await Post.findById(post.boostTarget)
    }
    post.subscribedUsers.pull(req.user._id)
    post.unsubscribedUsers.push(req.user._id)
    post.save()
      .then(() => res.sendStatus(200))
      .catch((error) => {
        console.error(error);
        return res
          .status(500)
          .send(sendError(500, 'Unexpected error unsubscribing from post.'));
      });
  });
};

const subscribeToPost = (req, res) => {
  Post.findOne({
    _id: req.body.postId,
  }).then(async (post) => {
    if (post.type === 'boost') {
      post = await Post.findById(post.boostTarget);
    }
    post.unsubscribedUsers.pull(req.user._id);
    post.subscribedUsers.push(req.user._id);
    post
      .save()
      .then(() => res.sendStatus(200))
      .catch((error) => {
        console.log(error);
        return res
          .status(500)
          .send(sendError(500, 'Unexpected error subscribing to post.'));
      });
  });
};

const deletePost = async (req, res) => {
  const post = await Post.findById(req.body.postId);
  if (!post) {
    return res.status(404).send(sendError(404, 'Post not found.'));
  }
  if (!post.author._id.equals(req.user._id)) {
    return res.status(404).send(sendError(404, 'This post cannot be deleted.'));
  }

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
      Image.deleteOne({ _id: image._id }).then(response => console.log(response));
    });
  }

  // Delete tags (does not currently fix tag last updated time)
  if (post.tags) {
    post.tags.forEach((tag) => {
      Tag.findOneAndUpdate({ name: tag }, { $pull: { posts: post._id } })
        .then((updatedTag) => {
          console.log(`Deleted post from tag: ${updatedTag}`)
        })
        .catch((err) => {
          console.log('Database error while attempting to delete post from tag:', err)
        });
    });
  }

  // Delete boosts
  if (post.type === 'original' && post.boostsV2) {
    post.boostsV2.forEach((boostDocument) => {
      Post.deleteOne({ _id: boostDocument.boost })
        .then((deletedBoost) => {
          console.log(`Deleted boost: ${deletedBoost}`)
        })
        .catch((err) => {
          console.log('Database error while attempting to delete boost while deleting post:', err);
        });
    });
  }

  // Delete notifications
  User.update({}, { $pull: { notifications: { subjectId: post._id } } }, { multi: true }).then(response => { console.log(response) });

  // Finally, delete the post!
  Post.deleteOne({ _id: post._id })
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.log('Error while attempting to delete post:', err);
    });
};

const editPost = async (req, res) => {
  console.log(req.body);
  const { postId, context, contextId, body, contentWarning, tags, audience } = req.body;
  const isCommunityPost = context === 'community' && contextId !== null;
  if (!body) {
    return res.status(404).send(sendError(404, 'Post content empty'));
  }
  const post = await Post.findById(postId)
  if (!post.author._id.equals(req.user._id)) {
    return res.status(403).send(sendError(403, 'Not authorised to edit this post'));
  }

  const parsedAudience = audience ? audience.map((o) => o.value) : [];

  const { parsedBody, extractedImages } = collapseImages(body);

  const oldPostImages = await Image.find({ post: post._id });

  const mentions = findMentions(parsedBody);

  /* IMAGES */

  // First, check if any images have been deleted from the old post
  // Returns any images from oldPostImages which are not present in extractedImages (new post images)
  const imagesToDelete = oldPostImages.filter((oldImage) => !extractedImages.some((newImage) => newImage.src === oldImage.filename));
  for (const image of imagesToDelete) {
    Image.deleteOne({ _id: image._id });
    s3.deleteObject({
      Bucket: 'sweet-images',
      Key: image.filename, // images/image.jpg
    })
      .promise()
      .catch((e) => console.error('Error deleting unused images from edited post', e));
  }
  // Next, add any new images
  if (extractedImages) {
    extractedImages.forEach(async (attrs) => {
      const imageExists = await Image.findOne({ filename: attrs.src });
      if (!imageExists) {
        const image = new Image({
          context: isCommunityPost ? 'community' : 'user',
          filename: attrs.src,
          url: `https://sweet-images.s3.eu-west-2.amazonaws.com/${attrs.src}`,
          privacy: parsedAudience.includes('public') ? 'public' : 'private',
          user: req.user._id,
          post: post._id,
        });
        await image.save();
      }
    });
  }

  const newMentions = mentions.filter((v) => !post.mentions.includes(v));
  for (const mention of newMentions) {
    if (mention !== req.user.username) {
      User.findOne({ username: mention }).then(async (mentioned) => {
        if (isCommunityPost) {
          if (mentioned.communities.some((v) => v.equals(post.community))) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: post._id,
              url: `/${req.user.username}/${newPostUrl}`,
              context: 'post',
            });
          }
        } else if (parsedAudience.includes('public') === false) {
          if (
            await Relationship.findOne({
              value: 'trust',
              fromUser: req.user._id,
              toUser: mentioned._id,
            })
          ) {
            notifier.notify({
              type: 'user',
              cause: 'mention',
              notifieeID: mentioned._id,
              sourceId: req.user._id,
              subjectId: post._id,
              url: `/${req.user.username}/${newPostUrl}`,
              context: 'post',
            });
          }
        } else {
          notifier.notify({
            type: 'user',
            cause: 'mention',
            notifieeID: mentioned._id,
            sourceId: req.user._id,
            subjectId: post._id,
            url: `/${req.user.username}/${newPostUrl}`,
            context: 'post',
          });
        }
      });
    }
  }

  const newTags = tags.filter((v) => !post.tags.includes(v));
  for (const tag of newTags) {
    Tag.findOneAndUpdate(
      { name: tag },
      {
        $push: { posts: post._id.toString() },
        $set: { lastUpdated: new Date() },
      },
      { upsert: true, new: true },
      () => { },
    );
  }
  const deletedTags = post.tags.filter((v) => !tags.includes(v));
  for (const tag of deletedTags) {
    Tag.findOneAndUpdate({ name: tag }, { $pull: { posts: post._id.toString() } }).catch(err => console.error(`Could not remove edited post ${post._id.toString()} from tag ${tag}\n${err}`));
  }

  post.audience = parsedAudience;
  post.privacy = parsedAudience.includes('public') ? 'public' : 'private';
  post.lastEdited = Date.now();
  post.mentions = mentions;
  post.tags = tags;
  post.contentWarnings = contentWarning;
  post.jsonBody = parsedBody;

  await post.save();

  const editedPost = await Post.findById(post._id)
    .populate('author', 'username email imageEnabled image displayName')
    .populate(
      'community',
      'name slug url imageEnabled image mutedMembers settings',
    )
    // If there's a better way to populate a nested tree lmk because this is... dumb. Mitch says: probably just fetching the authors recursively in actual code below
    .populate('comments.author', 'username imageEnabled image displayName')
    .populate(
      'comments.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate(
      'comments.replies.replies.replies.replies.author',
      'username imageEnabled image displayName',
    )
    .populate('boostTarget')
    .populate('boostsV2.booster', 'username imageEnabled image displayName')
    .populate(
      'boostsV2.community',
      'name slug url imageEnabled image mutedMembers settings',
    )
    .then((response) => {
      response.canReply = true;
      response.isYourPost = true;
      return res.status(200).send(sendResponse(response, 200));
    });
};

module.exports = {
  listPosts,
  plusPost,
  boostPost,
  unboostPost,
  createPost,
  createComment,
  deleteComment,
  subscribeToPost,
  unsubscribeFromPost,
  deletePost,
  editPost,
};
