// source: https://gist.github.com/theskumar/54be20713e53d418bf02
// can add to this list in the future

export const reservedNames = [
  'about', 'access', 'account', 'accounts', 'add', 'address', 'adm', 'admin', 'administration', 'adult', 'advertising', 'affiliate', 'affiliates', 'ajax', 'analytics', 'android', 'anon', 'anonymous', 'api', 'app', 'apps', 'archive', 'atom', 'auth', 'authentication', 'avatar',
  'backup', 'banner', 'banners', 'bin', 'billing', 'blog', 'blogs', 'board', 'bot', 'bots', 'business',
  'chat', 'cache', 'cadastro', 'calendar', 'campaign', 'careers', 'cgi', 'client', 'cliente', 'code', 'comercial', 'compare', 'config', 'connect', 'contact', 'contest', 'create', 'code', 'compras', 'css',
  'dashboard', 'data', 'db', 'design', 'delete', 'demo', 'design', 'designer', 'dev', 'devel', 'dir', 'directorydoc', 'docs', 'domain', 'download', 'downloads',
  'edit', 'editor', 'email', 'ecommerce',
  'forum', 'forums', 'faq', 'favorite', 'feed', 'feedback', 'flog', 'follow', 'file', 'files', 'free', 'ftpgadget',
  'gadgets', 'games', 'guest', 'group', 'groups',
  'help', 'home', 'homepage', 'host', 'hosting', 'hostname', 'html', 'http', 'httpd', 'https', 'hpg',
  'info', 'information', 'image', 'img', 'images', 'imap', 'index', 'invite', 'intranet', 'indice', 'ipad', 'iphone', 'irc',
  'java', 'javascript', 'job', 'jobs', 'js',
  'knowledgebase',
  'log', 'login', 'logs', 'logout', 'list', 'lists',
  'mail', 'mail1', 'mail2', 'mail3', 'mail4', 'mail5', 'mailer', 'mailing', 'mx', 'manager', 'marketing', 'master', 'me', 'media', 'message', 'microblog', 'microblogs', 'mine', 'mp3', 'msg', 'msn', 'mysql', 'messenger', 'mob', 'mobile', 'movie', 'movies', 'music', 'musicas', 'my',
  'name', 'named', 'net', 'network', 'new', 'news', 'newsletter', 'nick', 'nickname', 'notes', 'noticias', 'ns', 'ns1', 'ns2', 'ns3', 'ns4',
  'old', 'online', 'operator', 'order', 'orders',
  'page', 'pager', 'pages', 'panel', 'password', 'perl', 'pic', 'pics', 'photo', 'photos', 'photoalbum', 'php', 'plugin', 'plugins', 'pop', 'pop3', 'post', 'postmaster', 'postfix', 'posts', 'profile', 'project', 'projects', 'promo', 'pub', 'public', 'python',
  'random', 'register', 'registration', 'root', 'ruby', 'rss',
  'sale', 'sales', 'sample', 'samples', 'script', 'scripts', 'secure', 'send', 'service', 'shop', 'sql', 'signup', 'signin', 'search', 'security', 'settings', 'setting', 'setup', 'site', 'sites', 'sitemap', 'smtp', 'soporte', 'ssh', 'stage', 'staging', 'start', 'subscribe', 'subdomain', 'suporte', 'support', 'stat', 'static', 'stats', 'status', 'store', 'stores', 'system',
  'tablet', 'tablets', 'tech', 'telnet', 'test', 'test1', 'test2', 'test3', 'teste', 'tests', 'theme', 'themes', 'tmp', 'todo', 'task', 'tasks', 'tools', 'tv', 'talk',
  'update', 'upload', 'url', 'user', 'username', 'usuario', 'usage',
  'vendas', 'video', 'videos', 'visitor',
  'win', 'ww', 'www', 'www1', 'www2', 'www3', 'www4', 'www5', 'www6', 'www7', 'wwww', 'wws', 'wwws', 'web', 'webmail', 'website', 'websites', 'webmaster', 'workshop',
  'xxx', 'xpg', 'you', 'yourname',
  'yourusername', 'yoursite', 'yourdomain'
];

// Distinctive profanity / slur stems used as substring checks against the
// leetspeak-normalized name (e.g. 3→e, 0→o, separators stripped). Keep this
// list to terms unlikely to collide with real names — substring matching on
// short generic words like 'ass' or 'tit' would block legitimate names like
// "cassius" or "titus", which is unacceptable on a Latin-themed site.
export const inappropriateSubstrings = [
  'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'bastard',
  'blowjob', 'bollock', 'bukkake', 'bullshit', 'coochie',
  'cumshot', 'dildo', 'dyke', 'faggot', 'handjob',
  'hentai', 'jackoff', 'jerkoff', 'jizz', 'kike',
  'milf', 'molest', 'motherfuck', 'nigga', 'nigger',
  'paki', 'pedo', 'porn', 'pussy', 'queef',
  'rapist', 'retard', 'rimjob', 'shithead',
  'skank', 'slut', 'spic', 'tranny', 'twat',
  'vagina', 'wanker', 'whore'
];

// Whole-token bans (matched after splitting on hyphen/underscore + lowercasing).
// Use this list for short or generic words where substring matching would
// cause false positives.
export const inappropriateNames = [
  'gyatt', 'cenat', 'monkus', 'mcpickle', 'sigma',
  'anal', 'anus', 'arse', 'ass', 'ballsack', 'boner', 'boob',
  'clit', 'cock', 'coon', 'crap', 'cum', 'damn', 'dick',
  'douche', 'fag', 'goddamn', 'hoe', 'horny', 'kunt',
  'nipple', 'orgasm', 'orgy', 'penis', 'piss', 'porno',
  'prick', 'pube', 'rape', 'scrotum', 'semen', 'sex',
  'shag', 'spunk', 'tit', 'titties', 'turd', 'wank', 'wop',
  ...inappropriateSubstrings
];

const banList = reservedNames.concat(inappropriateNames);
banList.push('');

export default banList;
