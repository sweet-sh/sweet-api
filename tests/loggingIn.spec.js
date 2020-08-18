const request = require('supertest');
const User = require('../src/modules/user/model');
const { sampleUser } = require('./populatedb');


describe('logging in', function () {
  let app = require('../src/index');

  beforeEach(function (done) {
    User.create(sampleUser, function (err) {
      if (err) return done(err);
      done();
    });
  });

  afterEach(function (done) {
    User.remove({}, function (err) {
      if (err) return done(err);
      done();
    });
  });

  it('should 401 if missing email or password');
  it('should 401 if no user matches the submitted email');
  it('should 401 if the matching user is not verified');
  it("should 401 if the submitted password doesn't match");
  it("should 200 if everything's copacetic", function(done) {
    const email = 'test@example.com';
    const password = 'foobar';
    request(app)
      .post('/api/login')
      .send({ email, password })
      .expect(200, done);
  });
});
