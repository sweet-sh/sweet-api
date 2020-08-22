const request = require('supertest');
const User = require('../src/modules/user/model');
const { sampleUser, unverifiedUser } = require('./populatedb');

describe('logging in', () => {
  let app = require('../src/index');

  beforeEach((done) => {
    User.create([sampleUser, unverifiedUser], (err) => {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  afterEach((done) => {
    User.remove({}, (err) => {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  it('should 401 if missing email or password', (done) => {
    const password = 'foobar';
    request(app).post('/api/login').send({ password }).expect(401, done);
  });

  it('should 401 if no user matches the submitted email', (done) => {
    const email = 'unknown@example.com';
    const password = 'foobar';
    request(app).post('/api/login').send({ email, password }).expect(401, done);
  });

  it('should 401 if the matching user is not verified', (done) => {
    const email = 'unverified@example.com';
    const password = 'foobar';
    request(app).post('/api/login').send({ email, password }).expect(403, done);
  });

  it("should 401 if the submitted password doesn't match", (done) => {
    const email = 'test@example.com';
    const password = 'barfoo';
    request(app).post('/api/login').send({ email, password }).expect(401, done);
  });

  it("should 200 if everything's copacetic", (done) => {
    const email = 'test@example.com';
    const password = 'foobar';
    request(app).post('/api/login').send({ email, password }).expect(200, done);
  });
});
