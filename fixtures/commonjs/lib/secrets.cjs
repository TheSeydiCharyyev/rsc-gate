require('server-only');

const KEY = process.env.SECRET_KEY;

module.exports = { token: KEY };
