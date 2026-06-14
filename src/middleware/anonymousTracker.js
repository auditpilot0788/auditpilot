const crypto = require('crypto');

function generateAnonId() {
  return 'anon_' + crypto.randomBytes(16).toString('hex');
}

function getAnonId(req, res) {
  let anonId = req.cookies?.ap_anon_id;
  if (!anonId) {
    anonId = generateAnonId();
    res.cookie('ap_anon_id', anonId, {
      maxAge:   365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure:   true,
      sameSite: 'none'
    });
  }
  return anonId;
}

module.exports = { getAnonId, generateAnonId };
