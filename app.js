var express = require('express'),
    https = require('https'),
    Twit = require('twit'),
    natural = require('natural'),
    fs = require('fs'),
    io = require('socket.io');

Object.size = function(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};

var sFactor = 1;
var received = { total:0, negative:0 };
var data;

try {
    data = fs.readFileSync('data.json');
} catch(e) {
}
if(!data) {
    data = {
        cSpam: 0,
        cHam: 0,
        wSpam: 0, 
        wHam: 0,
        spamDictionary: {},
        hamDictionary: {},
        dictionary: {}
    };
} else {
    data = JSON.parse(data);
    console.log("Loaded from data.json");
}

process.on('SIGINT', function () {
    fs.writeFileSync("data.json", JSON.stringify(data));
    console.log("Data saved.");
    process.exit(0);
});

var tokenizer = new natural.WordTokenizer();

var T = new Twit({
        consumer_key:         'vZmPHiHleXTeNjNbOg7cDA'
      , consumer_secret:      'uoEIUhwuA6EGeTQmH6ecSaCxKIkIferg9RYDaDt4c'
      , access_token:         '87438163-0Eshllfh2h00gbKhhQUjPYqIyIOaFx2zqukL1LkER'
      , access_token_secret:  'q0WSpTfUH9XJ34uZu3tlwxJ1WPx05KZvqL6Trl3OE'
});

var app = express.createServer(express.logger());
io = io.listen(app);

app.set('view engine', 'jade');
app.set('views', __dirname + '/views');
app.use(express.cookieParser());
app.use(express.session({ secret: "kjglasbjnasbn,m" }));
app.use(express.bodyParser());
app.set('view options', {
  layout: false
});

app.configure('development', function(){
    app.use(express.static(__dirname + '/public'));
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  var oneYear = 31557600000;
  app.use(express.static(__dirname + '/public', { maxAge: oneYear }));
  app.use(express.errorHandler());
});

var stream = T.stream('statuses/filter', {track:"mercadolibre"});
stream.on('tweet', function (tweet) {
    console.log(tweet.text);
    var tokens = tokenizer.tokenize(tweet.text);

    updateDictionary(tokens);

    tweet.tokens = tokens;
    received.total++;

    io.sockets.in('ask').volatile.emit('tweets', tweet);
    var spam = spammity(tokens);
    if(spam>0.95) {
      received.negative++;
      io.sockets.in('all').volatile.emit('negative', tweet);
    }
});

app.listen(80);

io.sockets.on('connection', function (socket) {
  socket.join('all');
  socket.join('ask');

  socket.on('classify negative', function (tweet) {
    console.log("NEGATIVE");
    updateSpam(tweet.tokens);
  });

  socket.on('classify other', function (tweet) {
    console.log("OTHER");
    updateHam(tweet.tokens);
  });

  socket.on('dont ask', function() {
    console.log("DONT ASK");
    socket.leave('ask');
  });
});

setInterval(function() {
  io.sockets.in('all').volatile.emit('data', received);
  console.log("Data sent. " + JSON.stringify(received));
  received.negative = 0;
  received.total = 0;
}, 5000);


app.get('/', function(req, res) {
  res.render('index');
});

function updateDictionary(tokens) {
    for(var i in tokens) {
        var word = tokens[i];
        data.dictionary[word]=data.dictionary[word]+1 || 1;
    }
}

function updateSpam(tokens) {
    for(var i in tokens) {
        var word = tokens[i];
        data.spamDictionary[word]=data.spamDictionary[word]+1 || 1;
    }
    data.wSpam+=tokens.length;
    data.cSpam++;
}

function updateHam(tokens) {
    for(var i in tokens) {
        var word = tokens[i];
        data.hamDictionary[word]=data.hamDictionary[word]+1 || 1;
    }
    data.wHam+=tokens.length;
    data.cHam++;
}

function spammity(tokens) {
    /*
     * Bayes
     *
     * P(S/M) =          P(M/S) * P(S)
     *         ------------------------------
     *          P(M/S) * P(S) + P(M/H) * P(H)
     *
     */

    /*
     * Laplacian Smoothing
     *
     * P(x) = count(x) + k
     *       --------------
     *          N + k|x|
     */
     
    var pms = 1;
    var pmh = 1;
    var ps = (data.cSpam+sFactor)/(data.cSpam+data.cHam+2);
    var ph = (data.cHam+sFactor)/(data.cSpam+data.cHam+2);


    for(var i in tokens) {
        var word = tokens[i];
        
        var pws = ((data.spamDictionary[word] || 0)+sFactor)/(data.wSpam+Object.size(data.dictionary));

        var pwh = ((data.hamDictionary[word] || 0)+sFactor)/(data.wHam+Object.size(data.dictionary));

        pms*=pws;
        pmh*=pwh;
    }

    return (pms*ps)/(pms*ps+pmh*ph);
}
