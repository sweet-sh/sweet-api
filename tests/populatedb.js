const bcrypt = require('bcrypt');
const User = require('../src/modules/user/model');

function getPasswordHash(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
}

const sampleUser = {
  joined: new Date(),
  lastOnline: new Date(),
  lastUpdated: new Date(),
  isVerified: true,
  verificationToken: "abc123",
  verificationTokenExpiry: new Date(),
  acceptedCodeOfConduct: true,
  email: 'test@example.com',
  username: 'test',
  password: getPasswordHash('foobar'),
  passwordResetToken: '',
  passwordResetTokenExpiry: new Date(),
  image: '',
  imageEnabled: false,
  displayName: 'Test',
  pronouns: 'they/them',
  aboutRaw: '',
  aboutParsed: '',
  websiteRaw: '',
  websiteParsed: '',
  location: '',
  settings: {
    theme: 'light',
    timezone: 'UTC',
    autoDetectedTimeZone: 'UTC',
    profileVisibility: 'invisible',
    newPostPrivacy: 'public',
    imageQuality: 'standard',
    homeTagTimelineSorting: 'fluid',
    userTimelineSorting: 'chronological',
    communityTimelineSorting: 'fluid',
    flashRecentComments: true,
    digestEmailFrequency: 'off',
    emailTime: '17:00',
    emailDay: 'Sunday',
    showRecommendations: true,
    showHashtags: true,
    sendMentionEmails: true,
    sendMobileNotifications: true
  },
  notifications: [],
  pushNotifSubscriptions: [],
  expoPushTokens: [],
  communities: [],
  bannedCommunities: [],
  mutedCommunities: [],
  hiddenRecommendedUsers: [],
  hiddenRecommendedCommunities: []
};

module.exports = {
  sampleUser,
};
