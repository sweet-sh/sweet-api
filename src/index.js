/* eslint-disable no-restricted-syntax */
require('dotenv').config();
require("regenerator-runtime/runtime");
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const configDatabase = require('./database').config;
const { transporter } = require('./mailer');
const { authHandler } = require('./helpers/authHandler');

const {
  registerExpoToken,
  register,
  login,
  listUsers,
  detailUser,
  reportUser,
  changeSettings,
  getCoC,
  acceptCoC,
} = require('./modules/user/controller');
const {
  listPosts,
  plusPost,
  boostPost,
  unboostPost,
  createPost,
  createComment,
} = require('./modules/post/controller');
const {
  listCommunities,
  detailCommunity,
  joinCommunity,
  leaveCommunity,
} = require('./modules/community/controller');
const { createRelationship } = require('./modules/relationship/controller');


const app = express();
const port = process.env.PORT || 8787;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  next();
});

// Nodemailer
transporter.verify(function(error, success) {
	if (error) {
		console.log("Email server error!")
		console.log(error); 
	} else {
		console.log("Email server is ready to take our messages");
	}
});

mongoose.connect(configDatabase.url, { useNewUrlParser: true });

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use('/api/*', authHandler)

app.post('/api/expo_token/register', registerExpoToken);
app.post('/api/register', register);
app.post('/api/login', login);

app.get('/api/posts/:context?/:timestamp?/:identifier?', listPosts);
app.post('/api/post', createPost);
app.post('/api/plus/:postid', plusPost);
app.post('/api/boost/:postid/:locationid?', boostPost)
app.post('/removeboost/:postid', unboostPost)
app.post('/api/comment/:postid/:commentid?', createComment);

app.get('/api/communities/all', listCommunities);
app.get('/api/communities/:communityid', detailCommunity);
app.post('/api/community/join', joinCommunity);
app.post('/api/community/leave', leaveCommunity);

app.get('/api/users/:sortorder', listUsers)
app.get('/api/user/:identifier', detailUser);
app.post('/api/settings', changeSettings);
app.post('/api/report', reportUser);

app.post('/api/relationship', createRelationship);

app.get('/api/code-of-conduct', getCoC);
app.post('/api/code-of-conduct/accept', acceptCoC);

app.listen(port);

console.log(`Server ready at http://localhost:${port}/`);

module.exports = app;
