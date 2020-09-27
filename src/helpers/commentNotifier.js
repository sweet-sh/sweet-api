const User = require('../modules/user/model');
const Relationship = require('../modules/relationship/model');
const notifier = require('./notifier');

const commentNotifier = ({ comment, post, postAuthor, postPrivacy, commentAuthor, commentParent, mentions }) => {
  // Notify any and all interested parties
  User.findOne({ _id: postAuthor })
    .then((originalPoster) => {
      // NOTIFY EVERYONE WHO IS MENTIONED

      // we're never going to notify the author of the comment about them mentioning themself
      const workingMentions = mentions.filter(m => m !== commentAuthor.username)

      if (post.type === 'community') {
        workingMentions.forEach(function (mentionedUsername) {
          User.findOne({
            username: mentionedUsername
          }).then((mentionedUser) => {
            // within communities: notify the mentioned user if this post's community is one they belong to
            if (mentionedUser.communities.some(c => c.toString() === post.community.toString())) {
              notifier.notify({
                type: 'user',
                cause: 'mention',
                notifieeID: mentionedUser._id,
                sourceId: commentAuthor._id,
                subjectId: post._id,
                url: '/' + originalPoster.username + '/' + post.url,
                context: 'reply',
              })
            }
          }).catch(err => {
            console.log('could not find document for mentioned user ' + mentionedUsername + ', error:')
            console.log(err)
          })
        })
      } else {
        if (postPrivacy === 'private') {
          workingMentions.forEach(mentionedUsername => {
            User.findOne({
              username: mentionedUsername
            }).then(mentionedUser => {
              // Make sure to only notify mentioned people if they are trusted by the post's author (and can therefore see the post).
              // The post's author is implicitly trusted by the post's author
              if (mentionedUser._id.equals(originalPoster._id)) {
                notifier.notify({
                  type: 'user',
                  cause: 'mention',
                  notifieeID: mentionedUser._id,
                  sourceId: commentAuthor._id,
                  subjectId: post._id,
                  url: '/' + originalPoster.username + '/' + post.url,
                  context: 'reply',
                })
                return; // no need to go down there and check for relationships and stuff
              }
              Relationship.findOne({
                fromUser: originalPoster._id,
                toUser: mentionedUser._id,
                value: 'trust'
              }, {
                _id: 1
              }).then(theRelationshipExists => {
                if (theRelationshipExists) {
                  notifier.notify({
                    type: 'user',
                    cause: 'mention',
                    notifieeID: mentionedUser._id,
                    sourceId: commentAuthor._id,
                    subjectId: post._id,
                    url: '/' + originalPoster.username + '/' + post.url,
                    context: 'reply',
                  })
                }
              })
            }).catch(err => {
              console.log('could not find document for mentioned user ' + mentionedUsername + ', error:')
              console.log(err)
            })
          })
        } else if (postPrivacy === 'public') {
          workingMentions.forEach(function (mention) {
            User.findOne({
              username: mention
            })
              .then((mentionedGuy) => {
                // notify everyone
                notifier.notify({
                  type: 'user',
                  cause: 'mention',
                  notifieeID: mentionedGuy._id,
                  sourceId: commentAuthor._id,
                  subjectId: post._id,
                  url: '/' + originalPoster.username + '/' + post.url,
                  context: 'reply',
                })
              }).catch(err => {
                console.log('could not find document for mentioned user ' + mention + ', error:')
                console.log(err)
              })
          })
        }
      }

      // NOTIFY THE POST'S AUTHOR
      // Author doesn't need to know about their own comments, and about replies on your posts they're not subscribed to, and if they're @ed they already got a notification above
      if (!originalPoster._id.equals(commentAuthor._id) && (post.unsubscribedUsers.includes(originalPoster._id.toString()) === false) && (!mentions.includes(originalPoster.username))) {
        console.log('Notifying post author of a reply')
        notifier.notify({
          type: 'user',
          cause: 'reply',
          notifieeID: originalPoster._id,
          sourceId: commentAuthor._id,
          subjectId: post._id,
          url: '/' + originalPoster.username + '/' + post.url + '#comment-' + comment._id,
          context: 'post',
        })
      }

      // NOTIFY THE PARENT COMMENT'S AUTHOR
      // Author doesn't need to know about their own child comments,
      // and about replies on your posts they're not subscribed to,
      // and if they're @ed they already got a notification above,
      // and if they're the post's author as well as the parent
      // comment's author (they got a notification above for that
      // too)
      // First check if this comment even HAS a parent
      if (commentParent) {
        const parentCommentAuthor = commentParent.author
        if (
          !parentCommentAuthor._id.equals(commentAuthor._id) &&
          (!post.unsubscribedUsers.includes(parentCommentAuthor._id.toString())) &&
          (!mentions.includes(parentCommentAuthor.username)) &&
          (!originalPoster._id.equals(parentCommentAuthor._id))
        ) {
          console.log('Notifying parent comment author of a reply')
          notifier.notify({
            type: 'user',
            cause: 'commentReply',
            notifieeID: parentCommentAuthor._id,
            sourceId: commentAuthor._id,
            subjectId: post._id,
            url: '/' + originalPoster.username + '/' + post.url + '#comment-' + commentParent._id,
            context: 'post',
          })
        }
      }

      // NOTIFY PEOPLE WHO BOOSTED THE POST
      if (post.boostsV2.length > 0) {
        const boosterIDs = []
        post.populate('boostV2.booster', (err, populatedPost) => {
          if (err) {
            console.log('could not notify people who boosted post ' + post._id.toString() + ' of a recent reply:')
            console.log(err)
          } else {
            populatedPost.boostsV2.forEach(boost => {
              boosterIDs.push(boost.booster._id.toString())
              // make sure we're not notifying the person who left the comment (this will be necessary if they left it on their own boosted post)
              // and make sure we're not notifying the post's author (necessary if they boosted their own post) (they'll have gotten a notification above)
              // and make sure we're not notifying anyone who was @ed (they'll have gotten a notification above),
              // or anyone who unsubscribed from the post
              if (!boost.booster._id.equals(commentAuthor._id) &&
                !boost.booster._id.equals(originalPoster._id) &&
                !mentions.includes(boost.booster.username) &&
                !post.unsubscribedUsers.includes(boost.booster._id.toString())) {
                notifier.notify({
                  type: 'user',
                  cause: 'boostedPostReply',
                  notifieeID: boost.booster._id,
                  sourceId: commentAuthor._id,
                  subjectId: post._id,
                  url: '/' + originalPoster.username + '/' + post.url + '#comment-' + commentParent._id,
                  context: 'post',
                })
              }
            })
          }
          // if there are boosters, we notify the other "subscribers" here, because here we have the full list of
          // boosters and can check the subscribers against it before notifying them
          const workingSubscribers = post.subscribedUsers.filter(u => !boosterIDs.includes(u))
          notifySubscribers(workingSubscribers)
        })
      }

      // NOTIFY THE OTHER SUBSCRIBERS (PEOPLE WHO WERE MENTIONED IN THE ORGINAL POST AND THOSE WHO COMMENTED ON IT)

      // if there are boosts for this post, this was called a few lines up from here. otherwise, we do it now
      if (post.boostsV2.length === 0) {
        notifySubscribers(post.subscribedUsers)
      }

      // checks each subscriber for trustedness if this is a private post, notifies all of 'em otherwise
      function notifySubscribers(subscriberList) {
        if (postPrivacy === 'private') {
          subscriberList.forEach(subscriberID => {
            Relationship.findOne({
              fromUser: originalPoster._id,
              toUser: subscriberID,
              value: 'trust'
            }, {
              _id: 1
            }).then(theRelationshipExists => {
              if (theRelationshipExists) {
                notifySubscriber(subscriberID)
              }
            })
          })
        } else {
          subscriberList.forEach(subscriberID => {
            notifySubscriber(subscriberID)
          })
        }
      }

      function notifySubscriber(subscriberID) {
        if (
          // Do not notify the comment's author about the comment
          (subscriberID !== commentAuthor._id.toString()) &&
          // don't notify the post's author (because they get a
          // different notification, above)
          (subscriberID !== originalPoster._id.toString()) &&
          // don't notify unsubscribed users
          (!post.unsubscribedUsers.includes(subscriberID)) &&
          // don't notify parent comment author, if it's a child
          // comment (because they get a different notification,
          // above)
          (commentParent ? subscriberID !== commentParent.author._id.toString() : true)
        ) {
          console.log('Notifying subscribed user')
          User.findById(subscriberID).then((subscriber) => {
            if (!mentions.includes(subscriber.username)) {
              // don't notify people who are going to be notified
              // anyway bc they're mentioned in the new comment
              if (post.mentions.includes(subscriber.username)) {
                notifier.notify({
                  type: 'user',
                  cause: 'mentioningPostReply',
                  notifieeID: subscriberID,
                  sourceId: commentAuthor._id,
                  subjectId: post._id,
                  url: '/' + originalPoster.username + '/' + post.url + '#comment-' + commentParent._id,
                  context: 'post',
                })
              } else {
                notifier.notify({
                  type: 'user',
                  cause: 'subscribedReply',
                  notifieeID: subscriberID,
                  sourceId: commentAuthor._id,
                  subjectId: post._id,
                  url: '/' + originalPoster.username + '/' + post.url + '#comment-' + commentParent._id,
                  context: 'post',
                })
              }
            }
          }).catch(err => {
            console.log('could not find subscribed user ' + subscriberID + ', error:')
            console.log(err)
          })
        }
      }
    }).catch(err => {
      console.log("can't find author of commented-upon post, error:")
      console.log(err)
    })
}

module.exports = {
  commentNotifier,
};
