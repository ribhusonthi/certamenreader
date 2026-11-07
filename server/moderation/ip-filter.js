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

const ipFilterError = (err, req, res, _next) => {
  if (err instanceof IpDeniedError) {
    console.log(`Blocked IP: ${req.ip}`);
    res.status(403);
    res.end();
  } else {
    res.status(err.status || 500);
  }
};

export { ipFilterMiddleware, ipFilterError };
