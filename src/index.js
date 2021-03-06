/* eslint-disable no-restricted-syntax */
require('dotenv').config();
require('regenerator-runtime/runtime');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');

const configDatabase = require('./config/database').config;
const { mailer } = require('./mailer');
const { authHandler } = require('./helpers/authHandler');
const { scrapeURL } = require('./utils');

const {
  registerExpoToken,
  register,
  login,
  listUsers,
  listAllUsers,
  detailUser,
  reportUser,
  changeSettings,
  getCoC,
  acceptCoC,
  deleteUser,
  exportUserData,
} = require('./modules/user/controller');
const {
  listPosts,
  plusPost,
  createPost,
  createComment,
  deleteComment,
  subscribeToPost,
  unsubscribeFromPost,
  deletePost,
  editPost,
} = require('./modules/post/controller');
const {
  listCommunities,
  detailCommunity,
  joinCommunity,
  leaveCommunity,
} = require('./modules/community/controller');
const { createRelationship } = require('./modules/relationship/controller');
const { createImage, rotateImage } = require('./modules/image/controller');
const { addToLibrary, removeFromLibrary } = require('./modules/library/controller');

const app = express();
const port = process.env.PORT || 8787;

// CORS
app.use(cors());

// Nodemailer
mailer.verify((error, success) => {
  if (error) {
    console.log('Email server error!');
    console.log(error);
  } else {
    console.log('Email server is ready to take our messages');
  }
});

mongoose.connect(configDatabase.url, { useNewUrlParser: true });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use('/api/*', authHandler);

app.post('/api/expo_token/register', registerExpoToken);
app.post('/api/register', register);
app.post('/api/login', login);

app.get('/api/posts/:context?/:timestamp?/:identifier?', listPosts);
app.post('/api/plus/:postid', plusPost);
app.post('/api/comment/:postid/:commentid?', createComment);

app.post('/api/post', createPost);
app.delete('/api/post', deletePost);
app.put('/api/post', editPost);

app.post('/api/comment', createComment);
app.delete('/api/comment', deleteComment);

app.post('/api/subscription', subscribeToPost);
app.delete('/api/subscription', unsubscribeFromPost);

app.get('/api/communities/all', listCommunities);
app.get('/api/communities/:communityid', detailCommunity);
app.post('/api/community/join', joinCommunity);
app.post('/api/community/leave', leaveCommunity);

app.get('/api/users/all', listAllUsers);
app.get('/api/users/:sortorder', listUsers);
app.get('/api/user/:identifier', detailUser);
app.post('/api/settings', changeSettings);
app.post('/api/report', reportUser);

app.delete('/api/user', deleteUser);

app.get('/api/user-export', exportUserData);

app.post('/api/relationship', createRelationship);

app.get('/api/code-of-conduct', getCoC);
app.post('/api/code-of-conduct/accept', acceptCoC);

app.post('/api/image', createImage);
app.post('/api/image/rotate', rotateImage);

app.post('/api/url-metadata', scrapeURL);

app.post('/api/library', addToLibrary);
app.delete('/api/library', removeFromLibrary);

app.listen(port);

console.log(`Server ready at http://localhost:${port}/`);

module.exports = app;
