const canCommentOnPost = ({ user, post, communityId }) => {
  // Can't comment when logged out
  if (!user) {
    return false;
  }
  // Can't comment on Sweetbot's posts
  if (post.author.username === 'sweetbot') {
    return false;
  }
  // Can't comment on community posts from communities you're not a member of
  if (post.community) {
    return user.communities.length
      ? user.communities.some((v) => v.equals(post.community._id))
      : false;
  }
  return true;
};

module.exports = {
  canCommentOnPost,
}
