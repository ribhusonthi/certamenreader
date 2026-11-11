import expressIpfilter from 'express-ipfilter';
const { IpFilter, IpDeniedError } = expressIpfilter;

const ips = [
  '3.236.192.58',
  '18.206.238.89',
  '18.215.118.139'
];

// req.ip is the address Cloud Run's proxy saw ('trust proxy' is 1 hop). The
// first X-Forwarded-For entry is whatever the client sent, so a blocked IP
// could get past the filter by sending a made-up header.
const clientIp = (req, _res) => req.ip;

const ipFilterMiddleware = IpFilter(ips, { mode: 'deny', log: false, detectIp: clientIp });

const ipFilterError = (err, req, res, next) => {
  if (err instanceof IpDeniedError) {
    console.log(`Blocked IP: ${req.ip}`);
    res.status(403);
    res.end();
  } else {
    // Not ours (for example a request body that isn't valid JSON). Pass it on
    // to the error handler in index.js; setting a status without answering
    // left the request hanging until the client gave up.
    next(err);
  }
};

export { ipFilterMiddleware, ipFilterError };
