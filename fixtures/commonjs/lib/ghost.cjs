// Nothing may reach this file. It is server-only on purpose: if a negative case
// above ever starts resolving, this shows up as a leak and the test fails.
require('server-only');

module.exports = { ghost: true };
